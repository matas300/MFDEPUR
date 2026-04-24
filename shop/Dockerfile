# syntax=docker/dockerfile:1.6
# Multi-stage build per MFDEPUR Shop
# Stage 1: installa deps + genera Prisma client
# Stage 2: runtime minimale

ARG NODE_VERSION=20.17.0-alpine3.20

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Install completo (serve Prisma engine binary per generate)
RUN npm ci --omit=dev && npm cache clean --force

FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate && npm prune --omit=dev && npm cache clean --force

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Utente non-root
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app . .
USER app
EXPOSE 3000
# Health check (container scheduler)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/healthz', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))" || exit 1
CMD ["node", "server.js"]
