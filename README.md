# Argon

Monorepo da Argon.

## Requisitos

- **Node.js** 20.9 ou superior
- **pnpm** — a versão está fixada em `packageManager` no `package.json`. Com o Corepack ativo
  (`corepack enable`), ela é usada automaticamente.

## Começando

```bash
pnpm install
pnpm dev
```

O site sobe em `http://localhost:3000`.

## Comandos

Rodados da raiz, o Turborepo os executa em todos os pacotes do workspace:

| Comando | O que faz |
| --- | --- |
| `pnpm dev` | Sobe os pacotes em modo de desenvolvimento |
| `pnpm build` | Build de produção |
| `pnpm lint` | ESLint |
| `pnpm check-types` | Checagem de tipos |

Para rodar em um pacote só, sem passar pelo turbo: `pnpm -C apps/web <script>`.

O turbo mantém cache local em `.turbo/` — execuções repetidas sem mudança no código terminam
em milissegundos. O diretório cresce com o tempo e pode ser apagado a qualquer momento: é
cache, e se refaz sozinho.

### Antes de abrir o PR

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm check-types && pnpm build
```

O install com lockfile congelado é o que a Vercel executa: se o lockfile estiver dessincronizado
do `package.json`, o build falha lá e passa aqui.

## Estrutura

```
argon/
├── apps/
│   └── web/              # @argon/web — site institucional (Next.js)
├── packages/             # código compartilhado entre apps (ainda vazio)
├── package.json          # raiz do workspace
├── pnpm-workspace.yaml   # pacotes do workspace e permissões de build
├── pnpm-lock.yaml        # lockfile único, para todo o workspace
└── turbo.json            # tasks e suas dependências
```

Cada app tem o seu README com as particularidades dele — comece por
[`apps/web`](apps/web/README.md).

`packages/` já está no glob do workspace: quando surgir código compartilhado, basta criar a
pasta e rodar `pnpm install`.

## Trabalhando no workspace

Dependência para um app específico:

```bash
pnpm --filter @argon/web add <pacote>
```

Dependência de ferramental, na raiz:

```bash
pnpm add -Dw <pacote>
```

Alguns pacotes trazem scripts de instalação, que o pnpm bloqueia por padrão. A decisão de
permitir ou não fica registrada em `allowBuilds`, no `pnpm-workspace.yaml`. Se um `pnpm install`
reclamar de builds ignorados, use `pnpm approve-builds <pacote>` — ou `!<pacote>` para negar —
e o arquivo é atualizado sozinho.
