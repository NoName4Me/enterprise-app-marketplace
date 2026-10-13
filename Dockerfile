# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN npm install -g pnpm@10.17.1
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
# Build-time non-secret placeholders; production values arrive at runtime.
RUN DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder \
    BETTER_AUTH_URL=http://localhost:3000 \
    BETTER_AUTH_SECRET=build-only-placeholder-never-use-for-runtime-234567890 \
    NEXT_TELEMETRY_DISABLED=1 pnpm build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
