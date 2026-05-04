FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json ./
RUN bun install --frozen-lockfile
COPY . .
RUN bunx prisma generate
# Optional: bun run build if you pre-compile, but ts-node/bun can run ts files directly
CMD ["bun", "run", "src/server.ts"]
