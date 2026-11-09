# Ponte WhatsApp ↔ Luna

Deixa a Luna responder, em seu nome, contatos **salvos** do WhatsApp enquanto você está ocupado (jogando, por exemplo), e manda um resumo de cada conversa para o seu número de controle.

```
Contato ──► WhatsApp ──► Evolution API ──webhook──► ponte (esta pasta) ──► Luna no Render (/api/atendimento)
                                                       │                         │
                                                       ◄──────── resposta ◄──────┘
                          Evolution API ◄── envia *Luna:* … ┘      e avisos/resumos para o seu número de controle
```

- **A ponte roda perto da Evolution API** (por exemplo, no Raspberry Pi). Ela guarda o histórico dos contatos num SQLite local (`ponte.db`).
- **A Luna do Render só gera a resposta.** No atendimento ela **não** vê as suas memórias pessoais, não pesquisa na web e não executa nada.

## Como a Luna se comporta

- Só atende números listados em `contatos.json`. Qualquer outro número, grupo ou status é ignorado.
- Todas as respostas começam com `*Luna:*`. No primeiro contato ela se apresenta como assistente e avisa que você está ocupado. Se perguntarem, ela diz que é uma IA.
- Preço, prazo, pagamento, encontro, urgência ou qualquer dúvida: ela manda uma frase de espera ("Vou confirmar com…") e **te pergunta** no número de controle. Você responde com `#12 diga que sim, amanhã às 10h` e ela escreve e envia.
- Não envia links que ninguém pediu, não revela dados seus e ignora ordens escritas pelo contato dentro da conversa.
- Trava contra loops e abuso: espera por mais mensagens antes de responder (8 s), pausa entre respostas (20 s), máximo de 6 respostas por hora e 20 por dia por contato, atraso de digitação e mensagens com mais de 10 minutos são ignoradas.
- Áudio, imagem e figurinha: ela não responde, só te avisa.

## Comandos (mande do número de controle)

| Comando | O que faz |
|---|---|
| `#ausente` (ou `#jogando`) | Liga: responde os contatos liberados |
| `#auto 10` | Só responde se **você** não responder em 10 minutos |
| `#voltei` | Desliga e cancela respostas agendadas |
| `#status` | Mostra modo, contatos e pedidos esperando você |
| `#resumo` | Conversas atendidas nas últimas 24 h |
| `#contatos` | Quem está liberado |
| `#12 instrução` | Responde o pedido nº 12 (a Luna escreve a mensagem) |
| `#12 ignorar` | Descarta o pedido nº 12 |

O modo começa **desligado**. Se você responder o contato pelo celular, a Luna para de responder aquela mensagem.

## Instalação

### 1. Luna no Render
Em **Environment**, crie:

- `LUNA_ATENDIMENTO_TOKEN` com 24 ou mais caracteres aleatórios (ex.: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`). Sem ele, o endpoint fica desativado.
- `LUNA_DONO_NOME` com o seu nome (como a Luna deve se referir a você).
- Opcional: `LUNA_ATENDIMENTO_TOM` (ex.: `descontraída, usa gírias leves`).

### 2. Evolution API
Instale seguindo a documentação oficial da Evolution API (geralmente Docker com Postgres e Redis). Depois:

1. Crie uma instância (ex.: `luna`) e conecte o WhatsApp lendo o QR code.
2. Configure o webhook da instância com a URL `http://127.0.0.1:8090/webhook/SEU_WEBHOOK_SECRET` (se a Evolution roda em Docker e a ponte fora dele, use o endereço do host, como `http://host.docker.internal:8090/...` ou o IP da máquina) e **somente** o evento `MESSAGES_UPSERT`. Pode ser pelo Evolution Manager ou pela API (`POST /webhook/set/luna`); o formato do corpo varia um pouco entre versões, então confira a documentação da sua.

### 3. A ponte
```bash
cd whatsapp_bridge
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                 # preencha
cp contatos.example.json contatos.json   # só quem estiver aqui é atendido
python -m unittest -v test_bridge_core test_bridge_io   # opcional: testes sem WhatsApp
uvicorn bridge:app --host 127.0.0.1 --port 8090
```

`contatos.json`: números só com dígitos, com 55 e DDD. A ponte trata contas antigas sem o nono dígito.

Para subir sozinha no Pi, um serviço systemd (`/etc/systemd/system/luna-ponte.service`):
```ini
[Unit]
Description=Ponte WhatsApp da Luna
After=network-online.target

[Service]
WorkingDirectory=/home/pi/luna/whatsapp_bridge
ExecStart=/home/pi/luna/whatsapp_bridge/.venv/bin/uvicorn bridge:app --host 127.0.0.1 --port 8090
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

### 4. Primeiro teste
1. Abra `http://127.0.0.1:8090/saude` no Pi: deve mostrar `"ok": true` e a quantidade de contatos.
2. Do número de controle, mande `#status`. Se chegar a resposta, a ponte → Evolution está funcionando.
3. Mande `#ausente`. Peça a um contato liberado (ou use um chip de teste) para mandar "oi". A Luna deve responder com `*Luna:*` e você recebe o resumo.
4. `#voltei` quando terminar.

## Limites e cuidados

- **Risco de banimento.** Conectar o seu número por QR code (Baileys) não é oficial e viola os termos do WhatsApp. Atender só contatos salvos, com limites e atraso, reduz o risco, mas não o elimina. Para testar, prefira um chip separado antes de usar o número principal.
- **Número com `@lid`.** O WhatsApp está trocando alguns identificadores por IDs que não mostram o telefone. Se um contato liberado for ignorado, procure no log da ponte a linha "número não liberado" e veja o `remoteJid` do webhook; a ponte usa `remoteJidAlt`/`senderPn` quando a Evolution os envia.
- **Aviso no próprio número.** Mensagens que você manda para si mesmo costumam não gerar notificação no celular. Se isso acontecer, use um segundo número como `CONTROL_NUMBER`. Se o controle for o seu próprio número, funciona do mesmo jeito, só que sem o aviso sonoro.
- **Reinício.** Respostas agendadas e o modo `#auto` em andamento se perdem se a ponte reiniciar; o histórico e o modo (`#ausente`/`#auto`) ficam salvos.
- **Privacidade.** O texto dos contatos vai ao Groq para gerar a resposta. Use só com contatos que fazem sentido para isso e não ligue o modo ausente em conversas sensíveis.
- **Primeira resposta lenta.** O Render gratuito dorme; a primeira chamada depois de um tempo pode demorar quase um minuto (a ponte espera e tenta de novo).
- A Luna pode errar. Não deixe o modo ligado para clientes ou assuntos em que uma resposta errada custe caro; nesses casos ela deve te perguntar, mas isso depende do modelo.
