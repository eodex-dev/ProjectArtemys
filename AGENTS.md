# Orientações para alterações no projeto Luna

- Ao alterar comportamento, interface, integrações, dependências ou implantação, registre a mudança em `CHANGELOG.md` com a data atual e uma descrição curta voltada ao usuário.
- Mantenha as entradas mais recentes no topo e agrupe mudanças do mesmo trabalho sob uma única data.
- Não registre segredos, dados pessoais, diagnósticos que exponham credenciais ou detalhes internos sem utilidade para quem usa a Luna.
- Se o formato ou local do changelog mudar, atualize também `carregar_changelog` em `core_brain.py` e a cópia do arquivo no `Dockerfile`.
