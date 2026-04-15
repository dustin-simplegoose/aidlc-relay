# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/relay/package.json packages/relay/
COPY packages/relay-client/package.json packages/relay-client/

RUN pnpm install --frozen-lockfile

COPY packages/relay/ packages/relay/
COPY packages/relay-client/ packages/relay-client/

RUN pnpm --filter @aidlc/relay build

# Production stage
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/packages/relay/dist ./dist
COPY --from=builder /app/packages/relay/package.json ./

# Install production deps from the npm registry (deps are now published, no workspace: refs)
RUN npm install --omit=dev --ignore-scripts

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:8080/health || exit 1

CMD ["node", "dist/main.js"]
