FROM node:20-alpine AS base

FROM base AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN npm install -g pnpm
COPY . .
RUN pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile
RUN pnpm --filter @repo/shared build
# Prisma Client must be generated before tsc: the backend imports
# @prisma/client types (PrismaClient, UserRole, ...). turbo normally does this
# via the `db:generate` task, but the Docker build calls the package script
# directly, so generate it explicitly here.
ENV DATABASE_URL="postgresql://prisma:prisma@localhost:5432/prisma"
RUN pnpm --filter @ebook-liff/backend db:generate
RUN pnpm --filter @ebook-liff/backend build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat openssl

# Preserve the pnpm workspace layout: apps/backend/node_modules contains
# symlinks into the root virtual store (node_modules/.pnpm) and into
# packages/shared, so the whole tree must keep the same relative structure.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

WORKDIR /app/apps/backend
EXPOSE 3000
CMD ["node", "dist/main.js"]
