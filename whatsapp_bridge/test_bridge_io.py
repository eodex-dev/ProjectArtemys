"""Testa a comunicação HTTP da ponte contra servidores falsos locais. Rode: python -m unittest -v test_bridge_io"""
import asyncio
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import bridge_io
from bridge_core import Bridge, Config, Store
from bridge_io import Settings, carregar_contatos, carregar_env, criar_ask_luna, criar_send_text

CONTROLE = "5511900000000"
CARLOS = "5511987654321"


class Falso:
    """Servidor HTTP de teste que registra o que recebe e responde com respostas programadas."""

    def __init__(self):
        self.pedidos, self.respostas = [], []
        falso = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                corpo = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                falso.pedidos.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": corpo})
                codigo, resposta = falso.respostas.pop(0) if falso.respostas else (200, {})
                dados = json.dumps(resposta).encode()
                self.send_response(codigo)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(dados)))
                self.end_headers()
                self.wfile.write(dados)

            def log_message(self, *a):
                pass

        self.servidor = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.servidor.server_port}"
        threading.Thread(target=self.servidor.serve_forever, daemon=True).start()

    def parar(self):
        self.servidor.shutdown()


def settings(evo, luna, **extra):
    base = dict(evolution_url=evo.url, evolution_key="CHAVE-EVO", evolution_instance="luna", luna_url=luna.url,
                luna_token="t" * 30, webhook_secret="s" * 30, control_number=CONTROLE, dono="André", db_path=":memory:", contatos_path="x")
    base.update(extra)
    return Settings(**base)


class TestHttp(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.evo, self.luna = Falso(), Falso()
        self.addCleanup(self.evo.parar)
        self.addCleanup(self.luna.parar)

    async def test_send_text(self):
        await criar_send_text(settings(self.evo, self.luna))("5511987654321", "*Luna:* oi", 3000)
        p = self.evo.pedidos[0]
        self.assertEqual(p["path"], "/message/sendText/luna")
        self.assertEqual(p["headers"]["apikey"], "CHAVE-EVO")
        self.assertEqual(p["body"], {"number": "5511987654321", "text": "*Luna:* oi", "delay": 3000})

    async def test_ask_luna_com_token(self):
        self.luna.respostas = [(200, {"resposta": "ok", "escalar": False})]
        r = await criar_ask_luna(settings(self.evo, self.luna))({"nome": "Carlos", "mensagens": []})
        self.assertEqual(r["resposta"], "ok")
        p = self.luna.pedidos[0]
        self.assertEqual(p["path"], "/api/atendimento")
        self.assertEqual(p["headers"]["authorization"], "Bearer " + "t" * 30)

    async def test_repete_em_erro_5xx_mas_nao_em_401(self):
        self.luna.respostas = [(503, {}), (200, {"resposta": "depois", "escalar": False})]
        r = await criar_ask_luna(settings(self.evo, self.luna), espera_nova_tentativa=0.01)({"nome": "x", "mensagens": []})
        self.assertEqual(r["resposta"], "depois")
        self.assertEqual(len(self.luna.pedidos), 2)
        self.luna.pedidos.clear()
        self.luna.respostas = [(401, {"detail": "Token inválido."})]
        with self.assertRaises(urllib.error.HTTPError):
            await criar_ask_luna(settings(self.evo, self.luna), espera_nova_tentativa=0.01)({"nome": "x", "mensagens": []})
        self.assertEqual(len(self.luna.pedidos), 1)

    async def test_ponta_a_ponta(self):
        """Webhook falso → ponte → Luna falsa → Evolution falsa, com as funções HTTP de verdade."""
        self.luna.respostas = [(200, {"resposta": "Oi! Sou a Luna.", "assunto": "Convite", "escalar": False, "motivo": "", "erro": False})]
        cfg = settings(self.evo, self.luna)
        ponte = Bridge(Config(control_number=CONTROLE, contatos={CARLOS: "Carlos"}, debounce_s=0.03, cooldown_s=0, delay_min_ms=50, delay_max_ms=50),
                       Store(), criar_send_text(cfg), criar_ask_luna(cfg), rand=lambda a, b: a)

        def hook(jid, texto):
            return {"event": "messages.upsert", "data": {"key": {"remoteJid": jid + "@s.whatsapp.net", "fromMe": False, "id": "X" + str(time.time())},
                                                          "message": {"conversation": texto}, "messageType": "conversation", "messageTimestamp": int(time.time())}}

        await ponte.handle_webhook(hook(CONTROLE, "#ausente"))
        await asyncio.sleep(0.4)
        await ponte.handle_webhook(hook(CARLOS, "bora jogar?"))
        await asyncio.sleep(1.0)
        enviados = [(p["body"]["number"], p["body"]["text"]) for p in self.evo.pedidos]
        self.assertTrue(any(n == CARLOS and t == "*Luna:* Oi! Sou a Luna." for n, t in enviados), enviados)
        self.assertTrue(any(n == CONTROLE and "Assunto: Convite" in t for n, t in enviados), enviados)
        self.assertEqual(self.luna.pedidos[0]["body"]["mensagens"], [{"role": "contato", "content": "bora jogar?"}])


class TestConfig(unittest.TestCase):
    def test_contatos_e_env(self):
        with tempfile.TemporaryDirectory() as d:
            ok = Path(d, "c.json"); ok.write_text('{"5511999999999": "Ana"}', encoding="utf-8")
            self.assertEqual(carregar_contatos(str(ok)), {"5511999999999": "Ana"})
            ruim = Path(d, "r.json"); ruim.write_text('["5511999999999"]', encoding="utf-8")
            with self.assertRaises(SystemExit):
                carregar_contatos(str(ruim))
            with self.assertRaises(SystemExit):
                carregar_contatos(str(Path(d, "nao-existe.json")))
            env = Path(d, ".env"); env.write_text('# c\nTESTE_PONTE_A="valor 1"\nTESTE_PONTE_B=2\n', encoding="utf-8")
            os.environ["TESTE_PONTE_B"] = "ja-existe"
            carregar_env(env)
            self.assertEqual(os.environ["TESTE_PONTE_A"], "valor 1")
            self.assertEqual(os.environ["TESTE_PONTE_B"], "ja-existe")

    def test_settings_exige_o_essencial(self):
        antigos = {k: os.environ.pop(k, None) for k in ["EVOLUTION_API_KEY", "EVOLUTION_INSTANCE", "LUNA_URL", "LUNA_ATENDIMENTO_TOKEN", "WEBHOOK_SECRET", "CONTROL_NUMBER"]}
        try:
            with self.assertRaises(SystemExit) as c:
                Settings.do_ambiente()
            self.assertIn("EVOLUTION_API_KEY", str(c.exception))
            os.environ.update(EVOLUTION_API_KEY="k", EVOLUTION_INSTANCE="luna", LUNA_URL="https://x.onrender.com/", LUNA_ATENDIMENTO_TOKEN="curto", WEBHOOK_SECRET="s" * 30, CONTROL_NUMBER="5511900000000")
            with self.assertRaises(SystemExit):
                Settings.do_ambiente()
            os.environ["LUNA_ATENDIMENTO_TOKEN"] = "t" * 30
            self.assertEqual(Settings.do_ambiente().luna_url, "https://x.onrender.com")
        finally:
            for k, v in antigos.items():
                os.environ.pop(k, None)
                if v is not None:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
