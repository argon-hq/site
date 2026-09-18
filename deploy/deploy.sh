#!/usr/bin/env bash
# Roda na instância, via SSM Run Command. Uso: deploy.sh <prod|dev> <tag>
# Atualiza a tag do ambiente, regera o env a partir do Parameter Store e sobe só os serviços do ambiente.
set -euo pipefail
ENV_NAME="$1"; TAG="$2"
cd /opt/argon
mkdir -p env
touch .env
grep -q '^ECR=' .env || echo "ECR=$(aws sts get-caller-identity --query Account --output text).dkr.ecr.sa-east-1.amazonaws.com" >> .env
for k in PROD_TAG DEV_TAG; do grep -q "^$k=" .env || echo "$k=" >> .env; done
KEY="$(echo "$ENV_NAME" | tr a-z A-Z)_TAG"
grep -q "^$KEY=" .env && sed -i "s|^$KEY=.*|$KEY=$TAG|" .env || echo "$KEY=$TAG" >> .env
# Parâmetros /argon/<env>/NOME viram NOME=valor no env do ambiente.
aws ssm get-parameters-by-path --path "/argon/$ENV_NAME/" --with-decryption --region sa-east-1 \
  --query 'Parameters[].[Name,Value]' --output text | awk -F'\t' '{sub(".*/","",$1); print $1"="$2}' > "env/$ENV_NAME.env"
aws ecr get-login-password --region sa-east-1 | docker login --username AWS --password-stdin "$(grep '^ECR=' .env | cut -d= -f2)"
docker compose pull "web-$ENV_NAME"
docker compose up -d caddy "web-$ENV_NAME"
# Retenção de 30 dias nos logs do ambiente; o grupo é criado pelo driver awslogs no primeiro start.
sleep 5; aws logs put-retention-policy --region sa-east-1 --log-group-name "/argon/$ENV_NAME/web" --retention-in-days 30 || true
docker image prune -f >/dev/null
echo "deploy $ENV_NAME $TAG ok"
