#!/usr/bin/env bash
# Instala o servidor do Game Platform em uma máquina Ubuntu/Debian (ex.: Oracle Cloud grátis).
# Uso:  ADMIN_EMAIL=voce@exemplo.com bash install.sh
# Opcional: DOMINIO=meu-nome.duckdns.org  (sem isso, usa <ip>.sslip.io, que já tem HTTPS e não precisa de cadastro)
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${ADMIN_EMAIL:-}" ]; then
  echo "Falta o seu e-mail de administrador. Rode assim:"
  echo "  ADMIN_EMAIL=voce@exemplo.com bash install.sh"
  exit 1
fi

echo "==> 1/5 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo systemctl enable --now docker >/dev/null 2>&1 || true
D="sudo docker"

echo "==> 2/5 Portas 80 e 443 no firewall da máquina"
# As imagens Ubuntu da Oracle vêm com iptables bloqueando tudo, exceto SSH.
if command -v iptables >/dev/null 2>&1; then
  for p in 80 443; do
    sudo iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport "$p" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then sudo netfilter-persistent save >/dev/null 2>&1 || true
  elif [ -d /etc/iptables ]; then sudo sh -c 'iptables-save > /etc/iptables/rules.v4' || true; fi
fi

echo "==> 3/5 Endereço"
if [ -z "${DOMINIO:-}" ]; then
  IP="$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)"
  DOMINIO="$(echo "$IP" | tr . -).sslip.io"
fi
echo "    $DOMINIO"

echo "==> 4/5 Configuração"
if [ ! -f .env ]; then
  SEGREDO="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
  printf 'JWT_SECRET=%s\nADMIN_EMAIL=%s\nDOMINIO=%s\nCORS_ORIGINS=\n' "$SEGREDO" "$ADMIN_EMAIL" "$DOMINIO" > .env
  chmod 600 .env
else
  echo "    .env já existe, mantido (apague-o para gerar de novo)."
  sed -i "s|^DOMINIO=.*|DOMINIO=$DOMINIO|; s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=$ADMIN_EMAIL|" .env
fi

echo "==> 5/5 Subindo o servidor (a primeira vez demora uns minutos)"
$D compose up -d --build

# backup diário do banco, às 4h
CRON="0 4 * * * cd $(pwd) && bash backup.sh >> backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v "backup.sh" ; echo "$CRON" ) | crontab -

echo
echo "Pronto. Espere uns 30 segundos e abra:"
echo "  https://$DOMINIO"
echo "Esse é o endereço do servidor para colocar no app (variável SERVER_URL no GitHub)."
