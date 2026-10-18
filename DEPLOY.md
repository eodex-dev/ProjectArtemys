# Implantação da Luna em domínio próprio

O pacote usa Docker Compose para facilitar a atualização e Caddy para obter/renovar HTTPS automaticamente. Funciona em Linux ARM64 e x86-64; o host precisa ter Docker Engine e o plugin Docker Compose.

## Antes de subir

1. Aponte o registro DNS `A` do seu domínio para o IPv4 público do servidor. Se houver um registro `AAAA`, ele também precisa apontar para esse servidor.
2. Libere as portas TCP 80 e 443 no firewall do host e do provedor. O Caddy usa essas portas para HTTPS. Não publique a porta 8000.
3. Copie `.env.production.example` para `.env` e preencha as chaves, o domínio, o e-mail permitido e os valores do Firebase Web. No Linux, restrinja o arquivo: `chmod 600 .env`.
4. Copie `luna_personality.example.txt` para `luna_personality.txt` e personalize o arquivo. Ele é ignorado pelo Git; faça essa cópia também no servidor antes de iniciar o Compose. Restrinja o acesso no Linux com `chmod 600 luna_personality.txt`.
5. Copie também `luna_apresentacao.example.txt` para `luna_apresentacao.txt`. Ele contém a apresentação pessoal da Luna, fica fora do Git e é montado no container como somente leitura. Restrinja com `chmod 600 luna_apresentacao.txt`.
6. Deixe `FIREBASE_SERVICE_ACCOUNT` vazio para validação normal dos ID tokens. Só monte uma credencial Admin se ativar `FIREBASE_CHECK_REVOKED=true` ou precisar de outra operação privilegiada; nunca envie o JSON ao Git.
7. No Firebase Authentication, adicione o domínio público em **Settings → Authorized domains**. Mantenha `ALLOWED_EMAIL` limitado à conta pessoal.
8. Suba com `docker compose up -d --build` e acompanhe `docker compose logs -f` até o Caddy emitir o certificado.

## Atualizar

Execute `sh update.sh`. Quando a instalação estiver ligada a um repositório Git privado, o script faz `git pull --ff-only` e reconstrói os containers. Sem Git, ele reconstrói os arquivos que já estão no servidor; primeiro será necessário copiar a versão nova para lá.

Este diretório ainda não está ligado a um repositório Git. Para atualizações remotas com um comando, crie um repositório privado, envie o código sem `.env`, JSON Admin, `luna_data/` ou áudio e configure o clone no servidor.

## Dados sensíveis e criptografia

- O banco local `luna_data/luna_memory.db` continua como SQLite normal. O Compose monta `luna_data/deploy` em `/data` e exige SQLCipher no deploy; assim, a base local não é alterada e o site não inicia silenciosamente com um banco sem criptografia.
- Antes do primeiro deploy, instale `requirements.txt` no ambiente Python local e execute `python scripts/encrypt_deployment_db.py`. O script cria a cópia cifrada `luna_data/deploy/luna_memory.db` e uma chave aleatória `luna_data/deploy/luna_db_key.txt`; ele se recusa a sobrescrever uma cópia existente. Esses arquivos estão excluídos do Git e do contexto Docker.
- No servidor, copie somente o banco cifrado para `luna_data/deploy/luna_memory.db`. Configure `LUNA_DB_ENCRYPTION_KEY` no `.env` do servidor com o conteúdo do arquivo de chave e restrinja o acesso ao `.env` (`chmod 600 .env`). Guarde uma cópia segura da chave fora do servidor junto dos backups. Não envie banco ou chave ao GitHub e não mantenha a chave ao lado do banco no servidor.
- SQLCipher cifra o arquivo do banco, mas a aplicação precisa da chave em memória enquanto roda. Para proteger também `.env`, áudios e os demais arquivos em caso de perda física do disco, use armazenamento Linux cifrado (LUKS) e mantenha backups criptografados. Planeje como o volume será desbloqueado após reinicializações.
- A conversa ainda é enviada aos serviços configurados (Groq, Gemini/Google Search, DuckDuckGo e Edge TTS). HTTPS e criptografia de disco não impedem esses provedores de processarem o conteúdo enviado a eles. Não use dados que exijam processamento exclusivamente local sem trocar essas integrações.
- Os áudios de resposta agora são servidos por rota autenticada e não por um caminho público estático. Eles continuam no volume persistente de áudio, portanto entram no mesmo plano de criptografia e backup.

## Persistência

O Compose mantém o banco em `luna_data/deploy`; áudios e certificados do Caddy ficam em volumes Docker. Não remova esses dados ao atualizar. Faça cópia de segurança do banco cifrado e do volume de áudio; preserve a chave do banco, o JSON Admin e `.env` separadamente, em armazenamento protegido.
