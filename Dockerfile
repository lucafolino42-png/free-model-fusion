# ─── Build Stage ───────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# ─── Production Stage ────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

RUN apk add --no-cache tini

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Static assets served by the API (UI, favicon, frontend JS modules).
# Without these the dashboard, favicon, and /js/utils.js 404 in the container.
COPY public ./public

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
