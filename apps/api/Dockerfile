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
# Straight to the package, past turbo, so the Prisma client is generated here by hand: the build
# compiles against it. `turbo run build` does the same through the `generate` task.
RUN pnpm --filter api generate && pnpm --filter api build
# The Studio bundle travels with the `mastra` CLI, a devDependency that the runtime stage does not
# install. Copied out of node_modules here, dereferenced (pnpm links it), for the stage below.
RUN cp -rL apps/api/node_modules/mastra/dist/studio apps/api/studio

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --prod --filter api...

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
