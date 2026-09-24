# Argon

Newsletter diária de negócios, em português, escrita por agentes de IA e enviada de segunda a
sábado. Este arquivo é a cópia curta das convenções do time e vale para pessoas e agentes de
código. A fonte são os documentos `Diretrizes`, `Arquitetura`, `Stack` e `Infraestrutura`, na
pasta `Argon/Newsletter` do OneDrive; quando houver divergência, o documento manda.

## 1. O produto

- **Site** (`apps/web`): páginas institucionais, cadastro, confirmação, descadastro e arquivo das
  edições. Só mostra páginas e manda formulário para a API.
- **API** (`apps/api`): processo Nest permanente. Cadastro, geração da edição pelos agentes,
  construção do e-mail, envio e recebimento dos avisos do provedor. Agendador interno: geração às
  5h30, envio às 7h, `America/Sao_Paulo`.
- **Banco**: assinantes, notícias, edições, entregas e configurações.

Princípio central: **os agentes decidem, o código impõe as regras**. Limites, janelas, fontes
permitidas e validações ficam em código; o agente escolhe dentro delas. A construção do e-mail é
determinística — regra em código não erra nem custa token.

## 2. Repositório

Monorepo pnpm 11 + Turborepo, Node 22, TypeScript.

```
apps/web     # @argon/web — Next.js 16, React 19, Tailwind 4, next-intl
apps/api     # @argon/api — NestJS 11, Mastra, Prisma 7.10, Zod 4, Vitest
deploy/      # compose.yml, Caddyfile, deploy.sh, bootstrap.sh
```

Na raiz, o turbo roda em todos os pacotes:

```bash
pnpm dev; pnpm build; pnpm lint; pnpm check-types; pnpm test
```

Em um pacote só: `pnpm -C apps/api <script>`. Na API: `db:up` sobe o Postgres local,
`db:migrate` cria migration, `email:preview` renderiza o e-mail. O Studio é o da própria API, em
`http://localhost:3001/studio`, com `STUDIO_ENABLED=true`.

O cliente Prisma é gerado em `apps/api/src/generated/prisma`, fora do git, antes de build, dev,
test e check-types.

## 3. Código

- Código, identificadores, esquema de banco, comentários, commits e branches em **inglês**.
  Documentos, PRs e cards em **português**.
- **Zod** nas fronteiras dos agentes e endpoints, inclusive no corpo das requisições, pelo
  `ZodBodyPipe`. Sem `class-validator`: um esquema só, que serve ao agente e à rota.
- **Effect** como padrão na API: erros tipados (`Data.TaggedError`), pattern matching (`Match`),
  retries (`Effect.retry` + `Schedule`) e promises (`Effect.tryPromise`). O efeito roda na borda
  do Nest, com `Effect.runPromise`. Não misturar try/catch e Effect na mesma função. Código novo
  já nasce assim; o existente migra quando for tocado.
- Serviços recebem dependências por **injeção** — `EmailService`, provedor de modelos, banco.
- Logs pelo Logger do Nest, em JSON, indexados pelo CloudWatch. Custo em tokens e resultado da
  revisão vão para o log, não para o banco.
- Públicas são só `/health` e `POST /subscriber/unsubscribe/one-click`, que o servidor do cliente
  de e-mail chama sozinho, e, onde `STUDIO_ENABLED` está ligado, os estáticos do Studio em
  `/studio` mais `GET /mastra/auth/capabilities`, que o Studio precisa antes de desenhar a tela.
  Todas as outras, inclusive as rotas do Mastra, exigem `x-internal-secret` — o Studio manda o
  segredo que o operador guarda nele, no navegador. A chave de metadata do `@Public` é um
  `Symbol`, não uma string: o `@mastra/nestjs` marca o `/health`, o `/ready` e o `/info` dele com
  a chave `"isPublic"`, e uma string de mesmo nome abriria essas rotas junto.
- Segredos no ambiente (Parameter Store em `/argon/<env>/`), nunca no repositório nem na tabela
  de configurações.
- Documentação de biblioteca pelo **context7**.

## 4. Git

- Branch `<tipo>/ARG-<n>-<descricao>`, com `feat`, `fix`, `docs`, `chore`, `refactor`.
  Ex.: `feat/ARG-76-email-builder`.
- Commits em conventional commits, em inglês, enxutos, no máximo 20 palavras.
- PR para `dev`, em português, com a chave do Jira no título. Um card, uma branch, um PR.
  Trabalho sem card é exceção, e o PR diz por quê.
- Nenhuma referência à ferramenta de IA em commits, PRs, comentários, documentos ou cards.

## 5. Qualidade e deploy

- Lint, `tsc` e testes passam antes do PR e rodam no CI depois de abrir o PR.
- **O CI não é portão**: ele dispara junto com o deploy, não antes. Vermelho não impede a
  publicação.
- Push em `dev` faz deploy no ambiente dev; push em `main`, em prod. O ambiente `lab` é publicado
  à mão, em Actions → Deploy → Run workflow, escolhendo a branch.
- Migration versionada no repositório e aplicada pelo deploy (`prisma migrate deploy`). Nada de
  alterar banco à mão. O que o schema não expressa (check constraints, gatilhos, valores iniciais)
  vive no SQL da migration.

## 6. Documentos e cards

- Direto e enxuto: o que é e por quê.
- Decisão entra no documento de `Stack` ou de `Arquitetura` com data e origem. Discussão fica no
  PR, na daily ou no card.
- Card com critérios de aceite verificáveis e dependências. Card, branch e PR se atualizam quando
  a decisão muda.

## 7. Agentes de código

- Propor o texto de documento e de card **antes** de escrever, e esperar a revisão.
- Commit local. Push e PR só quando pedidos.
- Planos de tarefa ficam fora do repositório, em `~/dev/Argon/plans/`.
