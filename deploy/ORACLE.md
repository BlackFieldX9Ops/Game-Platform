# Servidor grátis na Oracle Cloud

Dá uma máquina sempre ligada, com disco permanente, sem custo dentro do plano "Always Free". Você precisa de um cartão de crédito para a Oracle verificar a identidade (ela não cobra por esse uso). Tempo: uns 30 minutos.

## 1. Criar a conta

1. Entre em https://www.oracle.com/br/cloud/free/ e toque em **Comece gratuitamente**.
2. Preencha os dados. **Escolha bem a região de origem** (ex.: Brazil East, São Paulo), porque depois não dá para trocar.
3. Confirme o cartão e espere o e-mail de conta pronta.

## 2. Criar a máquina

1. No painel: **Compute > Instances > Create instance**.
2. **Image:** Ubuntu (Canonical Ubuntu 24.04).
3. **Shape > Change shape:**
   - Ampere **VM.Standard.A1.Flex** com 1 OCPU e 6 GB de memória (melhor). Se der "Out of capacity", tente de novo mais tarde, ou
   - AMD **VM.Standard.E2.1.Micro** (1 GB de memória, serve para começar).
4. **Networking:** deixe marcado **Assign a public IPv4 address**.
5. **Add SSH keys:** escolha **Generate a key pair for me** e **baixe a chave privada** (arquivo `.key`). Guarde-a, ela é a sua senha de acesso.
6. **Create**. Quando ficar verde (Running), copie o **Public IP address**.

## 3. Abrir as portas 80 e 443

1. Na página da máquina, toque no nome da **Subnet** (em Primary VNIC).
2. Toque em **Default Security List** > **Add Ingress Rules**.
3. Crie uma regra com **Source CIDR** `0.0.0.0/0`, **IP Protocol** TCP e **Destination Port Range** `80,443`.

## 4. Entrar na máquina e instalar

No computador (PowerShell, Terminal ou Termux), na pasta da chave:

```bash
chmod 600 minha-chave.key          # só no Linux/Mac/Termux
ssh -i minha-chave.key ubuntu@IP_DA_MAQUINA
```

Dentro da máquina:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/BlackFieldX9Ops/Game-Platform.git
cd Game-Platform/deploy
ADMIN_EMAIL=seu@email.com bash install.sh
```

O script instala o Docker, libera as portas, cria a chave secreta, sobe o servidor com HTTPS automático e agenda um backup diário às 4h. No fim ele mostra o endereço, algo como `https://132-226-10-20.sslip.io`. Abra no navegador para conferir: o app já funciona por lá.

Quem se cadastrar com o e-mail em `ADMIN_EMAIL` vira administrador.

Se quiser um nome seu, crie um subdomínio grátis em https://www.duckdns.org apontando para o IP e rode: `DOMINIO=meu-nome.duckdns.org ADMIN_EMAIL=seu@email.com bash install.sh`.

## 5. Ligar o app ao servidor

No GitHub: **Settings > Secrets and variables > Actions > Variables > New repository variable**. Nome `SERVER_URL`, valor o endereço `https://...` do passo anterior. Depois **Actions > Gerar APK > Run workflow**. Quando terminar, o app do celular avisa da atualização; instale por cima. Ou, sem esperar, abra **Perfil > Configurações** no app e escreva o endereço em **Endereço do servidor**.

## Dia a dia

| O que | Comando (dentro de `Game-Platform/deploy`) |
|---|---|
| Atualizar o servidor para a última versão | `bash update.sh` |
| Ver o que está acontecendo | `sudo docker compose logs -f app` |
| Backup agora | `bash backup.sh` (cópias em `deploy/backups/`, ficam as 7 últimas) |
| Trazer um backup para o seu computador | `scp -i minha-chave.key ubuntu@IP:Game-Platform/deploy/backups/app-*.db .` |
| Restaurar um backup | `sudo docker compose cp backups/ARQUIVO.db app:/app/data/app.db && sudo docker compose restart app` |

## Cuidados

- Mantenha uma cópia dos backups fora da máquina (o `scp` acima).
- A Oracle pode suspender contas paradas por 30 dias ou mais e pode recolher máquinas grátis que fiquem ociosas por muito tempo. Entre na conta de vez em quando e confira as regras atuais em https://www.oracle.com/cloud/free/.
- O endereço `sslip.io` leva o IP da máquina. Se você recriar a máquina, o IP muda: rode o `install.sh` de novo e atualize `SERVER_URL`.
- Nunca divulgue o arquivo `deploy/.env` nem a chave `.key`.
