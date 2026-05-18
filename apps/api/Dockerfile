FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
RUN if [ -d prisma ]; then bunx prisma generate; fi
EXPOSE 3005
CMD ["bun", "run", "src/server.ts"]
