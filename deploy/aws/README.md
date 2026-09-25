# Infraestrutura como código (ARG-116)

Terraform da conta AWS do Argon (382597877834, `sa-east-1`). Descreve o que a tabela "Recursos
criados" do `deploy/README.md` listava de memória, mais os alarmes das etapas 2, 8 e 14 da revisão
de 24/09/2026.

> **Aplicado em 24/09/2026.** O primeiro `plan` importou 82 recursos, criou as duas assinaturas de
> e-mail do SNS e só alterou tags e descrições; o `apply` que o seguiu deixou a conta igual ao código
> (`terraform plan` responde "No changes"). O estado está no bucket `argon-terraform-state-382597877834`.

## O que cobre

| Arquivo | Recursos |
| --- | --- |
| `ec2.tf` | Instância `i-00296133cc8e8093d` (t4g.small, AL2023 arm64, gp3 de 16 GB), IP elástico `54.94.89.230`, security groups `argon-web` e `argon-db` com suas regras, IMDSv2 obrigatório |
| `iam.tf` | Papel `argon-ec2` (SSM, ECR pull, Parameter Store, logs, S3 dos dumps) e seu instance profile; provedor OIDC do GitHub e papel `argon-github-deploy`, que também escreve no bucket público e no prefixo `public-assets/` do bucket de estado |
| `ecr.tf` | Repositórios `argon/web` e `argon/api`, com ciclo de vida de 10 imagens |
| `s3.tf` | Bucket `argon-db-backups-382597877834`: acesso público bloqueado, SSE-S3, sem versionamento, dumps expiram em 30 dias |
| `s3_public.tf` | Bucket `argon-public-382597877834`: leitura pública de objetos por política (sem listagem, sem ACL), SSE-S3, CORS de GET. O conteúdo é do root `public-assets/`, abaixo |
| `sns.tf` | Tópico `argon-alerts` em `sa-east-1` e outro de mesmo nome em `us-east-1`, cada um com uma assinatura por e-mail |
| `budget.tf` | Orçamento `argon-mensal`, US$ 30, avisos em 80% e 100% |
| `logs.tf` | Grupos `/argon/<env>/web`, `/argon/<env>/api` e `/argon/postgres`, retenção de 30 dias |
| `alarms.tf` | Filtros de métrica em `/argon/prod/api` e alarmes (abaixo), recuperação da instância, health check do Route 53 |
| `parameters.tf` | Nomes e tipos dos parâmetros `/argon/<env>/*` e `/argon/postgres/*`. **Nunca os valores** |
| `imports.tf` | Um bloco `import` para cada recurso que já existia, para o primeiro `plan` adotar em vez de criar |

O que existia na conta em 24/09/2026 e é importado: instância, IP, os dois security groups e
suas cinco regras, os dois papéis com políticas, o provedor OIDC, os dois repositórios ECR com
ciclo de vida, o bucket com suas configurações, o orçamento, seis grupos de log e 28 parâmetros.

O que **não existia** e o primeiro `apply` cria: os dois tópicos SNS e suas assinaturas, o grupo
`/argon/prod/api`, os cinco filtros de métrica, os oito alarmes e o health check.

## O que não cobre

- **DNS.** A zona `argon.eduardofockink.com` está na conta 663702377780 (perfil `default`),
  provisória até a ARG-68. Os registros `A` que apontam para o IP elástico continuam à mão até
  a zona mudar de conta; aí entram aqui.
- **A stack do Compose.** Containers, Caddy, Postgres, timers e o conteúdo de `/opt/argon` são
  do `deploy.sh` e do workflow, não do Terraform. O `user_data` da instância aponta para
  `../bootstrap.sh` só para uma conta nova.
- **Segredos do GitHub** (`AWS_DEPLOY_ROLE_ARN`, `AWS_INSTANCE_ID`): copie dos `outputs`.
- **Valores dos parâmetros.** Ver "Parâmetros".
- `/argon/rds/master_password`: sobra do RDS, não gerido. Apague à mão.

## Alarmes

Todos publicam no tópico `argon-alerts` da sua região.

| Alarme | Fonte | Dispara quando |
| --- | --- | --- |
| `argon-prod-schedule-not-fired` | log `schedule fired` | nenhum no dia (UTC). Falso positivo conhecido: de domingo à noite até segunda 5h30, porque não há edição de domingo |
| `argon-prod-send-not-finished` | log `send finished` | nenhum no dia. Mesmo falso positivo |
| `argon-backup-missing` | métrica `Argon/BackupOk`, publicada pelo `backup-db.sh` (etapa 14) | nenhuma no dia. O plano pedia 26 h; a janela de um alarme é limitada a um dia |
| `argon-prod-api-errors` | log `level = error` | um ou mais em 5 min |
| `argon-prod-edition-stuck` | log `edition stuck` (etapa 8) | um ou mais em 5 min |
| `argon-prod-owner-alert-skipped` | log `owner alert skipped` (etapa 2) | um ou mais em 5 min |
| `argon-ec2-system-check-failed` | `StatusCheckFailed_System` | 2 min seguidos; também pede a recuperação da instância |
| `argon-prod-api-health` (us-east-1) | health check do Route 53 em `https://api.argon.eduardofockink.com/health` | 3 min seguidos de falha, ou sem dados |

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
  todo deploy (exceto rollback por tag), antes de reiniciar os containers. O Terraform compara o MD5 de cada arquivo com o estado:
  arquivo alterado é reenviado, arquivo novo é criado, arquivo apagado sai do bucket, o resto não é
  tocado. O estado fica em `public-assets/<env>.tfstate`, no bucket de estado; o papel de deploy só
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

## Primeiro plan e apply

```bash
cd deploy/aws
terraform fmt -recursive          # o código nunca passou pelo fmt
terraform init
terraform validate
terraform plan -out=first.tfplan
```

O que o primeiro `plan` deve mostrar, e nada além disso:

- **Import** de tudo que está em `imports.tf` (≈ 60 recursos).
- **Create** dos tópicos SNS e assinaturas, do grupo `/argon/prod/api`, dos filtros, dos
  alarmes e do health check.
- **Update in-place** da instância: `http_put_response_hop_limit` de 2 para 1. Isso muda a
  instância em execução. Os containers deixam de alcançar o IMDS, o que é o objetivo: nenhum
  deles faz chamada à AWS (o driver `awslogs` roda no `dockerd`, no host). Se algum dia um
  container precisar das credenciais da instância, o limite volta a 2 aqui, não no console.
- **Update in-place** de tags: os grupos de log, os parâmetros, o bucket, o instance profile e
  as regras dos security groups não tinham a tag `Project=argon`, que o provedor aplica a tudo
  (`default_tags`).

Qualquer **replace** é sinal de erro no código, não da conta. Em especial a instância: `ami` e
`user_data` estão em `ignore_changes` justamente para nunca a substituírem. Se aparecer, pare e
corrija antes do `apply`.

Diferenças pequenas que podem aparecer e são cosméticas (documentos JSON reordenados, campos
computados): confira que o `apply` delas não altera comportamento, ou ajuste o código até o
`plan` ficar limpo. Um `plan` limpo depois do primeiro `apply` é o critério de aceite da ARG-116.

```bash
terraform apply first.tfplan
```

Depois do primeiro `apply`, `imports.tf` pode ser apagado.

## Confirmar as assinaturas

O SNS só entrega a um e-mail que confirmou a assinatura. O `apply` cria as duas assinaturas (uma
por região) e a AWS manda um e-mail "AWS Notification - Subscription Confirmation" para cada;
clique em *Confirm subscription* nos dois. O provedor espera alguns minutos pela confirmação
durante o `apply`; se expirar, confirme e rode `terraform apply` de novo. Para conferir:

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

O valor chega aos containers no deploy seguinte. Um parâmetro **novo** entra primeiro em
`parameters.tf` (o `apply` o cria com `CHANGE-ME`) e recebe o valor real pelo comando acima.
Numa conta nova, todos nascem assim e precisam de valor antes do primeiro deploy.

## Rotação

- **Parâmetros**: `put-parameter --overwrite` e um deploy.
- **Thumbprint do OIDC** (`iam.tf`): a AWS hoje valida o certificado do GitHub sozinha e ignora o
  thumbprint, mas ele continua obrigatório no recurso. Se o GitHub trocar de CA, atualize aqui.
- **IP elástico**: não rotaciona; o DNS na outra conta aponta para ele.
- **Instância**: recriá-la (novo `ami` ou `user_data`) é uma decisão manual — tire o
  `ignore_changes`, planeje, e lembre que o volume `db-data` do Postgres vai junto. Restaure do
  backup na instância nova.

## Conta nova

Com a conta vazia: crie o bucket de estado ("Estado"), apague `imports.tf`, preencha o
`terraform.tfvars`, `terraform apply`. Depois: valores dos parâmetros, `ARGON_BACKUP_BUCKET` em
`/opt/argon/.env` na instância, segredos do GitHub a partir dos `outputs`, registros DNS na
conta da zona, confirmação das assinaturas SNS. O `bootstrap.sh` roda como user data e deixa
Docker, swap e timers prontos; o primeiro deploy pelo workflow sobe o resto.

## Riscos conhecidos

- Os alarmes diários avaliam por dia UTC e avisam tarde (no dia seguinte); o domingo sem edição é
  coberto pelos heartbeats que a API registra às 5h30 e às 7h (workflow `heartbeat`, agendamentos
  `edition-sunday` e `send-sunday` em `src/pipeline/schedules.ts`).
- `/argon/prod/api` pode ter sido criado pelo `awslogs` entre a escrita deste código e o
  primeiro `apply`. Se o `plan` tentar criá-lo e o `apply` falhar com "already exists", adicione
  o import em `imports.tf`.
- `argon-db` não tem nada atrás dele desde o fim do RDS. Foi mantido por existir; pode sair
  junto com a última menção a RDS.
