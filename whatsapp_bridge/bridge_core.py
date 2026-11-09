"""Núcleo do atendimento por WhatsApp da Luna.

Sem dependências externas: o envio de mensagens e a chamada à Luna entram como funções (send_text e ask_luna),
o que permite testar tudo sem WhatsApp real. Veja bridge.py para a ligação com a Evolution API e o FastAPI.
"""
import asyncio
import random
import re
import sqlite3
import time
from dataclasses import dataclass, field

PREFIXO = "*Luna:* "
_IGNORAR_JID = ("@g.us", "@broadcast", "@newsletter")
_ROTULO_MIDIA = {
    "audioMessage": "um áudio",
    "imageMessage": "uma imagem",
    "videoMessage": "um vídeo",
    "stickerMessage": "uma figurinha",
    "documentMessage": "um documento",
    "contactMessage": "um contato",
    "locationMessage": "uma localização",
}


def so_digitos(valor) -> str:
    return re.sub(r"\D", "", str(valor or ""))


def canonico(numero) -> str:
    """Forma única do número. Contas antigas do Brasil vêm sem o nono dígito: normaliza para 13 dígitos."""
    d = so_digitos(numero)
    if d.startswith("55") and len(d) == 12 and d[4] in "6789":
        d = d[:4] + "9" + d[4:]
    return d


def numero_do_jid(jid) -> str:
    return so_digitos(str(jid or "").split("@")[0].split(":")[0])


@dataclass
class Config:
    control_number: str
    contatos: dict = field(default_factory=dict)  # número -> nome (só estes são atendidos)
    dono: str = "o dono"
    debounce_s: float = 8.0          # espera por mais mensagens antes de responder (modo ligado)
    auto_padrao_min: int = 10        # minutos de espera no modo auto
    auto_unidade_s: float = 60.0     # 60 = minutos de verdade (os testes usam menos)
    max_idade_s: int = 600           # mensagens mais velhas que isso (ex.: reconexão) são ignoradas
    cooldown_s: float = 20.0         # intervalo mínimo entre duas respostas ao mesmo contato
    max_por_hora: int = 6
    max_por_dia: int = 20
    delay_min_ms: int = 2500
    delay_max_ms: int = 7000
    sessao_s: int = 3 * 3600         # nova "conversa" para o resumo depois deste intervalo

    def __post_init__(self):
        self.control_number = canonico(self.control_number)
        self.contatos = {canonico(k): str(v) for k, v in self.contatos.items()}


class Store:
    def __init__(self, caminho: str = ":memory:"):
        self.db = sqlite3.connect(caminho, check_same_thread=False)
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT);
            CREATE TABLE IF NOT EXISTS mensagens (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, role TEXT, texto TEXT, ts REAL);
            CREATE INDEX IF NOT EXISTS idx_msg_numero ON mensagens (numero, id);
            CREATE TABLE IF NOT EXISTS vistos (msg_id TEXT PRIMARY KEY, ts REAL);
            CREATE TABLE IF NOT EXISTS envios (numero TEXT, ts REAL);
            CREATE TABLE IF NOT EXISTS jids (canonico TEXT PRIMARY KEY, envio TEXT);
            CREATE TABLE IF NOT EXISTS resumos (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, nome TEXT, assunto TEXT, ts REAL);
            CREATE TABLE IF NOT EXISTS escalacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, nome TEXT, pergunta TEXT, motivo TEXT, ts REAL, resolvida INTEGER DEFAULT 0);
            """
        )
        self.db.commit()

    def get(self, chave, padrao=None):
        linha = self.db.execute("SELECT valor FROM config WHERE chave=?", (chave,)).fetchone()
        return linha[0] if linha else padrao

    def set(self, chave, valor):
        self.db.execute("INSERT OR REPLACE INTO config VALUES (?,?)", (chave, str(valor)))
        self.db.commit()

    def visto(self, msg_id, ts) -> bool:
        """True se a mensagem já tinha sido processada (webhooks podem repetir)."""
        if not msg_id:
            return False
        if self.db.execute("SELECT 1 FROM vistos WHERE msg_id=?", (str(msg_id),)).fetchone():
            return True
        self.db.execute("INSERT INTO vistos VALUES (?,?)", (str(msg_id), ts))
        self.db.commit()
        return False

    def add_msg(self, numero, role, texto, ts):
        self.db.execute("INSERT INTO mensagens (numero, role, texto, ts) VALUES (?,?,?,?)", (numero, role, texto, ts))
        self.db.commit()

    def historico(self, numero, limite=20):
        linhas = self.db.execute(
            "SELECT role, texto, ts FROM mensagens WHERE numero=? ORDER BY id DESC LIMIT ?", (numero, limite)
        ).fetchall()
        return list(reversed(linhas))

    def nao_respondidas(self, numero):
        """Mensagens do contato que nem o dono nem a Luna viram/responderam ainda."""
        ultimo_dono = self.db.execute(
            "SELECT COALESCE(MAX(id),0) FROM mensagens WHERE numero=? AND role='dono'", (numero,)
        ).fetchone()[0]
        corte = max(ultimo_dono, int(self.get(f"ate_{numero}", 0)))
        return self.db.execute(
            "SELECT role, texto, ts FROM mensagens WHERE numero=? AND role='contato' AND id>? ORDER BY id", (numero, corte)
        ).fetchall()

    def marcar_atendido_ate(self, numero, marca):
        self.set(f"ate_{numero}", marca)

    def ultimo_id(self, numero) -> int:
        return self.db.execute("SELECT COALESCE(MAX(id),0) FROM mensagens WHERE numero=?", (numero,)).fetchone()[0]

    def dono_depois(self, numero, marca) -> bool:
        """O dono respondeu depois da mensagem de referência? (compara a ordem de chegada, não relógios)"""
        return bool(self.db.execute("SELECT 1 FROM mensagens WHERE numero=? AND role='dono' AND id>? LIMIT 1", (numero, marca)).fetchone())

    def tem_luna(self, numero) -> bool:
        return bool(self.db.execute("SELECT 1 FROM mensagens WHERE numero=? AND role='luna' LIMIT 1", (numero,)).fetchone())

    def ultima_luna(self, numero):
        return self.db.execute(
            "SELECT texto, ts FROM mensagens WHERE numero=? AND role='luna' ORDER BY id DESC LIMIT 1", (numero,)
        ).fetchone()

    def registrar_envio(self, numero, ts):
        self.db.execute("INSERT INTO envios VALUES (?,?)", (numero, ts))
        self.db.commit()

    def contar_envios(self, numero, desde):
        return self.db.execute("SELECT COUNT(*) FROM envios WHERE numero=? AND ts>=?", (numero, desde)).fetchone()[0]

    def ultimo_envio(self, numero):
        return self.db.execute("SELECT COALESCE(MAX(ts),0) FROM envios WHERE numero=?", (numero,)).fetchone()[0]

    def lembrar_jid(self, can, envio):
        self.db.execute("INSERT OR REPLACE INTO jids VALUES (?,?)", (can, envio))
        self.db.commit()

    def numero_envio(self, can):
        linha = self.db.execute("SELECT envio FROM jids WHERE canonico=?", (can,)).fetchone()
        return linha[0] if linha else can

    def novo_resumo(self, numero, nome, assunto, ts):
        self.db.execute("INSERT INTO resumos (numero, nome, assunto, ts) VALUES (?,?,?,?)", (numero, nome, assunto, ts))
        self.db.commit()

    def ultimo_resumo_ts(self, numero):
        linha = self.db.execute("SELECT MAX(ts) FROM resumos WHERE numero=?", (numero,)).fetchone()
        return linha[0] if linha and linha[0] else None

    def resumos_desde(self, ts):
        return self.db.execute("SELECT nome, assunto, ts FROM resumos WHERE ts>=? ORDER BY ts", (ts,)).fetchall()

    def nova_escalacao(self, numero, nome, pergunta, motivo, ts) -> int:
        cur = self.db.execute(
            "INSERT INTO escalacoes (numero, nome, pergunta, motivo, ts) VALUES (?,?,?,?,?)", (numero, nome, pergunta, motivo, ts)
        )
        self.db.commit()
        return cur.lastrowid

    def escalacao(self, id_):
        return self.db.execute(
            "SELECT id, numero, nome, pergunta, motivo, resolvida FROM escalacoes WHERE id=?", (id_,)
        ).fetchone()

    def resolver(self, id_):
        self.db.execute("UPDATE escalacoes SET resolvida=1 WHERE id=?", (id_,))
        self.db.commit()

    def abertas(self) -> int:
        return self.db.execute("SELECT COUNT(*) FROM escalacoes WHERE resolvida=0").fetchone()[0]

    def podar(self, ts_limite):
        self.db.execute("DELETE FROM mensagens WHERE ts<?", (ts_limite,))
        self.db.execute("DELETE FROM vistos WHERE ts<?", (ts_limite,))
        self.db.execute("DELETE FROM envios WHERE ts<?", (ts_limite,))
        self.db.commit()


class Bridge:
    def __init__(self, cfg: Config, store: Store, send_text, ask_luna, now=time.time, sleep=asyncio.sleep,
                 rand=random.uniform, log=print):
        self.cfg, self.store = cfg, store
        self.send_text, self.ask_luna = send_text, ask_luna
        self.now, self.sleep, self.rand, self.log = now, sleep, rand, log
        self.pendentes: dict[str, asyncio.Task] = {}
        self.processando: set[str] = set()
        self.chegou_novo: dict[str, bool] = {}
        self.avisou_limite: dict[str, float] = {}
        self.nao_liberados_logados: set[str] = set()

    # ------------------------------------------------------------ entrada
    async def handle_webhook(self, payload: dict):
        evento = str(payload.get("event", "")).lower().replace("_", ".").replace("-", ".")
        if evento != "messages.upsert":
            return
        dados = payload.get("data")
        for msg in dados if isinstance(dados, list) else [dados]:
            if isinstance(msg, dict):
                try:
                    await self._mensagem(msg)
                except Exception as exc:  # um webhook ruim nunca derruba o serviço
                    self.log(f"[Ponte] erro ao tratar mensagem: {type(exc).__name__}: {exc}")

    @staticmethod
    def _texto(msg: dict) -> tuple[str, str]:
        corpo = msg.get("message") or {}
        texto = (
            corpo.get("conversation")
            or (corpo.get("extendedTextMessage") or {}).get("text")
            or (corpo.get("imageMessage") or {}).get("caption")
            or (corpo.get("videoMessage") or {}).get("caption")
            or ""
        )
        tipo = msg.get("messageType") or next(iter(corpo), "")
        return str(texto).strip(), str(tipo)

    def _timestamp(self, msg: dict) -> float:
        bruto = msg.get("messageTimestamp")
        if isinstance(bruto, dict):
            bruto = bruto.get("low")
        try:
            return float(bruto)
        except (TypeError, ValueError):
            return self.now()

    async def _mensagem(self, msg: dict):
        chave = msg.get("key") or {}
        jid = str(chave.get("remoteJid") or "")
        if not jid or any(jid.endswith(s) for s in _IGNORAR_JID) or jid == "status@broadcast":
            return
        alt = chave.get("remoteJidAlt") or chave.get("senderPn") or msg.get("senderPn")
        if jid.endswith("@lid") and alt:
            jid = str(alt)
        if self.store.visto(chave.get("id"), self.now()):
            return
        da_pessoa = bool(chave.get("fromMe"))
        texto, tipo = self._texto(msg)
        ts = self._timestamp(msg)
        if self.now() - ts > self.cfg.max_idade_s:
            self.log("[Ponte] mensagem antiga ignorada (reconexão?).")
            return
        envio = numero_do_jid(jid)
        can = canonico(envio)

        if can == self.cfg.control_number:
            if texto.startswith("#"):
                self.store.lembrar_jid(can, envio)
                await self._comando(texto)
            return
        if da_pessoa:
            if can in self.cfg.contatos and texto and not texto.startswith(PREFIXO.strip()):
                self.store.add_msg(can, "dono", texto, ts)
                self._cancelar_pendente(can)
            return
        if can not in self.cfg.contatos:
            if can not in self.nao_liberados_logados and len(self.nao_liberados_logados) < 200:
                self.nao_liberados_logados.add(can)
                self.log(f"[Ponte] mensagem de número não liberado ignorada (…{can[-4:]}). Se for um contato seu, confira contatos.json.")
            return
        nome = self.cfg.contatos[can]
        self.store.lembrar_jid(can, envio)
        if not texto:
            rotulo = _ROTULO_MIDIA.get(tipo, "uma mensagem sem texto")
            await self._avisar(f"🤖 [Luna OS]\n👤 {nome} mandou {rotulo}. Não respondo mídia, é com você.")
            return
        self.store.add_msg(can, "contato", texto, ts)
        self._agendar(can)

    # ------------------------------------------------------------ agendamento
    def _modo(self) -> str:
        return self.store.get("modo", "off")

    def _agendar(self, can: str):
        modo = self._modo()
        if modo == "off":
            return
        if can in self.processando:
            self.chegou_novo[can] = True
            return
        atual = self.pendentes.get(can)
        if modo == "auto":
            if atual and not atual.done():
                return
            minutos = float(self.store.get("auto_min", self.cfg.auto_padrao_min))
            espera = minutos * self.cfg.auto_unidade_s
        else:
            if atual and not atual.done():
                atual.cancel()
            espera = self.cfg.debounce_s
        self.pendentes[can] = asyncio.create_task(self._depois(can, espera))

    def _cancelar_pendente(self, can: str):
        tarefa = self.pendentes.get(can)
        if tarefa and not tarefa.done() and can not in self.processando:
            tarefa.cancel()

    async def _depois(self, can: str, espera: float):
        try:
            await self.sleep(espera)
        except asyncio.CancelledError:
            return
        self.processando.add(can)
        try:
            await self._processar(can)
        except Exception as exc:
            self.log(f"[Ponte] erro ao responder: {type(exc).__name__}: {exc}")
        finally:
            self.processando.discard(can)
            if self.chegou_novo.pop(can, False):
                self._agendar(can)

    # ------------------------------------------------------------ resposta
    async def _avisar(self, texto: str):
        try:
            await self.send_text(self.store.numero_envio(self.cfg.control_number), texto, 0)
        except Exception as exc:
            self.log(f"[Ponte] não consegui avisar o dono: {type(exc).__name__}: {exc}")

    async def _perguntar(self, can: str, nome: str, instrucao: str = ""):
        mensagens = [{"role": r, "content": t} for r, t, _ in self.store.historico(can, 20)]
        try:
            return await self.ask_luna(
                {"nome": nome, "mensagens": mensagens, "primeiro_contato": not self.store.tem_luna(can), "instrucao_dono": instrucao}
            )
        except Exception as exc:
            self.log(f"[Ponte] a Luna não respondeu: {type(exc).__name__}: {exc}")
            await self._avisar(f"⚠️ [Luna OS] Não consegui falar com a Luna para responder {nome}. Veja a conversa você mesmo.")
            return None

    async def _enviar(self, can: str, texto: str, marca):
        espera = self.cfg.cooldown_s - (self.now() - self.store.ultimo_envio(can))
        if espera > 0:
            await self.sleep(espera)
        if marca is not None and self.store.dono_depois(can, marca):
            return False  # o dono respondeu enquanto a Luna preparava a resposta
        atraso = int(self.rand(self.cfg.delay_min_ms, self.cfg.delay_max_ms))
        await self.send_text(self.store.numero_envio(can), PREFIXO + texto, atraso)
        agora = self.now()
        self.store.add_msg(can, "luna", texto, agora)
        self.store.registrar_envio(can, agora)
        return True

    async def _processar(self, can: str):
        nome = self.cfg.contatos.get(can)
        pendentes = self.store.nao_respondidas(can)
        if not nome or not pendentes:
            return
        marca = self.store.ultimo_id(can)
        agora = self.now()
        if self.store.contar_envios(can, agora - 3600) >= self.cfg.max_por_hora or self.store.contar_envios(can, agora - 86400) >= self.cfg.max_por_dia:
            if agora - self.avisou_limite.get(can, 0) > 3600:
                self.avisou_limite[can] = agora
                await self._avisar(f"⚠️ [Luna OS] Atingi o limite de respostas com {nome}. Parei de responder esse contato por enquanto.")
            return
        resultado = await self._perguntar(can, nome)
        if resultado is None:
            return
        ultima = pendentes[-1][1]
        if resultado.get("erro"):
            self.store.marcar_atendido_ate(can, marca)
            await self._escalar(can, nome, ultima, resultado.get("motivo", ""))
            return
        texto = str(resultado.get("resposta") or "").strip()
        escalar = bool(resultado.get("escalar"))
        if texto and escalar:
            anterior = self.store.ultima_luna(can)
            if anterior and anterior[0] == texto and agora - anterior[1] < 3600:
                texto = ""  # não repete a mesma mensagem de espera
        if texto and not await self._enviar(can, texto, marca):
            return
        self.store.marcar_atendido_ate(can, marca)  # só o que a Luna realmente viu conta como atendido
        if escalar:
            await self._escalar(can, nome, ultima, resultado.get("motivo", ""))
            return
        assunto = str(resultado.get("assunto") or "").strip() or "(sem assunto claro)"
        ultimo = self.store.ultimo_resumo_ts(can)
        if ultimo is None or agora - ultimo > self.cfg.sessao_s:
            self.store.novo_resumo(can, nome, assunto, agora)
            await self._avisar(f"🤖 [Luna OS]\n👤 Contato: {nome}\n📌 Assunto: {assunto}")

    async def _escalar(self, can: str, nome: str, pergunta: str, motivo: str):
        id_ = self.store.nova_escalacao(can, nome, pergunta, motivo, self.now())
        await self._avisar(
            f"🤖 [Luna OS] ❓ Preciso de você\n👤 Contato: {nome}\n💬 Disse: {pergunta[:200]}\n"
            f"⚠️ Motivo: {motivo or 'não soube como responder'}\n↩️ Responda assim: #{id_} sua instrução (ou #{id_} ignorar)"
        )

    # ------------------------------------------------------------ comandos do dono
    async def _comando(self, texto: str):
        texto = texto.strip()
        m_id = re.match(r"^#(\d+)\s+(.+)$", texto, re.S)
        if m_id:
            return await self._responder_escalacao(int(m_id.group(1)), m_id.group(2).strip())
        m = re.match(r"^#(\w+)\s*(.*)$", texto, re.S)
        cmd, arg = (m.group(1).lower(), m.group(2).strip()) if m else ("", "")
        if cmd in ("ausente", "jogando", "on"):
            self.store.set("modo", "on")
            return await self._avisar("🎮 Modo ausente ligado. Respondo os contatos liberados até você mandar #voltei.")
        if cmd == "auto":
            try:
                minutos = max(1, min(240, int(arg))) if arg else int(self.store.get("auto_min", self.cfg.auto_padrao_min))
            except ValueError:
                return await self._avisar("Use assim: #auto 10 (minutos de espera antes de eu responder).")
            self.store.set("modo", "auto")
            self.store.set("auto_min", minutos)
            return await self._avisar(f"⏱ Modo auto ligado: só respondo se você não responder em {minutos} min.")
        if cmd in ("voltei", "off", "pare"):
            self.store.set("modo", "off")
            for tarefa in self.pendentes.values():
                if not tarefa.done():
                    tarefa.cancel()
            return await self._avisar("👋 Modo ausente desligado. Não respondo mais ninguém.")
        if cmd == "status":
            modo = self._modo()
            extra = f" ({self.store.get('auto_min', self.cfg.auto_padrao_min)} min)" if modo == "auto" else ""
            esperando = sum(1 for t in self.pendentes.values() if not t.done())
            return await self._avisar(
                f"📊 Modo: {modo}{extra}\nContatos liberados: {len(self.cfg.contatos)}\n"
                f"Respostas agendadas: {esperando}\nPedidos esperando você: {self.store.abertas()}"
            )
        if cmd == "resumo":
            linhas = [
                f"• {nome} — {assunto} ({time.strftime('%H:%M', time.localtime(ts))})"
                for nome, assunto, ts in self.store.resumos_desde(self.now() - 86400)
            ]
            return await self._avisar("📋 Últimas 24h:\n" + "\n".join(linhas) if linhas else "📋 Nenhuma conversa atendida nas últimas 24h.")
        if cmd == "contatos":
            return await self._avisar("👥 Liberados: " + (", ".join(sorted(self.cfg.contatos.values())) or "ninguém"))
        return await self._avisar(
            "Comandos: #ausente · #auto 10 · #voltei · #status · #resumo · #contatos · #12 instrução (responde um pedido) · #12 ignorar"
        )

    async def _responder_escalacao(self, id_: int, instrucao: str):
        linha = self.store.escalacao(id_)
        if not linha or linha[5]:
            return await self._avisar(f"Não achei o pedido #{id_} (ou ele já foi resolvido).")
        _, can, nome, _, _, _ = linha
        if instrucao.lower() in ("ignorar", "ignora", "deixa"):
            self.store.resolver(id_)
            return await self._avisar(f"👌 Pedido #{id_} ignorado. Não respondi {nome}.")
        resultado = await self._perguntar(can, nome, instrucao)
        texto = str((resultado or {}).get("resposta") or "").strip()
        if not resultado or resultado.get("erro") or not texto:
            return await self._avisar(f"⚠️ Não consegui escrever a resposta para {nome}. Responda você mesmo.")
        if await self._enviar(can, texto, None):
            self.store.resolver(id_)
            await self._avisar(f"✅ Enviei para {nome}: «{texto[:300]}»")
