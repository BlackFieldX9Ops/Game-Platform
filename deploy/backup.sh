#!/usr/bin/env bash
# Copia o banco com segurança (VACUUM INTO) para a pasta backups/ e guarda as 7 últimas.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
NOME="app-$(date +%Y%m%d-%H%M).db"
sudo docker compose exec -T app node --disable-warning=ExperimentalWarning -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/app/data/app.db');
db.exec(\"VACUUM INTO '/app/data/$NOME'\");
"
sudo docker compose cp "app:/app/data/$NOME" "backups/$NOME"
sudo docker compose exec -T app rm -f "/app/data/$NOME"
ls -1t backups/app-*.db | tail -n +8 | xargs -r rm -f
echo "$(date -Is) backup ok: backups/$NOME"
