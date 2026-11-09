# Changelog da Luna

Registra mudanças funcionais e atualizações visíveis para o usuário. A Luna consulta a versão mais recente quando perguntam o que há de novo.

## v1.2.5 — 2026-11-06

- **Gemini removido:** a Luna usa só o Groq para conversar, e acabou o erro de cota esgotada (429) do Google. Nenhuma chave do Gemini é necessária.
- **Busca na web independente:** a pesquisa pode usar DuckDuckGo (padrão, sem chave), Tavily ou Brave Search, escolhidos em `LUNA_SEARCH_PROVIDER`. Se o provedor escolhido falhar, a Luna usa o DuckDuckGo como reserva.
- **Conversa não é comando:** desabafos, reclamações e dúvidas nunca viram ação. Timers só são criados a partir de um pedido claro com tempo, e a Luna diz com franqueza que ainda não controla outras funções do aparelho, em vez de fingir que executou.
- **Temas sazonais:** o visual muda pela data (Natal a partir de 1º de novembro em 2026 e em dezembro nos outros anos). O botão 🎨 permite escolher entre automático, visual limpo ou fixar o tema, ajustar a visibilidade do fundo e ligar ou desligar a neve.
- **Tema de Natal:** fundo com a cena do presépio e brilhos suaves (estrela, lanternas e luzes), neve leve, gorro de Papai Noel nos balões da Luna e um trenó puxado por renas no lugar do indicador de "pensando". O fundo fica visível por trás de vidro leve, sem tirar a atenção da conversa, e respeita a opção de reduzir animações do aparelho.
- **Aviso de atualização:** uma seta verde no canto superior esquerdo aparece quando há versão nova. Ao tocar nela, abre uma janela com as novidades do changelog e o botão "Atualizar agora".
- A versão mostrada no rodapé passa a vir do changelog do servidor.

## v1.1.0 — 2026-10-21

- **Atendimento por WhatsApp (opcional):** a Luna pode responder contatos salvos enquanto você está ocupado, sempre começando com `*Luna:*`, e te manda um resumo de cada conversa. Quando ela fica em dúvida ou o assunto envolve preço, prazo ou compromisso, ela pergunta a você antes de decidir. No atendimento ela não acessa as suas memórias pessoais.
- Comandos pelo número de controle: `#ausente`, `#auto 10`, `#voltei`, `#status`, `#resumo`, `#contatos` e `#12 instrução` para responder um pedido da Luna.
- A ponte do WhatsApp fica na pasta `whatsapp_bridge/` e roda separada do servidor da Luna.

## v1.0.1 — 2026-10-19

- **Aviso de atualização:** quando há uma versão nova da Luna, aparece um pop-up com o botão "Atualizar", que reinicia o site ou o aplicativo instalado sem precisar fechá-lo à mão. Durante uma conversa por voz, o aviso espera a conversa terminar.
- **Animação de "pensando":** enquanto a Luna processa a resposta, aparece um indicador animado no chat, que muda para "Ainda pensando…" se a espera for longa.
- **Timers e lembretes:** peça "me avisa em 10 minutos" ou "me lembra às 15h de ligar pro João" e a Luna cria um timer com contagem regressiva no chat, que pode ser cancelado. O aviso aparece no chat, vibra e, com as notificações ativadas, também aparece como notificação do aparelho. O aviso depende do app estar aberto ou em segundo plano.
- **Vibração:** toques curtos ao enviar e ao receber respostas e um padrão mais longo quando um timer dispara, com botão no topo para ligar ou desligar (aparece só em aparelhos que suportam vibração).

## v1.0.0 — 2026-10-17

- **Raciocínio melhor:** com modelos de raciocínio (como o GPT-OSS 120B), a Luna pensa pouco em conversa simples e mais em contas, análises, código e perguntas do tipo "por quê". O limite de resposta subiu e, se o raciocínio consumir tudo e a resposta vier vazia, ela tenta de novo automaticamente.
- **Memória de curto prazo melhor:** o histórico enviado ao modelo passou de 12 mensagens para cerca de 24 mil caracteres, e as mensagens mais antigas viram um resumo corrido que preserva fatos, decisões e combinados. A Luna também recebeu a instrução de ligar "isso", "ele" e "como eu disse" ao que já foi conversado. A personalidade e as memórias permanentes não mudaram.
- **Formatação melhor:** Markdown renderizado com sanitização, tabelas e blocos de código com rolagem própria, números muito longos que quebram linha em vez de estourar o balão, e instruções para a Luna evitar sequências enormes de zeros.
- **Painel de memórias:** com rolagem no celular, busca, e agora é possível adicionar, editar e apagar memórias.
- **Conversa por voz em tempo real:** o microfone fica aberto e a Luna detecta quando você começa e termina de falar, entregando uma fala por vez (acabaram as várias caixas de mensagem). Ela responde em voz alta, em frases curtas e sem Markdown; tocar na esfera interrompe a resposta, há botão de mudo, a tela fica acesa e, se o áudio do servidor falhar, usa a voz do navegador.
- Busca na web mais criteriosa e erros do Gemini fora do chat (mudanças da v0.1.0.4, que ficam incluídas nesta versão).
- Novas variáveis opcionais: `LUNA_CONTEXT_CHARS`, `LUNA_CONTEXT_ROWS`, `LUNA_SUMMARY_TRIGGER`, `LUNA_SUMMARY_KEEP`, `LUNA_REASONING_EFFORT` e `LUNA_MAX_TOKENS`.
- O cache do aplicativo instalado (PWA) foi renovado para a nova versão aparecer sem limpar os dados do navegador.

## v0.1.0.4 — 2026-10-15

- A Luna decide melhor quando pesquisar na web: um classificador do Groq (por padrão, o mesmo modelo da conversa) avalia a mensagem e só busca em perguntas sobre fatos atuais ou verificáveis, não mais em conversas casuais.
- As buscas usam uma consulta curta em português, gerada a partir da pergunta, com resultados do Brasil; perguntas sobre acontecimentos recentes consultam notícias da última semana.
- O Gemini com Google Search deixa de ser acionado automaticamente quando a busca comum é fraca (reative com `LUNA_GEMINI_FALLBACK=true`); continua disponível quando você pede para usá-lo e entra em pausa por uma hora depois de um erro de cota.
- Erros técnicos do Gemini deixam de aparecer no fim das respostas e ficam apenas nos logs do servidor, exceto quando você pede explicitamente a pesquisa do Gemini.

## v0.1.0.3 — 2026-10-14

- O deploy web pode usar uma cópia do banco criptografada com SQLCipher; o banco local de desenvolvimento permanece separado e inalterado.
- PDFs escaneados agora passam por OCR com Groq Vision; o texto extraído segue para o modelo de conversa configurado, como GPT-OSS 120B.
- Páginas de PDF são reduzidas e comprimidas antes do OCR para evitar requisições grandes demais.
- Respostas sobre documentos ficam mais concisas por padrão: até cinco tópicos ou cerca de 150 palavras, salvo pedido por mais detalhes.
- Anexos escolhidos e gravações de áudio aparecem dentro da caixa de mensagem antes do envio, com opção de remover.
- O cache do PWA foi atualizado para carregar os novos estilos e scripts.
- O `requirements.txt` reúne as dependências diretas do servidor, IA, autenticação, anexos e voz.
- A Luna consulta este changelog quando você pergunta o que há de novo, sem confundir a pergunta com um pedido de pesquisa na web.
- A documentação foi reorganizada para publicação, com instruções de instalação, configuração, arquitetura, privacidade e deploy; a apresentação PDF foi incluída em `docs/`.
- Os arquivos de ambiente, credenciais, bancos, mídia gerada, ambientes Python e arquivos locais de build estão cobertos pelos dois arquivos de ignore; o pacote ARM compactado também foi excluído do Git.
