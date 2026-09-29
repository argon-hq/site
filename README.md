# Argon

Monorepo da newsletter Argon: o site, a API que gera e envia as edições, e o deploy.

## Requisitos

- **Node.js 22** — a versão das imagens e do CI (Node 22 LTS, correções até abril de 2027).
- **pnpm** — a versão está fixada em `packageManager` no `package.json`. Com o Corepack ativo
  (`corepack enable`), ela é usada automaticamente.
- **Docker** — para o Postgres e o Mailpit locais (`pnpm -C apps/api db:up`).

## Começando

```bash
pnpm install
pnpm -C apps/api db:up      # Postgres 16 com pgvector e Mailpit, em containers
cp apps/api/.env.example apps/api/.env   # preencha ANTHROPIC_API_KEY e os segredos
cp apps/web/.env.example apps/web/.env
pnpm dev
```

O site sobe em `https://localhost:3000`, com um certificado que o `pnpm certs` gera na primeira
vez (e que o `pnpm dev` refaz sozinho quando vence). É https porque a validação da edição só
aceita links https: o link de descadastro que vai no e-mail aponta para o site, e um link que o
site local não atende seria pior do que link nenhum. A API sobe em `http://localhost:3001` — ela
nunca aparece dentro do e-mail.

O certificado é assinado por uma autoridade nossa, então o navegador avisa na primeira visita.
Para parar de avisar, importe `certs/rootCA.pem` como autoridade confiável; senão, é só seguir.
O diretório `certs/` fica fora do git e se refaz a qualquer momento com `pnpm certs`.

## Comandos

Rodados da raiz, o Turborepo os executa em todos os pacotes do workspace:

| Comando             | O que faz                                                              |
| ------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`          | Sobe os pacotes em modo de desenvolvimento                             |
| `pnpm build`        | Build de produção                                                      |
| `pnpm lint`         | ESLint (com regras que leem os tipos, na API)                          |
| `pnpm format`       | Prettier em todo o código; `pnpm format:check` só confere              |
| `pnpm check-types`  | Checagem de tipos                                                      |
| `pnpm test`         | Vitest nos dois pacotes; `pnpm -C apps/api test:coverage` mede a API   |
| `pnpm certs`        | Gera o certificado de TLS local em `certs/`                            |

Para rodar em um pacote só, sem passar pelo turbo: `pnpm -C apps/api <script>`.

O turbo mantém cache local em `.turbo/` — execuções repetidas sem mudança no código terminam
em milissegundos. O diretório cresce com o tempo e pode ser apagado a qualquer momento: é
cache, e se refaz sozinho.

## Estrutura

```
argon/
├── apps/
│   ├── api/              # NestJS + Mastra: cadastro, geração, construção e envio das edições
│   └── web/              # site institucional (Next.js): páginas, cadastro, confirmação, descadastro
├── deploy/               # compose.yml, Caddyfile, scripts da instância e o Terraform (aws/)
├── scripts/              # ferramental do workspace (certificado local)
├── .github/workflows/    # CI e deploy
├── packages/             # código compartilhado entre apps (ainda vazio)
├── package.json          # raiz do workspace
├── pnpm-workspace.yaml   # pacotes do workspace, permissões de build e overrides
├── pnpm-lock.yaml        # lockfile único, para todo o workspace
└── turbo.json            # tasks e suas dependências
```

Cada parte tem o seu README: [`apps/api`](apps/api/README.md) explica a esteira das edições e as
rotas, [`apps/web`](apps/web/README.md) o site, e [`deploy`](deploy/README.md) a instância, o
workflow, o rollback e o que se configura à mão. As convenções do time estão em
[`AGENTS.md`](AGENTS.md); a fonte delas são os documentos no OneDrive.

`packages/` já está no glob do workspace: quando surgir código compartilhado, basta criar a
pasta e rodar `pnpm install`.

## Trabalhando no workspace

Dependência para um app específico:

```bash
pnpm --filter web add <pacote>
```

Dependência de ferramental, na raiz:

```bash
pnpm add -Dw <pacote>
```

Alguns pacotes trazem scripts de instalação, que o pnpm bloqueia por padrão. A decisão de
permitir ou não fica registrada em `allowBuilds`, no `pnpm-workspace.yaml`. Se um `pnpm install`
reclamar de builds ignorados, use `pnpm approve-builds <pacote>` — ou `!<pacote>` para negar —
e o arquivo é atualizado sozinho. O mesmo arquivo guarda os `overrides` de versões transitivas
(hoje só o `multer`, por uma vulnerabilidade corrigida acima do que o Nest pede).

## Qualidade

Lint, `tsc`, formatação e testes rodam no CI a cada push e PR, em paralelo ao deploy — o CI não
é portão. O Dependabot abre PRs semanais para actions, imagens e pacotes npm.
