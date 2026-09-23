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

O site sobe em `https://localhost:3000`, com um certificado que o `pnpm certs` gera na primeira
vez (e que o `pnpm dev` refaz sozinho quando vence). É https porque a validação da edição só
aceita links https: o link de descadastro que vai no e-mail aponta para o site, e um link que o
site local não atende seria pior do que link nenhum. A API continua em http — ela nunca aparece
dentro do e-mail.

O certificado é assinado por uma autoridade nossa, então o navegador avisa na primeira visita.
Para parar de avisar, importe `certs/rootCA.pem` como autoridade confiável; senão, é só seguir.
O diretório `certs/` fica fora do git e se refaz a qualquer momento com `pnpm certs`.

## Comandos

Rodados da raiz, o Turborepo os executa em todos os pacotes do workspace:

| Comando | O que faz |
| --- | --- |
| `pnpm dev` | Sobe os pacotes em modo de desenvolvimento |
| `pnpm build` | Build de produção |
| `pnpm lint` | ESLint |
| `pnpm check-types` | Checagem de tipos |
| `pnpm certs` | Gera o certificado de TLS local em `certs/` |

Para rodar em um pacote só, sem passar pelo turbo: `pnpm -C apps/web <script>`.

O turbo mantém cache local em `.turbo/` — execuções repetidas sem mudança no código terminam
em milissegundos. O diretório cresce com o tempo e pode ser apagado a qualquer momento: é
cache, e se refaz sozinho.

## Estrutura

```
argon/
├── apps/
│   └── web/              # site institucional (Next.js)
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
pnpm --filter web add <pacote>
```

Dependência de ferramental, na raiz:

```bash
pnpm add -Dw <pacote>
```

Alguns pacotes trazem scripts de instalação, que o pnpm bloqueia por padrão. A decisão de
permitir ou não fica registrada em `allowBuilds`, no `pnpm-workspace.yaml`. Se um `pnpm install`
reclamar de builds ignorados, use `pnpm approve-builds <pacote>` — ou `!<pacote>` para negar —
e o arquivo é atualizado sozinho.
