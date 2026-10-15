# Resolution worker image. Build from the repo root:
#   docker build -f apps/worker/Dockerfile -t mention-worker .
# Railway: set the service's Dockerfile path to apps/worker/Dockerfile (root directory: /).
FROM node:22-slim

ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# Manifests first so dependency installs cache across code changes. Every
# workspace manifest is copied so the frozen lockfile matches; only the
# worker's dependency tree is installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json packages/db/
COPY apps/resolution/package.json apps/resolution/
COPY apps/resolver/package.json apps/resolver/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter "@mention/worker..."

COPY packages/db packages/db
COPY apps/resolution apps/resolution
COPY apps/resolver/src apps/resolver/src
COPY apps/worker/src apps/worker/src
COPY apps/worker/scripts apps/worker/scripts
# The worker speaks the program interface through the web app's committed IDL.
COPY apps/web/src/lib/idl/mention.json apps/web/src/lib/idl/mention.json

USER node
CMD ["node", "apps/worker/src/main.mjs"]
