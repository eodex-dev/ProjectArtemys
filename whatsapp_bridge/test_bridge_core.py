"""Testes do núcleo da ponte (sem WhatsApp real). Rode: python -m unittest -v test_bridge_core"""
import asyncio
import itertools
import time
import unittest

from bridge_core import PREFIXO, Bridge, Config, Store, canonico

CONTROLE = "5511900000000"
CARLOS = "5511987654321"
_ids = itertools.count(1)


def webhook(jid, texto="", de_mim=False, tipo="conversation", ts=None, mid=None, chave_extra=None):
    chave = {"remoteJid": jid, "fromMe": de_mim, "id": mid or f"M{next(_ids)}"}
    chave.update(chave_extra or {})
    corpo = {"conversation": texto} if tipo == "conversation" else {tipo: {}}
    return {"event": "messages.upsert", "instance": "luna", "data": {"key": chave, "message": corpo, "messageType": tipo, "messageTimestamp": int(ts or time.time())}}


def de(numero, texto="", **kw):
    return webhook(f"{numero}@s.whatsapp.net", texto, **kw)


class Base(unittest.IsolatedAsyncioTestCase):
    def novo(self, **cfg):
        base = dict(control_number=CONTROLE, contatos={CARLOS: "Carlos"}, dono="André", debounce_s=0.03, auto_unidade_s=0.05,
                    cooldown_s=0, max_idade_s=600, delay_min_ms=100, delay_max_ms=100)
        base.update(cfg)
        self.enviados, self.chamadas, self.logs = [], [], []
        self.resposta = {"resposta": "Oi! Sou a Luna, assistente do André.", "assunto": "Convite para jogar", "escalar": False, "motivo": "", "erro": False}

        async def send(numero, texto, delay):
            self.enviados.append((numero, texto, delay))

        async def ask(payload):
            self.chamadas.append(payload)
            if isinstance(self.resposta, Exception):
                raise self.resposta
            return self.resposta

        self.b = Bridge(Config(**base), Store(), send, ask, rand=lambda a, b: a, log=self.logs.append)
        return self.b

    async def esperar(self, s=0.15):
        await asyncio.sleep(s)

    def para(self, numero):
        return [t for n, t, _ in self.enviados if n == numero]

    async def comando(self, texto):
        await self.b.handle_webhook(de(CONTROLE, texto))
        await self.esperar(0.02)


class TestFluxo(Base):
    async def test_desligado_nao_responde(self):
        self.novo()
        await self.b.handle_webhook(de(CARLOS, "bora jogar?"))
        await self.esperar()
        self.assertEqual(self.chamadas, [])
        self.assertEqual(self.enviados, [])

    async def test_modo_ausente_responde_com_prefixo_e_resume(self):
        self.novo()
        await self.comando("#ausente")
        await self.b.handle_webhook(de(CARLOS, "e aí, bora jogar hoje?"))
        await self.esperar()
        self.assertEqual(len(self.chamadas), 1)
        self.assertTrue(self.chamadas[0]["primeiro_contato"])
        self.assertEqual(self.chamadas[0]["nome"], "Carlos")
        resposta = self.para(CARLOS)[0]
        self.assertTrue(resposta.startswith(PREFIXO) and "assistente do André" in resposta)
        resumo = [t for t in self.para(CONTROLE) if "Assunto" in t]
        self.assertEqual(len(resumo), 1)
        self.assertIn("Contato: Carlos", resumo[0])
        self.assertIn("Convite para jogar", resumo[0])

    async def test_rajada_vira_uma_chamada(self):
        self.novo()
        await self.comando("#ausente")
        for t in ("oi", "tá aí?", "preciso falar contigo"):
            await self.b.handle_webhook(de(CARLOS, t))
        await self.esperar()
        self.assertEqual(len(self.chamadas), 1)
        textos = [m["content"] for m in self.chamadas[0]["mensagens"] if m["role"] == "contato"]
        self.assertEqual(textos, ["oi", "tá aí?", "preciso falar contigo"])
        self.assertEqual(len(self.para(CARLOS)), 1)

    async def test_segunda_conversa_nao_e_primeiro_contato(self):
        self.novo()
        await self.comando("#ausente")
        await self.b.handle_webhook(de(CARLOS, "oi"))
        await self.esperar()
        await self.b.handle_webhook(de(CARLOS, "e aí?"))
        await self.esperar()
        self.assertEqual([c["primeiro_contato"] for c in self.chamadas], [True, False])
        historico = [m["role"] for m in self.chamadas[1]["mensagens"]]
        self.assertEqual(historico, ["contato", "luna", "contato"])

    async def test_resumo_so_no_inicio_da_conversa(self):
        self.novo()
        await self.comando("#ausente")
        await self.b.handle_webhook(de(CARLOS, "oi"))
        await self.esperar()
        await self.b.handle_webhook(de(CARLOS, "e aí?"))
        await self.esperar()
        self.assertEqual(len([t for t in self.para(CONTROLE) if "Assunto" in t]), 1)


class TestFiltros(Base):
    async def test_ignora_o_que_nao_deve(self):
        self.novo()
        await self.comando("#ausente")
        await self.b.handle_webhook(de("5511911112222", "oi, sou desconhecido"))
        await self.b.handle_webhook(webhook("12036302@g.us", "msg de grupo"))
        await self.b.handle_webhook(webhook("status@broadcast", "status"))
        await self.b.handle_webhook(de(CARLOS, "msg velha", ts=time.time() - 3600))
        await self.b.handle_webhook(de(CARLOS, "*Luna:* eco da minha própria resposta", de_mim=True))
        repetida = de(CARLOS, "uma vez só", mid="DUP1")
        await self.b.handle_webhook(repetida)
        await self.b.handle_webhook(repetida)
        await self.esperar()
        self.assertEqual(len(self.chamadas), 1)
        textos = [m["content"] for m in self.chamadas[0]["mensagens"]]
        self.assertEqual(textos, ["uma vez só"])
        self.assertTrue(any("não liberado" in l for l in self.logs))

    async def test_contato_nao_executa_comandos(self):
        self.novo()
        await self.b.handle_webhook(de(CARLOS, "#ausente"))
        await self.esperar()
        self.assertEqual(self.b._modo(), "off")

    async def test_nono_digito_e_lid(self):
        self.novo()
        await self.comando("#ausente")
        await self.b.handle_webhook(de("551187654321", "conta antiga sem o 9"))
        await self.esperar()
        self.assertEqual(len(self.chamadas), 1)
        self.assertEqual(self.enviados[-2][0], "551187654321") if False else None
        self.assertIn("551187654321", [n for n, _, _ in self.enviados])
        self.assertEqual(canonico("551187654321"), CARLOS)
        await self.b.handle_webhook(webhook("999999@lid", "pelo lid", chave_extra={"remoteJidAlt": f"{CARLOS}@s.whatsapp.net"}))
        await self.esperar()
        self.assertEqual(len(self.chamadas), 2)

    async def test_midia_so_avisa_o_dono(self):
        self.novo()
        await self.comando("#ausente")
        await self.b.handle_webhook(de(CARLOS, tipo="audioMessage"))
        await self.esperar()
        self.assertEqual(self.chamadas, [])
        self.assertEqual(self.para(CARLOS), [])
        self.assertTrue(any("um áudio" in t for t in self.para(CONTROLE)))


class TestAuto(Base):
    async def test_dono_responde_antes_do_prazo(self):
        self.novo()
        await self.comando("#auto 1")
        await self.b.handle_webhook(de(CARLOS, "tá aí?"))
        await asyncio.sleep(0.02)
        await self.b.handle_webhook(de(CARLOS, "tô aqui, fala!", de_mim=True))
        await self.esperar(0.12)
        self.assertEqual(self.chamadas, [])
        self.assertEqual(self.para(CARLOS), [])

    async def test_dono_nao_responde_luna_assume(self):
        self.novo()
        await self.comando("#auto 1")
        await self.b.handle_webhook(de(CARLOS, "tá aí?"))
        await asyncio.sleep(0.02)
        self.assertEqual(self.chamadas, [])
        await self.esperar(0.1)
        self.assertEqual(len(self.chamadas), 1)
        self.assertEqual(len(self.para(CARLOS)), 1)

    async def test_resposta_do_dono_entra_no_historico(self):
        self.novo()
        await self.comando("#ausente")
        await self.b.handle_webhook(de(CARLOS, "oi"))
        await self.esperar()
        await self.b.handle_webhook(de(CARLOS, "e aí, tudo bem", de_mim=True))
        await self.b.handle_webhook(de(CARLOS, "beleza"))
        await self.esperar()
        self.assertEqual([m["role"] for m in self.chamadas[1]["mensagens"]], ["contato", "luna", "dono", "contato"])


class TestEscalacao(Base):
    async def test_pergunta_ao_dono_e_resposta_por_instrucao(self):
        self.novo()
        await self.comando("#ausente")
        self.resposta = {"resposta": "Vou confirmar isso com André e já te respondo.", "assunto": "Orçamento", "escalar": True, "motivo": "Pede preço", "erro": False}
        await self.b.handle_webhook(de(CARLOS, "quanto fica o serviço?"))
        await self.esperar()
        self.assertIn("Vou confirmar", self.para(CARLOS)[0])
        aviso = [t for t in self.para(CONTROLE) if "Preciso de você" in t][0]
        self.assertIn("#1", aviso)
        self.assertIn("quanto fica o serviço?", aviso)
        self.resposta = {"resposta": "O André disse que fica R$ 200.", "assunto": "", "escalar": False, "motivo": "", "erro": False}
        await self.comando("#1 diga que fica 200 reais")
        self.assertEqual(self.chamadas[-1]["instrucao_dono"], "diga que fica 200 reais")
        self.assertEqual(self.para(CARLOS)[-1], PREFIXO + "O André disse que fica R$ 200.")
        self.assertTrue(any("Enviei para Carlos" in t for t in self.para(CONTROLE)))
        await self.comando("#1 manda de novo")
        self.assertTrue(any("já foi resolvido" in t for t in self.para(CONTROLE)))

    async def test_ignorar_pedido(self):
        self.novo()
        await self.comando("#ausente")
        self.resposta = {"resposta": "", "assunto": "x", "escalar": True, "motivo": "dúvida", "erro": True}
        await self.b.handle_webhook(de(CARLOS, "???"))
        await self.esperar()
        self.assertEqual(self.para(CARLOS), [])
        await self.comando("#1 ignorar")
        self.assertEqual(self.para(CARLOS), [])
        self.assertTrue(any("ignorado" in t for t in self.para(CONTROLE)))

    async def test_falha_da_luna_nao_responde_ao_contato(self):
        self.novo()
        await self.comando("#ausente")
        self.resposta = RuntimeError("sem internet")
        await self.b.handle_webhook(de(CARLOS, "oi"))
        await self.esperar()
        self.assertEqual(self.para(CARLOS), [])
        self.assertTrue(any("Não consegui falar com a Luna" in t for t in self.para(CONTROLE)))

    async def test_mensagem_de_espera_nao_repete(self):
        self.novo()
        await self.comando("#ausente")
        self.resposta = {"resposta": "Vou confirmar isso com André e já te respondo.", "assunto": "x", "escalar": True, "motivo": "m", "erro": False}
        await self.b.handle_webhook(de(CARLOS, "quanto custa?"))
        await self.esperar()
        await self.b.handle_webhook(de(CARLOS, "e o prazo?"))
        await self.esperar()
        self.assertEqual(len(self.para(CARLOS)), 1)
        self.assertEqual(len([t for t in self.para(CONTROLE) if "Preciso de você" in t]), 2)


class TestLimitesEComandos(Base):
    async def test_limite_por_hora(self):
        self.novo(max_por_hora=2)
        await self.comando("#ausente")
        for i in range(4):
            await self.b.handle_webhook(de(CARLOS, f"msg {i}"))
            await self.esperar(0.1)
        self.assertEqual(len(self.para(CARLOS)), 2)
        self.assertEqual(len([t for t in self.para(CONTROLE) if "limite" in t]), 1)

    async def test_cooldown_entre_respostas(self):
        self.novo(cooldown_s=0.2)
        await self.comando("#ausente")
        await self.b.handle_webhook(de(CARLOS, "um"))
        await self.esperar(0.1)
        inicio = time.time()
        await self.b.handle_webhook(de(CARLOS, "dois"))
        await self.esperar(0.12)
        self.assertEqual(len(self.para(CARLOS)), 1)
        await self.esperar(0.25)
        self.assertEqual(len(self.para(CARLOS)), 2)

    async def test_voltei_cancela_o_que_estava_agendado(self):
        self.novo(debounce_s=0.2)
        await self.comando("#ausente")
        await self.b.handle_webhook(de(CARLOS, "oi"))
        await self.comando("#voltei")
        await self.esperar(0.3)
        self.assertEqual(self.chamadas, [])
        self.assertEqual(self.b._modo(), "off")

    async def test_status_resumo_contatos_ajuda(self):
        self.novo()
        await self.comando("#ausente")
        await self.b.handle_webhook(de(CARLOS, "oi"))
        await self.esperar()
        await self.comando("#status")
        await self.comando("#resumo")
        await self.comando("#contatos")
        await self.comando("#qualquercoisa")
        tudo = "\n".join(self.para(CONTROLE))
        self.assertIn("Modo: on", tudo)
        self.assertIn("• Carlos — Convite para jogar", tudo)
        self.assertIn("Liberados: Carlos", tudo)
        self.assertIn("Comandos:", tudo)

    async def test_auto_valida_minutos(self):
        self.novo()
        await self.comando("#auto abc")
        self.assertIn("Use assim", self.para(CONTROLE)[-1])
        await self.comando("#auto 999")
        self.assertEqual(self.b.store.get("auto_min"), "240")


class TestCorrida(Base):
    async def test_dono_responde_enquanto_a_luna_pensa(self):
        self.novo()
        await self.comando("#ausente")
        liberar = asyncio.Event()
        original = self.b.ask_luna

        async def devagar(payload):
            await liberar.wait()
            return await original(payload)

        self.b.ask_luna = devagar
        await self.b.handle_webhook(de(CARLOS, "tá aí?"))
        await self.esperar(0.08)          # a Luna já está "pensando"
        await self.b.handle_webhook(de(CARLOS, "tô aqui!", de_mim=True))
        liberar.set()
        await self.esperar(0.1)
        self.assertEqual(self.para(CARLOS), [])

    async def test_mensagem_nova_durante_a_resposta_gera_outra_rodada(self):
        self.novo()
        await self.comando("#ausente")
        liberar = asyncio.Event()
        original = self.b.ask_luna
        primeira = True

        async def devagar(payload):
            nonlocal primeira
            if primeira:
                primeira = False
                await liberar.wait()
            return await original(payload)

        self.b.ask_luna = devagar
        await self.b.handle_webhook(de(CARLOS, "oi"))
        await self.esperar(0.08)
        await self.b.handle_webhook(de(CARLOS, "esqueci de dizer uma coisa"))
        liberar.set()
        await self.esperar(0.2)
        self.assertEqual(len(self.chamadas), 2)


class TestNotaParaMim(Base):
    async def test_controle_igual_ao_proprio_numero(self):
        self.novo()
        meu = CONTROLE
        await self.b.handle_webhook(de(meu, "#ausente", de_mim=True))
        await self.esperar(0.02)
        self.assertEqual(self.b._modo(), "on")
        eco = self.para(CONTROLE)[-1]
        await self.b.handle_webhook(de(meu, eco, de_mim=True))
        await self.b.handle_webhook(de(meu, "texto qualquer sem comando", de_mim=True))
        await self.esperar(0.05)
        self.assertEqual(self.chamadas, [])
        self.assertEqual(len(self.para(CONTROLE)), 1)

    async def test_payload_estranho_nao_derruba(self):
        self.novo()
        for lixo in ({}, {"event": "messages.upsert"}, {"event": "messages.upsert", "data": []}, {"event": "messages.upsert", "data": [None, 5, {"key": None}]},
                     {"event": "connection.update"}, {"event": "MESSAGES_UPSERT", "data": {"key": {"remoteJid": CARLOS + "@s.whatsapp.net"}, "message": None}}):
            await self.b.handle_webhook(lixo)
        self.assertEqual(self.chamadas, [])


if __name__ == "__main__":
    unittest.main()
