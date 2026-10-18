#!/bin/sh
set -eu

cd "$(dirname "$0")"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git pull --ff-only
else
    echo "Aviso: esta pasta não está conectada ao Git; atualizando a imagem com os arquivos locais enviados para o servidor."
fi

docker compose up -d --build --remove-orphans
docker compose ps
