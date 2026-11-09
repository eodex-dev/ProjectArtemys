"""Ponte WhatsApp ↔ Luna. Rode:  uvicorn bridge:app --host 127.0.0.1 --port 8090

A Evolution API manda cada mensagem recebida para POST /webhook/<WEBHOOK_SECRET>. Veja o README.md desta pasta.
"""
import asyncio
import hmac
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request

from bridge_io import Settings, carregar_env, montar_ponte

carregar_env()
cfg = Settings.do_ambiente()
ponte = montar_ponte(cfg)
_tarefas: set[asyncio.Task] = set()


async def _limpeza_diaria():
    while True:
        ponte.store.podar(time.time() - 30 * 86400)
        await asyncio.sleep(86400)


@asynccontextmanager
async def lifespan(_app):
    limpeza = asyncio.create_task(_limpeza_diaria())
    yield
    limpeza.cancel()


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.post("/webhook/{segredo}")
@app.post("/webhook/{segredo}/{resto:path}")  # a Evolution acrescenta o nome do evento se "webhook por evento" estiver ligado
async def webhook(segredo: str, request: Request, resto: str = ""):
    if not hmac.compare_digest(segredo.encode("utf-8"), cfg.webhook_secret.encode("utf-8")):
        raise HTTPException(404)
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "JSON inválido.")
    tarefa = asyncio.create_task(ponte.handle_webhook(payload))
    _tarefas.add(tarefa)
    tarefa.add_done_callback(_tarefas.discard)
    return {"ok": True}


@app.get("/saude")
async def saude():
    return {"ok": True, "modo": ponte._modo(), "contatos": len(ponte.cfg.contatos)}
