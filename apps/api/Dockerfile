# syntax=docker/dockerfile:1
# API (NestJS + Mastra). Build from the monorepo root:
#   docker build -f apps/api/Dockerfile -t argon/api .
# The pnpm store is a cache mount (the syntax line above enables it): packages already fetched by
# an earlier build are not downloaded again. Needs BuildKit — the default with buildx installed,
# DOCKER_BUILDKIT=1 otherwise.
FROM node:22.23-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --filter api...
COPY apps/api apps/api
RUN pnpm --filter api build
# The Studio bundle travels with the `mastra` CLI, a devDependency that the runtime stage does not
# install. Copied out of node_modules here, dereferenced (pnpm links it), for the stage below.
RUN cp -rL apps/api/node_modules/mastra/dist/studio apps/api/studio

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --prod --filter api...
# The prisma CLI is in the image for one command, `migrate deploy` (deploy.sh). It loads its Studio
# and `prisma dev` modules at startup, so those stay; what it never touches on that path goes:
# pglite (the local dev server's database) and TypeScript, an optional peer that nothing runs.
# @prisma/client ships a query compiler for every database it supports, twice; only the PostgreSQL
# one is ever loaded here. Measured on 25/09/2026 (amd64, with the single copy of effect from
# pnpm-workspace.yaml): 1.13 GB down to 945 MB. If `migrate deploy` ever needs one of these, the
# deploy fails before any container is replaced.
RUN rm -rf node_modules/.pnpm/@electric-sql+pglite* node_modules/.pnpm/typescript@* \
 && find node_modules/.pnpm -path '*/@prisma/client/runtime/*' -name 'query_compiler_*' ! -name '*postgresql*' -delete

FROM node:22.23-alpine AS run
ENV NODE_ENV=production PORT=3001
WORKDIR /repo
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps --chown=app:app /repo/node_modules ./node_modules
COPY --from=deps --chown=app:app /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps --chown=app:app /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=app:app /repo/apps/api/dist ./apps/api/dist
# Static files of Mastra Studio, served under /studio when STUDIO_ENABLED is on.
COPY --from=build --chown=app:app /repo/apps/api/studio ./apps/api/studio
# Prisma CLI + migrations: deploy.sh runs `prisma migrate deploy` from this image.
COPY --from=build --chown=app:app /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=app:app /repo/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
USER app
WORKDIR /repo/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
