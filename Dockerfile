# Bytecra POS API — production image (Node 22, matches CI).
# Server runs from source: `node server/index.js` (no Vite bundle).

# ---------------------------------------------------------------------------
# Stage 1: install production Node dependencies (native addons: bcrypt, sharp)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

# Use Debian Chromium in the runtime image instead of Puppeteer's download.
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      wget \
      gnupg \
      gosu \
      openssl \
      chromium \
      fonts-liberation \
      fonts-noto-core \
      libnss3 \
      libatk-bridge2.0-0 \
      libdrm2 \
      libxkbcommon0 \
      libgbm1 \
      libasound2 \
    && wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    UPLOADS_DIR=/data/uploads \
    MAHALI_UPLOADS_DIR=/data/uploads \
    TLS_DIR=/data/tls

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY docker/entrypoint.sh /entrypoint.sh

RUN mkdir -p /data/uploads /data/tls /app/backups /app/logs \
    && chmod +x /entrypoint.sh \
    && chown -R node:node /app /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=8s --start-period=45s --retries=3 \
  CMD wget -qO- --no-check-certificate "https://127.0.0.1:${PORT}/api/health" \
      || wget -qO- "http://127.0.0.1:${PORT}/api/health" \
      || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server/index.js"]
