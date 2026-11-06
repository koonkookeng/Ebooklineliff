FROM node:20-alpine AS base

FROM base AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g pnpm

# Public values are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_DEFAULT_LIFF_ID
ARG NEXT_PUBLIC_LIFF_ID
ARG NEXT_PUBLIC_LINE_LIFF_ID
ARG NEXT_PUBLIC_LIFF_URL_BASE
ARG NEXT_PUBLIC_LINE_OA_URL
ARG NEXT_PUBLIC_BASE_DOMAIN
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_DEFAULT_LIFF_ID=$NEXT_PUBLIC_DEFAULT_LIFF_ID \
    NEXT_PUBLIC_LIFF_ID=$NEXT_PUBLIC_LIFF_ID \
    NEXT_PUBLIC_LINE_LIFF_ID=$NEXT_PUBLIC_LINE_LIFF_ID \
    NEXT_PUBLIC_LIFF_URL_BASE=$NEXT_PUBLIC_LIFF_URL_BASE \
    NEXT_PUBLIC_LINE_OA_URL=$NEXT_PUBLIC_LINE_OA_URL \
    NEXT_PUBLIC_BASE_DOMAIN=$NEXT_PUBLIC_BASE_DOMAIN \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @repo/shared build
RUN pnpm --filter @ebook-liff/frontend build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat

# outputFileTracingRoot is the monorepo root, so .next/standalone mirrors the
# repo layout: server.js is at standalone/apps/frontend/server.js. Runtime
# static/public assets must sit next to it.
COPY --from=builder /app/apps/frontend/.next/standalone ./
COPY --from=builder /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public

WORKDIR /app/apps/frontend
EXPOSE 3000
CMD ["node", "server.js"]
