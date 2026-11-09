"""Configuração e comunicação (Evolution API e Luna) da ponte do WhatsApp. Só biblioteca padrão."""
import asyncio
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from bridge_core import Bridge, Config, Store

BASE_DIR = Path(__file__).resolve().parent


def carregar_env(caminho: Path | None = None):
    """Lê o .env (CHAVE=valor) sem sobrescrever variáveis que já existem no ambiente."""
    caminho = caminho or BASE_DIR / ".env"
    if not caminho.exists():
        return
    for linha in caminho.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        os.environ.setdefault(chave.strip(), valor.strip().strip('"').strip("'"))


@dataclass
class Settings:
    evolution_url: str
    evolution_key: str
    evolution_instance: str
    luna_url: str
    luna_token: str
    webhook_secret: str
    control_number: str
    dono: str
    db_path: str
    contatos_path: str

    @classmethod
    def do_ambiente(cls) -> "Settings":
        obrigatorias = ["EVOLUTION_API_KEY", "EVOLUTION_INSTANCE", "LUNA_URL", "LUNA_ATENDIMENTO_TOKEN", "WEBHOOK_SECRET", "CONTROL_NUMBER"]
        faltando = [n for n in obrigatorias if not os.getenv(n, "").strip()]
        if faltando:
            raise SystemExit("Faltam variáveis no .env da ponte: " + ", ".join(faltando))
        if len(os.environ["WEBHOOK_SECRET"].strip()) < 24 or len(os.environ["LUNA_ATENDIMENTO_TOKEN"].strip()) < 24:
            raise SystemExit("WEBHOOK_SECRET e LUNA_ATENDIMENTO_TOKEN precisam ter 24 ou mais caracteres.")
        return cls(
            evolution_url=os.getenv("EVOLUTION_URL", "http://127.0.0.1:8080").strip().rstrip("/"),
            evolution_key=os.environ["EVOLUTION_API_KEY"].strip(),
            evolution_instance=os.environ["EVOLUTION_INSTANCE"].strip(),
            luna_url=os.environ["LUNA_URL"].strip().rstrip("/"),
            luna_token=os.environ["LUNA_ATENDIMENTO_TOKEN"].strip(),
            webhook_secret=os.environ["WEBHOOK_SECRET"].strip(),
            control_number=os.environ["CONTROL_NUMBER"].strip(),
            dono=os.getenv("DONO_NOME", "").strip() or "o dono",
            db_path=os.getenv("BRIDGE_DB", str(BASE_DIR / "ponte.db")),
            contatos_path=os.getenv("CONTATOS_FILE", str(BASE_DIR / "contatos.json")),
        )


def carregar_contatos(caminho: str) -> dict:
    arquivo = Path(caminho)
    if not arquivo.exists():
        raise SystemExit(f"Crie o arquivo {arquivo.name} a partir de contatos.example.json (só quem estiver nele é atendido).")
    dados = json.loads(arquivo.read_text(encoding="utf-8"))
    if not isinstance(dados, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in dados.items()):
        raise SystemExit('contatos.json deve ser um objeto {"5511999999999": "Nome"}.')
    return dados


def _post_json(url: str, dados: dict, cabecalhos: dict, timeout: float) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(dados).encode("utf-8"), headers={"Content-Type": "application/json", **cabecalhos}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resposta:
        corpo = resposta.read().decode("utf-8")
        return json.loads(corpo) if corpo else {}


async def _com_nova_tentativa(funcao, *args, tentativas=2, espera=2.0):
    ultimo = None
    for i in range(tentativas):
        try:
            return await asyncio.to_thread(funcao, *args)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            ultimo = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code < 500:
                raise  # erro do pedido (token errado, dados inválidos): repetir não adianta
            if i + 1 < tentativas:
                await asyncio.sleep(espera)
    raise ultimo


def criar_send_text(cfg: Settings):
    url = f"{cfg.evolution_url}/message/sendText/{cfg.evolution_instance}"

    async def send_text(numero: str, texto: str, delay_ms: int):
        await _com_nova_tentativa(_post_json, url, {"number": numero, "text": texto, "delay": int(delay_ms)}, {"apikey": cfg.evolution_key}, 30)

    return send_text


def criar_ask_luna(cfg: Settings, espera_nova_tentativa: float = 3.0):
    url = f"{cfg.luna_url}/api/atendimento"

    async def ask_luna(payload: dict) -> dict:
        # Render gratuito "dorme": a primeira chamada pode demorar; por isso o prazo longo e uma nova tentativa.
        return await _com_nova_tentativa(
            _post_json, url, payload, {"Authorization": f"Bearer {cfg.luna_token}"}, 90, tentativas=2, espera=espera_nova_tentativa
        )

    return ask_luna


def montar_ponte(cfg: Settings) -> Bridge:
    config = Config(control_number=cfg.control_number, contatos=carregar_contatos(cfg.contatos_path), dono=cfg.dono)
    for campo, env, tipo in (
        ("debounce_s", "DEBOUNCE_S", float), ("cooldown_s", "COOLDOWN_S", float), ("max_idade_s", "MAX_IDADE_S", int),
        ("max_por_hora", "MAX_POR_HORA", int), ("max_por_dia", "MAX_POR_DIA", int), ("auto_padrao_min", "AUTO_PADRAO_MIN", int),
    ):
        if os.getenv(env, "").strip():
            setattr(config, campo, tipo(os.environ[env]))
    return Bridge(config, Store(cfg.db_path), criar_send_text(cfg), criar_ask_luna(cfg))
