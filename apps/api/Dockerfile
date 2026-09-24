# API (NestJS + Mastra). Build from the monorepo root:
#   docker build -f apps/api/Dockerfile -t argon/api .
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api...
COPY apps/api apps/api
RUN pnpm --filter api build
# The Studio bundle travels with the `mastra` CLI, a devDependency that the runtime stage does not
# install. Copied out of node_modules here, dereferenced (pnpm links it), for the stage below.
RUN cp -rL apps/api/node_modules/mastra/dist/studio apps/api/studio

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter api...

FROM node:22-alpine AS run
ENV NODE_ENV=production PORT=3001
WORKDIR /repo
RUN addgroup -S app && adduser -S app -G app \
  # RDS root certificates, referenced by DATABASE_URL (sslmode=verify-full&sslrootcert=/etc/rds-ca.pem)
  && wget -qO /etc/rds-ca.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
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
