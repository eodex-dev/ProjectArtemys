"""Atalho para conversar com a Luna pelo terminal (uso local)."""
from core_brain import responder


def orquestrador(entrada_usuario):
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
