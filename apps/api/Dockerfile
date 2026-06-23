FROM oven/bun:1 AS base
WORKDIR /app

# ── Chromium + fonts for server-side PDF rendering (Puppeteer, plan §9.1) ──────
# Use the distro Chromium (apt resolves its full dependency tree) and point
# Puppeteer at it; skip Puppeteer's own bundled download during `bun install`.
# fonts-noto-core carries the ₹ (rupee) glyph the finance report needs — without
# it the PDF would show tofu where every ₹ amount should be. The report renders
# state CODES (e.g. "TN"), not Indic script, so a Latin + Noto core set suffices.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       chromium \
       fonts-liberation \
       fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
RUN if [ -d prisma ]; then bunx prisma generate; fi

# NOTE (plan §9.1): the process stays root because the tile-cache volume
# (/var/cache/tiles) is root-owned. Chromium therefore launches with
# --no-sandbox (browserPool args) under container isolation. To run non-root,
# chown the cache volume to the `bun` user and add `USER bun` here.
EXPOSE 3005
CMD ["bun", "run", "src/server.ts"]
