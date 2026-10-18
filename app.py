import base64
import io
import logging
import os
import re
from pathlib import Path

import firebase_admin
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from firebase_admin import auth, credentials
from pydantic import BaseModel, Field
from pypdf import PdfReader

load_dotenv(Path(__file__).with_name(".env"))
BASE_DIR = Path(__file__).resolve().parent
ALLOWED_EMAIL = os.getenv("ALLOWED_EMAIL", "").strip().lower()
CHECK_REVOKED = os.getenv("FIREBASE_CHECK_REVOKED", "false").strip().lower() == "true"
if not firebase_admin._apps:
    service_account = os.getenv("FIREBASE_SERVICE_ACCOUNT", "")
    if service_account and Path(service_account).exists():
        firebase_admin.initialize_app(credentials.Certificate(service_account))
        print(f"[Firebase Admin] Credencial JSON carregada ({Path(service_account).name}).")
    else:
        reason = "variável vazia" if not service_account else "arquivo não encontrado no caminho configurado"
        print(f"[Firebase Admin] JSON não carregado ({reason}); tentando Application Default Credentials.")
        firebase_admin.initialize_app(options={"projectId": os.getenv("FIREBASE_PROJECT_ID", "")})

from core_brain import (
    atualizar_memoria,
    atualizar_resumo_conversa,
    carregar_historico,
    criar_memoria,
    excluir_memoria,
    explicar_falha_integracao,
    extrair_memorias,
    extrair_texto_pdf_escaneado_com_groq,
    listar_memorias,
    responder,
    salvar_mensagem,
    transcrever_audio,
    transcricao_irrelevante,
)
from voice_engine import gerar_voz_luna_async

app = FastAPI(title="Luna AI")
logger = logging.getLogger("luna")
MAX_UPLOAD = 15 * 1024 * 1024
TEMPLATES_DIR = BASE_DIR / "templates"
PUBLIC_ASSETS = {
    "/style.css": BASE_DIR / "static" / "css" / "style.css",
    "/script.js": BASE_DIR / "static" / "js" / "script.js",
    "/voice-core.js": BASE_DIR / "static" / "js" / "voice-core.js",
    "/manifest.json": BASE_DIR / "static" / "pwa" / "manifest.json",
    "/sw.js": BASE_DIR / "static" / "pwa" / "sw.js",
    "/icon-192.png": BASE_DIR / "static" / "images" / "icon-192.png",
    "/icon-512.png": BASE_DIR / "static" / "images" / "icon-512.png",
    "/favicon.png": BASE_DIR / "static" / "images" / "favicon.png",
}


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)


class MemoryCreate(BaseModel):
    categoria: str = Field(default="preferência", max_length=30)
    conteudo: str = Field(min_length=1, max_length=400)


class MemoryUpdate(BaseModel):
    categoria: str | None = Field(default=None, max_length=30)
    conteudo: str | None = Field(default=None, min_length=1, max_length=400)


FIREBASE_CONFIG = {key: os.getenv(env, "") for key, env in {
    "apiKey": "FIREBASE_API_KEY", "authDomain": "FIREBASE_AUTH_DOMAIN", "projectId": "FIREBASE_PROJECT_ID",
    "storageBucket": "FIREBASE_STORAGE_BUCKET", "messagingSenderId": "FIREBASE_MESSAGING_SENDER_ID", "appId": "FIREBASE_APP_ID"
}.items()}


from fastapi import Header
import asyncio


async def usuario_autorizado(authorization: str | None = Header(default=None)):
    if not ALLOWED_EMAIL:
        raise HTTPException(503, "Configure ALLOWED_EMAIL no .env antes de liberar o acesso.")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sessão ausente. Entre novamente.")
    try:
        claims = auth.verify_id_token(authorization[7:], check_revoked=CHECK_REVOKED)
    except auth.ExpiredIdTokenError:
        raise HTTPException(401, "Sessão expirada. Entre novamente.")
    except auth.RevokedIdTokenError:
        raise HTTPException(401, "Sessão revogada. Entre novamente.")
    except auth.InvalidIdTokenError as exc:
        print(f"[Firebase Auth] Token recusado: {exc}")
        raise HTTPException(401, "O token não foi aceito pelo Firebase. Confira se a app Web e o servidor usam o mesmo FIREBASE_PROJECT_ID.")
    except Exception as exc:
        print(f"[Firebase Auth] Falha ao validar token: {type(exc).__name__}: {exc}")
        raise HTTPException(503, "O servidor não conseguiu validar a sessão com o Firebase. Confira as credenciais Admin e a conexão do servidor.")
    if (claims.get("email") or "").lower() != ALLOWED_EMAIL or not claims.get("email_verified"):
        raise HTTPException(403, "Esta conta não tem acesso à Luna.")
    return claims


@app.get("/config")
async def config():
    return {"firebase": FIREBASE_CONFIG, "allowedEmail": ALLOWED_EMAIL}


@app.get("/")
async def index():
    return FileResponse(TEMPLATES_DIR / "index.html")


@app.get("/login")
async def login():
    return FileResponse(TEMPLATES_DIR / "login.html")


@app.get("/style.css")
@app.get("/script.js")
@app.get("/voice-core.js")
@app.get("/manifest.json")
@app.get("/sw.js")
@app.get("/icon-192.png")
@app.get("/icon-512.png")
@app.get("/favicon.png")
async def public_asset(request: Request):
    path = PUBLIC_ASSETS.get(request.url.path)
    if path is None or not path.is_file():
        raise HTTPException(404, "Arquivo não encontrado.")
    return FileResponse(path)


@app.post("/api/chat")
async def chat(background_tasks: BackgroundTasks, prompt: str = Form(""), file: UploadFile | None = File(default=None), user=Depends(usuario_autorizado)):
    if not prompt.strip() and file is None:
        raise HTTPException(400, "Escreva uma mensagem ou escolha um anexo.")
    texto_anexo, imagem_url, transcricao = "", None, None
    if file:
        data = await file.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise HTTPException(413, "O arquivo passou do limite de 15 MB.")
        name, content_type = file.filename or "anexo", (file.content_type or "").lower()
        if content_type.startswith("audio/") or name.lower().endswith((".wav", ".mp3", ".m4a", ".webm", ".ogg", ".mp4")):
            transcricao = transcrever_audio(io.BytesIO(data), name)
            prompt = (prompt.strip() + "\n\nTranscrição do áudio: " + transcricao).strip()
        elif content_type == "application/pdf" or name.lower().endswith(".pdf"):
            reader = PdfReader(io.BytesIO(data))
            texto_anexo = "\n".join(page.extract_text() or "" for page in reader.pages)
            if not texto_anexo.strip():
                try:
                    texto_anexo = await asyncio.to_thread(extrair_texto_pdf_escaneado_com_groq, data)
                    prompt = prompt.strip() or "Analise o PDF anexado e faça um resumo dos pontos principais."
                except Exception as exc:
                    logger.exception("Falha no OCR Groq Vision do PDF escaneado")
                    raise HTTPException(
                        status_code=502,
                        detail=f"Este PDF parece escaneado e não tem texto selecionável. O OCR pela Groq Vision falhou: {exc}",
                    ) from exc
        elif content_type.startswith("image/"):
            image_url = f"data:{content_type};base64,{base64.b64encode(data).decode('ascii')}"
        elif content_type.startswith("text/") or name.lower().endswith((".txt", ".md", ".csv", ".json", ".log")):
            texto_anexo = data.decode("utf-8", errors="replace")
        else:
            raise HTTPException(415, "Tipo não suportado. Envie imagem, áudio, PDF ou arquivo de texto.")
    try:
        answer, _ = await asyncio.to_thread(responder, prompt, texto_anexo, imagem_url)
    except Exception as exc:
        logger.exception("Falha ao gerar resposta do chat")
        provider = "Groq" if type(exc).__module__.startswith("groq") else "backend da Luna"
        explanation = explicar_falha_integracao(exc, provider)
        answer = f"Não consegui concluir a resposta. {explanation}"
        salvar_mensagem("user", prompt or "[anexo enviado]")
        salvar_mensagem("assistant", answer)
        return {"response": answer, "user_transcription": transcricao, "audio_url": None}
    if prompt.strip():
        background_tasks.add_task(extrair_memorias, prompt.strip())
    background_tasks.add_task(atualizar_resumo_conversa)
    audio_url = None
    if os.getenv("LUNA_TTS_ENABLED", "true").lower() == "true":
        try:
            audio_url = await gerar_voz_luna_async(answer)
        except Exception:
            logger.exception("Falha ao gerar áudio TTS; mantendo a resposta em texto")
    return {"response": answer, "user_transcription": transcricao, "audio_url": audio_url}


@app.post("/api/voice")
async def voice_chat(background_tasks: BackgroundTasks, file: UploadFile = File(...), user=Depends(usuario_autorizado)):
    """Um turno da conversa por voz: transcreve, responde em modo falado e devolve o áudio."""
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "O áudio passou do limite de 15 MB.")
    if len(data) < 2000:
        return {"ignored": True, "user_transcription": "", "response": "", "audio_url": None}
    name = file.filename or "voz.wav"
    try:
        transcricao = await asyncio.to_thread(transcrever_audio, io.BytesIO(data), name)
    except Exception as exc:
        logger.exception("Falha ao transcrever o áudio da conversa por voz")
        provider = "Groq" if type(exc).__module__.startswith("groq") else "backend da Luna"
        raise HTTPException(502, f"Não consegui transcrever o áudio. {explicar_falha_integracao(exc, provider)}") from exc
    texto = (transcricao or "").strip()
    if transcricao_irrelevante(texto):
        return {"ignored": True, "user_transcription": texto, "response": "", "audio_url": None}
    try:
        answer, _ = await asyncio.to_thread(responder, texto, "", None, True)
    except Exception as exc:
        logger.exception("Falha ao gerar resposta da conversa por voz")
        provider = "Groq" if type(exc).__module__.startswith("groq") else "backend da Luna"
        raise HTTPException(502, f"Não consegui concluir a resposta. {explicar_falha_integracao(exc, provider)}") from exc
    background_tasks.add_task(extrair_memorias, texto)
    background_tasks.add_task(atualizar_resumo_conversa)
    audio_url = None
    if os.getenv("LUNA_TTS_ENABLED", "true").lower() == "true":
        try:
            audio_url = await gerar_voz_luna_async(answer)
        except Exception:
            logger.exception("Falha ao gerar áudio TTS da conversa por voz")
    return {"ignored": False, "user_transcription": texto, "response": answer, "audio_url": audio_url}


@app.get("/api/history")
async def history(user=Depends(usuario_autorizado)):
    return {"history": carregar_historico(30)}


@app.post("/api/tts")
async def text_to_speech(payload: TTSRequest, user=Depends(usuario_autorizado)):
    audio_url = await gerar_voz_luna_async(payload.text)
    if not audio_url:
        raise HTTPException(503, "O Edge TTS não conseguiu gerar a voz agora.")
    return {"audio_url": audio_url}


@app.get("/api/audio/{filename}")
async def audio_file(filename: str, user=Depends(usuario_autorizado)):
    if not re.fullmatch(r"luna_[0-9a-f]{8}\.mp3", filename):
        raise HTTPException(404, "Áudio não encontrado.")
    path = BASE_DIR / "static" / "audio" / filename
    if not path.is_file():
        raise HTTPException(404, "Áudio não encontrado.")
    return FileResponse(
        path,
        media_type="audio/mpeg",
        headers={"Cache-Control": "private, no-store"},
    )


@app.get("/api/memories")
async def memories(user=Depends(usuario_autorizado)):
    return {"memories": listar_memorias()}


@app.post("/api/memories")
async def create_memory(payload: MemoryCreate, user=Depends(usuario_autorizado)):
    try:
        return {"memory": criar_memoria(payload.categoria, payload.conteudo)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.put("/api/memories/{key}")
async def update_memory(key: str, payload: MemoryUpdate, user=Depends(usuario_autorizado)):
    try:
        updated = atualizar_memoria(key, payload.categoria, payload.conteudo)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not updated:
        raise HTTPException(404, "Memória não encontrada.")
    return {"ok": True}


@app.delete("/api/memories/{key}")
async def delete_memory(key: str, user=Depends(usuario_autorizado)):
    if not excluir_memoria(key):
        raise HTTPException(404, "Memória não encontrada.")
    return {"ok": True}
