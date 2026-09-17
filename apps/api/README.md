# @argon/api

NestJS with Mastra. Runs the newsletter agents and, later, sign-up, cron, queues and sending. Source of truth for decisions: the Architecture and Stack documents on OneDrive.

## Layout

- `src/mastra/`: Mastra instance (`index.ts`), `agents/`, `prompts/`, `schemas/`, `tools/`. `MastraModule` is imported last and mounted under `/mastra`.
- `src/edition/`: `POST /edition/write { url }` runs the writer agent on one article.
- `src/auth/`: global guard; every route needs the `x-internal-secret` header unless marked `@Public()`.
- `src/config.ts`: environment validated with Zod. Names match the Parameter Store keys under `/argon/<env>/`.

## Run

```bash
pnpm db:up             # local Postgres 16 with pgvector (Docker), argon/argon@localhost:5432/argon_dev
cp .env.example .env   # fill ANTHROPIC_API_KEY and INTERNAL_API_SECRET
pnpm dev               # http://localhost:3001
pnpm mastra:dev        # Mastra Studio. The repeated "does not support listing feedback" log line is a Studio bug (mastra-ai/mastra#23745), harmless.
pnpm test
```

```bash
curl -X POST http://localhost:3001/edition/write -H "x-internal-secret: $INTERNAL_API_SECRET" -H "content-type: application/json" -d '{"url":"https://agenciabrasil.ebc.com.br/..."}'
```
