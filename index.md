# index.md — Project Index (Atomic Phase 0)

## Root
- `.rule`, `.devinrule`, `skill.md`, `agent.md`, `memory.md`, `index.md`, `context.md`
- `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.json`
- `docker-compose.yml`, `.env.example`

## Apps
- `apps/frontend/` — Next.js 15 (app/(liff|dashboard|web), components/reader|player, lib, hooks, stores, middleware.ts)
- `apps/backend/src/` — NestJS+Fastify (api/graphql|webhooks|guards, modules/*, common/*, infra/*, gateways/*, jobs/*)

## Packages
- `packages/db/prisma/schema.prisma` — SSOT (Phase 0 core; full 279 models via scaffold)
- `packages/db/src/index.ts` — Prisma client export
- `packages/shared/src/schemas/*.ts` — Zod contracts (sdid-contract.ts = Phase 0 core)
- `packages/ui/*`, `packages/tsconfig/*`, `packages/eslint-config/*`

## Scripts & Docs
- `scripts/scaffold-from-inventory.mjs` — reads filefolder.md + schema.md, creates tree
- `scripts/verify-phase000.ts`, `scripts/check-bundle-size.ts`
- `docs/phase-roadmap-130.md`
