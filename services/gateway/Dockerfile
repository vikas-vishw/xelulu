# Xelulu gateway image. Build context is the repo root:
#   docker build -f services/gateway/Dockerfile .
# No secrets or Panel_Keys are baked in; configuration arrives at runtime via env_file.
FROM node:24.21.0-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/parent-app/package.json apps/parent-app/
COPY apps/admin/package.json apps/admin/
COPY services/gateway/package.json services/gateway/
COPY services/simulator/package.json services/simulator/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @xelulu/gateway...
COPY packages/shared packages/shared
COPY services/gateway services/gateway
RUN pnpm --filter @xelulu/gateway... build

FROM node:24.21.0-bookworm-slim
WORKDIR /app
COPY --from=build /repo/services/gateway/dist ./dist
USER node
CMD ["node", "dist/index.js"]
