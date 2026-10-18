"""Optional Gemini helper. Configure GEMINI_API_KEY outside the source tree."""
import os


def executar_acao_google(comando):
    if not os.getenv("GEMINI_API_KEY"):
        return "Integração Gemini não configurada. Defina GEMINI_API_KEY no arquivo .env."
    from google import genai
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return client.models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        contents=f"O usuário pediu: {comando}",
    ).text
