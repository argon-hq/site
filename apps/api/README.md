# @argon/api

Next.js só com route handlers. Roda o pipeline da newsletter (Mastra) e as rotas de cadastro. Projeto próprio na Vercel.

## Pipeline mínimo

Uma notícia → Redator → edição escrita em `out/`. Sem banco e sem envio. O Construtor HTML entra na ARG-76.

```bash
cp .env.example .env   # MODEL_PROVIDER=claude-code exige a CLI do Claude Code logada
pnpm pipeline:min https://agenciabrasil.ebc.com.br/geral/noticia/...
```

## Pastas

- `src/pipeline`: Mastra. `models.ts` escolhe o modelo por agente via ambiente (ARG-93).
- `src/app/api`: rotas.
