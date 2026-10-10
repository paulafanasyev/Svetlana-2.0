# Песочница команд: только runner.mjs, без кода ядра и без секретов
FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends git python3 ca-certificates && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 svetlana && mkdir -p /workspace /sock && chown svetlana /workspace /sock
WORKDIR /runner
COPY runner.mjs ./
USER svetlana
CMD ["node", "runner.mjs"]

# Ядро
FROM node:22-bookworm-slim AS core
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-dejavu ca-certificates && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 svetlana && mkdir -p /data /workspace /sock && chown -R svetlana /data /workspace /sock
WORKDIR /app
COPY . .
RUN node scripts/restore-assets.mjs
# Chromium работает в своей песочнице (нужны user namespaces ядра). Если хост их запрещает — CHROMIUM_NO_SANDBOX=1 в .env осознанно.
ENV NODE_ENV=production CHROMIUM_PATH=/usr/bin/chromium HOST=0.0.0.0 SVETLANA_DATA_DIR=/data SVETLANA_WORKSPACE=/workspace
USER svetlana
EXPOSE 8787
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
