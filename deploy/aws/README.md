# Infraestrutura como código (ARG-116)

Terraform da conta AWS do Argon (382597877834, `sa-east-1`): as funções Lambda da API, os
CloudFront da API e do site, os buckets, os papéis, os alarmes e o resto que o `deploy/README.md`
descreve.

> **Primeiro apply em 24/09/2026.** O primeiro `plan` importou o que já existia na conta (a
> instância EC2 de então, os papéis, o ECR, o bucket de backup, o orçamento, os grupos de log e os
> parâmetros), criou os tópicos e alarmes e só alterou tags e descrições. A instância e o que só
> existia por ela (`ec2.tf`, o papel `argon-ec2`, os security groups, o alarme de status, o
> repositório `argon/web`, os grupos de log do site e do Postgres) saíram do código em 04/11/2026. O
> estado está no bucket `argon-terraform-state-382597877834`.

## O que cobre

| Arquivo | Recursos |
| --- | --- |
| `lambda.tf` | As funções `argon-<env>-api` e `argon-<env>-jobs`, um papel por ambiente (`argon-lambda-<env>`: Parameter Store do ambiente, o grupo de log da API; em prod, os dumps), a URL da função de API, a política do ECR que deixa a Lambda puxar a imagem, o papel `argon-scheduler` e os agendamentos: keep-warm, jobs do dia, backup e ensaio de restauração |
| `api_cdn.tf` | Por ambiente: distribuição CloudFront na frente da URL da função de API, sem cache, certificado do ACM (`us-east-1`), o segredo `x-origin-verify` (`random_password`) e a origin request policy `argon-api` |
| `site_cdn.tf`, `site_router.js` | Bucket `argon-site-382597877834` (privado, lido por OAC), por ambiente: distribuição, certificado, CloudFront Function de idioma e `www`, response headers policy (CSP, `Referrer-Policy`) |
| `iam.tf` | Provedor OIDC do GitHub e papel `argon-github-deploy`: push no ECR, as origens do site no Parameter Store, publicar o site e invalidar a distribuição, mover as funções e invocar o `migrate` nas de jobs, o bucket público e o prefixo `public-assets/` do bucket de estado, e avisar o tópico de alertas quando um deploy falha |
| `ecr.tf` | Repositório `argon/api`: as imagens com a tag de um ambiente nunca expiram, e das outras ficam as dez últimas |
| `s3.tf` | Bucket `argon-db-backups-382597877834`: acesso público bloqueado, SSE-S3, sem versionamento, dumps expiram em 30 dias |
| `s3_public.tf` | Bucket `argon-public-382597877834`: leitura pública de objetos por política (sem listagem, sem ACL), SSE-S3, CORS de GET. O conteúdo é do root `public-assets/`, abaixo |
| `sns.tf` | Tópico `argon-alerts` em `sa-east-1`, com uma assinatura por e-mail |
| `budget.tf` | Orçamento `argon-mensal`, US$ 30, avisos em 80% e 100% |
| `logs.tf` | Grupos `/argon/<env>/api`, onde as duas funções de cada ambiente escrevem, retenção de 30 dias |
| `alarms.tf` | Filtros de métrica em `/argon/prod/api` e alarmes (abaixo) |
| `parameters.tf` | Nomes e tipos dos parâmetros `/argon/<env>/*`. **Nunca os valores** |
| `backend.tf`, `providers.tf`, `versions.tf` | Estado no S3, o provedor em `sa-east-1` e o alias `us_east_1`, onde o CloudFront exige os certificados |

## O que não cobre

- **DNS.** A zona `argonbusiness.com` está na Cloudflare, onde o domínio foi registrado (o registrador
  exige o DNS lá). Os registros dos sites e da API (CNAME para cada CloudFront, sem proxy), os de
  validação dos certificados e os do Resend são mantidos à mão. O que criar sai dos `outputs`:
  `api_cloudfront_domains`, `site_cloudfront`, `api_certificate_validation` e
  `site_certificate_validation`. O `apply` espera até 30 minutos pela validação de cada certificado.
- **O código das funções.** Cada função nasce com a imagem de `lambda_bootstrap_tag`, e o Terraform
  ignora a imagem dali em diante (`ignore_changes = [image_uri]`): quem a move é o workflow de deploy.
- **O banco.** O projeto `argon` no Neon e suas branches são do console do Neon.
- **Segredos do GitHub** (`AWS_DEPLOY_ROLE_ARN`, `AWS_ALERTS_TOPIC_ARN`): copie dos `outputs`.
- **Valores dos parâmetros.** Ver "Parâmetros". `/argon/<env>/UNSUBSCRIBE_TOKEN_SECRET` e
  `/argon/neon/*` existem e não estão em `parameters.tf`.
- `/argon/rds/master_password`: sobra do RDS, não gerido. Apague à mão. Os `/argon/caddy/*`, criados
  à mão para o Caddy da instância, também ficaram sem uso.

## Alarmes

Todos publicam no tópico `argon-alerts`.

| Alarme | Fonte | Dispara quando |
| --- | --- | --- |
| `argon-prod-schedule-not-fired` | log `schedule fired` | nenhum no dia (UTC). Falso positivo conhecido: de domingo à noite até segunda 5h30, porque não há edição de domingo |
| `argon-prod-send-not-finished` | log `send finished` | nenhum no dia. Mesmo falso positivo |
| `argon-backup-missing` | métrica `Argon/BackupOk`, publicada pelo job `backup` da função `argon-prod-jobs` (etapa 14) | nenhuma no dia. O plano pedia 26 h; a janela de um alarme é limitada a um dia |
| `argon-prod-api-errors` | log `level = error` | um ou mais em 5 min |
| `argon-prod-edition-stuck` | log `edition stuck` (etapa 8) | um ou mais em 5 min |
| `argon-prod-owner-alert-skipped` | log `owner alert skipped` (etapa 2) | um ou mais em 5 min |

Os alarmes diários avaliam o dia UTC e, enquanto o dia corrente não tem ponto, usam o anterior:
o alarme de uma execução perdida chega no dia UTC seguinte (por volta das 21h BRT) e some na
execução seguinte. Não é a checagem das 8h que o plano imaginou; para isso seria preciso um
agendamento fora do CloudWatch.

Os padrões dos filtros usam `$.message.msg`, não `$.msg`: o `ConsoleLogger` do Nest em modo
JSON embrulha o objeto logado no campo `message`.

## Arquivos públicos

Tudo o que está em `apps/web/public` (arquivos da marca em `brand/`, imagens do e-mail em
`email/`) é copiado para o bucket `argon-public-382597877834`, um prefixo por ambiente:

```
https://argon-public-382597877834.s3.sa-east-1.amazonaws.com/<env>/<caminho em apps/web/public>
ex.: …/prod/brand/argon-logo@2x.png
```

São dois roots, cada um no seu ritmo:

- **Este root** cria o bucket, a política pública e a permissão do papel de deploy. Roda à mão,
  como o resto, e só muda quando o bucket muda.
- **`public-assets/`** cria um objeto por arquivo da pasta. Quem roda é o workflow de deploy, em
  todo deploy (exceto rollback por tag), antes de mover as funções. O Terraform compara o MD5 de
  cada arquivo com o estado: arquivo alterado é reenviado, arquivo novo é criado, arquivo apagado
  sai do bucket, o resto não é tocado. O estado fica em `public-assets/<env>.tfstate`, no bucket de estado; o papel de deploy só
  enxerga esse prefixo, nunca o `site/terraform.tfstate`, que guarda valores de parâmetros.

Para mudar a marca: troque o arquivo em `apps/web/public`, faça o commit e o push. Não há passo
manual.

**Quem lê daqui.** Os e-mails (edição, confirmação, prévia) buscam as imagens em
`<bucket>/<env>/email/` (`apps/api/src/email/assets.ts`), e a API confere ao subir se elas
respondem (`EmailAssets`). `PUBLIC_ASSETS_ORIGIN` no ambiente da API troca essa origem; uma
máquina local usa o site (`WEB_ORIGIN`).

**Primeira vez.** O `apply` deste root precisa acontecer antes do primeiro deploy com o passo novo;
sem o bucket e a permissão, o passo "Arquivos públicos" falha. O `plan` deve mostrar só a criação
do bucket e das suas configurações (acesso público, dono, criptografia, versionamento, política,
CORS) e a atualização in-place da política `argon-deploy`.

**Block Public Access da conta.** Se a conta bloqueia políticas públicas no nível da conta, a
política do bucket é recusada (`AccessDenied` no `PutBucketPolicy`). Confira com
`aws s3control get-public-access-block --account-id 382597877834`: `BlockPublicPolicy` e
`RestrictPublicBuckets` precisam estar `false` na conta; os outros buckets continuam protegidos
pelo bloqueio próprio de cada um.

Rodar o `public-assets/` à mão, para um ambiente:

```bash
cd deploy/aws/public-assets
terraform init -backend-config=key=public-assets/dev.tfstate
terraform plan -var env=dev
```

## Pré-requisitos

- Terraform **1.10 ou mais novo** (o lock do estado no S3, `use_lockfile`, começa nessa versão).
- Perfil `argon-new` da CLI apontando para a conta 382597877834. Os comandos abaixo assumem
  `export AWS_PROFILE=argon-new`. Um precondition no bucket recusa outra conta.
- `terraform.tfvars` a partir do `example.tfvars`, com o e-mail dos alertas e os do orçamento.
  Os e-mails do orçamento precisam ser **os mesmos já cadastrados** na notificação, senão o
  `plan` propõe trocá-los. Veja-os com
  `aws budgets describe-subscribers-for-notification --account-id 382597877834 --budget-name argon-mensal --notification NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=80,ThresholdType=PERCENTAGE`.

## Estado

O estado fica em `s3://argon-terraform-state-382597877834/site/terraform.tfstate`, com lock por
arquivo no próprio bucket. O bucket é o único recurso que se cria à mão, uma vez:

```bash
aws s3api create-bucket --bucket argon-terraform-state-382597877834 --region sa-east-1 \
  --create-bucket-configuration LocationConstraint=sa-east-1
aws s3api put-bucket-versioning --bucket argon-terraform-state-382597877834 \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket argon-terraform-state-382597877834 \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket argon-terraform-state-382597877834 \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

**O estado contém os valores dos parâmetros**, inclusive os `SecureString`: o Terraform os lê
ao importar e a cada refresh, mesmo ignorando mudanças. Trate o bucket de estado como se fosse o
Parameter Store — ninguém além de quem já pode ler os parâmetros deve ler o estado.

## Plan e apply

```bash
cd deploy/aws
terraform fmt -recursive
terraform init
terraform validate
terraform plan -var lambda_bootstrap_tag=prod -out=argon.tfplan
terraform apply argon.tfplan
```

Todo `plan` pede `lambda_bootstrap_tag`: o precondition das funções recusa o vazio. Para as que já
existem o valor não muda nada, porque a imagem está em `ignore_changes`; a tag de um ambiente
(`prod`) serve.

O critério é o de sempre: depois do `apply`, `terraform plan` responde "No changes". Diferenças
pequenas que podem aparecer e são cosméticas (documentos JSON reordenados, campos computados):
confira que o `apply` delas não altera comportamento, ou ajuste o código até o `plan` ficar limpo.

Um **replace** de função, distribuição ou bucket é sinal de erro no código, não da conta: pare e
corrija antes do `apply`. A imagem das funções está em `ignore_changes` para o Terraform nunca
desfazer um deploy.

## Confirmar as assinaturas

O SNS só entrega a um e-mail que confirmou a assinatura. O `apply` cria a assinatura e a AWS manda
um e-mail "AWS Notification - Subscription Confirmation"; clique em *Confirm subscription*. O
provedor espera alguns minutos pela confirmação durante o `apply`; se expirar, confirme e rode
`terraform apply` de novo. Para conferir:

```bash
aws sns list-subscriptions-by-topic --topic-arn "$(terraform output -raw alerts_topic_arn)"
```

Uma assinatura `PendingConfirmation` não recebe nada. Teste com
`aws sns publish --topic-arn ... --message teste`.

## Parâmetros

O Terraform gerencia nome e tipo de cada parâmetro e ignora o valor. Criar, trocar ou rotacionar
um valor continua sendo:

```bash
aws ssm put-parameter --region sa-east-1 --name /argon/prod/RESEND_API_KEY \
  --type SecureString --overwrite --value '<valor>'
```

As funções leem os parâmetros ao subir, então o valor chega a todas no deploy seguinte, que troca os
ambientes de execução. Um parâmetro **novo** entra primeiro em `parameters.tf` (o `apply` o cria
com `CHANGE-ME`) e recebe o valor real pelo comando acima.
Numa conta nova, todos nascem assim e precisam de valor antes do primeiro deploy.

## Rotação

- **Parâmetros**: `put-parameter --overwrite` e um deploy.
- **Thumbprint do OIDC** (`iam.tf`): a AWS hoje valida o certificado do GitHub sozinha e ignora o
  thumbprint, mas ele continua obrigatório no recurso. Se o GitHub trocar de CA, atualize aqui.
- **`x-origin-verify`** (`api_cdn.tf`): vive no estado e no ambiente da função de API.
  `terraform apply -replace='random_password.origin_verify["<env>"]'` troca o valor, e o mesmo
  `apply` atualiza a função e a distribuição; entre uma e outra, a API do ambiente responde 403.

## Conta nova

Com a conta vazia: crie o bucket de estado ("Estado") e preencha o `terraform.tfvars`. As funções
precisam de uma imagem `argon/api` no ECR antes de existir — `lambda_bootstrap_tag` é obrigatório
e o precondition recusa o vazio —, então o repositório vem primeiro:

```bash
terraform apply -target=aws_ecr_repository.app
docker buildx build --platform linux/arm64 --provenance=false -f apps/api/Dockerfile \
  -t 382597877834.dkr.ecr.sa-east-1.amazonaws.com/argon/api:<tag> --push .   # da raiz do monorepo
terraform apply -var lambda_bootstrap_tag=<tag>
```

Depois: valores dos parâmetros (inclusive `UNSUBSCRIBE_TOKEN_SECRET`), registros DNS na Cloudflare a
partir dos `outputs`, segredos do GitHub, confirmação da assinatura SNS e um deploy pelo workflow,
que publica o site e os arquivos públicos.

## Riscos conhecidos

- Os alarmes diários avaliam por dia UTC e avisam tarde (no dia seguinte); o domingo sem edição é
  coberto pelos heartbeats que os jobs `sunday-edition` e `sunday-send` registram às 5h30 e às 7h
  (`apps/api/src/pipeline/scheduler.ts`).
