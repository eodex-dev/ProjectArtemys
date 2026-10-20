# Luna AI

Assistente pessoal em português brasileiro, acessível pelo navegador como site ou Progressive Web App (PWA). A Luna combina uma interface web própria com um servidor FastAPI, memória local em SQLite e serviços de IA configuráveis.

<p align"center">
<img width="1407" height="768" alt="Logo Luna" src="https://github.com/user-attachments/assets/2f05401d-3564-49cb-aa22-09f312b2d312" />
</p>

> Projeto pessoal em desenvolvimento. Versão exibida na aplicação: **v1.0.1**.

## Apresentação

Veja a [apresentação visual da Luna](docs/apresentacao-luna.pdf). O material é uma visão geral do projeto e contém ideias de integrações futuras; itens apresentados como próximos passos não significam que já estejam implementados. A apresentação foi feita para a versão `v0.1.0.2 W.I.P.` e pode mencionar modelos/configurações diferentes dos atuais; consulte este README e o changelog para o estado mais recente.

## Funcionalidades

- **Chat:** conversas em português usando o modelo configurado em `GROQ_CHAT_MODEL` (padrão de exemplo: `openai/gpt-oss-120b`).
- **Pesquisa na web:** Google Search Grounding via Gemini, com DuckDuckGo como alternativa conforme a consulta e a disponibilidade das APIs.
- **Anexos:** leitura de texto e PDFs com camada textual; OCR de PDFs escaneados usando Groq Vision; análise de imagens com modelo de visão configurado.
- **Voz:** gravação e transcrição de áudio via Groq, leitura de respostas com Edge TTS e reconhecimento contínuo de fala quando suportado pelo navegador.
- **Memória:** preferências, interesses e projetos selecionados são guardados em SQLite local.
- **Acesso pessoal:** Firebase Authentication com autorização no servidor limitada ao e-mail definido em `ALLOWED_EMAIL`.
- **PWA:** instalação no celular e cache da interface. O modo offline não inclui chat nem chamadas de IA.

O OCR de PDFs processa até 12 páginas por envio. Arquivos enviados ao chat têm limite de 15 MB. A conversa por voz contínua depende do reconhecimento de fala disponível no navegador e não implementa detecção local de palavra de ativação.

## Arquitetura

```text
Navegador / PWA
      │ HTTPS + Firebase ID token
      ▼
FastAPI ─── SQLite local
   ├── Groq: conversa, visão e transcrição
   ├── Gemini: pesquisa Google Search Grounding
   ├── DuckDuckGo: pesquisa alternativa
   └── Edge TTS: geração de voz
```

O servidor não executa um LLM local. Groq, Gemini, DuckDuckGo e Edge TTS dependem de internet. Prompts e anexos podem ser enviados aos provedores usados pela funcionalidade; considere isso antes de enviar conteúdo confidencial.

## Requisitos

- Python 3.11 ou superior.
- Uma chave da Groq para chat e transcrição; recursos de pesquisa Gemini e modelos de visão requerem as configurações correspondentes.
- Um projeto Firebase Authentication para login.
- Para acesso fora de `localhost`, um domínio com HTTPS.

As dependências Python estão listadas em [`requirements.txt`](requirements.txt).

## Execução local

### Windows PowerShell

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edite `.env` e configure as chaves e os campos do Firebase. Defina `ALLOWED_EMAIL` com o único e-mail autorizado. No console Firebase, habilite o método de login escolhido e inclua o domínio local ou público em **Authentication → Settings → Authorized domains**.

Inicie o servidor:

```powershell
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

Acesse `http://127.0.0.1:8000`.

### Linux ARM64 / Raspberry Pi

Use uma distribuição Linux de 64 bits com Python 3.11 ou superior. Em Arch Linux ARM, instale Python e pip pelo gerenciador da distribuição; depois:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp .env.example .env
```

Preencha `.env` e execute o servidor localmente. No desenvolvimento, `luna_data/luna_memory.db` continua como SQLite local. O deploy web usa uma cópia separada criptografada com SQLCipher; consulte [DEPLOY.md](DEPLOY.md) para preparar o banco e a chave no servidor. O PyMuPDF usado para renderizar PDFs precisa ser compatível com a arquitetura e a distribuição do sistema; prefira uma base Linux ARM64 glibc.

## Configuração

As variáveis e valores de exemplo ficam em `.env.example` e `.env.production.example`. Nunca coloque valores reais nesses exemplos. As variáveis principais são:

| Variável | Uso |
| --- | --- |
| `GROQ_API_KEY` | Acesso à Groq. |
| `GROQ_CHAT_MODEL` | Modelo de conversa e análise de texto. |
| `GROQ_VISION_MODEL` | Visão de imagens e OCR de PDF escaneado. |
| `GROQ_STT_MODEL` | Transcrição de áudio. |
| `GEMINI_API_KEY` | Pesquisa com Google Search Grounding. |
| `ALLOWED_EMAIL` | Único e-mail autorizado pela aplicação. |
| `FIREBASE_*` | Configuração web do Firebase Authentication. |
| `FIREBASE_SERVICE_ACCOUNT` | Opcional para o uso normal; credencial Admin protegida, necessária em cenários como verificação de revogação. |
| `LUNA_DATA_DIR` | Pasta persistente do banco SQLite. |

O JSON da conta de serviço Firebase é uma credencial privilegiada: mantenha-o fora do Git e da imagem Docker. Application Default Credentials podem ser usadas no lugar do caminho `FIREBASE_SERVICE_ACCOUNT` quando configuradas no ambiente do servidor.

## Deploy com Docker

O Compose usa Caddy como proxy reverso e gerenciador automático de HTTPS. Consulte [`DEPLOY.md`](DEPLOY.md) para DNS, firewall, persistência, backups e atualização.

Resumo do primeiro deploy em Linux:

```bash
cp .env.production.example .env
# Edite .env: configure DOMAIN, provedores, Firebase e ALLOWED_EMAIL.
cp luna_personality.example.txt luna_personality.txt
cp luna_apresentacao.example.txt luna_apresentacao.txt
docker compose up -d --build
```

Não exponha a porta 8000 diretamente à internet. Restrinja as permissões do `.env` e mantenha os volumes persistentes protegidos.

## Privacidade e segurança

- `.env`, credenciais Firebase Admin, banco local, áudios gerados e arquivos pessoais da personalidade são excluídos pelo `.gitignore` e pelo `.dockerignore`.
- O banco local de desenvolvimento permanece SQLite; o deploy Compose exige banco SQLCipher e chave configurada. O `.env`, os áudios e outros arquivos do servidor ainda dependem das permissões do host ou de criptografia de disco, como LUKS.
- HTTPS protege o tráfego entre navegador e servidor, mas não impede que provedores externos processem o conteúdo enviado às APIs.
- Antes de publicar, confira a saída de `git status` e não use `git add -f` em arquivos ignorados sem revisar o conteúdo.

## Estrutura

- `app.py`, `core_brain.py`, `voice_engine.py`: API, conversa, memória, anexos e voz.
- `templates/`, `static/`: interface web e recursos PWA.
- `docs/`: materiais públicos de apresentação.
- `CHANGELOG.md`: mudanças recentes, consultadas pela Luna quando perguntam o que há de novo.
- `AGENTS.md`: instruções para manter o changelog atualizado durante futuras alterações.
- `Dockerfile`, `compose.yaml`, `Caddyfile`, `DEPLOY.md`: implantação.
- `scripts/encrypt_deployment_db.py`: prepara uma cópia SQLCipher separada para o servidor.

## Status e contribuições

O projeto está em evolução e ainda pode mudar sem compatibilidade garantida entre versões. O changelog registra as atualizações. Não há licença de código definida neste repositório; antes de permitir reutilização ou contribuições públicas, escolha e inclua uma licença apropriada.
