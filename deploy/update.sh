#!/usr/bin/env bash
# Atualiza o servidor para a versão mais nova do GitHub. Os dados ficam.
set -euo pipefail
cd "$(dirname "$0")"
git -C .. pull --ff-only
sudo docker compose up -d --build
sudo docker image prune -f >/dev/null
echo "Servidor atualizado."
