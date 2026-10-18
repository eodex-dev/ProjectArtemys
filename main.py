from core_brain import responder
from google_tools import executar_acao_google


def orquestrador(entrada_usuario):
    gatilhos_google = [
        "Google",
        "pesquisar",
        "buscar",
        "procurar",
        "tocar",
        "música",
        "youtube",
        "agenda",
        "compromisso",
        "lembrete",
        "timer",
    ]

    if any(palavra in entrada_usuario.lower() for palavra in gatilhos_google):
        print("[Orquestrador] Redirecionando para o Gemini (Ação Google)...")
        return executar_acao_google(entrada_usuario)

    print("[Orquestrador] Processando pelo modelo configurado (Groq)...")
    return responder(entrada_usuario)[0]


# Teste simples no terminal
if __name__ == "__main__":
    while True:
        user_input = input("Você: ")
        if user_input.lower() in ["sair", "exit"]:
            break

        resposta = orquestrador(user_input)
        print(f"Luna: {resposta}\n")
