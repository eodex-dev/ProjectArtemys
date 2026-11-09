import os
import re
import uuid
from pathlib import Path
import edge_tts

BASE_DIR = Path(__file__).resolve().parent
AUDIO_DIR = BASE_DIR / "static" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

VOZ_PADRAO = os.getenv("LUNA_TTS_VOICE", "pt-BR-FranciscaNeural")


def limpar_texto_para_fala(texto: str) -> str:
    # Mantém o texto visível de links Markdown e remove o endereço para não soletrá-lo.
    texto_limpo = re.sub(r"\[([^\]]+)\]\(https?://[^)]+\)", r"\1", texto)
    texto_limpo = re.sub(r"https?://\S+", "", texto_limpo)
    texto_limpo = re.sub(
        r"```.*?```", " trecho de código omitido ", texto_limpo, flags=re.S
    )
    texto_limpo = re.sub(r"[*#`_~|>]", "", texto_limpo)

    # Remove emojis, bandeiras, variation selectors, modificadores e conectores ZWJ.
    regex_emojis = re.compile(
        "[\U0001f000-\U0001faff\U0001fc00-\U0001ffff\U00002600-\U000027bf"
        "\U00002300-\U000023ff\U00002b00-\U00002bff\u200d\ufe0e\ufe0f\u20e3]+",
        flags=re.UNICODE,
    )
    texto_limpo = regex_emojis.sub(" ", texto_limpo)
    return re.sub(r"\s+", " ", texto_limpo).strip()


async def gerar_voz_luna_async(texto: str, voz_escolhida: str = VOZ_PADRAO) -> str:
    try:
        nome_arquivo = f"luna_{uuid.uuid4().hex[:8]}.mp3"
        caminho_completo = AUDIO_DIR / nome_arquivo

        texto_tratado = limpar_texto_para_fala(texto)

        if not texto_tratado:
            return None

        communicate = edge_tts.Communicate(texto_tratado, voz_escolhida)
        await communicate.save(caminho_completo)

        return f"/api/audio/{nome_arquivo}"
    except Exception as e:
        print(f"[VoiceEngine] Erro ao gerar áudio: {e}")
        return None
