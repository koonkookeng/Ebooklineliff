# File & Folder Inventory — Ebook LINE LIFF V2 (All Phases, Deduplicated)

สกัดจาก `Phase1-4_EbooklineliffV2.md` (Atomic 000–070) + `Phase5-7_EbooklineliffV2.md` (Atomic 071–129) รวม 2 วิธี: (1) regex `IN_SCOPE_FILES` / path mentions, (2) parse Directory Structure Tree (`├──/└──`).

- canonical ไม่ซ้ำหลังรวม `src/* → apps/*, packages/*`: **2168** (ไฟล์ **1374** + โฟลเดอร์/module **794**)
- กฎลดซ้ำซ้อน:
  - `src/backend/**` → `apps/backend/src/**`, `src/frontend/**` → `apps/frontend/**`, `src/shared/**` → `packages/shared/src/**`, `src/database/prisma/**` → `packages/db/prisma/**`, `infra/**` → `apps/backend/src/infra/**`
  - `**/**`, `/**/*`, `/*` ยุบเป็นโฟลเดอร์เดียว (kind=dir), ไฟล์ซ้ำต่าง phase รวม phase ไว้ช่องเดียว
  - `.rule/.devinrule/skill.md/agent.md/memory.md/index.md/context.md` บังคับ root; `middleware.ts/next.config.*` ที่ mention ลอยๆ map ลง `apps/frontend/`; ตัด npm import (`prisma/client*`) และขยะ `*)` ทิ้ง
  - ยึดโครง Turborepo `apps/* + packages/*` ของ Phase 001 เป็น canonical (เลิกใช้ `src/*` คู่ขนาน)

## โครงโฟลเดอร์รวม (Unified, แนะนำใช้จริง)

```
(root)
├── .rule / .devinrule / skill.md / agent.md / memory.md / index.md / context.md
├── package.json / pnpm-workspace.yaml / turbo.json / tsconfig.json
├── .eslintrc.js / .prettierrc / docker-compose.yml / .env.example
├── docs/phase-roadmap-130.md
├── scripts/verify-*.ts / check-bundle-size.ts
├── apps/frontend/ (Next.js 15: app/(liff|dashboard|web), components/*, lib/*, hooks/*, stores/*, providers/*, middleware.ts)
├── apps/backend/src/ (NestJS+Fastify: api/graphql|webhooks|guards, modules/*, common/*, infra/*, gateways/*, jobs/*)
├── packages/db/prisma/schema.prisma + packages/db/src/index.ts
├── packages/shared/src/schemas/*.ts (Zod contracts) + types/*
├── packages/ui/*, packages/tsconfig/*, packages/eslint-config/*
└── infra/ (รวมเข้า apps/backend/src/infra + docker/postgres/redis configs)
```

## ตารางทั้งหมด เรียงตามโฟลเดอร์ (Folder → File)

| โฟลเดอร์ | ไฟล์ / พาธเต็ม (canonical) | ประเภท | Phase ต้นทาง | หมายเหตุ |
|---|---|---|---|---|
| (root) | `.devinrule` | file | 000 | AI IDE rule/memory |
| (root) | `.rule` | file | 000 | AI IDE rule/memory |
| (root) | `agent.md` | file | 000 | AI IDE rule/memory |
| (root) | `context.md` | file | 000 | AI IDE rule/memory |
| (root) | `docker-compose.yml` | file | 001, 002 | Monorepo root config |
| (root) | `index.md` | file | 000 | AI IDE rule/memory |
| (root) | `memory.md` | file | 000 | AI IDE rule/memory |
| (root) | `package.json` | file | 000, 001, 021 | Monorepo root config |
| (root) | `pnpm-workspace.yaml` | file | 001 | Monorepo root config |
| (root) | `skill.md` | file | 000 | AI IDE rule/memory |
| (root) | `tsconfig.json` | file | 000, 001 | Monorepo root config |
| (root) | `turbo.json` | file | 001 | Monorepo root config |
| apps/backend | `apps/backend` | dir | 001 | — |
| apps/backend | `apps/backend/nest-cli.json` | file | 001 | — |
| apps/backend | `apps/backend/package.json` | file | 001 | — |
| apps/backend | `apps/backend/tsconfig.json` | file | 001 | — |
| apps/backend/src | `apps/backend/src` | dir | 001 | — |
| apps/backend/src | `apps/backend/src/app.module.ts` | file | 001 | NestJS module |
| apps/backend/src | `apps/backend/src/main.ts` | file | 001 | — |
| apps/backend/src/api | `apps/backend/src/api` | dir | 000, 004, 031, 034, 061, 093, 098, 101, 102, 105, 121 | — |
| apps/backend/src/api/controllers | `apps/backend/src/api/controllers/csp-report.controller.ts` | file | 028 | REST controller |
| apps/backend/src/api/controllers | `apps/backend/src/api/controllers/media-vault.controller.ts` | file | 036 | REST controller |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql` | dir | 000, 004, 031, 061, 076, 093, 098, 101, 102, 105, 121 | — |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/admin-user.resolver.ts` | file | 109 | GraphQL resolver |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/analytics.resolver.ts` | file | 052 | GraphQL resolver |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/apollo-server.module.ts` | file | 004 | NestJS module |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/b2b-hr.resolver.ts` | file | 098 | GraphQL resolver |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/certificate.resolver.ts` | file | 048 | GraphQL resolver |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/kyc.resolver.ts` | file | 111 | GraphQL resolver |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/live-stream.resolver.ts` | file | 100 | GraphQL resolver |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/logistics.resolver.ts` | file | 077 | GraphQL resolver |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/offline-license.resolver.ts` | file | 068 | GraphQL resolver |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/payout.resolver.ts` | file | 086 | GraphQL resolver |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/reader-control.resolver.ts` | file | 041 | GraphQL resolver |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/recommendation.resolver.ts` | file | 104 | GraphQL resolver |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/sync.resolver.ts` | file | 070 | GraphQL resolver |
| apps/backend/src/api/graphql | `apps/backend/src/api/graphql/tenant.resolver.ts` | file | 072 | GraphQL resolver |
| apps/backend/src/api/graphql/auth | `apps/backend/src/api/graphql/auth` | dir | 007 | — |
| apps/backend/src/api/graphql/auth/ | `apps/backend/src/api/graphql/auth/` | dir | 006 | — |
| apps/backend/src/api/graphql/auth/auth.graphql | `apps/backend/src/api/graphql/auth/auth.graphql` | dir | 006 | GraphQL typeDefs |
| apps/backend/src/api/graphql/b2b-hr.types.graphql | `apps/backend/src/api/graphql/b2b-hr.types.graphql` | dir | 098 | GraphQL typeDefs |
| apps/backend/src/api/graphql/b2b.graphql | `apps/backend/src/api/graphql/b2b.graphql` | dir | 097 | GraphQL typeDefs |
| apps/backend/src/api/graphql/catalog.graphql | `apps/backend/src/api/graphql/catalog.graphql` | dir | 008 | GraphQL typeDefs |
| apps/backend/src/api/graphql/context | `apps/backend/src/api/graphql/context` | dir | 004 | — |
| apps/backend/src/api/graphql/context | `apps/backend/src/api/graphql/context/graphql-context.factory.ts` | file | 004 | — |
| apps/backend/src/api/graphql/dataloaders | `apps/backend/src/api/graphql/dataloaders` | dir | 128 | — |
| apps/backend/src/api/graphql/dataloaders | `apps/backend/src/api/graphql/dataloaders/entitlement.dataloader.ts` | file | 128 | — |
| apps/backend/src/api/graphql/drm | `apps/backend/src/api/graphql/drm` | dir | 049 | — |
| apps/backend/src/api/graphql/finance/ | `apps/backend/src/api/graphql/finance/` | dir | 081 | — |
| apps/backend/src/api/graphql/gamification | `apps/backend/src/api/graphql/gamification` | dir | 083 | — |
| apps/backend/src/api/graphql/identity.graphql | `apps/backend/src/api/graphql/identity.graphql` | dir | 003 | GraphQL typeDefs |
| apps/backend/src/api/graphql/kyc | `apps/backend/src/api/graphql/kyc` | dir | 085 | — |
| apps/backend/src/api/graphql/messaging | `apps/backend/src/api/graphql/messaging` | dir | 084 | — |
| apps/backend/src/api/graphql/moderation | `apps/backend/src/api/graphql/moderation` | dir | 112 | — |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers` | dir | 004, 031, 061, 101, 102, 105 | — |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/affiliate.resolver.ts` | file | 079 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/ai-companion.resolver.ts` | file | 092 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/ai-copilot.resolver.ts` | file | 094 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/analytics.resolver.ts` | file | 116 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/audit-log.resolver.ts` | file | 118 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/auth.resolver.ts` | file | 004 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/cart.resolver.ts` | file | 011 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/certificate.resolver.ts` | file | 105 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/clearinghouse.resolver.ts` | file | 114 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/course-studio.resolver.ts` | file | 078 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/dispute.resolver.ts` | file | 113 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/drm-reader.resolver.ts` | file | 061 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/ebook-reader.resolver.ts` | file | 004 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/elearning.resolver.ts` | file | 004 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/flash-sale.resolver.ts` | file | 087 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/gift.resolver.ts` | file | 089 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/group-buying.resolver.ts` | file | 090 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/inventory.resolver.ts` | file | 075 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/keep-alive.resolver.ts` | file | 031 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/library.resolver.ts` | file | 018 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/live.resolver.ts` | file | 099 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/note.resolver.ts` | file | 065 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/order-payment.resolver.ts` | file | 004 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/order.resolver.ts` | file | 012 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/payment.resolver.ts` | file | 015 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/permission.resolver.ts` | file | 106 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/prefetch.resolver.ts` | file | 029 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/preview.resolver.ts` | file | 051 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/product-builder.resolver.ts` | file | 074 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/product.resolver.ts` | file | 009 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/promotion.resolver.ts` | file | 088 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/quiz.resolver.ts` | file | 047 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/reconciliation.resolver.ts` | file | 115 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/scrubbing.resolver.ts` | file | 058 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/security.resolver.ts` | file | 120 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/share.resolver.ts` | file | 026, 080 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/social-reading.resolver.ts` | file | 095 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/storage-management.resolver.ts` | file | 123 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/stream.resolver.ts` | file | 102 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/tax.resolver.ts` | file | 082 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/theme-preference.resolver.ts` | file | 066 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/user-inspector.resolver.ts` | file | 110 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers | `apps/backend/src/api/graphql/resolvers/vector-search.resolver.ts` | file | 091 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers/b2b | `apps/backend/src/api/graphql/resolvers/b2b` | dir | 097 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers/campaign | `apps/backend/src/api/graphql/resolvers/campaign` | dir | 117 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers/live | `apps/backend/src/api/graphql/resolvers/live` | dir | 101 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers/squad | `apps/backend/src/api/graphql/resolvers/squad` | dir | 096 | GraphQL resolver |
| apps/backend/src/api/graphql/resolvers/support | `apps/backend/src/api/graphql/resolvers/support` | dir | 103 | GraphQL resolver |
| apps/backend/src/api/graphql/schema | `apps/backend/src/api/graphql/schema` | dir | 004 | — |
| apps/backend/src/api/graphql/schema | `apps/backend/src/api/graphql/schema/type-defs.ts` | file | 004 | — |
| apps/backend/src/api/graphql/schema.graphql | `apps/backend/src/api/graphql/schema.graphql` | dir | 124 | GraphQL typeDefs |
| apps/backend/src/api/graphql/schema/catalog.graphql | `apps/backend/src/api/graphql/schema/catalog.graphql` | dir | 037 | GraphQL typeDefs |
| apps/backend/src/api/graphql/schema/flash-sale.graphql | `apps/backend/src/api/graphql/schema/flash-sale.graphql` | dir | 087 | GraphQL typeDefs |
| apps/backend/src/api/graphql/schema/promotion.graphql | `apps/backend/src/api/graphql/schema/promotion.graphql` | dir | 088 | GraphQL typeDefs |
| apps/backend/src/api/graphql/schemas/note.graphql | `apps/backend/src/api/graphql/schemas/note.graphql` | dir | 065 | GraphQL typeDefs |
| apps/backend/src/api/graphql/schemas/product.graphql | `apps/backend/src/api/graphql/schemas/product.graphql` | dir | 009 | GraphQL typeDefs |
| apps/backend/src/api/graphql/stream | `apps/backend/src/api/graphql/stream/stream.resolver.ts` | file | 045 | GraphQL resolver |
| apps/backend/src/api/graphql/tenant | `apps/backend/src/api/graphql/tenant` | dir | 108 | — |
| apps/backend/src/api/graphql/tenant.graphql | `apps/backend/src/api/graphql/tenant.graphql` | dir | 072 | GraphQL typeDefs |
| apps/backend/src/api/graphql/typeDefs/course-studio.graphql | `apps/backend/src/api/graphql/typeDefs/course-studio.graphql` | dir | 078 | GraphQL typeDefs |
| apps/backend/src/api/graphql/wallet | `apps/backend/src/api/graphql/wallet` | dir | 017 | — |
| apps/backend/src/api/guards | `apps/backend/src/api/guards` | dir | 127 | — |
| apps/backend/src/api/guards/ | `apps/backend/src/api/guards/` | dir | 129 | NestJS guard |
| apps/backend/src/api/interceptors/ | `apps/backend/src/api/interceptors/` | dir | 129 | NestJS interceptor |
| apps/backend/src/api/middlewares | `apps/backend/src/api/middlewares` | dir | 127 | — |
| apps/backend/src/api/webhooks | `apps/backend/src/api/webhooks` | dir | 000, 004, 034, 077, 093, 102, 105, 121 | REST webhook |
| apps/backend/src/api/webhooks | `apps/backend/src/api/webhooks/analytics.controller.ts` | file | 052 | REST webhook |
| apps/backend/src/api/webhooks | `apps/backend/src/api/webhooks/bank-payout-callback.controller.ts` | file | 086 | REST webhook |
| apps/backend/src/api/webhooks | `apps/backend/src/api/webhooks/certificate-verify.controller.ts` | file | 048 | REST webhook |
| apps/backend/src/api/webhooks | `apps/backend/src/api/webhooks/dispute-logistics.controller.ts` | file | 113 | REST webhook |
| apps/backend/src/api/webhooks | `apps/backend/src/api/webhooks/line-messaging.controller.ts` | file | 034 | REST webhook |
| apps/backend/src/api/webhooks | `apps/backend/src/api/webhooks/live-stream-webhook.controller.ts` | file | 102 | REST webhook |
| apps/backend/src/api/webhooks | `apps/backend/src/api/webhooks/logistics-carrier.controller.ts` | file | 077 | REST webhook |
| apps/backend/src/api/webhooks | `apps/backend/src/api/webhooks/public-certificate.controller.ts` | file | 105 | REST webhook |
| apps/backend/src/api/webhooks | `apps/backend/src/api/webhooks/webhooks.module.ts` | file | 004 | REST webhook |
| apps/backend/src/api/webhooks/auth/ | `apps/backend/src/api/webhooks/auth/` | dir | 006 | REST webhook |
| apps/backend/src/api/webhooks/controllers | `apps/backend/src/api/webhooks/controllers` | dir | 004 | REST webhook |
| apps/backend/src/api/webhooks/controllers | `apps/backend/src/api/webhooks/controllers/easyslip-webhook.controller.ts` | file | 004 | REST webhook |
| apps/backend/src/api/webhooks/controllers | `apps/backend/src/api/webhooks/controllers/line-messaging-webhook.controller.ts` | file | 004 | REST webhook |
| apps/backend/src/api/webhooks/controllers | `apps/backend/src/api/webhooks/controllers/logistics-webhook.controller.ts` | file | 004 | REST webhook |
| apps/backend/src/api/webhooks/guards | `apps/backend/src/api/webhooks/guards` | dir | 004 | REST webhook |
| apps/backend/src/api/webhooks/guards | `apps/backend/src/api/webhooks/guards/hmac-signature.guard.ts` | file | 004 | REST webhook |
| apps/backend/src/api/webhooks/guards | `apps/backend/src/api/webhooks/guards/line-signature.guard.ts` | file | 004 | REST webhook |
| apps/backend/src/api/webhooks/kyc | `apps/backend/src/api/webhooks/kyc` | dir | 111 | REST webhook |
| apps/backend/src/api/webhooks/line-support | `apps/backend/src/api/webhooks/line-support` | dir | 103 | REST webhook |
| apps/backend/src/api/webhooks/moderation | `apps/backend/src/api/webhooks/moderation` | dir | 112 | REST webhook |
| apps/backend/src/application | `apps/backend/src/application` | dir | 106 | — |
| apps/backend/src/application/commands | `apps/backend/src/application/commands` | dir | 106 | — |
| apps/backend/src/application/commands | `apps/backend/src/application/commands/revoke-jwt-scope.command.ts` | file | 106 | — |
| apps/backend/src/application/commands | `apps/backend/src/application/commands/update-role-matrix.command.ts` | file | 106 | — |
| apps/backend/src/application/queries | `apps/backend/src/application/queries` | dir | 106 | — |
| apps/backend/src/application/queries | `apps/backend/src/application/queries/evaluate-permission.query.ts` | file | 106 | — |
| apps/backend/src/application/queries | `apps/backend/src/application/queries/get-role-matrix.query.ts` | file | 106 | — |
| apps/backend/src/application/services | `apps/backend/src/application/services` | dir | 106 | — |
| apps/backend/src/application/services | `apps/backend/src/application/services/bitwise-evaluator.service.ts` | file | 106 | NestJS service |
| apps/backend/src/application/services | `apps/backend/src/application/services/scope-matcher.service.ts` | file | 106 | NestJS service |
| apps/backend/src/backend | `apps/backend/src/backend` | dir | 000, 031, 034, 060, 061, 093, 098, 101, 102, 105, 108, 121, 124, 127 | — |
| apps/backend/src/common | `apps/backend/src/common` | dir | 001, 121 | — |
| apps/backend/src/common/crypto | `apps/backend/src/common/crypto/field-encryption.service.ts` | file | 107 | NestJS service |
| apps/backend/src/common/filters | `apps/backend/src/common/filters` | dir | 001, 121 | — |
| apps/backend/src/common/filters | `apps/backend/src/common/filters/http-exception.filter.ts` | file | 001 | — |
| apps/backend/src/common/filters | `apps/backend/src/common/filters/sentry-exception.filter.ts` | file | 121 | — |
| apps/backend/src/common/guards | `apps/backend/src/common/guards/tenant.guard.ts` | file | 071 | NestJS guard |
| apps/backend/src/common/interceptors | `apps/backend/src/common/interceptors` | dir | 001, 121 | — |
| apps/backend/src/common/interceptors | `apps/backend/src/common/interceptors/logging.interceptor.ts` | file | 121 | NestJS interceptor |
| apps/backend/src/common/interceptors | `apps/backend/src/common/interceptors/pii-masking.interceptor.ts` | file | 107 | NestJS interceptor |
| apps/backend/src/common/interceptors | `apps/backend/src/common/interceptors/telemetry.interceptor.ts` | file | 121 | NestJS interceptor |
| apps/backend/src/common/interceptors | `apps/backend/src/common/interceptors/tenant-header.interceptor.ts` | file | 071 | NestJS interceptor |
| apps/backend/src/common/interceptors | `apps/backend/src/common/interceptors/transform.interceptor.ts` | file | 001 | NestJS interceptor |
| apps/backend/src/config | `apps/backend/src/config` | dir | 001 | — |
| apps/backend/src/config | `apps/backend/src/config/configuration.ts` | file | 001 | — |
| apps/backend/src/docs | `apps/backend/src/docs` | dir | 000 | — |
| apps/backend/src/docs | `apps/backend/src/docs/phase-roadmap-130.md` | file | 000 | — |
| apps/backend/src/domain | `apps/backend/src/domain` | dir | 106 | — |
| apps/backend/src/domain/entities | `apps/backend/src/domain/entities` | dir | 106 | — |
| apps/backend/src/domain/entities | `apps/backend/src/domain/entities/jwt-scope-pattern.vo.ts` | file | 106 | DDD entity |
| apps/backend/src/domain/entities | `apps/backend/src/domain/entities/permission-bitmask.vo.ts` | file | 106 | DDD entity |
| apps/backend/src/domain/exceptions | `apps/backend/src/domain/exceptions` | dir | 106 | — |
| apps/backend/src/domain/exceptions | `apps/backend/src/domain/exceptions/invalid-bitmask.exception.ts` | file | 106 | — |
| apps/backend/src/domain/exceptions | `apps/backend/src/domain/exceptions/scope-access-denied.exception.ts` | file | 106 | — |
| apps/backend/src/edge/cloudflare-workers | `apps/backend/src/edge/cloudflare-workers/hls-auth-gatekeeper.ts` | file | 053 | — |
| apps/backend/src/frontend | `apps/backend/src/frontend` | dir | 000 | — |
| apps/backend/src/gateways | `apps/backend/src/gateways` | dir | 101 | — |
| apps/backend/src/gateways/live-socket | `apps/backend/src/gateways/live-socket` | dir | 101 | — |
| apps/backend/src/gateways/live-socket | `apps/backend/src/gateways/live-socket/live-socket.gateway.ts` | file | 101 | — |
| apps/backend/src/gateways/live-socket/adapters | `apps/backend/src/gateways/live-socket/adapters` | dir | 101 | — |
| apps/backend/src/gateways/live-socket/guards | `apps/backend/src/gateways/live-socket/guards` | dir | 101 | — |
| apps/backend/src/guards | `apps/backend/src/guards/jwt-auth.guard.ts` | file | 005 | NestJS guard |
| apps/backend/src/infra | `apps/backend/src/infra` | dir | 000, 031, 061, 093, 098, 101, 121, 124, 125 | — |
| apps/backend/src/infra/apollo | `apps/backend/src/infra/apollo/apollo-server.module.ts` | file | 004 | NestJS module |
| apps/backend/src/infra/cloudflare | `apps/backend/src/infra/cloudflare` | dir | 000, 061, 093, 126, 130 | — |
| apps/backend/src/infra/cloudflare | `apps/backend/src/infra/cloudflare/r2-client.ts` | file | 038, 043, 102, 123 | — |
| apps/backend/src/infra/cloudflare | `apps/backend/src/infra/cloudflare/r2-cors-policy.json` | file | 028 | — |
| apps/backend/src/infra/cloudflare | `apps/backend/src/infra/cloudflare/r2-storage.module.ts` | file | 036 | NestJS module |
| apps/backend/src/infra/cloudflare | `apps/backend/src/infra/cloudflare/r2-storage.service.ts` | file | 036 | NestJS service |
| apps/backend/src/infra/cloudflare | `apps/backend/src/infra/cloudflare/r2-uploader.service.ts` | file | 044 | NestJS service |
| apps/backend/src/infra/cloudflare | `apps/backend/src/infra/cloudflare/r2-vault.client.ts` | file | 061 | — |
| apps/backend/src/infra/cloudflare | `apps/backend/src/infra/cloudflare/r2-worm-vault.service.ts` | file | 118 | NestJS service |
| apps/backend/src/infra/cloudflare/r2-storage.service | `apps/backend/src/infra/cloudflare/r2-storage.service` | dir | 036 | — |
| apps/backend/src/infra/cloudflare/r2.service | `apps/backend/src/infra/cloudflare/r2.service` | dir | 048, 060 | — |
| apps/backend/src/infra/connection-pool | `apps/backend/src/infra/connection-pool` | dir | 125 | — |
| apps/backend/src/infra/connection-pool | `apps/backend/src/infra/connection-pool/database-replica.service.ts` | file | 125 | NestJS service |
| apps/backend/src/infra/connection-pool | `apps/backend/src/infra/connection-pool/edge-redis-cluster.service.ts` | file | 125 | NestJS service |
| apps/backend/src/infra/connection-pool | `apps/backend/src/infra/connection-pool/infra-health.controller.ts` | file | 125 | REST controller |
| apps/backend/src/infra/connection-pool | `apps/backend/src/infra/connection-pool/read-write-interceptor.ts` | file | 125 | — |
| apps/backend/src/infra/database | `apps/backend/src/infra/database/prisma.service.ts` | file | 002 | NestJS service |
| apps/backend/src/infra/database | `apps/backend/src/infra/database/replica-router.ts` | file | 125 | — |
| apps/backend/src/infra/database/prisma/schema.prisma | `apps/backend/src/infra/database/prisma/schema.prisma` | dir | 125 | — |
| apps/backend/src/infra/docker | `apps/backend/src/infra/docker/docker-compose.prod.yml` | file | 130 | — |
| apps/backend/src/infra/edge | `apps/backend/src/infra/edge` | dir | 125 | — |
| apps/backend/src/infra/edge | `apps/backend/src/infra/edge/cloudflare-balancer.ts` | file | 125 | — |
| apps/backend/src/infra/edge | `apps/backend/src/infra/edge/load-balancer.ts` | file | 125 | — |
| apps/backend/src/infra/health | `apps/backend/src/infra/health` | dir | 125 | — |
| apps/backend/src/infra/ivs | `apps/backend/src/infra/ivs` | dir | 101 | — |
| apps/backend/src/infra/k8s | `apps/backend/src/infra/k8s` | dir | 130 | — |
| apps/backend/src/infra/logger | `apps/backend/src/infra/logger` | dir | 121 | — |
| apps/backend/src/infra/logger | `apps/backend/src/infra/logger/pino-logger.service.ts` | file | 121 | NestJS service |
| apps/backend/src/infra/logger | `apps/backend/src/infra/logger/redact-pii.utility.ts` | file | 121 | — |
| apps/backend/src/infra/observability | `apps/backend/src/infra/observability` | dir | 121 | — |
| apps/backend/src/infra/observability | `apps/backend/src/infra/observability/metrics.service.ts` | file | 121 | NestJS service |
| apps/backend/src/infra/observability | `apps/backend/src/infra/observability/open-telemetry.sdk.ts` | file | 121 | — |
| apps/backend/src/infra/observability | `apps/backend/src/infra/observability/trace-context.holder.ts` | file | 121 | — |
| apps/backend/src/infra/pdf | `apps/backend/src/infra/pdf` | dir | 098 | — |
| apps/backend/src/infra/pdf | `apps/backend/src/infra/pdf/hr-report-generator.service.ts` | file | 098 | NestJS service |
| apps/backend/src/infra/postgres | `apps/backend/src/infra/postgres/init-extensions.sql` | file | 002 | — |
| apps/backend/src/infra/postgres | `apps/backend/src/infra/postgres/postgresql.conf` | file | 002 | — |
| apps/backend/src/infra/prisma | `apps/backend/src/infra/prisma` | dir | 000, 031, 093, 124, 126 | — |
| apps/backend/src/infra/prisma | `apps/backend/src/infra/prisma/client.ts` | file | 012 | — |
| apps/backend/src/infra/prisma | `apps/backend/src/infra/prisma/prisma-query-logger.middleware.ts` | file | 128 | Next.js Edge middleware |
| apps/backend/src/infra/prisma | `apps/backend/src/infra/prisma/prisma-retry.extension.ts` | file | 124 | — |
| apps/backend/src/infra/prisma | `apps/backend/src/infra/prisma/prisma.service.ts` | file | 128 | NestJS service |
| apps/backend/src/infra/prisma/prisma.service | `apps/backend/src/infra/prisma/prisma.service` | dir | 003, 004, 005, 006, 007, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 021, 022, 023, 024, 025, 026, 028, 029, 030, 033, 034, 036, 037, 038, 040, 041, 044, 045, 046, 047, 048, 051, 053, 054, 055, 056, 058, 063, 064, 065, 066, 067, 070, 072, 074, 075, 076, 077, 078, 079, 081, 083, 084, 085, 086, 087, 088, 090, 091, 097, 099, 100, 101, 104, 105, 108, 109, 110, 112, 113, 114, 115, 116, 117, 119, 120, 123, 124, 128 | — |
| apps/backend/src/infra/prisma/schema.prisma | `apps/backend/src/infra/prisma/schema.prisma` | dir | 031 | — |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis` | dir | 000, 031, 061, 093, 098, 101, 124, 126 | — |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/b2b-analytics-cache.service.ts` | file | 098 | NestJS service |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/cache-query.service.ts` | file | 128 | NestJS service |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/edge-cache.service.ts` | file | 061 | NestJS service |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/edge-cluster.ts` | file | 125 | — |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/generate-cluster-config.sh` | file | 002 | — |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/keep-alive-redis.repository.ts` | file | 031 | — |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/progress-buffer.service.ts` | file | 046 | NestJS service |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/redis-cluster.config.ts` | file | 039 | — |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/redis-cluster.service.ts` | file | 002 | NestJS service |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/redis-cluster.tmpl` | file | 002 | — |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/redis-lock.service.ts` | file | 015 | NestJS service |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/redis-pubsub.adapter.ts` | file | 057 | — |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/redis.service.ts` | file | 050 | NestJS service |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/resilient-redis.client.ts` | file | 124 | — |
| apps/backend/src/infra/redis | `apps/backend/src/infra/redis/vector-cache.ts` | file | 038 | — |
| apps/backend/src/infra/redis/redis-lock.service | `apps/backend/src/infra/redis/redis-lock.service` | dir | 015 | — |
| apps/backend/src/infra/redis/redis.service | `apps/backend/src/infra/redis/redis.service` | dir | 004, 005, 006, 007, 009, 010, 012, 013, 014, 016, 017, 018, 020, 023, 025, 028, 029, 030, 032, 033, 040, 041, 045, 046, 047, 050, 051, 052, 053, 054, 055, 056, 057, 058, 060, 065, 066, 067, 070, 071, 072, 074, 075, 078, 079, 081, 083, 087, 088, 090, 096, 097, 100, 101, 104, 106, 108, 109, 110, 115, 116, 117, 119, 123 | — |
| apps/backend/src/infra/resilience | `apps/backend/src/infra/resilience` | dir | 124 | — |
| apps/backend/src/infra/scripts | `apps/backend/src/infra/scripts/backup-r2-vault.sh` | file | 127 | — |
| apps/backend/src/infra/scripts | `apps/backend/src/infra/scripts/dr-failover.sh` | file | 127 | — |
| apps/backend/src/infra/security | `apps/backend/src/infra/security` | dir | 028 | — |
| apps/backend/src/infra/security | `apps/backend/src/infra/security/cloudflare-cors.config.ts` | file | 028 | — |
| apps/backend/src/infra/security | `apps/backend/src/infra/security/cors-whitelist.guard.ts` | file | 028 | NestJS guard |
| apps/backend/src/infra/security | `apps/backend/src/infra/security/csp-report.controller.ts` | file | 028 | REST controller |
| apps/backend/src/infra/security | `apps/backend/src/infra/security/csp.middleware.ts` | file | 028 | Next.js Edge middleware |
| apps/backend/src/infra/sentry | `apps/backend/src/infra/sentry` | dir | 121 | — |
| apps/backend/src/infra/sentry | `apps/backend/src/infra/sentry/sentry.module.ts` | file | 121 | NestJS module |
| apps/backend/src/infra/sentry | `apps/backend/src/infra/sentry/sentry.service.ts` | file | 121 | NestJS service |
| apps/backend/src/infra/test | `apps/backend/src/infra/test/chaos-failover.spec.ts` | file | 125 | — |
| apps/backend/src/infrastructure | `apps/backend/src/infrastructure` | dir | 106 | — |
| apps/backend/src/infrastructure/adapters | `apps/backend/src/infrastructure/adapters` | dir | 106 | — |
| apps/backend/src/infrastructure/adapters | `apps/backend/src/infrastructure/adapters/redis-token-blacklist.adapter.ts` | file | 106 | — |
| apps/backend/src/infrastructure/external/clients | `apps/backend/src/infrastructure/external/clients` | dir | 122 | — |
| apps/backend/src/infrastructure/persistence | `apps/backend/src/infrastructure/persistence` | dir | 106 | — |
| apps/backend/src/infrastructure/persistence | `apps/backend/src/infrastructure/persistence/prisma-security-role.repository.ts` | file | 106 | — |
| apps/backend/src/jobs/book-processor | `apps/backend/src/jobs/book-processor` | dir | 038 | — |
| apps/backend/src/jobs/processors | `apps/backend/src/jobs/processors/message-dispatcher.processor.ts` | file | 024 | — |
| apps/backend/src/jobs/queues | `apps/backend/src/jobs/queues/abandoned-cart.processor.ts` | file | 084 | — |
| apps/backend/src/jobs/transcoder | `apps/backend/src/jobs/transcoder` | dir | 043 | — |
| apps/backend/src/middleware | `apps/backend/src/middleware/auth-context.middleware.ts` | file | 005 | Next.js Edge middleware |
| apps/backend/src/modules | `apps/backend/src/modules` | dir | 000, 001, 015, 031, 034, 060, 061, 081, 091, 093, 096, 098, 101, 102, 103, 105, 108, 113, 124, 127, 129 | — |
| apps/backend/src/modules/adaptive-testing | `apps/backend/src/modules/adaptive-testing` | dir | 093 | — |
| apps/backend/src/modules/admin/audit | `apps/backend/src/modules/admin/audit` | dir | 109 | — |
| apps/backend/src/modules/admin/kyc | `apps/backend/src/modules/admin/kyc` | dir | 109 | — |
| apps/backend/src/modules/admin/user-management | `apps/backend/src/modules/admin/user-management` | dir | 109 | — |
| apps/backend/src/modules/admin/user-management | `apps/backend/src/modules/admin/user-management/admin-user.module.ts` | file | 109 | NestJS module |
| apps/backend/src/modules/admin/user-management/controllers | `apps/backend/src/modules/admin/user-management/controllers` | dir | 109 | — |
| apps/backend/src/modules/admin/user-management/controllers | `apps/backend/src/modules/admin/user-management/controllers/admin-user-rest.controller.ts` | file | 109 | REST controller |
| apps/backend/src/modules/admin/user-management/dto | `apps/backend/src/modules/admin/user-management/dto` | dir | 109 | — |
| apps/backend/src/modules/admin/user-management/dto | `apps/backend/src/modules/admin/user-management/dto/admin-user-action.dto.ts` | file | 109 | DTO |
| apps/backend/src/modules/admin/user-management/dto | `apps/backend/src/modules/admin/user-management/dto/admin-user-filter.dto.ts` | file | 109 | DTO |
| apps/backend/src/modules/admin/user-management/guards | `apps/backend/src/modules/admin/user-management/guards` | dir | 109 | — |
| apps/backend/src/modules/admin/user-management/guards | `apps/backend/src/modules/admin/user-management/guards/admin-rbac.guard.ts` | file | 109 | NestJS guard |
| apps/backend/src/modules/admin/user-management/repositories | `apps/backend/src/modules/admin/user-management/repositories` | dir | 109 | — |
| apps/backend/src/modules/admin/user-management/repositories | `apps/backend/src/modules/admin/user-management/repositories/admin-user-prisma.repository.ts` | file | 109 | — |
| apps/backend/src/modules/admin/user-management/resolvers | `apps/backend/src/modules/admin/user-management/resolvers` | dir | 109 | — |
| apps/backend/src/modules/admin/user-management/resolvers | `apps/backend/src/modules/admin/user-management/resolvers/admin-user.resolver.ts` | file | 109 | GraphQL resolver |
| apps/backend/src/modules/admin/user-management/services | `apps/backend/src/modules/admin/user-management/services` | dir | 109 | — |
| apps/backend/src/modules/admin/user-management/services | `apps/backend/src/modules/admin/user-management/services/admin-kyc-processor.service.ts` | file | 109 | NestJS service |
| apps/backend/src/modules/admin/user-management/services | `apps/backend/src/modules/admin/user-management/services/admin-user-command.service.ts` | file | 109 | NestJS service |
| apps/backend/src/modules/admin/user-management/services | `apps/backend/src/modules/admin/user-management/services/admin-user-query.service.ts` | file | 109 | NestJS service |
| apps/backend/src/modules/affiliate | `apps/backend/src/modules/affiliate` | dir | 000, 025, 079, 080, 082, 093 | — |
| apps/backend/src/modules/affiliate | `apps/backend/src/modules/affiliate/affiliate.module.ts` | file | 079 | NestJS module |
| apps/backend/src/modules/affiliate/controllers | `apps/backend/src/modules/affiliate/controllers` | dir | 079 | — |
| apps/backend/src/modules/affiliate/controllers | `apps/backend/src/modules/affiliate/controllers/affiliate.controller.ts` | file | 079 | REST controller |
| apps/backend/src/modules/affiliate/dto | `apps/backend/src/modules/affiliate/dto` | dir | 079 | — |
| apps/backend/src/modules/affiliate/dto | `apps/backend/src/modules/affiliate/dto/create-referral-link.dto.ts` | file | 079 | DTO |
| apps/backend/src/modules/affiliate/dto | `apps/backend/src/modules/affiliate/dto/request-payout.dto.ts` | file | 079 | DTO |
| apps/backend/src/modules/affiliate/resolvers | `apps/backend/src/modules/affiliate/resolvers` | dir | 079 | — |
| apps/backend/src/modules/affiliate/resolvers | `apps/backend/src/modules/affiliate/resolvers/affiliate.resolver.ts` | file | 079 | GraphQL resolver |
| apps/backend/src/modules/affiliate/services | `apps/backend/src/modules/affiliate/services` | dir | 079 | — |
| apps/backend/src/modules/affiliate/services | `apps/backend/src/modules/affiliate/services/affiliate-tree.service.ts` | file | 079 | NestJS service |
| apps/backend/src/modules/affiliate/services | `apps/backend/src/modules/affiliate/services/anti-fraud.service.ts` | file | 079 | NestJS service |
| apps/backend/src/modules/affiliate/services | `apps/backend/src/modules/affiliate/services/commission-engine.service.ts` | file | 079 | NestJS service |
| apps/backend/src/modules/affiliate/services | `apps/backend/src/modules/affiliate/services/flex-message-builder.service.ts` | file | 079 | NestJS service |
| apps/backend/src/modules/affiliate/services | `apps/backend/src/modules/affiliate/services/payout.service.ts` | file | 079 | NestJS service |
| apps/backend/src/modules/affiliate/services | `apps/backend/src/modules/affiliate/services/share-attribution.service.ts` | file | 026 | NestJS service |
| apps/backend/src/modules/ai-bot | `apps/backend/src/modules/ai-bot` | dir | 103 | — |
| apps/backend/src/modules/ai-bot | `apps/backend/src/modules/ai-bot/ai-bot.module.ts` | file | 103 | NestJS module |
| apps/backend/src/modules/ai-bot/application | `apps/backend/src/modules/ai-bot/application` | dir | 103 | — |
| apps/backend/src/modules/ai-bot/application | `apps/backend/src/modules/ai-bot/application/rag-search.service.ts` | file | 103 | NestJS service |
| apps/backend/src/modules/ai-bot/application | `apps/backend/src/modules/ai-bot/application/sentiment-analyzer.service.ts` | file | 103 | NestJS service |
| apps/backend/src/modules/ai-bot/infrastructure | `apps/backend/src/modules/ai-bot/infrastructure` | dir | 103 | — |
| apps/backend/src/modules/ai-bot/infrastructure/llm | `apps/backend/src/modules/ai-bot/infrastructure/llm` | dir | 103 | — |
| apps/backend/src/modules/ai-bot/infrastructure/vector-store | `apps/backend/src/modules/ai-bot/infrastructure/vector-store` | dir | 103 | — |
| apps/backend/src/modules/ai-companion | `apps/backend/src/modules/ai-companion` | dir | 092 | — |
| apps/backend/src/modules/ai-companion | `apps/backend/src/modules/ai-companion/ai-companion.module.ts` | file | 092 | NestJS module |
| apps/backend/src/modules/ai-companion/controllers | `apps/backend/src/modules/ai-companion/controllers` | dir | 092 | — |
| apps/backend/src/modules/ai-companion/controllers | `apps/backend/src/modules/ai-companion/controllers/ai-chat.controller.ts` | file | 092 | REST controller |
| apps/backend/src/modules/ai-companion/controllers | `apps/backend/src/modules/ai-companion/controllers/ai-quiz.controller.ts` | file | 092 | REST controller |
| apps/backend/src/modules/ai-companion/dto | `apps/backend/src/modules/ai-companion/dto` | dir | 092 | — |
| apps/backend/src/modules/ai-companion/dto | `apps/backend/src/modules/ai-companion/dto/ai-companion.dto.ts` | file | 092 | DTO |
| apps/backend/src/modules/ai-companion/guardrails | `apps/backend/src/modules/ai-companion/guardrails` | dir | 092 | — |
| apps/backend/src/modules/ai-companion/guardrails | `apps/backend/src/modules/ai-companion/guardrails/drm-protection.guardrail.ts` | file | 092 | — |
| apps/backend/src/modules/ai-companion/guardrails | `apps/backend/src/modules/ai-companion/guardrails/prompt-injection.guardrail.ts` | file | 092 | — |
| apps/backend/src/modules/ai-companion/resolvers | `apps/backend/src/modules/ai-companion/resolvers` | dir | 092 | — |
| apps/backend/src/modules/ai-companion/resolvers | `apps/backend/src/modules/ai-companion/resolvers/ai-companion.resolver.ts` | file | 092 | GraphQL resolver |
| apps/backend/src/modules/ai-companion/services | `apps/backend/src/modules/ai-companion/services` | dir | 092 | — |
| apps/backend/src/modules/ai-companion/services | `apps/backend/src/modules/ai-companion/services/adaptive-quiz.service.ts` | file | 092 | NestJS service |
| apps/backend/src/modules/ai-companion/services | `apps/backend/src/modules/ai-companion/services/llm-orchestrator.service.ts` | file | 092 | NestJS service |
| apps/backend/src/modules/ai-companion/services | `apps/backend/src/modules/ai-companion/services/rag-retrieval.service.ts` | file | 092 | NestJS service |
| apps/backend/src/modules/ai-companion/services | `apps/backend/src/modules/ai-companion/services/summarizer.service.ts` | file | 092 | NestJS service |
| apps/backend/src/modules/ai-copilot | `apps/backend/src/modules/ai-copilot` | dir | 094 | — |
| apps/backend/src/modules/ai-copilot | `apps/backend/src/modules/ai-copilot/ai-copilot.module.ts` | file | 094 | NestJS module |
| apps/backend/src/modules/ai-copilot/adapters | `apps/backend/src/modules/ai-copilot/adapters` | dir | 094 | — |
| apps/backend/src/modules/ai-copilot/adapters | `apps/backend/src/modules/ai-copilot/adapters/llm-orchestrator.adapter.ts` | file | 094 | — |
| apps/backend/src/modules/ai-copilot/adapters | `apps/backend/src/modules/ai-copilot/adapters/openai-whisper.adapter.ts` | file | 094 | — |
| apps/backend/src/modules/ai-copilot/controllers | `apps/backend/src/modules/ai-copilot/controllers` | dir | 094 | — |
| apps/backend/src/modules/ai-copilot/controllers | `apps/backend/src/modules/ai-copilot/controllers/ai-copilot.controller.ts` | file | 094 | REST controller |
| apps/backend/src/modules/ai-copilot/controllers | `apps/backend/src/modules/ai-copilot/controllers/subtitle-download.controller.ts` | file | 094 | REST controller |
| apps/backend/src/modules/ai-copilot/queues | `apps/backend/src/modules/ai-copilot/queues` | dir | 094 | — |
| apps/backend/src/modules/ai-copilot/queues | `apps/backend/src/modules/ai-copilot/queues/transcribe.processor.ts` | file | 094 | — |
| apps/backend/src/modules/ai-copilot/queues | `apps/backend/src/modules/ai-copilot/queues/transcribe.queue.ts` | file | 094 | — |
| apps/backend/src/modules/ai-copilot/resolvers | `apps/backend/src/modules/ai-copilot/resolvers` | dir | 094 | — |
| apps/backend/src/modules/ai-copilot/resolvers | `apps/backend/src/modules/ai-copilot/resolvers/ai-copilot.resolver.ts` | file | 094 | GraphQL resolver |
| apps/backend/src/modules/ai-copilot/services | `apps/backend/src/modules/ai-copilot/services` | dir | 094 | — |
| apps/backend/src/modules/ai-copilot/services | `apps/backend/src/modules/ai-copilot/services/auto-quiz-builder.service.ts` | file | 094 | NestJS service |
| apps/backend/src/modules/ai-copilot/services | `apps/backend/src/modules/ai-copilot/services/outline-generator.service.ts` | file | 094 | NestJS service |
| apps/backend/src/modules/ai-copilot/services | `apps/backend/src/modules/ai-copilot/services/subtitle-formatter.service.ts` | file | 094 | NestJS service |
| apps/backend/src/modules/ai-copilot/services | `apps/backend/src/modules/ai-copilot/services/whisper-transcriber.service.ts` | file | 094 | NestJS service |
| apps/backend/src/modules/ai-engine | `apps/backend/src/modules/ai-engine` | dir | 112 | — |
| apps/backend/src/modules/ai-rag | `apps/backend/src/modules/ai-rag` | dir | 091 | — |
| apps/backend/src/modules/ai-rag | `apps/backend/src/modules/ai-rag/ai-rag.module.ts` | file | 091 | NestJS module |
| apps/backend/src/modules/ai-rag/services | `apps/backend/src/modules/ai-rag/services` | dir | 091 | — |
| apps/backend/src/modules/ai-rag/services | `apps/backend/src/modules/ai-rag/services/ai-summarizer.service.ts` | file | 091 | NestJS service |
| apps/backend/src/modules/ai-rag/services | `apps/backend/src/modules/ai-rag/services/rag-context-builder.service.ts` | file | 091 | NestJS service |
| apps/backend/src/modules/analytics | `apps/backend/src/modules/analytics` | dir | 052, 073, 098, 104, 110, 116 | — |
| apps/backend/src/modules/analytics | `apps/backend/src/modules/analytics/analytics.module.ts` | file | 052 | NestJS module |
| apps/backend/src/modules/analytics | `apps/backend/src/modules/analytics/analytics.spec.ts` | file | 052 | — |
| apps/backend/src/modules/analytics/controllers | `apps/backend/src/modules/analytics/controllers` | dir | 052 | — |
| apps/backend/src/modules/analytics/controllers | `apps/backend/src/modules/analytics/controllers/analytics-ingestion.controller.ts` | file | 052 | REST controller |
| apps/backend/src/modules/analytics/dto | `apps/backend/src/modules/analytics/dto` | dir | 052 | — |
| apps/backend/src/modules/analytics/dto | `apps/backend/src/modules/analytics/dto/analytics-payload.dto.ts` | file | 052 | DTO |
| apps/backend/src/modules/analytics/dto/(1 | `apps/backend/src/modules/analytics/dto/(1` | dir | 052 | DTO |
| apps/backend/src/modules/analytics/dto/(2 | `apps/backend/src/modules/analytics/dto/(2` | dir | 052 | DTO |
| apps/backend/src/modules/analytics/dto/(3 | `apps/backend/src/modules/analytics/dto/(3` | dir | 052 | DTO |
| apps/backend/src/modules/analytics/dto/(4 | `apps/backend/src/modules/analytics/dto/(4` | dir | 052 | DTO |
| apps/backend/src/modules/analytics/events | `apps/backend/src/modules/analytics/events/environment-metrics.event.ts` | file | 022 | — |
| apps/backend/src/modules/analytics/processors | `apps/backend/src/modules/analytics/processors` | dir | 052 | — |
| apps/backend/src/modules/analytics/processors | `apps/backend/src/modules/analytics/processors/analytics-queue.processor.ts` | file | 052 | — |
| apps/backend/src/modules/analytics/resolvers | `apps/backend/src/modules/analytics/resolvers` | dir | 052 | — |
| apps/backend/src/modules/analytics/resolvers | `apps/backend/src/modules/analytics/resolvers/analytics.resolver.ts` | file | 052 | GraphQL resolver |
| apps/backend/src/modules/analytics/services | `apps/backend/src/modules/analytics/services` | dir | 052 | — |
| apps/backend/src/modules/analytics/services | `apps/backend/src/modules/analytics/services/analytics-aggregation.service.ts` | file | 052 | NestJS service |
| apps/backend/src/modules/analytics/services | `apps/backend/src/modules/analytics/services/analytics-stream.service.ts` | file | 052 | NestJS service |
| apps/backend/src/modules/analytics/services | `apps/backend/src/modules/analytics/services/heatmap-processor.service.ts` | file | 052 | NestJS service |
| apps/backend/src/modules/audit-log | `apps/backend/src/modules/audit-log` | dir | 118 | — |
| apps/backend/src/modules/audit-log/application | `apps/backend/src/modules/audit-log/application` | dir | 118 | — |
| apps/backend/src/modules/audit-log/application | `apps/backend/src/modules/audit-log/application/audit-interceptor.ts` | file | 118 | — |
| apps/backend/src/modules/audit-log/application | `apps/backend/src/modules/audit-log/application/audit-log.service.ts` | file | 118 | NestJS service |
| apps/backend/src/modules/audit-log/application | `apps/backend/src/modules/audit-log/application/integrity-checker.cron.ts` | file | 118 | — |
| apps/backend/src/modules/audit-log/domain | `apps/backend/src/modules/audit-log/domain` | dir | 118 | — |
| apps/backend/src/modules/audit-log/domain | `apps/backend/src/modules/audit-log/domain/audit-log.entity.ts` | file | 118 | DDD entity |
| apps/backend/src/modules/audit-log/domain | `apps/backend/src/modules/audit-log/domain/crypto-signer.engine.ts` | file | 118 | — |
| apps/backend/src/modules/audit-log/domain | `apps/backend/src/modules/audit-log/domain/hash-chain.engine.ts` | file | 118 | — |
| apps/backend/src/modules/audit-log/infrastructure | `apps/backend/src/modules/audit-log/infrastructure` | dir | 118 | — |
| apps/backend/src/modules/audit-log/infrastructure | `apps/backend/src/modules/audit-log/infrastructure/audit-log.repository.ts` | file | 118 | — |
| apps/backend/src/modules/audit-log/infrastructure | `apps/backend/src/modules/audit-log/infrastructure/r2-worm-vault.adapter.ts` | file | 118 | — |
| apps/backend/src/modules/audit-log/presentation | `apps/backend/src/modules/audit-log/presentation` | dir | 118 | — |
| apps/backend/src/modules/audit-log/presentation | `apps/backend/src/modules/audit-log/presentation/audit-log.controller.ts` | file | 118 | REST controller |
| apps/backend/src/modules/audit-log/presentation | `apps/backend/src/modules/audit-log/presentation/audit-log.resolver.ts` | file | 118 | GraphQL resolver |
| apps/backend/src/modules/auth | `apps/backend/src/modules/auth` | dir | 000, 005, 006, 025, 034, 049, 080, 085, 089, 093, 108, 110, 111, 119 | — |
| apps/backend/src/modules/auth | `apps/backend/src/modules/auth/auth.module.ts` | file | 005, 006 | NestJS module |
| apps/backend/src/modules/auth | `apps/backend/src/modules/auth/auth.service.spec.ts` | file | 006 | — |
| apps/backend/src/modules/auth | `apps/backend/src/modules/auth/auth.service.ts` | file | 120 | NestJS service |
| apps/backend/src/modules/auth | `apps/backend/src/modules/auth/jwt-session.strategy.ts` | file | 036 | — |
| apps/backend/src/modules/auth | `apps/backend/src/modules/auth/liff-auth.controller.ts` | file | 021 | REST controller |
| apps/backend/src/modules/auth | `apps/backend/src/modules/auth/liff-auth.service.ts` | file | 021 | NestJS service |
| apps/backend/src/modules/auth | `apps/backend/src/modules/auth/line-auth.service.ts` | file | 034 | NestJS service |
| apps/backend/src/modules/auth | `apps/backend/src/modules/auth/line-liff-auth.service.ts` | file | 100 | NestJS service |
| apps/backend/src/modules/auth | `apps/backend/src/modules/auth/line-miniapp-verifier.service.ts` | file | 035 | NestJS service |
| apps/backend/src/modules/auth | `apps/backend/src/modules/auth/session-handshake.service.ts` | file | 070 | NestJS service |
| apps/backend/src/modules/auth/ | `apps/backend/src/modules/auth/` | dir | 006, 018 | — |
| apps/backend/src/modules/auth/adapters | `apps/backend/src/modules/auth/adapters` | dir | 005 | — |
| apps/backend/src/modules/auth/adapters | `apps/backend/src/modules/auth/adapters/google-oauth.adapter.ts` | file | 005 | — |
| apps/backend/src/modules/auth/adapters | `apps/backend/src/modules/auth/adapters/line-oauth.adapter.ts` | file | 005 | — |
| apps/backend/src/modules/auth/controllers | `apps/backend/src/modules/auth/controllers` | dir | 005, 006 | — |
| apps/backend/src/modules/auth/controllers | `apps/backend/src/modules/auth/controllers/auth-webhook.controller.ts` | file | 005, 006 | REST webhook |
| apps/backend/src/modules/auth/dto | `apps/backend/src/modules/auth/dto` | dir | 006 | — |
| apps/backend/src/modules/auth/dto | `apps/backend/src/modules/auth/dto/liff-auth.dto.ts` | file | 006 | DTO |
| apps/backend/src/modules/auth/gateways | `apps/backend/src/modules/auth/gateways/qr-auth.gateway.ts` | file | 007 | — |
| apps/backend/src/modules/auth/guards | `apps/backend/src/modules/auth/guards` | dir | 004, 005, 006 | — |
| apps/backend/src/modules/auth/guards | `apps/backend/src/modules/auth/guards/audit-context.guard.ts` | file | 118 | NestJS guard |
| apps/backend/src/modules/auth/guards | `apps/backend/src/modules/auth/guards/bitwise-permission.guard.ts` | file | 106 | NestJS guard |
| apps/backend/src/modules/auth/guards | `apps/backend/src/modules/auth/guards/jwt-auth.guard` | file | 046 | NestJS guard |
| apps/backend/src/modules/auth/guards | `apps/backend/src/modules/auth/guards/jwt-auth.guard.ts` | file | 005, 006 | NestJS guard |
| apps/backend/src/modules/auth/guards | `apps/backend/src/modules/auth/guards/jwt-scope.guard.ts` | file | 106 | NestJS guard |
| apps/backend/src/modules/auth/guards | `apps/backend/src/modules/auth/guards/line-liff.guard.ts` | file | 006 | NestJS guard |
| apps/backend/src/modules/auth/guards | `apps/backend/src/modules/auth/guards/rbac.guard.ts` | file | 109 | NestJS guard |
| apps/backend/src/modules/auth/guards | `apps/backend/src/modules/auth/guards/roles.guard.ts` | file | 005 | NestJS guard |
| apps/backend/src/modules/auth/qr-sync | `apps/backend/src/modules/auth/qr-sync` | dir | 007 | — |
| apps/backend/src/modules/auth/qr-sync/application | `apps/backend/src/modules/auth/qr-sync/application` | dir | 007 | — |
| apps/backend/src/modules/auth/qr-sync/application/use-cases | `apps/backend/src/modules/auth/qr-sync/application/use-cases` | dir | 007 | — |
| apps/backend/src/modules/auth/qr-sync/application/use-cases | `apps/backend/src/modules/auth/qr-sync/application/use-cases/authorize-qr-session.use-case.ts` | file | 007 | — |
| apps/backend/src/modules/auth/qr-sync/application/use-cases | `apps/backend/src/modules/auth/qr-sync/application/use-cases/init-qr-session.use-case.ts` | file | 007 | — |
| apps/backend/src/modules/auth/qr-sync/application/use-cases | `apps/backend/src/modules/auth/qr-sync/application/use-cases/process-qr-scan.use-case.ts` | file | 007 | — |
| apps/backend/src/modules/auth/qr-sync/domain | `apps/backend/src/modules/auth/qr-sync/domain` | dir | 007 | — |
| apps/backend/src/modules/auth/qr-sync/domain/entities | `apps/backend/src/modules/auth/qr-sync/domain/entities` | dir | 007 | — |
| apps/backend/src/modules/auth/qr-sync/domain/entities | `apps/backend/src/modules/auth/qr-sync/domain/entities/qr-session.entity.ts` | file | 007 | DDD entity |
| apps/backend/src/modules/auth/qr-sync/domain/value-objects | `apps/backend/src/modules/auth/qr-sync/domain/value-objects` | dir | 007 | — |
| apps/backend/src/modules/auth/qr-sync/domain/value-objects | `apps/backend/src/modules/auth/qr-sync/domain/value-objects/ephemeral-nonce.vo.ts` | file | 007 | — |
| apps/backend/src/modules/auth/qr-sync/infrastructure | `apps/backend/src/modules/auth/qr-sync/infrastructure` | dir | 007 | — |
| apps/backend/src/modules/auth/qr-sync/infrastructure/gateways | `apps/backend/src/modules/auth/qr-sync/infrastructure/gateways` | dir | 007 | — |
| apps/backend/src/modules/auth/qr-sync/infrastructure/gateways | `apps/backend/src/modules/auth/qr-sync/infrastructure/gateways/qr-auth.gateway.ts` | file | 007 | — |
| apps/backend/src/modules/auth/qr-sync/infrastructure/repositories | `apps/backend/src/modules/auth/qr-sync/infrastructure/repositories` | dir | 007 | — |
| apps/backend/src/modules/auth/qr-sync/infrastructure/repositories | `apps/backend/src/modules/auth/qr-sync/infrastructure/repositories/redis-qr-cache.repository.ts` | file | 007 | — |
| apps/backend/src/modules/auth/qr-sync/presentation | `apps/backend/src/modules/auth/qr-sync/presentation` | dir | 007 | — |
| apps/backend/src/modules/auth/qr-sync/presentation/controllers | `apps/backend/src/modules/auth/qr-sync/presentation/controllers` | dir | 007 | — |
| apps/backend/src/modules/auth/qr-sync/presentation/controllers | `apps/backend/src/modules/auth/qr-sync/presentation/controllers/qr-auth-webhook.controller.ts` | file | 007 | REST webhook |
| apps/backend/src/modules/auth/qr-sync/presentation/resolvers | `apps/backend/src/modules/auth/qr-sync/presentation/resolvers` | dir | 007 | — |
| apps/backend/src/modules/auth/qr-sync/presentation/resolvers | `apps/backend/src/modules/auth/qr-sync/presentation/resolvers/qr-auth.resolver.ts` | file | 007 | GraphQL resolver |
| apps/backend/src/modules/auth/resolvers | `apps/backend/src/modules/auth/resolvers` | dir | 006 | — |
| apps/backend/src/modules/auth/resolvers | `apps/backend/src/modules/auth/resolvers/auth.resolver.ts` | file | 006 | GraphQL resolver |
| apps/backend/src/modules/auth/services | `apps/backend/src/modules/auth/services` | dir | 005, 006 | — |
| apps/backend/src/modules/auth/services | `apps/backend/src/modules/auth/services/auth.service.ts` | file | 005, 006 | NestJS service |
| apps/backend/src/modules/auth/services | `apps/backend/src/modules/auth/services/jwt-token.service.ts` | file | 006 | NestJS service |
| apps/backend/src/modules/auth/services | `apps/backend/src/modules/auth/services/line-verifier.service.ts` | file | 006 | NestJS service |
| apps/backend/src/modules/auth/services | `apps/backend/src/modules/auth/services/token-scope.service.ts` | file | 106 | NestJS service |
| apps/backend/src/modules/auth/services | `apps/backend/src/modules/auth/services/token.service.ts` | file | 005 | NestJS service |
| apps/backend/src/modules/auth/strategies | `apps/backend/src/modules/auth/strategies` | dir | 005, 006 | — |
| apps/backend/src/modules/auth/strategies | `apps/backend/src/modules/auth/strategies/jwt.strategy.ts` | file | 005, 006, 007, 118 | — |
| apps/backend/src/modules/b2b | `apps/backend/src/modules/b2b` | dir | 097 | — |
| apps/backend/src/modules/b2b | `apps/backend/src/modules/b2b/b2b.module.ts` | file | 097 | NestJS module |
| apps/backend/src/modules/b2b-hr | `apps/backend/src/modules/b2b-hr` | dir | 098 | — |
| apps/backend/src/modules/b2b-hr | `apps/backend/src/modules/b2b-hr/b2b-hr.module.ts` | file | 098 | NestJS module |
| apps/backend/src/modules/b2b-hr/controllers | `apps/backend/src/modules/b2b-hr/controllers` | dir | 098 | — |
| apps/backend/src/modules/b2b-hr/controllers | `apps/backend/src/modules/b2b-hr/controllers/b2b-export.controller.ts` | file | 098 | REST controller |
| apps/backend/src/modules/b2b-hr/repositories | `apps/backend/src/modules/b2b-hr/repositories` | dir | 098 | — |
| apps/backend/src/modules/b2b-hr/repositories | `apps/backend/src/modules/b2b-hr/repositories/b2b-hr.repository.ts` | file | 098 | — |
| apps/backend/src/modules/b2b-hr/services | `apps/backend/src/modules/b2b-hr/services` | dir | 098 | — |
| apps/backend/src/modules/b2b-hr/services | `apps/backend/src/modules/b2b-hr/services/b2b-analytics.service.ts` | file | 098 | NestJS service |
| apps/backend/src/modules/b2b-hr/services | `apps/backend/src/modules/b2b-hr/services/b2b-quiz-tracker.service.ts` | file | 098 | NestJS service |
| apps/backend/src/modules/b2b-hr/services | `apps/backend/src/modules/b2b-hr/services/b2b-seat.service.ts` | file | 098 | NestJS service |
| apps/backend/src/modules/b2b/controllers | `apps/backend/src/modules/b2b/controllers` | dir | 097 | — |
| apps/backend/src/modules/b2b/controllers | `apps/backend/src/modules/b2b/controllers/b2b-corporate.controller.ts` | file | 097 | REST controller |
| apps/backend/src/modules/b2b/repositories | `apps/backend/src/modules/b2b/repositories` | dir | 097 | — |
| apps/backend/src/modules/b2b/repositories | `apps/backend/src/modules/b2b/repositories/b2b-prisma.repository.ts` | file | 097 | — |
| apps/backend/src/modules/b2b/resolvers | `apps/backend/src/modules/b2b/resolvers` | dir | 097 | — |
| apps/backend/src/modules/b2b/resolvers | `apps/backend/src/modules/b2b/resolvers/b2b-seat.resolver.ts` | file | 097 | GraphQL resolver |
| apps/backend/src/modules/b2b/services | `apps/backend/src/modules/b2b/services` | dir | 097 | — |
| apps/backend/src/modules/b2b/services | `apps/backend/src/modules/b2b/services/b2b-analytics.service.ts` | file | 097 | NestJS service |
| apps/backend/src/modules/b2b/services | `apps/backend/src/modules/b2b/services/b2b-license.service.ts` | file | 097 | NestJS service |
| apps/backend/src/modules/b2b/services | `apps/backend/src/modules/b2b/services/b2b-seat-allocation.service.ts` | file | 097 | NestJS service |
| apps/backend/src/modules/campaign | `apps/backend/src/modules/campaign` | dir | 117 | — |
| apps/backend/src/modules/campaign/application | `apps/backend/src/modules/campaign/application` | dir | 117 | — |
| apps/backend/src/modules/campaign/application/services | `apps/backend/src/modules/campaign/application/services` | dir | 117 | — |
| apps/backend/src/modules/campaign/application/services | `apps/backend/src/modules/campaign/application/services/discount-calculator.service.ts` | file | 117 | NestJS service |
| apps/backend/src/modules/campaign/application/use-cases | `apps/backend/src/modules/campaign/application/use-cases` | dir | 117 | — |
| apps/backend/src/modules/campaign/application/use-cases | `apps/backend/src/modules/campaign/application/use-cases/claim-coupon.use-case.ts` | file | 117 | — |
| apps/backend/src/modules/campaign/application/use-cases | `apps/backend/src/modules/campaign/application/use-cases/execute-flash-sale-lock.use-case.ts` | file | 117 | — |
| apps/backend/src/modules/campaign/application/use-cases | `apps/backend/src/modules/campaign/application/use-cases/validate-coupon.use-case.ts` | file | 117 | — |
| apps/backend/src/modules/campaign/domain | `apps/backend/src/modules/campaign/domain` | dir | 117 | — |
| apps/backend/src/modules/campaign/domain/entities | `apps/backend/src/modules/campaign/domain/entities` | dir | 117 | — |
| apps/backend/src/modules/campaign/domain/entities | `apps/backend/src/modules/campaign/domain/entities/coupon.entity.ts` | file | 117 | DDD entity |
| apps/backend/src/modules/campaign/domain/value-objects | `apps/backend/src/modules/campaign/domain/value-objects` | dir | 117 | — |
| apps/backend/src/modules/campaign/domain/value-objects | `apps/backend/src/modules/campaign/domain/value-objects/discount-result.vo.ts` | file | 117 | — |
| apps/backend/src/modules/campaign/infrastructure | `apps/backend/src/modules/campaign/infrastructure` | dir | 117 | — |
| apps/backend/src/modules/campaign/infrastructure/persistence | `apps/backend/src/modules/campaign/infrastructure/persistence` | dir | 117 | — |
| apps/backend/src/modules/campaign/infrastructure/persistence | `apps/backend/src/modules/campaign/infrastructure/persistence/prisma-coupon.repository.ts` | file | 117 | — |
| apps/backend/src/modules/campaign/infrastructure/redis | `apps/backend/src/modules/campaign/infrastructure/redis` | dir | 117 | — |
| apps/backend/src/modules/campaign/infrastructure/redis | `apps/backend/src/modules/campaign/infrastructure/redis/coupon-cache.repository.ts` | file | 117 | — |
| apps/backend/src/modules/campaign/presentation | `apps/backend/src/modules/campaign/presentation` | dir | 117 | — |
| apps/backend/src/modules/campaign/presentation/graphql | `apps/backend/src/modules/campaign/presentation/graphql` | dir | 117 | — |
| apps/backend/src/modules/campaign/presentation/graphql | `apps/backend/src/modules/campaign/presentation/graphql/coupon.resolver.ts` | file | 117 | GraphQL resolver |
| apps/backend/src/modules/campaign/presentation/webhooks | `apps/backend/src/modules/campaign/presentation/webhooks` | dir | 117 | REST webhook |
| apps/backend/src/modules/campaign/presentation/webhooks | `apps/backend/src/modules/campaign/presentation/webhooks/campaign-event.controller.ts` | file | 117 | REST webhook |
| apps/backend/src/modules/cart | `apps/backend/src/modules/cart` | dir | 011, 084 | — |
| apps/backend/src/modules/cart/ | `apps/backend/src/modules/cart/` | dir | 011 | — |
| apps/backend/src/modules/cart/application | `apps/backend/src/modules/cart/application` | dir | 011 | — |
| apps/backend/src/modules/cart/application | `apps/backend/src/modules/cart/application/cart.service.ts` | file | 011 | NestJS service |
| apps/backend/src/modules/cart/application/use-cases | `apps/backend/src/modules/cart/application/use-cases` | dir | 011 | — |
| apps/backend/src/modules/cart/application/use-cases | `apps/backend/src/modules/cart/application/use-cases/add-to-cart.usecase.ts` | file | 011 | — |
| apps/backend/src/modules/cart/application/use-cases | `apps/backend/src/modules/cart/application/use-cases/split-cart-calculator.usecase.ts` | file | 011 | — |
| apps/backend/src/modules/cart/domain | `apps/backend/src/modules/cart/domain` | dir | 011 | — |
| apps/backend/src/modules/cart/domain/entities | `apps/backend/src/modules/cart/domain/entities` | dir | 011 | — |
| apps/backend/src/modules/cart/domain/entities | `apps/backend/src/modules/cart/domain/entities/cart-item.entity.ts` | file | 011 | DDD entity |
| apps/backend/src/modules/cart/domain/entities | `apps/backend/src/modules/cart/domain/entities/cart.entity.ts` | file | 011 | DDD entity |
| apps/backend/src/modules/cart/domain/value-objects | `apps/backend/src/modules/cart/domain/value-objects` | dir | 011 | — |
| apps/backend/src/modules/cart/domain/value-objects | `apps/backend/src/modules/cart/domain/value-objects/cart-split.vo.ts` | file | 011 | — |
| apps/backend/src/modules/cart/infrastructure | `apps/backend/src/modules/cart/infrastructure` | dir | 011 | — |
| apps/backend/src/modules/cart/infrastructure | `apps/backend/src/modules/cart/infrastructure/cart.repository.ts` | file | 011 | — |
| apps/backend/src/modules/cart/infrastructure | `apps/backend/src/modules/cart/infrastructure/shipping-adapter.service.ts` | file | 011 | NestJS service |
| apps/backend/src/modules/cart/presentation | `apps/backend/src/modules/cart/presentation` | dir | 011 | — |
| apps/backend/src/modules/cart/presentation | `apps/backend/src/modules/cart/presentation/cart.resolver.ts` | file | 011 | GraphQL resolver |
| apps/backend/src/modules/catalog | `apps/backend/src/modules/catalog` | dir | 008, 009, 010, 037 | — |
| apps/backend/src/modules/catalog | `apps/backend/src/modules/catalog/catalog.module.ts` | file | 037 | NestJS module |
| apps/backend/src/modules/catalog/ | `apps/backend/src/modules/catalog/` | dir | 009 | — |
| apps/backend/src/modules/catalog/application | `apps/backend/src/modules/catalog/application` | dir | 008, 009 | — |
| apps/backend/src/modules/catalog/application/commands | `apps/backend/src/modules/catalog/application/commands` | dir | 008 | — |
| apps/backend/src/modules/catalog/application/commands | `apps/backend/src/modules/catalog/application/commands/create-product.command.ts` | file | 008 | — |
| apps/backend/src/modules/catalog/application/commands | `apps/backend/src/modules/catalog/application/commands/update-stock.command.ts` | file | 008 | — |
| apps/backend/src/modules/catalog/application/handlers | `apps/backend/src/modules/catalog/application/handlers` | dir | 009 | — |
| apps/backend/src/modules/catalog/application/handlers | `apps/backend/src/modules/catalog/application/handlers/predictive-search.handler.ts` | file | 009 | — |
| apps/backend/src/modules/catalog/application/handlers | `apps/backend/src/modules/catalog/application/handlers/search-products.handler.ts` | file | 009 | — |
| apps/backend/src/modules/catalog/application/queries | `apps/backend/src/modules/catalog/application/queries` | dir | 008, 009 | — |
| apps/backend/src/modules/catalog/application/queries | `apps/backend/src/modules/catalog/application/queries/get-product-by-slug.query.ts` | file | 008 | — |
| apps/backend/src/modules/catalog/application/queries | `apps/backend/src/modules/catalog/application/queries/list-catalog.query.ts` | file | 008 | — |
| apps/backend/src/modules/catalog/application/queries | `apps/backend/src/modules/catalog/application/queries/predictive-search.query.ts` | file | 009 | — |
| apps/backend/src/modules/catalog/application/queries | `apps/backend/src/modules/catalog/application/queries/search-products.query.ts` | file | 009 | — |
| apps/backend/src/modules/catalog/controllers | `apps/backend/src/modules/catalog/controllers` | dir | 037 | — |
| apps/backend/src/modules/catalog/controllers | `apps/backend/src/modules/catalog/controllers/catalog-structure.controller.ts` | file | 037 | REST controller |
| apps/backend/src/modules/catalog/domain | `apps/backend/src/modules/catalog/domain` | dir | 008, 009 | — |
| apps/backend/src/modules/catalog/domain/ | `apps/backend/src/modules/catalog/domain/` | dir | 008 | — |
| apps/backend/src/modules/catalog/domain/entities | `apps/backend/src/modules/catalog/domain/entities` | dir | 008, 009 | — |
| apps/backend/src/modules/catalog/domain/entities | `apps/backend/src/modules/catalog/domain/entities/course-detail.entity.ts` | file | 008 | DDD entity |
| apps/backend/src/modules/catalog/domain/entities | `apps/backend/src/modules/catalog/domain/entities/ebook-detail.entity.ts` | file | 008 | DDD entity |
| apps/backend/src/modules/catalog/domain/entities | `apps/backend/src/modules/catalog/domain/entities/physical-detail.entity.ts` | file | 008 | DDD entity |
| apps/backend/src/modules/catalog/domain/entities | `apps/backend/src/modules/catalog/domain/entities/product-search-result.entity.ts` | file | 009 | DDD entity |
| apps/backend/src/modules/catalog/domain/entities | `apps/backend/src/modules/catalog/domain/entities/product.entity.ts` | file | 008 | DDD entity |
| apps/backend/src/modules/catalog/domain/events | `apps/backend/src/modules/catalog/domain/events` | dir | 008 | — |
| apps/backend/src/modules/catalog/domain/events | `apps/backend/src/modules/catalog/domain/events/product-created.event.ts` | file | 008 | — |
| apps/backend/src/modules/catalog/domain/events | `apps/backend/src/modules/catalog/domain/events/stock-reserved.event.ts` | file | 008 | — |
| apps/backend/src/modules/catalog/domain/repositories | `apps/backend/src/modules/catalog/domain/repositories` | dir | 009 | — |
| apps/backend/src/modules/catalog/domain/repositories | `apps/backend/src/modules/catalog/domain/repositories/product-search.repository.interface.ts` | file | 009 | — |
| apps/backend/src/modules/catalog/domain/value-objects | `apps/backend/src/modules/catalog/domain/value-objects` | dir | 008 | — |
| apps/backend/src/modules/catalog/domain/value-objects | `apps/backend/src/modules/catalog/domain/value-objects/money.vo.ts` | file | 008 | — |
| apps/backend/src/modules/catalog/domain/value-objects | `apps/backend/src/modules/catalog/domain/value-objects/sku.vo.ts` | file | 008 | — |
| apps/backend/src/modules/catalog/dto | `apps/backend/src/modules/catalog/dto` | dir | 037 | — |
| apps/backend/src/modules/catalog/dto | `apps/backend/src/modules/catalog/dto/create-course-lesson.dto.ts` | file | 037 | DTO |
| apps/backend/src/modules/catalog/dto | `apps/backend/src/modules/catalog/dto/create-ebook-chapter.dto.ts` | file | 037 | DTO |
| apps/backend/src/modules/catalog/dto | `apps/backend/src/modules/catalog/dto/ebook-course.dto.ts` | file | 037 | DTO |
| apps/backend/src/modules/catalog/infrastructure | `apps/backend/src/modules/catalog/infrastructure` | dir | 008, 009 | — |
| apps/backend/src/modules/catalog/infrastructure/mappers | `apps/backend/src/modules/catalog/infrastructure/mappers` | dir | 008 | — |
| apps/backend/src/modules/catalog/infrastructure/mappers | `apps/backend/src/modules/catalog/infrastructure/mappers/product.mapper.ts` | file | 008 | — |
| apps/backend/src/modules/catalog/infrastructure/persistence | `apps/backend/src/modules/catalog/infrastructure/persistence` | dir | 009 | — |
| apps/backend/src/modules/catalog/infrastructure/persistence | `apps/backend/src/modules/catalog/infrastructure/persistence/prisma-product-search.repository.ts` | file | 009 | — |
| apps/backend/src/modules/catalog/infrastructure/persistence | `apps/backend/src/modules/catalog/infrastructure/persistence/redis-search-cache.adapter.ts` | file | 009 | — |
| apps/backend/src/modules/catalog/infrastructure/repositories | `apps/backend/src/modules/catalog/infrastructure/repositories` | dir | 008 | — |
| apps/backend/src/modules/catalog/infrastructure/repositories | `apps/backend/src/modules/catalog/infrastructure/repositories/prisma-catalog.repository.ts` | file | 008 | — |
| apps/backend/src/modules/catalog/infrastructure/search-engine | `apps/backend/src/modules/catalog/infrastructure/search-engine` | dir | 009 | — |
| apps/backend/src/modules/catalog/infrastructure/search-engine | `apps/backend/src/modules/catalog/infrastructure/search-engine/postgres-fts.engine.ts` | file | 009 | — |
| apps/backend/src/modules/catalog/infrastructure/search-engine | `apps/backend/src/modules/catalog/infrastructure/search-engine/vector-search.engine.ts` | file | 009 | — |
| apps/backend/src/modules/catalog/presentation | `apps/backend/src/modules/catalog/presentation` | dir | 008, 009 | — |
| apps/backend/src/modules/catalog/presentation/graphql | `apps/backend/src/modules/catalog/presentation/graphql` | dir | 008 | — |
| apps/backend/src/modules/catalog/presentation/graphql | `apps/backend/src/modules/catalog/presentation/graphql/catalog.resolver.ts` | file | 008 | GraphQL resolver |
| apps/backend/src/modules/catalog/presentation/resolvers | `apps/backend/src/modules/catalog/presentation/resolvers` | dir | 009 | — |
| apps/backend/src/modules/catalog/presentation/resolvers | `apps/backend/src/modules/catalog/presentation/resolvers/product-search.resolver.ts` | file | 009 | GraphQL resolver |
| apps/backend/src/modules/catalog/presentation/rest | `apps/backend/src/modules/catalog/presentation/rest` | dir | 008 | — |
| apps/backend/src/modules/catalog/presentation/rest | `apps/backend/src/modules/catalog/presentation/rest/catalog-admin.controller.ts` | file | 008 | REST controller |
| apps/backend/src/modules/catalog/repositories | `apps/backend/src/modules/catalog/repositories` | dir | 037 | — |
| apps/backend/src/modules/catalog/repositories | `apps/backend/src/modules/catalog/repositories/course-detail.repository.ts` | file | 037 | — |
| apps/backend/src/modules/catalog/repositories | `apps/backend/src/modules/catalog/repositories/ebook-detail.repository.ts` | file | 037 | — |
| apps/backend/src/modules/catalog/resolvers | `apps/backend/src/modules/catalog/resolvers/storefront.resolver.ts` | file | 010 | GraphQL resolver |
| apps/backend/src/modules/catalog/services | `apps/backend/src/modules/catalog/services` | dir | 037 | — |
| apps/backend/src/modules/catalog/services | `apps/backend/src/modules/catalog/services/course-structure.service.ts` | file | 037 | NestJS service |
| apps/backend/src/modules/catalog/services | `apps/backend/src/modules/catalog/services/ebook-structure.service.ts` | file | 037 | NestJS service |
| apps/backend/src/modules/catalog/services | `apps/backend/src/modules/catalog/services/storefront.service.ts` | file | 010 | NestJS service |
| apps/backend/src/modules/certificate | `apps/backend/src/modules/certificate` | dir | 048, 105 | — |
| apps/backend/src/modules/certificate | `apps/backend/src/modules/certificate/certificate-verification.controller.ts` | file | 105 | REST controller |
| apps/backend/src/modules/certificate | `apps/backend/src/modules/certificate/certificate-verification.service.ts` | file | 105 | NestJS service |
| apps/backend/src/modules/certificate | `apps/backend/src/modules/certificate/certificate.module.ts` | file | 105 | NestJS module |
| apps/backend/src/modules/certificate | `apps/backend/src/modules/certificate/certificate.resolver.ts` | file | 105 | GraphQL resolver |
| apps/backend/src/modules/certificate/application | `apps/backend/src/modules/certificate/application` | dir | 048 | — |
| apps/backend/src/modules/certificate/application/event-handlers | `apps/backend/src/modules/certificate/application/event-handlers` | dir | 048 | — |
| apps/backend/src/modules/certificate/application/event-handlers | `apps/backend/src/modules/certificate/application/event-handlers/course-completed.handler.ts` | file | 048 | — |
| apps/backend/src/modules/certificate/application/services | `apps/backend/src/modules/certificate/application/services` | dir | 048 | — |
| apps/backend/src/modules/certificate/application/services | `apps/backend/src/modules/certificate/application/services/certificate-pdf-generator.service.ts` | file | 048 | NestJS service |
| apps/backend/src/modules/certificate/application/services | `apps/backend/src/modules/certificate/application/services/certificate-verification.service.ts` | file | 048 | NestJS service |
| apps/backend/src/modules/certificate/domain | `apps/backend/src/modules/certificate/domain` | dir | 048, 105 | — |
| apps/backend/src/modules/certificate/domain | `apps/backend/src/modules/certificate/domain/certificate-hash.verifier.ts` | file | 105 | — |
| apps/backend/src/modules/certificate/domain | `apps/backend/src/modules/certificate/domain/certificate-status.enum.ts` | file | 105 | — |
| apps/backend/src/modules/certificate/domain/entities | `apps/backend/src/modules/certificate/domain/entities` | dir | 048 | — |
| apps/backend/src/modules/certificate/domain/entities | `apps/backend/src/modules/certificate/domain/entities/certificate.entity.ts` | file | 048 | DDD entity |
| apps/backend/src/modules/certificate/domain/value-objects | `apps/backend/src/modules/certificate/domain/value-objects` | dir | 048 | — |
| apps/backend/src/modules/certificate/domain/value-objects | `apps/backend/src/modules/certificate/domain/value-objects/digital-signature.vo.ts` | file | 048 | — |
| apps/backend/src/modules/certificate/dto | `apps/backend/src/modules/certificate/dto` | dir | 105 | — |
| apps/backend/src/modules/certificate/dto | `apps/backend/src/modules/certificate/dto/verify-certificate.dto.ts` | file | 105 | DTO |
| apps/backend/src/modules/certificate/infrastructure | `apps/backend/src/modules/certificate/infrastructure` | dir | 048 | — |
| apps/backend/src/modules/certificate/infrastructure/pdf-engine | `apps/backend/src/modules/certificate/infrastructure/pdf-engine` | dir | 048 | — |
| apps/backend/src/modules/certificate/infrastructure/pdf-engine | `apps/backend/src/modules/certificate/infrastructure/pdf-engine/chromium-pdf-renderer.adapter.ts` | file | 048 | — |
| apps/backend/src/modules/certificate/infrastructure/qr-engine | `apps/backend/src/modules/certificate/infrastructure/qr-engine` | dir | 048 | — |
| apps/backend/src/modules/certificate/infrastructure/qr-engine | `apps/backend/src/modules/certificate/infrastructure/qr-engine/qr-code-generator.adapter.ts` | file | 048 | — |
| apps/backend/src/modules/certificate/presentation | `apps/backend/src/modules/certificate/presentation` | dir | 048 | — |
| apps/backend/src/modules/certificate/presentation | `apps/backend/src/modules/certificate/presentation/certificate-verify.controller.ts` | file | 048 | REST controller |
| apps/backend/src/modules/certificate/presentation | `apps/backend/src/modules/certificate/presentation/certificate.resolver.ts` | file | 048 | GraphQL resolver |
| apps/backend/src/modules/chaos | `apps/backend/src/modules/chaos` | dir | 124 | — |
| apps/backend/src/modules/chaos | `apps/backend/src/modules/chaos/chaos-injector.service.ts` | file | 124 | NestJS service |
| apps/backend/src/modules/chaos | `apps/backend/src/modules/chaos/chaos.controller.ts` | file | 124 | REST controller |
| apps/backend/src/modules/chaos/interceptors | `apps/backend/src/modules/chaos/interceptors` | dir | 124 | — |
| apps/backend/src/modules/chaos/interceptors | `apps/backend/src/modules/chaos/interceptors/easyslip-chaos.proxy.ts` | file | 124 | NestJS interceptor |
| apps/backend/src/modules/chaos/interceptors | `apps/backend/src/modules/chaos/interceptors/redis-fault.interceptor.ts` | file | 124 | NestJS interceptor |
| apps/backend/src/modules/clearinghouse | `apps/backend/src/modules/clearinghouse` | dir | 114 | — |
| apps/backend/src/modules/clearinghouse | `apps/backend/src/modules/clearinghouse/clearinghouse.module.ts` | file | 114 | NestJS module |
| apps/backend/src/modules/clearinghouse | `apps/backend/src/modules/clearinghouse/clearinghouse.service.ts` | file | 114 | NestJS service |
| apps/backend/src/modules/clearinghouse | `apps/backend/src/modules/clearinghouse/payout-processor.service.ts` | file | 114 | NestJS service |
| apps/backend/src/modules/clearinghouse | `apps/backend/src/modules/clearinghouse/reconciliation-engine.service.ts` | file | 114 | NestJS service |
| apps/backend/src/modules/clearinghouse | `apps/backend/src/modules/clearinghouse/tax-calculator.service.ts` | file | 114 | NestJS service |
| apps/backend/src/modules/commission | `apps/backend/src/modules/commission` | dir | 081 | — |
| apps/backend/src/modules/commission | `apps/backend/src/modules/commission/commission.module.ts` | file | 081 | NestJS module |
| apps/backend/src/modules/commission/ | `apps/backend/src/modules/commission/` | dir | 081 | — |
| apps/backend/src/modules/commission/application | `apps/backend/src/modules/commission/application` | dir | 081 | — |
| apps/backend/src/modules/commission/application | `apps/backend/src/modules/commission/application/commission-calculator.service.ts` | file | 081 | NestJS service |
| apps/backend/src/modules/commission/Check | `apps/backend/src/modules/commission/Check` | dir | 081 | — |
| apps/backend/src/modules/coupon | `apps/backend/src/modules/coupon` | dir | 084, 117 | — |
| apps/backend/src/modules/coupon/infra/redis | `apps/backend/src/modules/coupon/infra/redis/coupon-cache.repository.ts` | file | 117 | — |
| apps/backend/src/modules/course | `apps/backend/src/modules/course/lesson.service.ts` | file | 102 | NestJS service |
| apps/backend/src/modules/course-studio | `apps/backend/src/modules/course-studio` | dir | 073, 078 | — |
| apps/backend/src/modules/course-studio/application | `apps/backend/src/modules/course-studio/application` | dir | 078 | — |
| apps/backend/src/modules/course-studio/application/dto | `apps/backend/src/modules/course-studio/application/dto` | dir | 078 | — |
| apps/backend/src/modules/course-studio/application/dto | `apps/backend/src/modules/course-studio/application/dto/hls-upload.dto.ts` | file | 078 | DTO |
| apps/backend/src/modules/course-studio/application/dto | `apps/backend/src/modules/course-studio/application/dto/reorder-curriculum.dto.ts` | file | 078 | DTO |
| apps/backend/src/modules/course-studio/application/dto | `apps/backend/src/modules/course-studio/application/dto/save-quiz.dto.ts` | file | 078 | DTO |
| apps/backend/src/modules/course-studio/application/services | `apps/backend/src/modules/course-studio/application/services` | dir | 078 | — |
| apps/backend/src/modules/course-studio/application/services | `apps/backend/src/modules/course-studio/application/services/curriculum-builder.service.ts` | file | 078 | NestJS service |
| apps/backend/src/modules/course-studio/application/services | `apps/backend/src/modules/course-studio/application/services/hls-transcoder.service.ts` | file | 078 | NestJS service |
| apps/backend/src/modules/course-studio/application/services | `apps/backend/src/modules/course-studio/application/services/quiz-engine.service.ts` | file | 078 | NestJS service |
| apps/backend/src/modules/course-studio/application/use-cases | `apps/backend/src/modules/course-studio/application/use-cases` | dir | 078 | — |
| apps/backend/src/modules/course-studio/application/use-cases | `apps/backend/src/modules/course-studio/application/use-cases/process-hls-webhook.use-case.ts` | file | 078 | REST webhook |
| apps/backend/src/modules/course-studio/application/use-cases | `apps/backend/src/modules/course-studio/application/use-cases/reorder-curriculum.use-case.ts` | file | 078 | — |
| apps/backend/src/modules/course-studio/domain | `apps/backend/src/modules/course-studio/domain` | dir | 078 | — |
| apps/backend/src/modules/course-studio/domain/entities | `apps/backend/src/modules/course-studio/domain/entities` | dir | 078 | — |
| apps/backend/src/modules/course-studio/domain/entities | `apps/backend/src/modules/course-studio/domain/entities/course-lesson.entity.ts` | file | 078 | DDD entity |
| apps/backend/src/modules/course-studio/domain/entities | `apps/backend/src/modules/course-studio/domain/entities/course-section.entity.ts` | file | 078 | DDD entity |
| apps/backend/src/modules/course-studio/domain/entities | `apps/backend/src/modules/course-studio/domain/entities/lesson-quiz.entity.ts` | file | 078 | DDD entity |
| apps/backend/src/modules/course-studio/domain/repositories | `apps/backend/src/modules/course-studio/domain/repositories` | dir | 078 | — |
| apps/backend/src/modules/course-studio/domain/repositories | `apps/backend/src/modules/course-studio/domain/repositories/course-studio.repository.interface.ts` | file | 078 | — |
| apps/backend/src/modules/course-studio/infrastructure | `apps/backend/src/modules/course-studio/infrastructure` | dir | 078 | — |
| apps/backend/src/modules/course-studio/infrastructure/controllers | `apps/backend/src/modules/course-studio/infrastructure/controllers` | dir | 078 | — |
| apps/backend/src/modules/course-studio/infrastructure/controllers | `apps/backend/src/modules/course-studio/infrastructure/controllers/hls-webhook.controller.ts` | file | 078 | REST webhook |
| apps/backend/src/modules/course-studio/infrastructure/repositories | `apps/backend/src/modules/course-studio/infrastructure/repositories` | dir | 078 | — |
| apps/backend/src/modules/course-studio/infrastructure/repositories | `apps/backend/src/modules/course-studio/infrastructure/repositories/prisma-course-studio.repository.ts` | file | 078 | — |
| apps/backend/src/modules/disaster-recovery | `apps/backend/src/modules/disaster-recovery` | dir | 127 | — |
| apps/backend/src/modules/disaster-recovery/cron | `apps/backend/src/modules/disaster-recovery/cron` | dir | 127 | — |
| apps/backend/src/modules/disaster-recovery/cron | `apps/backend/src/modules/disaster-recovery/cron/backup-verifier.job.ts` | file | 127 | — |
| apps/backend/src/modules/disaster-recovery/services | `apps/backend/src/modules/disaster-recovery/services` | dir | 127 | — |
| apps/backend/src/modules/disaster-recovery/services | `apps/backend/src/modules/disaster-recovery/services/automated-failover.service.ts` | file | 127 | NestJS service |
| apps/backend/src/modules/disaster-recovery/services | `apps/backend/src/modules/disaster-recovery/services/health-checker.service.ts` | file | 127 | NestJS service |
| apps/backend/src/modules/disaster-recovery/services | `apps/backend/src/modules/disaster-recovery/services/r2-pitr-backup.service.ts` | file | 127 | NestJS service |
| apps/backend/src/modules/dispute | `apps/backend/src/modules/dispute` | dir | 113 | — |
| apps/backend/src/modules/dispute | `apps/backend/src/modules/dispute/dispute.controller.ts` | file | 113 | REST controller |
| apps/backend/src/modules/dispute | `apps/backend/src/modules/dispute/dispute.module.ts` | file | 113 | NestJS module |
| apps/backend/src/modules/dispute | `apps/backend/src/modules/dispute/dispute.resolver.ts` | file | 113 | GraphQL resolver |
| apps/backend/src/modules/dispute | `apps/backend/src/modules/dispute/dispute.service.ts` | file | 113 | NestJS service |
| apps/backend/src/modules/dispute/dto | `apps/backend/src/modules/dispute/dto` | dir | 113 | — |
| apps/backend/src/modules/dispute/dto | `apps/backend/src/modules/dispute/dto/create-dispute.dto.ts` | file | 113 | DTO |
| apps/backend/src/modules/dispute/dto | `apps/backend/src/modules/dispute/dto/resolve-dispute.dto.ts` | file | 113 | DTO |
| apps/backend/src/modules/domain-verifier | `apps/backend/src/modules/domain-verifier` | dir | 108 | — |
| apps/backend/src/modules/drm | `apps/backend/src/modules/drm` | dir | 049 | — |
| apps/backend/src/modules/drm/services | `apps/backend/src/modules/drm/services/drm-shuffling.service.ts` | file | 049 | NestJS service |
| apps/backend/src/modules/entitlement | `apps/backend/src/modules/entitlement` | dir | 000, 015, 017, 035, 047, 058, 079, 083, 086, 087, 089, 090, 093, 097, 098, 101, 103, 110, 111, 112, 113, 117, 128, 130 | — |
| apps/backend/src/modules/entitlement | `apps/backend/src/modules/entitlement/entitlement.module.ts` | file | 015 | NestJS module |
| apps/backend/src/modules/entitlement | `apps/backend/src/modules/entitlement/entitlement.service.ts` | file | 044, 051, 052, 053, 061, 070, 078, 084, 099, 106, 115 | NestJS service |
| apps/backend/src/modules/entitlement | `apps/backend/src/modules/entitlement/live-gatekeeper.service.ts` | file | 100 | NestJS service |
| apps/backend/src/modules/entitlement | `apps/backend/src/modules/entitlement/preview-gatekeeper.service.ts` | file | 051 | NestJS service |
| apps/backend/src/modules/entitlement/ | `apps/backend/src/modules/entitlement/` | dir | 012, 018, 020 | — |
| apps/backend/src/modules/entitlement/guards | `apps/backend/src/modules/entitlement/guards/edge-stream-entitlement.guard.ts` | file | 036 | NestJS guard |
| apps/backend/src/modules/entitlement/services | `apps/backend/src/modules/entitlement/services` | dir | 015 | — |
| apps/backend/src/modules/entitlement/services | `apps/backend/src/modules/entitlement/services/entitlement.service.ts` | file | 015, 026, 088 | NestJS service |
| apps/backend/src/modules/escrow | `apps/backend/src/modules/escrow` | dir | 113 | — |
| apps/backend/src/modules/escrow | `apps/backend/src/modules/escrow/escrow.cron.ts` | file | 113 | — |
| apps/backend/src/modules/escrow | `apps/backend/src/modules/escrow/escrow.module.ts` | file | 113 | NestJS module |
| apps/backend/src/modules/escrow | `apps/backend/src/modules/escrow/escrow.service.ts` | file | 113 | NestJS service |
| apps/backend/src/modules/finance | `apps/backend/src/modules/finance` | dir | 073, 081, 086, 116 | — |
| apps/backend/src/modules/finance | `apps/backend/src/modules/finance/finance.module.ts` | file | 081 | NestJS module |
| apps/backend/src/modules/finance/ | `apps/backend/src/modules/finance/` | dir | 081 | — |
| apps/backend/src/modules/finance/application | `apps/backend/src/modules/finance/application` | dir | 081 | — |
| apps/backend/src/modules/finance/application | `apps/backend/src/modules/finance/application/balance-calculator.service.ts` | file | 081 | NestJS service |
| apps/backend/src/modules/finance/application | `apps/backend/src/modules/finance/application/posting-engine.service.ts` | file | 081 | NestJS service |
| apps/backend/src/modules/finance/application | `apps/backend/src/modules/finance/application/tax-calculator.service.ts` | file | 081 | NestJS service |
| apps/backend/src/modules/finance/domain | `apps/backend/src/modules/finance/domain` | dir | 081 | — |
| apps/backend/src/modules/finance/domain | `apps/backend/src/modules/finance/domain/ledger-journal.aggregate.ts` | file | 081 | — |
| apps/backend/src/modules/finance/domain/events | `apps/backend/src/modules/finance/domain/events` | dir | 081 | — |
| apps/backend/src/modules/finance/domain/events | `apps/backend/src/modules/finance/domain/events/payout-requested.event.ts` | file | 081 | — |
| apps/backend/src/modules/finance/domain/events | `apps/backend/src/modules/finance/domain/events/revenue-posted.event.ts` | file | 081 | — |
| apps/backend/src/modules/finance/infrastructure | `apps/backend/src/modules/finance/infrastructure` | dir | 081 | — |
| apps/backend/src/modules/finance/infrastructure | `apps/backend/src/modules/finance/infrastructure/prisma-ledger.repository.ts` | file | 081 | — |
| apps/backend/src/modules/finance/infrastructure | `apps/backend/src/modules/finance/infrastructure/redis-balance.cache.ts` | file | 081 | — |
| apps/backend/src/modules/finance/payout | `apps/backend/src/modules/finance/payout` | dir | 085 | — |
| apps/backend/src/modules/flash-sale | `apps/backend/src/modules/flash-sale` | dir | 087 | — |
| apps/backend/src/modules/flash-sale | `apps/backend/src/modules/flash-sale/flash-sale.module.ts` | file | 087 | NestJS module |
| apps/backend/src/modules/flash-sale/controllers | `apps/backend/src/modules/flash-sale/controllers` | dir | 087 | — |
| apps/backend/src/modules/flash-sale/controllers | `apps/backend/src/modules/flash-sale/controllers/flash-sale-admin.controller.ts` | file | 087 | REST controller |
| apps/backend/src/modules/flash-sale/lua | `apps/backend/src/modules/flash-sale/lua` | dir | 087 | — |
| apps/backend/src/modules/flash-sale/lua/reserve | `apps/backend/src/modules/flash-sale/lua/reserve` | dir | 087 | — |
| apps/backend/src/modules/flash-sale/resolvers | `apps/backend/src/modules/flash-sale/resolvers` | dir | 087 | — |
| apps/backend/src/modules/flash-sale/resolvers | `apps/backend/src/modules/flash-sale/resolvers/flash-sale.resolver.ts` | file | 087 | GraphQL resolver |
| apps/backend/src/modules/flash-sale/services | `apps/backend/src/modules/flash-sale/services` | dir | 087 | — |
| apps/backend/src/modules/flash-sale/services | `apps/backend/src/modules/flash-sale/services/flash-sale-campaign.service.ts` | file | 087 | NestJS service |
| apps/backend/src/modules/flash-sale/services | `apps/backend/src/modules/flash-sale/services/redis-stock-lock.service.ts` | file | 087 | NestJS service |
| apps/backend/src/modules/flash-sale/services | `apps/backend/src/modules/flash-sale/services/reservation-cleanup.cron.ts` | file | 087 | NestJS service |
| apps/backend/src/modules/fulfillment | `apps/backend/src/modules/fulfillment` | dir | 076 | — |
| apps/backend/src/modules/fulfillment/adapters | `apps/backend/src/modules/fulfillment/adapters` | dir | 076 | — |
| apps/backend/src/modules/fulfillment/adapters | `apps/backend/src/modules/fulfillment/adapters/flash-express.adapter.ts` | file | 076 | — |
| apps/backend/src/modules/fulfillment/adapters | `apps/backend/src/modules/fulfillment/adapters/kex-express.adapter.ts` | file | 076 | — |
| apps/backend/src/modules/fulfillment/adapters | `apps/backend/src/modules/fulfillment/adapters/thailand-post.adapter.ts` | file | 076 | — |
| apps/backend/src/modules/fulfillment/controllers | `apps/backend/src/modules/fulfillment/controllers` | dir | 076 | — |
| apps/backend/src/modules/fulfillment/controllers | `apps/backend/src/modules/fulfillment/controllers/fulfillment-queue.controller.ts` | file | 076 | REST controller |
| apps/backend/src/modules/fulfillment/controllers | `apps/backend/src/modules/fulfillment/controllers/thermal-print.controller.ts` | file | 076 | REST controller |
| apps/backend/src/modules/fulfillment/dto | `apps/backend/src/modules/fulfillment/dto` | dir | 076 | — |
| apps/backend/src/modules/fulfillment/dto | `apps/backend/src/modules/fulfillment/dto/batch-booking.dto.ts` | file | 076 | DTO |
| apps/backend/src/modules/fulfillment/dto | `apps/backend/src/modules/fulfillment/dto/thermal-print.dto.ts` | file | 076 | DTO |
| apps/backend/src/modules/fulfillment/processors | `apps/backend/src/modules/fulfillment/processors` | dir | 076 | — |
| apps/backend/src/modules/fulfillment/processors | `apps/backend/src/modules/fulfillment/processors/fulfillment-queue.processor.ts` | file | 076 | — |
| apps/backend/src/modules/fulfillment/services | `apps/backend/src/modules/fulfillment/services` | dir | 076 | — |
| apps/backend/src/modules/fulfillment/services | `apps/backend/src/modules/fulfillment/services/batch-thermal-print.service.ts` | file | 076 | NestJS service |
| apps/backend/src/modules/fulfillment/services | `apps/backend/src/modules/fulfillment/services/fulfillment-queue.service.ts` | file | 076 | NestJS service |
| apps/backend/src/modules/fulfillment/services | `apps/backend/src/modules/fulfillment/services/logistics-adapter.service.ts` | file | 076 | NestJS service |
| apps/backend/src/modules/gamification | `apps/backend/src/modules/gamification` | dir | 083, 096 | — |
| apps/backend/src/modules/gamification | `apps/backend/src/modules/gamification/gamification.module.ts` | file | 096 | NestJS module |
| apps/backend/src/modules/gamification/application | `apps/backend/src/modules/gamification/application` | dir | 083 | — |
| apps/backend/src/modules/gamification/application/subscribers | `apps/backend/src/modules/gamification/application/subscribers` | dir | 083 | — |
| apps/backend/src/modules/gamification/application/subscribers | `apps/backend/src/modules/gamification/application/subscribers/learning-event.subscriber.ts` | file | 083 | — |
| apps/backend/src/modules/gamification/application/use-cases | `apps/backend/src/modules/gamification/application/use-cases` | dir | 083 | — |
| apps/backend/src/modules/gamification/application/use-cases | `apps/backend/src/modules/gamification/application/use-cases/daily-checkin.use-case.ts` | file | 083 | — |
| apps/backend/src/modules/gamification/application/use-cases | `apps/backend/src/modules/gamification/application/use-cases/evaluate-badges.use-case.ts` | file | 083 | — |
| apps/backend/src/modules/gamification/application/use-cases | `apps/backend/src/modules/gamification/application/use-cases/redeem-reward.use-case.ts` | file | 083 | — |
| apps/backend/src/modules/gamification/domain | `apps/backend/src/modules/gamification/domain` | dir | 083 | — |
| apps/backend/src/modules/gamification/domain/entities | `apps/backend/src/modules/gamification/domain/entities` | dir | 083 | — |
| apps/backend/src/modules/gamification/domain/entities | `apps/backend/src/modules/gamification/domain/entities/badge.entity.ts` | file | 083 | DDD entity |
| apps/backend/src/modules/gamification/domain/entities | `apps/backend/src/modules/gamification/domain/entities/streak.entity.ts` | file | 083 | DDD entity |
| apps/backend/src/modules/gamification/domain/services | `apps/backend/src/modules/gamification/domain/services` | dir | 083 | — |
| apps/backend/src/modules/gamification/domain/services | `apps/backend/src/modules/gamification/domain/services/badge-evaluator.service.ts` | file | 083 | NestJS service |
| apps/backend/src/modules/gamification/domain/services | `apps/backend/src/modules/gamification/domain/services/streak-calculator.service.ts` | file | 083 | NestJS service |
| apps/backend/src/modules/gamification/events | `apps/backend/src/modules/gamification/events` | dir | 096 | — |
| apps/backend/src/modules/gamification/events | `apps/backend/src/modules/gamification/events/study-activity.listener.ts` | file | 096 | — |
| apps/backend/src/modules/gamification/infrastructure | `apps/backend/src/modules/gamification/infrastructure` | dir | 083 | — |
| apps/backend/src/modules/gamification/infrastructure/redis | `apps/backend/src/modules/gamification/infrastructure/redis` | dir | 083 | — |
| apps/backend/src/modules/gamification/infrastructure/redis | `apps/backend/src/modules/gamification/infrastructure/redis/redis-streak-lock.service.ts` | file | 083 | NestJS service |
| apps/backend/src/modules/gamification/infrastructure/repositories | `apps/backend/src/modules/gamification/infrastructure/repositories` | dir | 083 | — |
| apps/backend/src/modules/gamification/infrastructure/repositories | `apps/backend/src/modules/gamification/infrastructure/repositories/prisma-gamification.repository.ts` | file | 083 | — |
| apps/backend/src/modules/gamification/presentation | `apps/backend/src/modules/gamification/presentation` | dir | 083 | — |
| apps/backend/src/modules/gamification/presentation/graphql | `apps/backend/src/modules/gamification/presentation/graphql` | dir | 083 | — |
| apps/backend/src/modules/gamification/presentation/graphql | `apps/backend/src/modules/gamification/presentation/graphql/gamification.resolver.ts` | file | 083 | GraphQL resolver |
| apps/backend/src/modules/gamification/services | `apps/backend/src/modules/gamification/services` | dir | 096 | — |
| apps/backend/src/modules/gamification/services | `apps/backend/src/modules/gamification/services/anti-cheat.guard.ts` | file | 096 | NestJS guard |
| apps/backend/src/modules/gamification/services | `apps/backend/src/modules/gamification/services/point-engine.service.ts` | file | 096 | NestJS service |
| apps/backend/src/modules/gift | `apps/backend/src/modules/gift` | dir | 089 | — |
| apps/backend/src/modules/gift | `apps/backend/src/modules/gift/gift.module.ts` | file | 089 | NestJS module |
| apps/backend/src/modules/gift/api | `apps/backend/src/modules/gift/api` | dir | 089 | — |
| apps/backend/src/modules/gift/api/graphql | `apps/backend/src/modules/gift/api/graphql` | dir | 089 | — |
| apps/backend/src/modules/gift/api/graphql | `apps/backend/src/modules/gift/api/graphql/gift.resolver.ts` | file | 089 | GraphQL resolver |
| apps/backend/src/modules/gift/api/graphql | `apps/backend/src/modules/gift/api/graphql/gift.type.ts` | file | 089 | — |
| apps/backend/src/modules/gift/api/rest | `apps/backend/src/modules/gift/api/rest` | dir | 089 | — |
| apps/backend/src/modules/gift/api/rest | `apps/backend/src/modules/gift/api/rest/gift-claim.controller.ts` | file | 089 | REST controller |
| apps/backend/src/modules/gift/application | `apps/backend/src/modules/gift/application` | dir | 089 | — |
| apps/backend/src/modules/gift/application/services | `apps/backend/src/modules/gift/application/services` | dir | 089 | — |
| apps/backend/src/modules/gift/application/services | `apps/backend/src/modules/gift/application/services/claim-gift.service.ts` | file | 089 | NestJS service |
| apps/backend/src/modules/gift/application/services | `apps/backend/src/modules/gift/application/services/create-gift-order.service.ts` | file | 089 | NestJS service |
| apps/backend/src/modules/gift/application/services | `apps/backend/src/modules/gift/application/services/gift-cron.service.ts` | file | 089 | NestJS service |
| apps/backend/src/modules/gift/application/use-cases | `apps/backend/src/modules/gift/application/use-cases` | dir | 089 | — |
| apps/backend/src/modules/gift/application/use-cases | `apps/backend/src/modules/gift/application/use-cases/generate-flex-card.usecase.ts` | file | 089 | — |
| apps/backend/src/modules/gift/domain | `apps/backend/src/modules/gift/domain` | dir | 089 | — |
| apps/backend/src/modules/gift/domain/entities | `apps/backend/src/modules/gift/domain/entities` | dir | 089 | — |
| apps/backend/src/modules/gift/domain/entities | `apps/backend/src/modules/gift/domain/entities/gift-order.entity.ts` | file | 089 | DDD entity |
| apps/backend/src/modules/gift/domain/events | `apps/backend/src/modules/gift/domain/events` | dir | 089 | — |
| apps/backend/src/modules/gift/domain/events | `apps/backend/src/modules/gift/domain/events/gift-claimed.event.ts` | file | 089 | — |
| apps/backend/src/modules/gift/domain/events | `apps/backend/src/modules/gift/domain/events/gift-created.event.ts` | file | 089 | — |
| apps/backend/src/modules/gift/domain/events | `apps/backend/src/modules/gift/domain/events/gift-expired.event.ts` | file | 089 | — |
| apps/backend/src/modules/gift/domain/repository | `apps/backend/src/modules/gift/domain/repository` | dir | 089 | — |
| apps/backend/src/modules/gift/domain/repository | `apps/backend/src/modules/gift/domain/repository/gift.repository.interface.ts` | file | 089 | — |
| apps/backend/src/modules/gift/infrastructure | `apps/backend/src/modules/gift/infrastructure` | dir | 089 | — |
| apps/backend/src/modules/gift/infrastructure/line | `apps/backend/src/modules/gift/infrastructure/line` | dir | 089 | — |
| apps/backend/src/modules/gift/infrastructure/line | `apps/backend/src/modules/gift/infrastructure/line/line-flex-gift.builder.ts` | file | 089 | — |
| apps/backend/src/modules/gift/infrastructure/persistence | `apps/backend/src/modules/gift/infrastructure/persistence` | dir | 089 | — |
| apps/backend/src/modules/gift/infrastructure/persistence | `apps/backend/src/modules/gift/infrastructure/persistence/prisma-gift.repository.ts` | file | 089 | — |
| apps/backend/src/modules/group-buying | `apps/backend/src/modules/group-buying` | dir | 090 | — |
| apps/backend/src/modules/group-buying | `apps/backend/src/modules/group-buying/group-buying.module.ts` | file | 090 | NestJS module |
| apps/backend/src/modules/group-buying/controllers | `apps/backend/src/modules/group-buying/controllers` | dir | 090 | — |
| apps/backend/src/modules/group-buying/controllers | `apps/backend/src/modules/group-buying/controllers/group-buying.controller.ts` | file | 090 | REST controller |
| apps/backend/src/modules/group-buying/dto | `apps/backend/src/modules/group-buying/dto` | dir | 090 | — |
| apps/backend/src/modules/group-buying/dto | `apps/backend/src/modules/group-buying/dto/group-buying.dto.ts` | file | 090 | DTO |
| apps/backend/src/modules/group-buying/resolvers | `apps/backend/src/modules/group-buying/resolvers` | dir | 090 | — |
| apps/backend/src/modules/group-buying/resolvers | `apps/backend/src/modules/group-buying/resolvers/group-buying.resolver.ts` | file | 090 | GraphQL resolver |
| apps/backend/src/modules/group-buying/services | `apps/backend/src/modules/group-buying/services` | dir | 090 | — |
| apps/backend/src/modules/group-buying/services | `apps/backend/src/modules/group-buying/services/group-buying.service.ts` | file | 090 | NestJS service |
| apps/backend/src/modules/group-buying/services | `apps/backend/src/modules/group-buying/services/group-expiry-queue.processor.ts` | file | 090 | NestJS service |
| apps/backend/src/modules/header | `apps/backend/src/modules/header` | dir | 023 | — |
| apps/backend/src/modules/header | `apps/backend/src/modules/header/header.module.ts` | file | 023 | NestJS module |
| apps/backend/src/modules/header | `apps/backend/src/modules/header/header.resolver.ts` | file | 023 | GraphQL resolver |
| apps/backend/src/modules/header | `apps/backend/src/modules/header/header.service.ts` | file | 023 | NestJS service |
| apps/backend/src/modules/header/dto | `apps/backend/src/modules/header/dto` | dir | 023 | — |
| apps/backend/src/modules/header/dto | `apps/backend/src/modules/header/dto/header-input.dto.ts` | file | 023 | DTO |
| apps/backend/src/modules/health | `apps/backend/src/modules/health` | dir | 001, 130 | — |
| apps/backend/src/modules/health | `apps/backend/src/modules/health/health.controller.ts` | file | 001 | REST controller |
| apps/backend/src/modules/health | `apps/backend/src/modules/health/health.module.ts` | file | 001 | NestJS module |
| apps/backend/src/modules/health | `apps/backend/src/modules/health/health.service.ts` | file | 001 | NestJS service |
| apps/backend/src/modules/identity | `apps/backend/src/modules/identity` | dir | 003 | — |
| apps/backend/src/modules/identity/application | `apps/backend/src/modules/identity/application` | dir | 003 | — |
| apps/backend/src/modules/identity/application | `apps/backend/src/modules/identity/application/identity.service.ts` | file | 003 | NestJS service |
| apps/backend/src/modules/identity/application | `apps/backend/src/modules/identity/application/kyc.service.ts` | file | 003 | NestJS service |
| apps/backend/src/modules/identity/application/kyc.service | `apps/backend/src/modules/identity/application/kyc.service` | dir | 003 | — |
| apps/backend/src/modules/identity/domain | `apps/backend/src/modules/identity/domain` | dir | 003 | — |
| apps/backend/src/modules/identity/domain/entities | `apps/backend/src/modules/identity/domain/entities` | dir | 003 | — |
| apps/backend/src/modules/identity/domain/entities | `apps/backend/src/modules/identity/domain/entities/user.entity.ts` | file | 003 | DDD entity |
| apps/backend/src/modules/identity/domain/value-objects | `apps/backend/src/modules/identity/domain/value-objects` | dir | 003 | — |
| apps/backend/src/modules/identity/domain/value-objects | `apps/backend/src/modules/identity/domain/value-objects/encrypted-id-card.vo.ts` | file | 003 | — |
| apps/backend/src/modules/identity/domain/value-objects | `apps/backend/src/modules/identity/domain/value-objects/thai-phone.vo.ts` | file | 003 | — |
| apps/backend/src/modules/identity/infrastructure | `apps/backend/src/modules/identity/infrastructure` | dir | 003 | — |
| apps/backend/src/modules/identity/infrastructure/encryption | `apps/backend/src/modules/identity/infrastructure/encryption` | dir | 003 | — |
| apps/backend/src/modules/identity/infrastructure/encryption | `apps/backend/src/modules/identity/infrastructure/encryption/crypto.service.ts` | file | 003 | NestJS service |
| apps/backend/src/modules/identity/infrastructure/repositories | `apps/backend/src/modules/identity/infrastructure/repositories` | dir | 003 | — |
| apps/backend/src/modules/identity/infrastructure/repositories | `apps/backend/src/modules/identity/infrastructure/repositories/user.repository.ts` | file | 003 | — |
| apps/backend/src/modules/identity/presentation | `apps/backend/src/modules/identity/presentation` | dir | 003 | — |
| apps/backend/src/modules/identity/presentation/controllers | `apps/backend/src/modules/identity/presentation/controllers` | dir | 003 | — |
| apps/backend/src/modules/identity/presentation/controllers | `apps/backend/src/modules/identity/presentation/controllers/kyc.controller.ts` | file | 003 | REST controller |
| apps/backend/src/modules/identity/presentation/resolvers | `apps/backend/src/modules/identity/presentation/resolvers` | dir | 003 | — |
| apps/backend/src/modules/identity/presentation/resolvers | `apps/backend/src/modules/identity/presentation/resolvers/identity.resolver.ts` | file | 003 | GraphQL resolver |
| apps/backend/src/modules/infra | `apps/backend/src/modules/infra/connection-pool.module.ts` | file | 125 | NestJS module |
| apps/backend/src/modules/inventory | `apps/backend/src/modules/inventory` | dir | 075 | — |
| apps/backend/src/modules/inventory/application | `apps/backend/src/modules/inventory/application` | dir | 075 | — |
| apps/backend/src/modules/inventory/application | `apps/backend/src/modules/inventory/application/batch-stock-update.usecase.ts` | file | 075 | — |
| apps/backend/src/modules/inventory/application | `apps/backend/src/modules/inventory/application/inventory-lock.service.ts` | file | 075 | NestJS service |
| apps/backend/src/modules/inventory/application | `apps/backend/src/modules/inventory/application/thermal-label.service.ts` | file | 075 | NestJS service |
| apps/backend/src/modules/inventory/domain | `apps/backend/src/modules/inventory/domain` | dir | 075 | — |
| apps/backend/src/modules/inventory/domain | `apps/backend/src/modules/inventory/domain/inventory-adjustment.entity.ts` | file | 075 | DDD entity |
| apps/backend/src/modules/inventory/domain | `apps/backend/src/modules/inventory/domain/warehouse-stock.repository.ts` | file | 075 | — |
| apps/backend/src/modules/inventory/infrastructure | `apps/backend/src/modules/inventory/infrastructure` | dir | 075 | — |
| apps/backend/src/modules/inventory/infrastructure | `apps/backend/src/modules/inventory/infrastructure/prisma-inventory.repository.ts` | file | 075 | — |
| apps/backend/src/modules/inventory/infrastructure | `apps/backend/src/modules/inventory/infrastructure/redis-lock.adapter.ts` | file | 075 | — |
| apps/backend/src/modules/inventory/presentation | `apps/backend/src/modules/inventory/presentation` | dir | 075 | — |
| apps/backend/src/modules/inventory/presentation | `apps/backend/src/modules/inventory/presentation/inventory.controller.ts` | file | 075 | REST controller |
| apps/backend/src/modules/inventory/presentation | `apps/backend/src/modules/inventory/presentation/inventory.resolver.ts` | file | 075 | GraphQL resolver |
| apps/backend/src/modules/keep-alive | `apps/backend/src/modules/keep-alive` | dir | 031 | — |
| apps/backend/src/modules/keep-alive | `apps/backend/src/modules/keep-alive/keep-alive.module.ts` | file | 031 | NestJS module |
| apps/backend/src/modules/keep-alive | `apps/backend/src/modules/keep-alive/keep-alive.service.ts` | file | 031 | NestJS service |
| apps/backend/src/modules/keep-alive/application | `apps/backend/src/modules/keep-alive/application` | dir | 031 | — |
| apps/backend/src/modules/keep-alive/application | `apps/backend/src/modules/keep-alive/application/sync-state.usecase.ts` | file | 031 | — |
| apps/backend/src/modules/keep-alive/domain | `apps/backend/src/modules/keep-alive/domain` | dir | 031 | — |
| apps/backend/src/modules/keep-alive/domain | `apps/backend/src/modules/keep-alive/domain/keep-alive.entity.ts` | file | 031 | DDD entity |
| apps/backend/src/modules/kyc | `apps/backend/src/modules/kyc` | dir | 003, 085, 111 | — |
| apps/backend/src/modules/kyc | `apps/backend/src/modules/kyc/kyc.module.ts` | file | 085, 111 | NestJS module |
| apps/backend/src/modules/kyc/adapters | `apps/backend/src/modules/kyc/adapters` | dir | 085 | — |
| apps/backend/src/modules/kyc/adapters | `apps/backend/src/modules/kyc/adapters/dopa-laser.adapter.ts` | file | 085 | — |
| apps/backend/src/modules/kyc/adapters | `apps/backend/src/modules/kyc/adapters/ocr-engine.adapter.ts` | file | 085 | — |
| apps/backend/src/modules/kyc/controllers | `apps/backend/src/modules/kyc/controllers` | dir | 085, 111 | — |
| apps/backend/src/modules/kyc/controllers | `apps/backend/src/modules/kyc/controllers/kyc-admin.controller.ts` | file | 085, 111 | REST controller |
| apps/backend/src/modules/kyc/controllers | `apps/backend/src/modules/kyc/controllers/kyc-submission.controller.ts` | file | 111 | REST controller |
| apps/backend/src/modules/kyc/domain | `apps/backend/src/modules/kyc/domain` | dir | 111 | — |
| apps/backend/src/modules/kyc/domain | `apps/backend/src/modules/kyc/domain/kyc-verification.aggregate.ts` | file | 111 | — |
| apps/backend/src/modules/kyc/domain/events | `apps/backend/src/modules/kyc/domain/events` | dir | 111 | — |
| apps/backend/src/modules/kyc/domain/events | `apps/backend/src/modules/kyc/domain/events/kyc-approved.event.ts` | file | 111 | — |
| apps/backend/src/modules/kyc/domain/events | `apps/backend/src/modules/kyc/domain/events/kyc-submitted.event.ts` | file | 111 | — |
| apps/backend/src/modules/kyc/dto | `apps/backend/src/modules/kyc/dto` | dir | 085 | — |
| apps/backend/src/modules/kyc/dto | `apps/backend/src/modules/kyc/dto/kyc-submission.dto.ts` | file | 085 | DTO |
| apps/backend/src/modules/kyc/infra | `apps/backend/src/modules/kyc/infra` | dir | 111 | — |
| apps/backend/src/modules/kyc/infra | `apps/backend/src/modules/kyc/infra/ocr-vision.adapter.ts` | file | 111 | — |
| apps/backend/src/modules/kyc/infra | `apps/backend/src/modules/kyc/infra/r2-private-vault.client.ts` | file | 111 | — |
| apps/backend/src/modules/kyc/resolvers | `apps/backend/src/modules/kyc/resolvers` | dir | 085, 111 | — |
| apps/backend/src/modules/kyc/resolvers | `apps/backend/src/modules/kyc/resolvers/kyc.resolver.ts` | file | 085, 111 | GraphQL resolver |
| apps/backend/src/modules/kyc/services | `apps/backend/src/modules/kyc/services` | dir | 085, 111 | — |
| apps/backend/src/modules/kyc/services | `apps/backend/src/modules/kyc/services/bank-validation.service.ts` | file | 085 | NestJS service |
| apps/backend/src/modules/kyc/services | `apps/backend/src/modules/kyc/services/kyc-encryption.service.ts` | file | 085 | NestJS service |
| apps/backend/src/modules/kyc/services | `apps/backend/src/modules/kyc/services/kyc-notification.service.ts` | file | 111 | NestJS service |
| apps/backend/src/modules/kyc/services | `apps/backend/src/modules/kyc/services/kyc-ocr.service.ts` | file | 111 | NestJS service |
| apps/backend/src/modules/kyc/services | `apps/backend/src/modules/kyc/services/kyc-queue.service.ts` | file | 111 | NestJS service |
| apps/backend/src/modules/kyc/services | `apps/backend/src/modules/kyc/services/kyc-verification.service.ts` | file | 085 | NestJS service |
| apps/backend/src/modules/kyc/services | `apps/backend/src/modules/kyc/services/pii-crypto.service.ts` | file | 111 | NestJS service |
| apps/backend/src/modules/leaderboard | `apps/backend/src/modules/leaderboard` | dir | 096 | — |
| apps/backend/src/modules/leaderboard | `apps/backend/src/modules/leaderboard/leaderboard.module.ts` | file | 096 | NestJS module |
| apps/backend/src/modules/leaderboard | `apps/backend/src/modules/leaderboard/leaderboard.resolver.ts` | file | 096 | GraphQL resolver |
| apps/backend/src/modules/leaderboard/services | `apps/backend/src/modules/leaderboard/services` | dir | 096 | — |
| apps/backend/src/modules/leaderboard/services | `apps/backend/src/modules/leaderboard/services/redis-leaderboard.service.ts` | file | 096 | NestJS service |
| apps/backend/src/modules/learning | `apps/backend/src/modules/learning` | dir | 048 | — |
| apps/backend/src/modules/library | `apps/backend/src/modules/library` | dir | 018 | — |
| apps/backend/src/modules/library | `apps/backend/src/modules/library/library.module.ts` | file | 018 | NestJS module |
| apps/backend/src/modules/library/ | `apps/backend/src/modules/library/` | dir | 018 | — |
| apps/backend/src/modules/library/controllers | `apps/backend/src/modules/library/controllers` | dir | 018 | — |
| apps/backend/src/modules/library/controllers | `apps/backend/src/modules/library/controllers/library.controller.ts` | file | 018 | REST controller |
| apps/backend/src/modules/library/repositories | `apps/backend/src/modules/library/repositories` | dir | 018 | — |
| apps/backend/src/modules/library/repositories | `apps/backend/src/modules/library/repositories/library-cache.repository.ts` | file | 018 | — |
| apps/backend/src/modules/library/resolvers | `apps/backend/src/modules/library/resolvers` | dir | 018 | — |
| apps/backend/src/modules/library/resolvers | `apps/backend/src/modules/library/resolvers/library.resolver.ts` | file | 018 | GraphQL resolver |
| apps/backend/src/modules/library/services | `apps/backend/src/modules/library/services` | dir | 018 | — |
| apps/backend/src/modules/library/services | `apps/backend/src/modules/library/services/asset-formatter.service.ts` | file | 018 | NestJS service |
| apps/backend/src/modules/library/services | `apps/backend/src/modules/library/services/library.service.ts` | file | 018 | NestJS service |
| apps/backend/src/modules/line-compliance | `apps/backend/src/modules/line-compliance` | dir | 129 | — |
| apps/backend/src/modules/line-compliance | `apps/backend/src/modules/line-compliance/line-compliance.service.ts` | file | 129 | NestJS service |
| apps/backend/src/modules/line-compliance | `apps/backend/src/modules/line-compliance/line-webhook.controller.ts` | file | 129 | REST webhook |
| apps/backend/src/modules/line-compliance/ | `apps/backend/src/modules/line-compliance/` | dir | 129 | — |
| apps/backend/src/modules/line-notification | `apps/backend/src/modules/line-notification` | dir | 077 | — |
| apps/backend/src/modules/line-oa | `apps/backend/src/modules/line-oa` | dir | 034 | — |
| apps/backend/src/modules/line-oa | `apps/backend/src/modules/line-oa/line-oa.module.ts` | file | 034 | NestJS module |
| apps/backend/src/modules/line-oa | `apps/backend/src/modules/line-oa/line-oa.resolver.ts` | file | 034 | GraphQL resolver |
| apps/backend/src/modules/line-oa | `apps/backend/src/modules/line-oa/line-oa.service.ts` | file | 034 | NestJS service |
| apps/backend/src/modules/line-sandbox | `apps/backend/src/modules/line-sandbox` | dir | 035 | — |
| apps/backend/src/modules/line-sandbox/checkers | `apps/backend/src/modules/line-sandbox/checkers` | dir | 035 | — |
| apps/backend/src/modules/line-sandbox/checkers | `apps/backend/src/modules/line-sandbox/checkers/auth-security.checker.ts` | file | 035 | — |
| apps/backend/src/modules/line-sandbox/checkers | `apps/backend/src/modules/line-sandbox/checkers/memory-performance.checker.ts` | file | 035 | — |
| apps/backend/src/modules/line-sandbox/checkers | `apps/backend/src/modules/line-sandbox/checkers/payment-policy.checker.ts` | file | 035 | — |
| apps/backend/src/modules/line-sandbox/controllers | `apps/backend/src/modules/line-sandbox/controllers` | dir | 035 | — |
| apps/backend/src/modules/line-sandbox/controllers | `apps/backend/src/modules/line-sandbox/controllers/line-sandbox-audit.controller.ts` | file | 035 | REST controller |
| apps/backend/src/modules/line-sandbox/dto | `apps/backend/src/modules/line-sandbox/dto` | dir | 035 | — |
| apps/backend/src/modules/line-sandbox/dto | `apps/backend/src/modules/line-sandbox/dto/line-sandbox-audit.dto.ts` | file | 035 | DTO |
| apps/backend/src/modules/line-sandbox/services | `apps/backend/src/modules/line-sandbox/services` | dir | 035 | — |
| apps/backend/src/modules/line-sandbox/services | `apps/backend/src/modules/line-sandbox/services/line-review-verifier.service.ts` | file | 035 | NestJS service |
| apps/backend/src/modules/line-sandbox/services | `apps/backend/src/modules/line-sandbox/services/line-sandbox-runner.service.ts` | file | 035 | NestJS service |
| apps/backend/src/modules/line-service-message | `apps/backend/src/modules/line-service-message` | dir | 024 | — |
| apps/backend/src/modules/line-service-message/application | `apps/backend/src/modules/line-service-message/application` | dir | 024 | — |
| apps/backend/src/modules/line-service-message/application | `apps/backend/src/modules/line-service-message/application/flex-builder.service.ts` | file | 024 | NestJS service |
| apps/backend/src/modules/line-service-message/application | `apps/backend/src/modules/line-service-message/application/line-service-message.service.ts` | file | 024 | NestJS service |
| apps/backend/src/modules/line-service-message/domain | `apps/backend/src/modules/line-service-message/domain` | dir | 024 | — |
| apps/backend/src/modules/line-service-message/domain/events | `apps/backend/src/modules/line-service-message/domain/events` | dir | 024 | — |
| apps/backend/src/modules/line-service-message/domain/events | `apps/backend/src/modules/line-service-message/domain/events/notification-dispatched.event.ts` | file | 024 | — |
| apps/backend/src/modules/line-service-message/domain/value-objects | `apps/backend/src/modules/line-service-message/domain/value-objects` | dir | 024 | — |
| apps/backend/src/modules/line-service-message/domain/value-objects | `apps/backend/src/modules/line-service-message/domain/value-objects/flex-container.vo.ts` | file | 024 | — |
| apps/backend/src/modules/line-service-message/infrastructure | `apps/backend/src/modules/line-service-message/infrastructure` | dir | 024 | — |
| apps/backend/src/modules/line-service-message/infrastructure | `apps/backend/src/modules/line-service-message/infrastructure/line-api.client.ts` | file | 024 | — |
| apps/backend/src/modules/line-service-message/infrastructure/processors | `apps/backend/src/modules/line-service-message/infrastructure/processors` | dir | 024 | — |
| apps/backend/src/modules/line-service-message/infrastructure/processors | `apps/backend/src/modules/line-service-message/infrastructure/processors/message-dispatcher.processor.ts` | file | 024 | — |
| apps/backend/src/modules/line-service-message/webhooks | `apps/backend/src/modules/line-service-message/webhooks` | dir | 024 | REST webhook |
| apps/backend/src/modules/line-service-message/webhooks | `apps/backend/src/modules/line-service-message/webhooks/line-delivery-status.controller.ts` | file | 024 | REST webhook |
| apps/backend/src/modules/line/services | `apps/backend/src/modules/line/services/line-messaging.service.ts` | file | 122 | NestJS service |
| apps/backend/src/modules/live | `apps/backend/src/modules/live` | dir | 099, 101 | — |
| apps/backend/src/modules/live | `apps/backend/src/modules/live/live.module.ts` | file | 099 | NestJS module |
| apps/backend/src/modules/live/application | `apps/backend/src/modules/live/application` | dir | 099 | — |
| apps/backend/src/modules/live/application/dtos | `apps/backend/src/modules/live/application/dtos` | dir | 099 | — |
| apps/backend/src/modules/live/application/dtos | `apps/backend/src/modules/live/application/dtos/create-live-session.dto.ts` | file | 099 | DTO |
| apps/backend/src/modules/live/application/dtos | `apps/backend/src/modules/live/application/dtos/join-live-stream.dto.ts` | file | 099 | DTO |
| apps/backend/src/modules/live/application/use-cases | `apps/backend/src/modules/live/application/use-cases` | dir | 099 | — |
| apps/backend/src/modules/live/application/use-cases | `apps/backend/src/modules/live/application/use-cases/convert-live-to-vod.usecase.ts` | file | 099 | — |
| apps/backend/src/modules/live/application/use-cases | `apps/backend/src/modules/live/application/use-cases/handle-webrtc-signaling.usecase.ts` | file | 099 | — |
| apps/backend/src/modules/live/application/use-cases | `apps/backend/src/modules/live/application/use-cases/mint-ivs-token.usecase.ts` | file | 099 | — |
| apps/backend/src/modules/live/domain | `apps/backend/src/modules/live/domain` | dir | 099, 101 | — |
| apps/backend/src/modules/live/domain/entities | `apps/backend/src/modules/live/domain/entities` | dir | 099 | — |
| apps/backend/src/modules/live/domain/entities | `apps/backend/src/modules/live/domain/entities/live-session.entity.ts` | file | 099 | DDD entity |
| apps/backend/src/modules/live/domain/services | `apps/backend/src/modules/live/domain/services` | dir | 099 | — |
| apps/backend/src/modules/live/domain/services | `apps/backend/src/modules/live/domain/services/entitlement-checker.service.ts` | file | 099 | NestJS service |
| apps/backend/src/modules/live/infrastructure | `apps/backend/src/modules/live/infrastructure` | dir | 099 | — |
| apps/backend/src/modules/live/infrastructure/adapters | `apps/backend/src/modules/live/infrastructure/adapters` | dir | 099 | — |
| apps/backend/src/modules/live/infrastructure/adapters | `apps/backend/src/modules/live/infrastructure/adapters/amazon-ivs.adapter.ts` | file | 099 | — |
| apps/backend/src/modules/live/infrastructure/adapters | `apps/backend/src/modules/live/infrastructure/adapters/cloudflare-r2-vod.adapter.ts` | file | 099 | — |
| apps/backend/src/modules/live/infrastructure/websocket | `apps/backend/src/modules/live/infrastructure/websocket` | dir | 099 | — |
| apps/backend/src/modules/live/infrastructure/websocket | `apps/backend/src/modules/live/infrastructure/websocket/live-chat.gateway.ts` | file | 099 | — |
| apps/backend/src/modules/live/repositories | `apps/backend/src/modules/live/repositories` | dir | 101 | — |
| apps/backend/src/modules/live/services | `apps/backend/src/modules/live/services` | dir | 101 | — |
| apps/backend/src/modules/logistics | `apps/backend/src/modules/logistics` | dir | 076, 077 | — |
| apps/backend/src/modules/logistics | `apps/backend/src/modules/logistics/logistics.module.ts` | file | 077 | NestJS module |
| apps/backend/src/modules/logistics/adapters | `apps/backend/src/modules/logistics/adapters` | dir | 077 | — |
| apps/backend/src/modules/logistics/adapters | `apps/backend/src/modules/logistics/adapters/carrier.interface.ts` | file | 077 | — |
| apps/backend/src/modules/logistics/adapters | `apps/backend/src/modules/logistics/adapters/flash-express.adapter.ts` | file | 077 | — |
| apps/backend/src/modules/logistics/adapters | `apps/backend/src/modules/logistics/adapters/kerry-express.adapter.ts` | file | 077 | — |
| apps/backend/src/modules/logistics/adapters | `apps/backend/src/modules/logistics/adapters/thailand-post.adapter.ts` | file | 077 | — |
| apps/backend/src/modules/logistics/services | `apps/backend/src/modules/logistics/services` | dir | 077 | — |
| apps/backend/src/modules/logistics/services | `apps/backend/src/modules/logistics/services/carrier-factory.service.ts` | file | 077 | NestJS service |
| apps/backend/src/modules/logistics/services | `apps/backend/src/modules/logistics/services/line-notification.service.ts` | file | 077 | NestJS service |
| apps/backend/src/modules/logistics/services | `apps/backend/src/modules/logistics/services/logistics.service.ts` | file | 077 | NestJS service |
| apps/backend/src/modules/merchant | `apps/backend/src/modules/merchant` | dir | 073 | — |
| apps/backend/src/modules/merchant | `apps/backend/src/modules/merchant/merchant.module.ts` | file | 073 | NestJS module |
| apps/backend/src/modules/merchant/application | `apps/backend/src/modules/merchant/application` | dir | 073 | — |
| apps/backend/src/modules/merchant/application/dtos | `apps/backend/src/modules/merchant/application/dtos` | dir | 073 | — |
| apps/backend/src/modules/merchant/application/use-cases | `apps/backend/src/modules/merchant/application/use-cases` | dir | 073 | — |
| apps/backend/src/modules/merchant/application/use-cases | `apps/backend/src/modules/merchant/application/use-cases/create-product-studio.usecase.ts` | file | 073 | — |
| apps/backend/src/modules/merchant/application/use-cases | `apps/backend/src/modules/merchant/application/use-cases/generate-shipping-label.usecase.ts` | file | 073 | — |
| apps/backend/src/modules/merchant/application/use-cases | `apps/backend/src/modules/merchant/application/use-cases/process-payout-request.usecase.ts` | file | 073 | — |
| apps/backend/src/modules/merchant/domain | `apps/backend/src/modules/merchant/domain` | dir | 073 | — |
| apps/backend/src/modules/merchant/domain/entities | `apps/backend/src/modules/merchant/domain/entities` | dir | 073 | — |
| apps/backend/src/modules/merchant/domain/entities | `apps/backend/src/modules/merchant/domain/entities/course-studio.entity.ts` | file | 073 | DDD entity |
| apps/backend/src/modules/merchant/domain/entities | `apps/backend/src/modules/merchant/domain/entities/merchant-account.entity.ts` | file | 073 | DDD entity |
| apps/backend/src/modules/merchant/domain/services | `apps/backend/src/modules/merchant/domain/services` | dir | 073 | — |
| apps/backend/src/modules/merchant/domain/services | `apps/backend/src/modules/merchant/domain/services/tax-calculator.domain-service.ts` | file | 073 | NestJS service |
| apps/backend/src/modules/merchant/infrastructure | `apps/backend/src/modules/merchant/infrastructure` | dir | 073 | — |
| apps/backend/src/modules/merchant/infrastructure/controllers | `apps/backend/src/modules/merchant/infrastructure/controllers` | dir | 073 | — |
| apps/backend/src/modules/merchant/infrastructure/controllers | `apps/backend/src/modules/merchant/infrastructure/controllers/merchant-payout.controller.ts` | file | 073 | REST controller |
| apps/backend/src/modules/merchant/infrastructure/controllers | `apps/backend/src/modules/merchant/infrastructure/controllers/merchant-studio.controller.ts` | file | 073 | REST controller |
| apps/backend/src/modules/merchant/infrastructure/graphql | `apps/backend/src/modules/merchant/infrastructure/graphql` | dir | 073 | — |
| apps/backend/src/modules/merchant/infrastructure/graphql/resolvers | `apps/backend/src/modules/merchant/infrastructure/graphql/resolvers` | dir | 073 | — |
| apps/backend/src/modules/merchant/infrastructure/graphql/resolvers | `apps/backend/src/modules/merchant/infrastructure/graphql/resolvers/merchant-studio.resolver.ts` | file | 073 | GraphQL resolver |
| apps/backend/src/modules/merchant/infrastructure/graphql/type-defs | `apps/backend/src/modules/merchant/infrastructure/graphql/type-defs` | dir | 073 | — |
| apps/backend/src/modules/merchant/infrastructure/repositories | `apps/backend/src/modules/merchant/infrastructure/repositories` | dir | 073 | — |
| apps/backend/src/modules/merchant/infrastructure/repositories | `apps/backend/src/modules/merchant/infrastructure/repositories/prisma-merchant.repository.ts` | file | 073 | — |
| apps/backend/src/modules/messaging | `apps/backend/src/modules/messaging` | dir | 084 | — |
| apps/backend/src/modules/messaging | `apps/backend/src/modules/messaging/messaging.module.ts` | file | 084 | NestJS module |
| apps/backend/src/modules/messaging/controllers | `apps/backend/src/modules/messaging/controllers` | dir | 084 | — |
| apps/backend/src/modules/messaging/controllers | `apps/backend/src/modules/messaging/controllers/abandoned-cart.controller.ts` | file | 084 | REST controller |
| apps/backend/src/modules/messaging/dto | `apps/backend/src/modules/messaging/dto` | dir | 084 | — |
| apps/backend/src/modules/messaging/dto | `apps/backend/src/modules/messaging/dto/abandoned-cart.dto.ts` | file | 084 | DTO |
| apps/backend/src/modules/messaging/queues | `apps/backend/src/modules/messaging/queues` | dir | 084 | — |
| apps/backend/src/modules/messaging/queues | `apps/backend/src/modules/messaging/queues/abandoned-cart.processor.ts` | file | 084 | — |
| apps/backend/src/modules/messaging/queues | `apps/backend/src/modules/messaging/queues/abandoned-cart.queue.ts` | file | 084 | — |
| apps/backend/src/modules/messaging/services | `apps/backend/src/modules/messaging/services` | dir | 084 | — |
| apps/backend/src/modules/messaging/services | `apps/backend/src/modules/messaging/services/abandoned-cart.service.ts` | file | 084 | NestJS service |
| apps/backend/src/modules/messaging/services | `apps/backend/src/modules/messaging/services/coupon-issuer.service.ts` | file | 084 | NestJS service |
| apps/backend/src/modules/messaging/services | `apps/backend/src/modules/messaging/services/line-flex-builder.service.ts` | file | 084 | NestJS service |
| apps/backend/src/modules/moderation | `apps/backend/src/modules/moderation` | dir | 112 | — |
| apps/backend/src/modules/moderation | `apps/backend/src/modules/moderation/moderation.module.ts` | file | 112 | NestJS module |
| apps/backend/src/modules/moderation/controllers | `apps/backend/src/modules/moderation/controllers` | dir | 112 | — |
| apps/backend/src/modules/moderation/controllers | `apps/backend/src/modules/moderation/controllers/creator-appeal.controller.ts` | file | 112 | REST controller |
| apps/backend/src/modules/moderation/controllers | `apps/backend/src/modules/moderation/controllers/moderation-webhook.controller.ts` | file | 112 | REST webhook |
| apps/backend/src/modules/moderation/dto | `apps/backend/src/modules/moderation/dto` | dir | 112 | — |
| apps/backend/src/modules/moderation/dto | `apps/backend/src/modules/moderation/dto/appeal-submission.dto.ts` | file | 112 | DTO |
| apps/backend/src/modules/moderation/dto | `apps/backend/src/modules/moderation/dto/moderation-request.dto.ts` | file | 112 | DTO |
| apps/backend/src/modules/moderation/queues | `apps/backend/src/modules/moderation/queues` | dir | 112 | — |
| apps/backend/src/modules/moderation/queues | `apps/backend/src/modules/moderation/queues/moderation.processor.ts` | file | 112 | — |
| apps/backend/src/modules/moderation/services | `apps/backend/src/modules/moderation/services` | dir | 112 | — |
| apps/backend/src/modules/moderation/services | `apps/backend/src/modules/moderation/services/appeal-manager.service.ts` | file | 112 | NestJS service |
| apps/backend/src/modules/moderation/services | `apps/backend/src/modules/moderation/services/copyright-scanner.service.ts` | file | 112 | NestJS service |
| apps/backend/src/modules/moderation/services | `apps/backend/src/modules/moderation/services/moderation-engine.service.ts` | file | 112 | NestJS service |
| apps/backend/src/modules/moderation/services | `apps/backend/src/modules/moderation/services/nsfw-detector.service.ts` | file | 112 | NestJS service |
| apps/backend/src/modules/navigation | `apps/backend/src/modules/navigation` | dir | 027 | — |
| apps/backend/src/modules/navigation | `apps/backend/src/modules/navigation/navigation.controller.ts` | file | 027 | REST controller |
| apps/backend/src/modules/navigation | `apps/backend/src/modules/navigation/navigation.module.ts` | file | 027 | NestJS module |
| apps/backend/src/modules/navigation | `apps/backend/src/modules/navigation/navigation.service.ts` | file | 027 | NestJS service |
| apps/backend/src/modules/navigation/dto | `apps/backend/src/modules/navigation/dto` | dir | 027 | — |
| apps/backend/src/modules/navigation/dto | `apps/backend/src/modules/navigation/dto/navigation-response.dto.ts` | file | 027 | DTO |
| apps/backend/src/modules/navigation/dto | `apps/backend/src/modules/navigation/dto/sync-navigation.dto.ts` | file | 027 | DTO |
| apps/backend/src/modules/navigation/guards | `apps/backend/src/modules/navigation/guards` | dir | 027 | — |
| apps/backend/src/modules/navigation/guards | `apps/backend/src/modules/navigation/guards/liff-session.guard.ts` | file | 027 | NestJS guard |
| apps/backend/src/modules/network | `apps/backend/src/modules/network` | dir | 069 | — |
| apps/backend/src/modules/network | `apps/backend/src/modules/network/network-health.controller.ts` | file | 069 | REST controller |
| apps/backend/src/modules/network | `apps/backend/src/modules/network/network-health.module.ts` | file | 069 | NestJS module |
| apps/backend/src/modules/network | `apps/backend/src/modules/network/network-health.resolver.ts` | file | 069 | GraphQL resolver |
| apps/backend/src/modules/network | `apps/backend/src/modules/network/network-health.service.ts` | file | 069 | NestJS service |
| apps/backend/src/modules/network/services | `apps/backend/src/modules/network/services` | dir | 069 | — |
| apps/backend/src/modules/network/services | `apps/backend/src/modules/network/services/offline-sync.service.ts` | file | 069 | NestJS service |
| apps/backend/src/modules/note | `apps/backend/src/modules/note` | dir | 065 | — |
| apps/backend/src/modules/note | `apps/backend/src/modules/note/note.module.ts` | file | 065 | NestJS module |
| apps/backend/src/modules/note/controllers | `apps/backend/src/modules/note/controllers` | dir | 065 | — |
| apps/backend/src/modules/note/controllers | `apps/backend/src/modules/note/controllers/note-export.controller.ts` | file | 065 | REST controller |
| apps/backend/src/modules/note/dto | `apps/backend/src/modules/note/dto` | dir | 065 | — |
| apps/backend/src/modules/note/dto | `apps/backend/src/modules/note/dto/create-note.dto.ts` | file | 065 | DTO |
| apps/backend/src/modules/note/dto | `apps/backend/src/modules/note/dto/update-note.dto.ts` | file | 065 | DTO |
| apps/backend/src/modules/note/resolvers | `apps/backend/src/modules/note/resolvers` | dir | 065 | — |
| apps/backend/src/modules/note/resolvers | `apps/backend/src/modules/note/resolvers/note.resolver.ts` | file | 065 | GraphQL resolver |
| apps/backend/src/modules/note/services | `apps/backend/src/modules/note/services` | dir | 065 | — |
| apps/backend/src/modules/note/services | `apps/backend/src/modules/note/services/note-ai-summarizer.service.ts` | file | 065 | NestJS service |
| apps/backend/src/modules/note/services | `apps/backend/src/modules/note/services/note-pdf-exporter.service.ts` | file | 065 | NestJS service |
| apps/backend/src/modules/note/services | `apps/backend/src/modules/note/services/note.service.ts` | file | 065 | NestJS service |
| apps/backend/src/modules/notification | `apps/backend/src/modules/notification` | dir | 019, 024 | — |
| apps/backend/src/modules/notification | `apps/backend/src/modules/notification/line-messaging.module.ts` | file | 019 | NestJS module |
| apps/backend/src/modules/notification | `apps/backend/src/modules/notification/line-messaging.service.ts` | file | 019 | NestJS service |
| apps/backend/src/modules/notification/pdf | `apps/backend/src/modules/notification/pdf` | dir | 019 | — |
| apps/backend/src/modules/notification/pdf | `apps/backend/src/modules/notification/pdf/receipt-pdf.generator.ts` | file | 019 | — |
| apps/backend/src/modules/notification/processors | `apps/backend/src/modules/notification/processors` | dir | 019 | — |
| apps/backend/src/modules/notification/processors | `apps/backend/src/modules/notification/processors/receipt-queue.processor.ts` | file | 019 | — |
| apps/backend/src/modules/notification/services | `apps/backend/src/modules/notification/services/line-flex-alert.service.ts` | file | 123 | NestJS service |
| apps/backend/src/modules/notification/templates | `apps/backend/src/modules/notification/templates` | dir | 019 | — |
| apps/backend/src/modules/notification/templates | `apps/backend/src/modules/notification/templates/receipt-flex.template.ts` | file | 019 | — |
| apps/backend/src/modules/notifications | `apps/backend/src/modules/notifications/line-flex-alert.service.ts` | file | 120 | NestJS service |
| apps/backend/src/modules/offline | `apps/backend/src/modules/offline` | dir | 063 | — |
| apps/backend/src/modules/offline | `apps/backend/src/modules/offline/drm-lease.controller.ts` | file | 063 | REST controller |
| apps/backend/src/modules/offline | `apps/backend/src/modules/offline/drm-lease.service.ts` | file | 063 | NestJS service |
| apps/backend/src/modules/offline | `apps/backend/src/modules/offline/offline.module.ts` | file | 063 | NestJS module |
| apps/backend/src/modules/offline-license | `apps/backend/src/modules/offline-license` | dir | 068 | — |
| apps/backend/src/modules/offline-license | `apps/backend/src/modules/offline-license/offline-license.controller.ts` | file | 068 | REST controller |
| apps/backend/src/modules/offline-sync | `apps/backend/src/modules/offline-sync` | dir | 062 | — |
| apps/backend/src/modules/offline-sync | `apps/backend/src/modules/offline-sync/offline-sync.module.ts` | file | 062 | NestJS module |
| apps/backend/src/modules/offline-sync/application | `apps/backend/src/modules/offline-sync/application` | dir | 062 | — |
| apps/backend/src/modules/offline-sync/application/dtos | `apps/backend/src/modules/offline-sync/application/dtos` | dir | 062 | — |
| apps/backend/src/modules/offline-sync/application/dtos | `apps/backend/src/modules/offline-sync/application/dtos/bulk-sync.dto.ts` | file | 062 | DTO |
| apps/backend/src/modules/offline-sync/application/use-cases | `apps/backend/src/modules/offline-sync/application/use-cases` | dir | 062 | — |
| apps/backend/src/modules/offline-sync/application/use-cases | `apps/backend/src/modules/offline-sync/application/use-cases/process-bulk-sync.use-case.ts` | file | 062 | — |
| apps/backend/src/modules/offline-sync/application/use-cases | `apps/backend/src/modules/offline-sync/application/use-cases/validate-offline-queue.use-case.ts` | file | 062 | — |
| apps/backend/src/modules/offline-sync/domain | `apps/backend/src/modules/offline-sync/domain` | dir | 062 | — |
| apps/backend/src/modules/offline-sync/domain/entities | `apps/backend/src/modules/offline-sync/domain/entities` | dir | 062 | — |
| apps/backend/src/modules/offline-sync/domain/entities | `apps/backend/src/modules/offline-sync/domain/entities/sync-item.entity.ts` | file | 062 | DDD entity |
| apps/backend/src/modules/offline-sync/domain/value-objects | `apps/backend/src/modules/offline-sync/domain/value-objects` | dir | 062 | — |
| apps/backend/src/modules/offline-sync/domain/value-objects | `apps/backend/src/modules/offline-sync/domain/value-objects/sync-target.vo.ts` | file | 062 | — |
| apps/backend/src/modules/offline-sync/infrastructure | `apps/backend/src/modules/offline-sync/infrastructure` | dir | 062 | — |
| apps/backend/src/modules/offline-sync/infrastructure/controllers | `apps/backend/src/modules/offline-sync/infrastructure/controllers` | dir | 062 | — |
| apps/backend/src/modules/offline-sync/infrastructure/controllers | `apps/backend/src/modules/offline-sync/infrastructure/controllers/offline-sync.controller.ts` | file | 062 | REST controller |
| apps/backend/src/modules/offline-sync/infrastructure/repositories | `apps/backend/src/modules/offline-sync/infrastructure/repositories` | dir | 062 | — |
| apps/backend/src/modules/offline-sync/infrastructure/repositories | `apps/backend/src/modules/offline-sync/infrastructure/repositories/offline-sync.repository.ts` | file | 062 | — |
| apps/backend/src/modules/offline/controllers | `apps/backend/src/modules/offline/controllers` | dir | 063 | — |
| apps/backend/src/modules/offline/controllers | `apps/backend/src/modules/offline/controllers/drm-lease.controller.ts` | file | 063 | REST controller |
| apps/backend/src/modules/offline/dto | `apps/backend/src/modules/offline/dto` | dir | 063 | — |
| apps/backend/src/modules/offline/dto | `apps/backend/src/modules/offline/dto/issue-lease.dto.ts` | file | 063 | DTO |
| apps/backend/src/modules/offline/dto | `apps/backend/src/modules/offline/dto/offline-sync.dto.ts` | file | 063 | DTO |
| apps/backend/src/modules/offline/services | `apps/backend/src/modules/offline/services` | dir | 063 | — |
| apps/backend/src/modules/offline/services | `apps/backend/src/modules/offline/services/drm-lease.service.ts` | file | 063 | NestJS service |
| apps/backend/src/modules/offline/services | `apps/backend/src/modules/offline/services/offline-sync.service.ts` | file | 063 | NestJS service |
| apps/backend/src/modules/order | `apps/backend/src/modules/order` | dir | 000, 015, 017, 079, 093, 103, 113, 115, 117, 128 | — |
| apps/backend/src/modules/order | `apps/backend/src/modules/order/flash-sale-checkout.service.ts` | file | 087 | NestJS service |
| apps/backend/src/modules/order | `apps/backend/src/modules/order/inventory-lock.service.ts` | file | 075 | NestJS service |
| apps/backend/src/modules/order | `apps/backend/src/modules/order/order.service.ts` | file | 024, 075, 077, 114 | NestJS service |
| apps/backend/src/modules/order/ | `apps/backend/src/modules/order/` | dir | 012, 020 | — |
| apps/backend/src/modules/order/services | `apps/backend/src/modules/order/services` | dir | 015 | — |
| apps/backend/src/modules/order/services | `apps/backend/src/modules/order/services/discount-calculator.service.ts` | file | 088 | NestJS service |
| apps/backend/src/modules/order/services | `apps/backend/src/modules/order/services/order-atomic.service.ts` | file | 015 | NestJS service |
| apps/backend/src/modules/order/services | `apps/backend/src/modules/order/services/order-expiry.service.ts` | file | 013 | NestJS service |
| apps/backend/src/modules/payment | `apps/backend/src/modules/payment` | dir | 000, 013, 014, 015, 016, 017, 083, 085, 086, 089, 090, 093, 097, 107, 115, 117, 124, 126, 128, 130 | — |
| apps/backend/src/modules/payment | `apps/backend/src/modules/payment/easyslip.service.ts` | file | 029 | NestJS service |
| apps/backend/src/modules/payment | `apps/backend/src/modules/payment/payment-slip.controller.ts` | file | 011, 019 | REST controller |
| apps/backend/src/modules/payment | `apps/backend/src/modules/payment/payment-slip.service.ts` | file | 020, 081, 114 | NestJS service |
| apps/backend/src/modules/payment | `apps/backend/src/modules/payment/payment.module.ts` | file | 014, 015, 016 | NestJS module |
| apps/backend/src/modules/payment | `apps/backend/src/modules/payment/payment.service.ts` | file | 113 | NestJS service |
| apps/backend/src/modules/payment | `apps/backend/src/modules/payment/promptpay.module.ts` | file | 013 | NestJS module |
| apps/backend/src/modules/payment | `apps/backend/src/modules/payment/slip-picker.controller.ts` | file | 016 | REST controller |
| apps/backend/src/modules/payment | `apps/backend/src/modules/payment/slip-verification.controller.ts` | file | 014 | REST controller |
| apps/backend/src/modules/payment | `apps/backend/src/modules/payment/slip-verification.service.ts` | file | 014, 016 | NestJS service |
| apps/backend/src/modules/payment | `apps/backend/src/modules/payment/slip-verifier.controller.ts` | file | 127 | REST controller |
| apps/backend/src/modules/payment | `apps/backend/src/modules/payment/slip-verifier.service.ts` | file | 024, 124 | NestJS service |
| apps/backend/src/modules/payment/ | `apps/backend/src/modules/payment/` | dir | 012, 020, 129 | — |
| apps/backend/src/modules/payment/controllers | `apps/backend/src/modules/payment/controllers` | dir | 004, 013, 015 | — |
| apps/backend/src/modules/payment/controllers | `apps/backend/src/modules/payment/controllers/promptpay.controller.ts` | file | 013 | REST controller |
| apps/backend/src/modules/payment/controllers | `apps/backend/src/modules/payment/controllers/slip-verification.controller.ts` | file | 015 | REST controller |
| apps/backend/src/modules/payment/dto | `apps/backend/src/modules/payment/dto` | dir | 013, 015, 016 | — |
| apps/backend/src/modules/payment/dto | `apps/backend/src/modules/payment/dto/promptpay-qr.dto.ts` | file | 013 | DTO |
| apps/backend/src/modules/payment/dto | `apps/backend/src/modules/payment/dto/slip-picker.dto.ts` | file | 016 | DTO |
| apps/backend/src/modules/payment/dto | `apps/backend/src/modules/payment/dto/slip-verification.dto.ts` | file | 015 | DTO |
| apps/backend/src/modules/payment/providers | `apps/backend/src/modules/payment/providers` | dir | 014 | — |
| apps/backend/src/modules/payment/providers | `apps/backend/src/modules/payment/providers/easyslip.provider.ts` | file | 014, 015 | — |
| apps/backend/src/modules/payment/resilience | `apps/backend/src/modules/payment/resilience` | dir | 124 | — |
| apps/backend/src/modules/payment/resilience | `apps/backend/src/modules/payment/resilience/circuit-breaker.service.ts` | file | 124 | NestJS service |
| apps/backend/src/modules/payment/resilience | `apps/backend/src/modules/payment/resilience/slip-outbox-worker.service.ts` | file | 124 | NestJS service |
| apps/backend/src/modules/payment/services | `apps/backend/src/modules/payment/services` | dir | 013, 015 | — |
| apps/backend/src/modules/payment/services | `apps/backend/src/modules/payment/services/easyslip.provider.ts` | file | 015 | NestJS service |
| apps/backend/src/modules/payment/services | `apps/backend/src/modules/payment/services/easyslip.service.ts` | file | 013 | NestJS service |
| apps/backend/src/modules/payment/services | `apps/backend/src/modules/payment/services/promptpay-expiry.service.ts` | file | 013 | NestJS service |
| apps/backend/src/modules/payment/services | `apps/backend/src/modules/payment/services/promptpay-qr.service.ts` | file | 013 | NestJS service |
| apps/backend/src/modules/payment/services | `apps/backend/src/modules/payment/services/slip-verification.service.ts` | file | 015, 122 | NestJS service |
| apps/backend/src/modules/payment/utils | `apps/backend/src/modules/payment/utils` | dir | 013 | — |
| apps/backend/src/modules/payment/utils | `apps/backend/src/modules/payment/utils/emvco-crc16.util.ts` | file | 013 | — |
| apps/backend/src/modules/payout | `apps/backend/src/modules/payout` | dir | 082, 086, 114 | — |
| apps/backend/src/modules/payout | `apps/backend/src/modules/payout/payout.module.ts` | file | 086 | NestJS module |
| apps/backend/src/modules/payout/ | `apps/backend/src/modules/payout/` | dir | 081 | — |
| apps/backend/src/modules/payout/application | `apps/backend/src/modules/payout/application` | dir | 086 | — |
| apps/backend/src/modules/payout/application/dto | `apps/backend/src/modules/payout/application/dto` | dir | 086 | — |
| apps/backend/src/modules/payout/application/dto | `apps/backend/src/modules/payout/application/dto/payout-request.dto.ts` | file | 086 | DTO |
| apps/backend/src/modules/payout/application/use-cases | `apps/backend/src/modules/payout/application/use-cases` | dir | 086 | — |
| apps/backend/src/modules/payout/application/use-cases | `apps/backend/src/modules/payout/application/use-cases/generate-tax-pdf.use-case.ts` | file | 086 | — |
| apps/backend/src/modules/payout/application/use-cases | `apps/backend/src/modules/payout/application/use-cases/process-batch-clearing.use-case.ts` | file | 086 | — |
| apps/backend/src/modules/payout/application/use-cases | `apps/backend/src/modules/payout/application/use-cases/request-payout.use-case.ts` | file | 086 | — |
| apps/backend/src/modules/payout/domain | `apps/backend/src/modules/payout/domain` | dir | 086 | — |
| apps/backend/src/modules/payout/domain/entities | `apps/backend/src/modules/payout/domain/entities` | dir | 086 | — |
| apps/backend/src/modules/payout/domain/entities | `apps/backend/src/modules/payout/domain/entities/payout-calculator.entity.ts` | file | 086 | DDD entity |
| apps/backend/src/modules/payout/domain/services | `apps/backend/src/modules/payout/domain/services` | dir | 086 | — |
| apps/backend/src/modules/payout/domain/services | `apps/backend/src/modules/payout/domain/services/ledger-integrity.service.ts` | file | 086 | NestJS service |
| apps/backend/src/modules/payout/infrastructure | `apps/backend/src/modules/payout/infrastructure` | dir | 086 | — |
| apps/backend/src/modules/payout/infrastructure/bank-gateway | `apps/backend/src/modules/payout/infrastructure/bank-gateway` | dir | 086 | — |
| apps/backend/src/modules/payout/infrastructure/bank-gateway | `apps/backend/src/modules/payout/infrastructure/bank-gateway/kasikorn-payout.adapter.ts` | file | 086 | — |
| apps/backend/src/modules/payout/infrastructure/bank-gateway | `apps/backend/src/modules/payout/infrastructure/bank-gateway/scb-payout.adapter.ts` | file | 086 | — |
| apps/backend/src/modules/payout/infrastructure/pdf | `apps/backend/src/modules/payout/infrastructure/pdf` | dir | 086 | — |
| apps/backend/src/modules/payout/infrastructure/pdf | `apps/backend/src/modules/payout/infrastructure/pdf/withholding-tax-pdf.generator.ts` | file | 086 | — |
| apps/backend/src/modules/pdf | `apps/backend/src/modules/pdf/receipt-pdf.generator.ts` | file | 019 | — |
| apps/backend/src/modules/pdpa | `apps/backend/src/modules/pdpa` | dir | 129 | — |
| apps/backend/src/modules/pdpa | `apps/backend/src/modules/pdpa/pdpa.controller.ts` | file | 129 | REST controller |
| apps/backend/src/modules/pdpa | `apps/backend/src/modules/pdpa/pdpa.resolver.ts` | file | 129 | GraphQL resolver |
| apps/backend/src/modules/pdpa/ | `apps/backend/src/modules/pdpa/` | dir | 129 | — |
| apps/backend/src/modules/pdpa/services | `apps/backend/src/modules/pdpa/services` | dir | 129 | — |
| apps/backend/src/modules/pdpa/services | `apps/backend/src/modules/pdpa/services/consent-manager.service.ts` | file | 129 | NestJS service |
| apps/backend/src/modules/pdpa/services | `apps/backend/src/modules/pdpa/services/dsr-engine.service.ts` | file | 129 | NestJS service |
| apps/backend/src/modules/performance | `apps/backend/src/modules/performance` | dir | 029 | — |
| apps/backend/src/modules/performance/application | `apps/backend/src/modules/performance/application` | dir | 029 | — |
| apps/backend/src/modules/performance/application/queries | `apps/backend/src/modules/performance/application/queries` | dir | 029 | — |
| apps/backend/src/modules/performance/application/queries | `apps/backend/src/modules/performance/application/queries/get-bundle-metrics.query.ts` | file | 029 | — |
| apps/backend/src/modules/performance/application/services | `apps/backend/src/modules/performance/application/services` | dir | 029 | — |
| apps/backend/src/modules/performance/application/services | `apps/backend/src/modules/performance/application/services/bundle-guard.service.ts` | file | 029 | NestJS service |
| apps/backend/src/modules/performance/application/services | `apps/backend/src/modules/performance/application/services/predictive-prefetch.service.ts` | file | 029 | NestJS service |
| apps/backend/src/modules/performance/domain | `apps/backend/src/modules/performance/domain` | dir | 029 | — |
| apps/backend/src/modules/performance/domain/entities | `apps/backend/src/modules/performance/domain/entities` | dir | 029 | — |
| apps/backend/src/modules/performance/domain/entities | `apps/backend/src/modules/performance/domain/entities/performance-metric.entity.ts` | file | 029 | DDD entity |
| apps/backend/src/modules/performance/domain/value-objects | `apps/backend/src/modules/performance/domain/value-objects` | dir | 029 | — |
| apps/backend/src/modules/performance/domain/value-objects | `apps/backend/src/modules/performance/domain/value-objects/bundle-size.vo.ts` | file | 029 | — |
| apps/backend/src/modules/performance/infrastructure | `apps/backend/src/modules/performance/infrastructure` | dir | 029 | — |
| apps/backend/src/modules/performance/infrastructure/adapters | `apps/backend/src/modules/performance/infrastructure/adapters` | dir | 029 | — |
| apps/backend/src/modules/performance/infrastructure/adapters | `apps/backend/src/modules/performance/infrastructure/adapters/redis-prefetch-cache.adapter.ts` | file | 029 | — |
| apps/backend/src/modules/performance/infrastructure/persistence | `apps/backend/src/modules/performance/infrastructure/persistence` | dir | 029 | — |
| apps/backend/src/modules/performance/infrastructure/persistence | `apps/backend/src/modules/performance/infrastructure/persistence/prisma-performance.repository.ts` | file | 029 | — |
| apps/backend/src/modules/performance/presentation | `apps/backend/src/modules/performance/presentation` | dir | 029 | — |
| apps/backend/src/modules/performance/presentation/graphql | `apps/backend/src/modules/performance/presentation/graphql` | dir | 029 | — |
| apps/backend/src/modules/performance/presentation/graphql | `apps/backend/src/modules/performance/presentation/graphql/prefetch.resolver.ts` | file | 029 | GraphQL resolver |
| apps/backend/src/modules/performance/presentation/webhooks | `apps/backend/src/modules/performance/presentation/webhooks` | dir | 029 | REST webhook |
| apps/backend/src/modules/performance/presentation/webhooks | `apps/backend/src/modules/performance/presentation/webhooks/performance-telemetry.controller.ts` | file | 029 | REST webhook |
| apps/backend/src/modules/permission | `apps/backend/src/modules/permission` | dir | 032 | — |
| apps/backend/src/modules/permission | `apps/backend/src/modules/permission/permission-audit.controller.ts` | file | 032 | REST controller |
| apps/backend/src/modules/permission | `apps/backend/src/modules/permission/permission-audit.service.ts` | file | 032 | NestJS service |
| apps/backend/src/modules/permission | `apps/backend/src/modules/permission/permission.module.ts` | file | 032 | NestJS module |
| apps/backend/src/modules/permission | `apps/backend/src/modules/permission/reverse-geocoding.service.ts` | file | 032 | NestJS service |
| apps/backend/src/modules/permission/dto | `apps/backend/src/modules/permission/dto` | dir | 032 | — |
| apps/backend/src/modules/permission/dto | `apps/backend/src/modules/permission/dto/request-permission.dto.ts` | file | 032 | DTO |
| apps/backend/src/modules/permission/dto | `apps/backend/src/modules/permission/dto/reverse-geocode.dto.ts` | file | 032 | DTO |
| apps/backend/src/modules/pipeline | `apps/backend/src/modules/pipeline` | dir | 038 | — |
| apps/backend/src/modules/pipeline/application | `apps/backend/src/modules/pipeline/application` | dir | 038 | — |
| apps/backend/src/modules/pipeline/application/dto | `apps/backend/src/modules/pipeline/application/dto` | dir | 038 | — |
| apps/backend/src/modules/pipeline/application/dto | `apps/backend/src/modules/pipeline/application/dto/pipeline-job.dto.ts` | file | 038 | DTO |
| apps/backend/src/modules/pipeline/application/use-cases | `apps/backend/src/modules/pipeline/application/use-cases` | dir | 038 | — |
| apps/backend/src/modules/pipeline/application/use-cases | `apps/backend/src/modules/pipeline/application/use-cases/encrypt-and-upload-chunk.use-case.ts` | file | 038 | — |
| apps/backend/src/modules/pipeline/application/use-cases | `apps/backend/src/modules/pipeline/application/use-cases/process-epub-to-chunks.use-case.ts` | file | 038 | — |
| apps/backend/src/modules/pipeline/application/use-cases | `apps/backend/src/modules/pipeline/application/use-cases/process-pdf-to-chunks.use-case.ts` | file | 038 | — |
| apps/backend/src/modules/pipeline/domain | `apps/backend/src/modules/pipeline/domain` | dir | 038 | — |
| apps/backend/src/modules/pipeline/domain/entities | `apps/backend/src/modules/pipeline/domain/entities` | dir | 038 | — |
| apps/backend/src/modules/pipeline/domain/entities | `apps/backend/src/modules/pipeline/domain/entities/book-job.entity.ts` | file | 038 | DDD entity |
| apps/backend/src/modules/pipeline/domain/entities | `apps/backend/src/modules/pipeline/domain/entities/vector-page.entity.ts` | file | 038 | DDD entity |
| apps/backend/src/modules/pipeline/domain/services | `apps/backend/src/modules/pipeline/domain/services` | dir | 038 | — |
| apps/backend/src/modules/pipeline/domain/services | `apps/backend/src/modules/pipeline/domain/services/svg-sanitizer.service.ts` | file | 038 | NestJS service |
| apps/backend/src/modules/pipeline/domain/services | `apps/backend/src/modules/pipeline/domain/services/vector-compressor.service.ts` | file | 038 | NestJS service |
| apps/backend/src/modules/pipeline/infrastructure | `apps/backend/src/modules/pipeline/infrastructure` | dir | 038 | — |
| apps/backend/src/modules/pipeline/infrastructure/parsers | `apps/backend/src/modules/pipeline/infrastructure/parsers` | dir | 038 | — |
| apps/backend/src/modules/pipeline/infrastructure/parsers | `apps/backend/src/modules/pipeline/infrastructure/parsers/epub-parser.adapter.ts` | file | 038 | — |
| apps/backend/src/modules/pipeline/infrastructure/parsers | `apps/backend/src/modules/pipeline/infrastructure/parsers/pdf-vector-parser.adapter.ts` | file | 038 | — |
| apps/backend/src/modules/pipeline/infrastructure/processors | `apps/backend/src/modules/pipeline/infrastructure/processors` | dir | 038 | — |
| apps/backend/src/modules/pipeline/infrastructure/processors | `apps/backend/src/modules/pipeline/infrastructure/processors/book-pipeline.processor.ts` | file | 038 | — |
| apps/backend/src/modules/pipeline/infrastructure/storage | `apps/backend/src/modules/pipeline/infrastructure/storage` | dir | 038 | — |
| apps/backend/src/modules/pipeline/infrastructure/storage | `apps/backend/src/modules/pipeline/infrastructure/storage/r2-vault.adapter.ts` | file | 038 | — |
| apps/backend/src/modules/pipeline/presentation | `apps/backend/src/modules/pipeline/presentation` | dir | 038 | — |
| apps/backend/src/modules/pipeline/presentation/controllers | `apps/backend/src/modules/pipeline/presentation/controllers` | dir | 038 | — |
| apps/backend/src/modules/pipeline/presentation/controllers | `apps/backend/src/modules/pipeline/presentation/controllers/book-pipeline.controller.ts` | file | 038 | REST controller |
| apps/backend/src/modules/pipeline/presentation/resolvers | `apps/backend/src/modules/pipeline/presentation/resolvers` | dir | 038 | — |
| apps/backend/src/modules/pipeline/presentation/resolvers | `apps/backend/src/modules/pipeline/presentation/resolvers/book-pipeline.resolver.ts` | file | 038 | GraphQL resolver |
| apps/backend/src/modules/prefetch | `apps/backend/src/modules/prefetch` | dir | 029 | — |
| apps/backend/src/modules/preview | `apps/backend/src/modules/preview` | dir | 051 | — |
| apps/backend/src/modules/preview | `apps/backend/src/modules/preview/preview.module.ts` | file | 051 | NestJS module |
| apps/backend/src/modules/preview/controllers | `apps/backend/src/modules/preview/controllers` | dir | 051 | — |
| apps/backend/src/modules/preview/controllers | `apps/backend/src/modules/preview/controllers/ebook-preview.controller.ts` | file | 051 | REST controller |
| apps/backend/src/modules/preview/controllers | `apps/backend/src/modules/preview/controllers/video-preview.controller.ts` | file | 051 | REST controller |
| apps/backend/src/modules/preview/resolvers | `apps/backend/src/modules/preview/resolvers` | dir | 051 | — |
| apps/backend/src/modules/preview/resolvers | `apps/backend/src/modules/preview/resolvers/preview.resolver.ts` | file | 051 | GraphQL resolver |
| apps/backend/src/modules/preview/services | `apps/backend/src/modules/preview/services` | dir | 051 | — |
| apps/backend/src/modules/preview/services | `apps/backend/src/modules/preview/services/ebook-chunk.service.ts` | file | 051 | NestJS service |
| apps/backend/src/modules/preview/services | `apps/backend/src/modules/preview/services/hls-token.service.ts` | file | 051 | NestJS service |
| apps/backend/src/modules/preview/services | `apps/backend/src/modules/preview/services/preview-gatekeeper.service.ts` | file | 051 | NestJS service |
| apps/backend/src/modules/product-builder | `apps/backend/src/modules/product-builder` | dir | 074 | — |
| apps/backend/src/modules/product-builder | `apps/backend/src/modules/product-builder/product-builder.module.ts` | file | 074 | NestJS module |
| apps/backend/src/modules/product-builder/controllers | `apps/backend/src/modules/product-builder/controllers` | dir | 074 | — |
| apps/backend/src/modules/product-builder/controllers | `apps/backend/src/modules/product-builder/controllers/product-builder.controller.ts` | file | 074 | REST controller |
| apps/backend/src/modules/product-builder/controllers | `apps/backend/src/modules/product-builder/controllers/upload-presign.controller.ts` | file | 074 | REST controller |
| apps/backend/src/modules/product-builder/dto | `apps/backend/src/modules/product-builder/dto` | dir | 074 | — |
| apps/backend/src/modules/product-builder/dto | `apps/backend/src/modules/product-builder/dto/create-draft.dto.ts` | file | 074 | DTO |
| apps/backend/src/modules/product-builder/dto | `apps/backend/src/modules/product-builder/dto/publish-product.dto.ts` | file | 074 | DTO |
| apps/backend/src/modules/product-builder/resolvers | `apps/backend/src/modules/product-builder/resolvers` | dir | 074 | — |
| apps/backend/src/modules/product-builder/resolvers | `apps/backend/src/modules/product-builder/resolvers/product-builder.resolver.ts` | file | 074 | GraphQL resolver |
| apps/backend/src/modules/product-builder/services | `apps/backend/src/modules/product-builder/services` | dir | 074 | — |
| apps/backend/src/modules/product-builder/services | `apps/backend/src/modules/product-builder/services/draft-storage.service.ts` | file | 074 | NestJS service |
| apps/backend/src/modules/product-builder/services | `apps/backend/src/modules/product-builder/services/product-builder.service.ts` | file | 074 | NestJS service |
| apps/backend/src/modules/product-builder/services | `apps/backend/src/modules/product-builder/services/r2-asset-pipeline.service.ts` | file | 074 | NestJS service |
| apps/backend/src/modules/progress | `apps/backend/src/modules/progress` | dir | 064 | — |
| apps/backend/src/modules/progress | `apps/backend/src/modules/progress/batch-sync.controller.ts` | file | 064 | REST controller |
| apps/backend/src/modules/progress | `apps/backend/src/modules/progress/progress.module.ts` | file | 064 | NestJS module |
| apps/backend/src/modules/progress/controllers | `apps/backend/src/modules/progress/controllers` | dir | 064 | — |
| apps/backend/src/modules/progress/controllers | `apps/backend/src/modules/progress/controllers/batch-sync.controller.ts` | file | 064 | REST controller |
| apps/backend/src/modules/progress/dto | `apps/backend/src/modules/progress/dto` | dir | 064 | — |
| apps/backend/src/modules/progress/dto | `apps/backend/src/modules/progress/dto/progress-sync.dto.ts` | file | 064 | DTO |
| apps/backend/src/modules/progress/resolvers | `apps/backend/src/modules/progress/resolvers` | dir | 064 | — |
| apps/backend/src/modules/progress/resolvers | `apps/backend/src/modules/progress/resolvers/course-progress.resolver.ts` | file | 064 | GraphQL resolver |
| apps/backend/src/modules/progress/resolvers | `apps/backend/src/modules/progress/resolvers/ebook-progress.resolver.ts` | file | 064 | GraphQL resolver |
| apps/backend/src/modules/progress/services | `apps/backend/src/modules/progress/services` | dir | 064 | — |
| apps/backend/src/modules/progress/services | `apps/backend/src/modules/progress/services/payload-verifier.service.ts` | file | 064 | NestJS service |
| apps/backend/src/modules/progress/services | `apps/backend/src/modules/progress/services/progress-sync.service.ts` | file | 064 | NestJS service |
| apps/backend/src/modules/promotion | `apps/backend/src/modules/promotion` | dir | 088 | — |
| apps/backend/src/modules/promotion | `apps/backend/src/modules/promotion/promotion.module.ts` | file | 088 | NestJS module |
| apps/backend/src/modules/promotion/controllers | `apps/backend/src/modules/promotion/controllers` | dir | 088 | — |
| apps/backend/src/modules/promotion/controllers | `apps/backend/src/modules/promotion/controllers/promotion.controller.ts` | file | 088 | REST controller |
| apps/backend/src/modules/promotion/domain | `apps/backend/src/modules/promotion/domain` | dir | 088 | — |
| apps/backend/src/modules/promotion/domain | `apps/backend/src/modules/promotion/domain/calculation-engine.ts` | file | 088 | — |
| apps/backend/src/modules/promotion/domain | `apps/backend/src/modules/promotion/domain/coupon.entity.ts` | file | 088 | DDD entity |
| apps/backend/src/modules/promotion/resolvers | `apps/backend/src/modules/promotion/resolvers` | dir | 088 | — |
| apps/backend/src/modules/promotion/resolvers | `apps/backend/src/modules/promotion/resolvers/promotion.resolver.ts` | file | 088 | GraphQL resolver |
| apps/backend/src/modules/promotion/services | `apps/backend/src/modules/promotion/services` | dir | 088 | — |
| apps/backend/src/modules/promotion/services | `apps/backend/src/modules/promotion/services/coupon.service.ts` | file | 088 | NestJS service |
| apps/backend/src/modules/promotion/services | `apps/backend/src/modules/promotion/services/discount-calculator.service.ts` | file | 088 | NestJS service |
| apps/backend/src/modules/promotion/services | `apps/backend/src/modules/promotion/services/points.service.ts` | file | 088 | NestJS service |
| apps/backend/src/modules/promotion/services | `apps/backend/src/modules/promotion/services/redlock.service.ts` | file | 088 | NestJS service |
| apps/backend/src/modules/queue | `apps/backend/src/modules/queue` | dir | 076 | — |
| apps/backend/src/modules/quiz | `apps/backend/src/modules/quiz` | dir | 047 | — |
| apps/backend/src/modules/quiz/application | `apps/backend/src/modules/quiz/application` | dir | 047 | — |
| apps/backend/src/modules/quiz/application/dto | `apps/backend/src/modules/quiz/application/dto` | dir | 047 | — |
| apps/backend/src/modules/quiz/application/dto | `apps/backend/src/modules/quiz/application/dto/submit-quiz.dto.ts` | file | 047 | DTO |
| apps/backend/src/modules/quiz/application/services | `apps/backend/src/modules/quiz/application/services` | dir | 047 | — |
| apps/backend/src/modules/quiz/application/services | `apps/backend/src/modules/quiz/application/services/ai-hint-generator.service.ts` | file | 047 | NestJS service |
| apps/backend/src/modules/quiz/application/services | `apps/backend/src/modules/quiz/application/services/quiz-evaluator.service.ts` | file | 047 | NestJS service |
| apps/backend/src/modules/quiz/domain | `apps/backend/src/modules/quiz/domain` | dir | 047 | — |
| apps/backend/src/modules/quiz/domain/entities | `apps/backend/src/modules/quiz/domain/entities` | dir | 047 | — |
| apps/backend/src/modules/quiz/domain/entities | `apps/backend/src/modules/quiz/domain/entities/quiz-session.entity.ts` | file | 047 | DDD entity |
| apps/backend/src/modules/quiz/domain/repositories | `apps/backend/src/modules/quiz/domain/repositories` | dir | 047 | — |
| apps/backend/src/modules/quiz/domain/repositories | `apps/backend/src/modules/quiz/domain/repositories/quiz.repository.ts` | file | 047 | — |
| apps/backend/src/modules/quiz/infrastructure | `apps/backend/src/modules/quiz/infrastructure` | dir | 047 | — |
| apps/backend/src/modules/quiz/infrastructure/persistence | `apps/backend/src/modules/quiz/infrastructure/persistence` | dir | 047 | — |
| apps/backend/src/modules/quiz/infrastructure/persistence | `apps/backend/src/modules/quiz/infrastructure/persistence/prisma-quiz.repository.ts` | file | 047 | — |
| apps/backend/src/modules/quiz/presentation | `apps/backend/src/modules/quiz/presentation` | dir | 047 | — |
| apps/backend/src/modules/quiz/presentation | `apps/backend/src/modules/quiz/presentation/quiz.resolver.ts` | file | 047 | GraphQL resolver |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader` | dir | 000, 040, 049, 059, 060, 061, 093, 095, 110, 126, 128 | — |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/ebook-chunker.service.ts` | file | 036 | NestJS service |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/preview-reader.controller.ts` | file | 051 | REST controller |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/progress.resolver.ts` | file | 064 | GraphQL resolver |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/reader-chunk.service.ts` | file | 055 | NestJS service |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/reader-control.controller.ts` | file | 041 | REST controller |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/reader-control.service.ts` | file | 041 | NestJS service |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/reader-paging.service.ts` | file | 124 | NestJS service |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/reader-sync.gateway.ts` | file | 070 | — |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/reader.controller.ts` | file | 040 | REST controller |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/reader.module.ts` | file | 040 | NestJS module |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/reader.resolver.ts` | file | 040 | GraphQL resolver |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/reader.service.ts` | file | 038, 040, 090, 092 | NestJS service |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/sliding-window.engine.ts` | file | 127 | — |
| apps/backend/src/modules/reader | `apps/backend/src/modules/reader/watermark-seed.service.ts` | file | 042 | NestJS service |
| apps/backend/src/modules/reader/application | `apps/backend/src/modules/reader/application` | dir | 059 | — |
| apps/backend/src/modules/reader/application | `apps/backend/src/modules/reader/application/reader-preference.service.ts` | file | 059 | NestJS service |
| apps/backend/src/modules/reader/application/commands | `apps/backend/src/modules/reader/application/commands` | dir | 059 | — |
| apps/backend/src/modules/reader/cache | `apps/backend/src/modules/reader/cache` | dir | 039 | — |
| apps/backend/src/modules/reader/cache | `apps/backend/src/modules/reader/cache/chunk-cache.module.ts` | file | 039 | NestJS module |
| apps/backend/src/modules/reader/cache | `apps/backend/src/modules/reader/cache/redis-edge.service.ts` | file | 039 | NestJS service |
| apps/backend/src/modules/reader/cache/controllers | `apps/backend/src/modules/reader/cache/controllers` | dir | 039 | — |
| apps/backend/src/modules/reader/cache/controllers | `apps/backend/src/modules/reader/cache/controllers/reader-chunk.controller.ts` | file | 039 | REST controller |
| apps/backend/src/modules/reader/cache/interfaces | `apps/backend/src/modules/reader/cache/interfaces` | dir | 039 | — |
| apps/backend/src/modules/reader/cache/interfaces | `apps/backend/src/modules/reader/cache/interfaces/chunk-cache.interface.ts` | file | 039 | — |
| apps/backend/src/modules/reader/cache/services | `apps/backend/src/modules/reader/cache/services` | dir | 039 | — |
| apps/backend/src/modules/reader/cache/services | `apps/backend/src/modules/reader/cache/services/chunk-warmer.service.ts` | file | 039 | NestJS service |
| apps/backend/src/modules/reader/cache/services | `apps/backend/src/modules/reader/cache/services/redis-edge.service.ts` | file | 039 | NestJS service |
| apps/backend/src/modules/reader/controllers | `apps/backend/src/modules/reader/controllers` | dir | 060 | — |
| apps/backend/src/modules/reader/controllers | `apps/backend/src/modules/reader/controllers/reader-chunk.controller.ts` | file | 039 | REST controller |
| apps/backend/src/modules/reader/controllers | `apps/backend/src/modules/reader/controllers/retina-reader.controller.ts` | file | 060 | REST controller |
| apps/backend/src/modules/reader/domain | `apps/backend/src/modules/reader/domain` | dir | 059 | — |
| apps/backend/src/modules/reader/domain | `apps/backend/src/modules/reader/domain/navigation-event.entity.ts` | file | 059 | DDD entity |
| apps/backend/src/modules/reader/domain/value-objects | `apps/backend/src/modules/reader/domain/value-objects` | dir | 059 | — |
| apps/backend/src/modules/reader/drm | `apps/backend/src/modules/reader/drm` | dir | 061 | — |
| apps/backend/src/modules/reader/drm | `apps/backend/src/modules/reader/drm/canvas-shuffling.service.ts` | file | 061 | NestJS service |
| apps/backend/src/modules/reader/drm | `apps/backend/src/modules/reader/drm/pixel-matrix.generator.ts` | file | 061 | — |
| apps/backend/src/modules/reader/drm/dto | `apps/backend/src/modules/reader/drm/dto` | dir | 061 | — |
| apps/backend/src/modules/reader/drm/dto | `apps/backend/src/modules/reader/drm/dto/drm-chunk-request.dto.ts` | file | 061 | DTO |
| apps/backend/src/modules/reader/dto | `apps/backend/src/modules/reader/dto` | dir | 040, 060 | — |
| apps/backend/src/modules/reader/dto | `apps/backend/src/modules/reader/dto/canvas-scaler.dto.ts` | file | 060 | DTO |
| apps/backend/src/modules/reader/dto | `apps/backend/src/modules/reader/dto/reader.dto.ts` | file | 040 | DTO |
| apps/backend/src/modules/reader/infrastructure | `apps/backend/src/modules/reader/infrastructure` | dir | 059 | — |
| apps/backend/src/modules/reader/infrastructure/api | `apps/backend/src/modules/reader/infrastructure/api` | dir | 059 | — |
| apps/backend/src/modules/reader/infrastructure/api | `apps/backend/src/modules/reader/infrastructure/api/reader-preference.resolver.ts` | file | 059 | GraphQL resolver |
| apps/backend/src/modules/reader/resolvers | `apps/backend/src/modules/reader/resolvers` | dir | 060 | — |
| apps/backend/src/modules/reader/resolvers | `apps/backend/src/modules/reader/resolvers/reader.resolver.ts` | file | 060 | GraphQL resolver |
| apps/backend/src/modules/reader/services | `apps/backend/src/modules/reader/services` | dir | 040, 060 | — |
| apps/backend/src/modules/reader/services | `apps/backend/src/modules/reader/services/chunk-decryptor.service.ts` | file | 040 | NestJS service |
| apps/backend/src/modules/reader/services | `apps/backend/src/modules/reader/services/retina-scaler.service.ts` | file | 060 | NestJS service |
| apps/backend/src/modules/reader/services | `apps/backend/src/modules/reader/services/sliding-window-cache.service.ts` | file | 040 | NestJS service |
| apps/backend/src/modules/reader/services | `apps/backend/src/modules/reader/services/theme-sync.service.ts` | file | 066 | NestJS service |
| apps/backend/src/modules/reader/services | `apps/backend/src/modules/reader/services/vector-chunk.service.ts` | file | 060, 091 | NestJS service |
| apps/backend/src/modules/reader/services | `apps/backend/src/modules/reader/services/watermark-generator.service.ts` | file | 040 | NestJS service |
| apps/backend/src/modules/recommendation | `apps/backend/src/modules/recommendation` | dir | 104 | — |
| apps/backend/src/modules/recommendation | `apps/backend/src/modules/recommendation/recommendation.module.ts` | file | 104 | NestJS module |
| apps/backend/src/modules/recommendation/controllers | `apps/backend/src/modules/recommendation/controllers` | dir | 104 | — |
| apps/backend/src/modules/recommendation/controllers | `apps/backend/src/modules/recommendation/controllers/recommendation-event.controller.ts` | file | 104 | REST controller |
| apps/backend/src/modules/recommendation/dto | `apps/backend/src/modules/recommendation/dto` | dir | 104 | — |
| apps/backend/src/modules/recommendation/dto | `apps/backend/src/modules/recommendation/dto/recommendation-request.dto.ts` | file | 104 | DTO |
| apps/backend/src/modules/recommendation/resolvers | `apps/backend/src/modules/recommendation/resolvers` | dir | 104 | — |
| apps/backend/src/modules/recommendation/resolvers | `apps/backend/src/modules/recommendation/resolvers/recommendation.resolver.ts` | file | 104 | GraphQL resolver |
| apps/backend/src/modules/recommendation/services | `apps/backend/src/modules/recommendation/services` | dir | 104 | — |
| apps/backend/src/modules/recommendation/services | `apps/backend/src/modules/recommendation/services/cold-start.service.ts` | file | 104 | NestJS service |
| apps/backend/src/modules/recommendation/services | `apps/backend/src/modules/recommendation/services/collaborative-filtering.service.ts` | file | 104 | NestJS service |
| apps/backend/src/modules/recommendation/services | `apps/backend/src/modules/recommendation/services/hybrid-reranker.service.ts` | file | 104 | NestJS service |
| apps/backend/src/modules/recommendation/services | `apps/backend/src/modules/recommendation/services/vector-search.service.ts` | file | 104 | NestJS service |
| apps/backend/src/modules/reconciliation | `apps/backend/src/modules/reconciliation` | dir | 115 | — |
| apps/backend/src/modules/reconciliation | `apps/backend/src/modules/reconciliation/reconciliation.module.ts` | file | 115 | NestJS module |
| apps/backend/src/modules/reconciliation/controllers | `apps/backend/src/modules/reconciliation/controllers` | dir | 115 | — |
| apps/backend/src/modules/reconciliation/controllers | `apps/backend/src/modules/reconciliation/controllers/bank-webhook.controller.ts` | file | 115 | REST webhook |
| apps/backend/src/modules/reconciliation/controllers | `apps/backend/src/modules/reconciliation/controllers/manual-override.controller.ts` | file | 115 | REST controller |
| apps/backend/src/modules/reconciliation/dto | `apps/backend/src/modules/reconciliation/dto` | dir | 115 | — |
| apps/backend/src/modules/reconciliation/dto | `apps/backend/src/modules/reconciliation/dto/bank-statement.dto.ts` | file | 115 | DTO |
| apps/backend/src/modules/reconciliation/dto | `apps/backend/src/modules/reconciliation/dto/override-request.dto.ts` | file | 115 | DTO |
| apps/backend/src/modules/reconciliation/repositories | `apps/backend/src/modules/reconciliation/repositories` | dir | 115 | — |
| apps/backend/src/modules/reconciliation/repositories | `apps/backend/src/modules/reconciliation/repositories/reconciliation.repository.ts` | file | 115 | — |
| apps/backend/src/modules/reconciliation/services | `apps/backend/src/modules/reconciliation/services` | dir | 115 | — |
| apps/backend/src/modules/reconciliation/services | `apps/backend/src/modules/reconciliation/services/audit-chain.service.ts` | file | 115 | NestJS service |
| apps/backend/src/modules/reconciliation/services | `apps/backend/src/modules/reconciliation/services/auto-reconciliation-engine.service.ts` | file | 115 | NestJS service |
| apps/backend/src/modules/reconciliation/services | `apps/backend/src/modules/reconciliation/services/manual-override.service.ts` | file | 115 | NestJS service |
| apps/backend/src/modules/reconciliation/services | `apps/backend/src/modules/reconciliation/services/matching-strategy.service.ts` | file | 115 | NestJS service |
| apps/backend/src/modules/resilience | `apps/backend/src/modules/resilience` | dir | 122 | — |
| apps/backend/src/modules/resilience | `apps/backend/src/modules/resilience/circuit-breaker.service.ts` | file | 122 | NestJS service |
| apps/backend/src/modules/resilience | `apps/backend/src/modules/resilience/idempotency.interceptor.ts` | file | 122 | NestJS interceptor |
| apps/backend/src/modules/resilience | `apps/backend/src/modules/resilience/resilience.module.ts` | file | 122 | NestJS module |
| apps/backend/src/modules/resilience/adapters | `apps/backend/src/modules/resilience/adapters` | dir | 122 | — |
| apps/backend/src/modules/resilience/adapters | `apps/backend/src/modules/resilience/adapters/easyslip-circuit.adapter.ts` | file | 122 | — |
| apps/backend/src/modules/resilience/decorators | `apps/backend/src/modules/resilience/decorators` | dir | 122 | — |
| apps/backend/src/modules/resilience/decorators | `apps/backend/src/modules/resilience/decorators/idempotent.decorator.ts` | file | 122 | — |
| apps/backend/src/modules/resilience/interceptors | `apps/backend/src/modules/resilience/interceptors` | dir | 122 | — |
| apps/backend/src/modules/resilience/interceptors | `apps/backend/src/modules/resilience/interceptors/idempotency.interceptor.ts` | file | 122 | NestJS interceptor |
| apps/backend/src/modules/resilience/services | `apps/backend/src/modules/resilience/services` | dir | 122 | — |
| apps/backend/src/modules/resilience/services | `apps/backend/src/modules/resilience/services/circuit-breaker.service.ts` | file | 122 | NestJS service |
| apps/backend/src/modules/resilience/services | `apps/backend/src/modules/resilience/services/distributed-lock.service.ts` | file | 122 | NestJS service |
| apps/backend/src/modules/resilience/stores | `apps/backend/src/modules/resilience/stores` | dir | 122 | — |
| apps/backend/src/modules/resilience/stores | `apps/backend/src/modules/resilience/stores/redis-idempotency.store.ts` | file | 122 | — |
| apps/backend/src/modules/resolver | `apps/backend/src/modules/resolver` | dir | 025 | — |
| apps/backend/src/modules/resolver | `apps/backend/src/modules/resolver/resolver.module.ts` | file | 025 | NestJS module |
| apps/backend/src/modules/resolver/application | `apps/backend/src/modules/resolver/application` | dir | 025 | — |
| apps/backend/src/modules/resolver/application/dto | `apps/backend/src/modules/resolver/application/dto` | dir | 025 | — |
| apps/backend/src/modules/resolver/application/dto | `apps/backend/src/modules/resolver/application/dto/resolver.dto.ts` | file | 025 | DTO |
| apps/backend/src/modules/resolver/application/use-cases | `apps/backend/src/modules/resolver/application/use-cases` | dir | 025 | — |
| apps/backend/src/modules/resolver/application/use-cases | `apps/backend/src/modules/resolver/application/use-cases/create-short-link.usecase.ts` | file | 025 | — |
| apps/backend/src/modules/resolver/application/use-cases | `apps/backend/src/modules/resolver/application/use-cases/resolve-deep-link.usecase.ts` | file | 025 | — |
| apps/backend/src/modules/resolver/domain | `apps/backend/src/modules/resolver/domain` | dir | 025 | — |
| apps/backend/src/modules/resolver/domain/entities | `apps/backend/src/modules/resolver/domain/entities` | dir | 025 | — |
| apps/backend/src/modules/resolver/domain/entities | `apps/backend/src/modules/resolver/domain/entities/short-link.entity.ts` | file | 025 | DDD entity |
| apps/backend/src/modules/resolver/domain/services | `apps/backend/src/modules/resolver/domain/services` | dir | 025 | — |
| apps/backend/src/modules/resolver/domain/services | `apps/backend/src/modules/resolver/domain/services/hmac-crypto.service.ts` | file | 025 | NestJS service |
| apps/backend/src/modules/resolver/infrastructure | `apps/backend/src/modules/resolver/infrastructure` | dir | 025 | — |
| apps/backend/src/modules/resolver/infrastructure/controllers | `apps/backend/src/modules/resolver/infrastructure/controllers` | dir | 025 | — |
| apps/backend/src/modules/resolver/infrastructure/controllers | `apps/backend/src/modules/resolver/infrastructure/controllers/fastify-resolver.controller.ts` | file | 025 | REST controller |
| apps/backend/src/modules/resolver/infrastructure/repositories | `apps/backend/src/modules/resolver/infrastructure/repositories` | dir | 025 | — |
| apps/backend/src/modules/resolver/infrastructure/repositories | `apps/backend/src/modules/resolver/infrastructure/repositories/short-link.repository.ts` | file | 025 | — |
| apps/backend/src/modules/reward | `apps/backend/src/modules/reward` | dir | 083 | — |
| apps/backend/src/modules/search/ | `apps/backend/src/modules/search/` | dir | 009 | — |
| apps/backend/src/modules/security | `apps/backend/src/modules/security` | dir | 106, 107, 119, 120, 127, 129 | — |
| apps/backend/src/modules/security | `apps/backend/src/modules/security/forensic-watermark.service.ts` | file | 055 | NestJS service |
| apps/backend/src/modules/security | `apps/backend/src/modules/security/geoip-lookup.service.ts` | file | 120 | NestJS service |
| apps/backend/src/modules/security | `apps/backend/src/modules/security/ip-anomaly.service.ts` | file | 120 | NestJS service |
| apps/backend/src/modules/security | `apps/backend/src/modules/security/risk-calculator.service.ts` | file | 120 | NestJS service |
| apps/backend/src/modules/security | `apps/backend/src/modules/security/security.module.ts` | file | 119, 120 | NestJS module |
| apps/backend/src/modules/security | `apps/backend/src/modules/security/velocity-checker.service.ts` | file | 120 | NestJS service |
| apps/backend/src/modules/security/ | `apps/backend/src/modules/security/` | dir | 129 | — |
| apps/backend/src/modules/security/controllers | `apps/backend/src/modules/security/controllers` | dir | 119, 120 | — |
| apps/backend/src/modules/security/controllers | `apps/backend/src/modules/security/controllers/security-fingerprint.controller.ts` | file | 119 | REST controller |
| apps/backend/src/modules/security/controllers | `apps/backend/src/modules/security/controllers/security-webhook.controller.ts` | file | 120 | REST webhook |
| apps/backend/src/modules/security/guards | `apps/backend/src/modules/security/guards` | dir | 119, 127, 129 | — |
| apps/backend/src/modules/security/guards | `apps/backend/src/modules/security/guards/concurrent-stream.guard.ts` | file | 119 | NestJS guard |
| apps/backend/src/modules/security/guards | `apps/backend/src/modules/security/guards/device-fingerprint.guard.ts` | file | 119 | NestJS guard |
| apps/backend/src/modules/security/guards | `apps/backend/src/modules/security/guards/drm-entitlement.guard.ts` | file | 127 | NestJS guard |
| apps/backend/src/modules/security/guards | `apps/backend/src/modules/security/guards/graphql-depth-limit.guard.ts` | file | 127 | NestJS guard |
| apps/backend/src/modules/security/guards | `apps/backend/src/modules/security/guards/line-liff-auth.guard.ts` | file | 129 | NestJS guard |
| apps/backend/src/modules/security/guards | `apps/backend/src/modules/security/guards/line-signature.guard.ts` | file | 129 | NestJS guard |
| apps/backend/src/modules/security/guards | `apps/backend/src/modules/security/guards/pdpa-consent.guard.ts` | file | 129 | NestJS guard |
| apps/backend/src/modules/security/guards | `apps/backend/src/modules/security/guards/rate-limiter.guard.ts` | file | 127 | NestJS guard |
| apps/backend/src/modules/security/repositories | `apps/backend/src/modules/security/repositories` | dir | 119, 120 | — |
| apps/backend/src/modules/security/repositories | `apps/backend/src/modules/security/repositories/active-session-redis.repository.ts` | file | 119 | — |
| apps/backend/src/modules/security/repositories | `apps/backend/src/modules/security/repositories/security-audit.repository.ts` | file | 120 | — |
| apps/backend/src/modules/security/resolvers | `apps/backend/src/modules/security/resolvers` | dir | 120 | — |
| apps/backend/src/modules/security/resolvers | `apps/backend/src/modules/security/resolvers/security.resolver.ts` | file | 120 | GraphQL resolver |
| apps/backend/src/modules/security/services | `apps/backend/src/modules/security/services` | dir | 119, 120, 127, 129 | — |
| apps/backend/src/modules/security/services | `apps/backend/src/modules/security/services/audit-logger.service.ts` | file | 129 | NestJS service |
| apps/backend/src/modules/security/services | `apps/backend/src/modules/security/services/fingerprint-verifier.service.ts` | file | 119 | NestJS service |
| apps/backend/src/modules/security/services | `apps/backend/src/modules/security/services/forensic-watermark.service.ts` | file | 127 | NestJS service |
| apps/backend/src/modules/security/services | `apps/backend/src/modules/security/services/geoip-lookup.service.ts` | file | 120 | NestJS service |
| apps/backend/src/modules/security/services | `apps/backend/src/modules/security/services/hls-token-signer.service.ts` | file | 119 | NestJS service |
| apps/backend/src/modules/security/services | `apps/backend/src/modules/security/services/ip-anomaly.service.ts` | file | 120 | NestJS service |
| apps/backend/src/modules/security/services | `apps/backend/src/modules/security/services/line-flex-alert.service.ts` | file | 120 | NestJS service |
| apps/backend/src/modules/security/services | `apps/backend/src/modules/security/services/pii-crypto.service.ts` | file | 129 | NestJS service |
| apps/backend/src/modules/security/services | `apps/backend/src/modules/security/services/risk-calculator.service.ts` | file | 120 | NestJS service |
| apps/backend/src/modules/security/services | `apps/backend/src/modules/security/services/security-audit-logger.service.ts` | file | 127 | NestJS service |
| apps/backend/src/modules/security/services | `apps/backend/src/modules/security/services/session-eviction.service.ts` | file | 119 | NestJS service |
| apps/backend/src/modules/security/services | `apps/backend/src/modules/security/services/velocity-checker.service.ts` | file | 120 | NestJS service |
| apps/backend/src/modules/security/waf | `apps/backend/src/modules/security/waf` | dir | 127 | — |
| apps/backend/src/modules/security/waf | `apps/backend/src/modules/security/waf/sql-injection-filter.middleware.ts` | file | 127 | Next.js Edge middleware |
| apps/backend/src/modules/security/waf | `apps/backend/src/modules/security/waf/xss-sanitizer.middleware.ts` | file | 127 | Next.js Edge middleware |
| apps/backend/src/modules/share | `apps/backend/src/modules/share` | dir | 080 | — |
| apps/backend/src/modules/share/application | `apps/backend/src/modules/share/application` | dir | 080 | — |
| apps/backend/src/modules/share/application | `apps/backend/src/modules/share/application/generate-flex-share.usecase.ts` | file | 080 | — |
| apps/backend/src/modules/share/application | `apps/backend/src/modules/share/application/track-click.usecase.ts` | file | 080 | — |
| apps/backend/src/modules/share/domain | `apps/backend/src/modules/share/domain` | dir | 080 | — |
| apps/backend/src/modules/share/domain | `apps/backend/src/modules/share/domain/attribution.signer.ts` | file | 080 | — |
| apps/backend/src/modules/share/domain | `apps/backend/src/modules/share/domain/flex-builder.engine.ts` | file | 080 | — |
| apps/backend/src/modules/share/infrastructure | `apps/backend/src/modules/share/infrastructure` | dir | 080 | — |
| apps/backend/src/modules/share/infrastructure | `apps/backend/src/modules/share/infrastructure/share-redis.cache.ts` | file | 080 | — |
| apps/backend/src/modules/share/infrastructure | `apps/backend/src/modules/share/infrastructure/share.repository.ts` | file | 080 | — |
| apps/backend/src/modules/share/presentation | `apps/backend/src/modules/share/presentation` | dir | 080 | — |
| apps/backend/src/modules/share/presentation | `apps/backend/src/modules/share/presentation/share.resolver.ts` | file | 080 | GraphQL resolver |
| apps/backend/src/modules/shipping/ | `apps/backend/src/modules/shipping/` | dir | 011 | — |
| apps/backend/src/modules/social-reading | `apps/backend/src/modules/social-reading` | dir | 095 | — |
| apps/backend/src/modules/social-reading/application | `apps/backend/src/modules/social-reading/application` | dir | 095 | — |
| apps/backend/src/modules/social-reading/application | `apps/backend/src/modules/social-reading/application/create-note.usecase.ts` | file | 095 | — |
| apps/backend/src/modules/social-reading/application | `apps/backend/src/modules/social-reading/application/fetch-page-notes.usecase.ts` | file | 095 | — |
| apps/backend/src/modules/social-reading/application | `apps/backend/src/modules/social-reading/application/toggle-like-note.usecase.ts` | file | 095 | — |
| apps/backend/src/modules/social-reading/domain | `apps/backend/src/modules/social-reading/domain` | dir | 095 | — |
| apps/backend/src/modules/social-reading/domain | `apps/backend/src/modules/social-reading/domain/social-note.entity.ts` | file | 095 | DDD entity |
| apps/backend/src/modules/social-reading/domain | `apps/backend/src/modules/social-reading/domain/social-note.repository.interface.ts` | file | 095 | — |
| apps/backend/src/modules/social-reading/infrastructure | `apps/backend/src/modules/social-reading/infrastructure` | dir | 095 | — |
| apps/backend/src/modules/social-reading/infrastructure/persistence | `apps/backend/src/modules/social-reading/infrastructure/persistence` | dir | 095 | — |
| apps/backend/src/modules/social-reading/infrastructure/persistence | `apps/backend/src/modules/social-reading/infrastructure/persistence/prisma-social-note.repository.ts` | file | 095 | — |
| apps/backend/src/modules/social-reading/infrastructure/redis | `apps/backend/src/modules/social-reading/infrastructure/redis` | dir | 095 | — |
| apps/backend/src/modules/social-reading/infrastructure/redis | `apps/backend/src/modules/social-reading/infrastructure/redis/social-note-cache.adapter.ts` | file | 095 | — |
| apps/backend/src/modules/social-reading/presentation | `apps/backend/src/modules/social-reading/presentation` | dir | 095 | — |
| apps/backend/src/modules/social-reading/presentation/graphql | `apps/backend/src/modules/social-reading/presentation/graphql` | dir | 095 | — |
| apps/backend/src/modules/social-reading/presentation/graphql | `apps/backend/src/modules/social-reading/presentation/graphql/social-reading.resolver.ts` | file | 095 | GraphQL resolver |
| apps/backend/src/modules/social-reading/presentation/graphql/dto | `apps/backend/src/modules/social-reading/presentation/graphql/dto` | dir | 095 | — |
| apps/backend/src/modules/social-reading/presentation/graphql/dto | `apps/backend/src/modules/social-reading/presentation/graphql/dto/create-note.input.ts` | file | 095 | DTO |
| apps/backend/src/modules/social-reading/presentation/graphql/dto | `apps/backend/src/modules/social-reading/presentation/graphql/dto/social-note.type.ts` | file | 095 | DTO |
| apps/backend/src/modules/social-share | `apps/backend/src/modules/social-share` | dir | 026 | — |
| apps/backend/src/modules/social-share/controllers | `apps/backend/src/modules/social-share/controllers` | dir | 026 | — |
| apps/backend/src/modules/social-share/controllers | `apps/backend/src/modules/social-share/controllers/social-share.controller.ts` | file | 026 | REST controller |
| apps/backend/src/modules/social-share/dto | `apps/backend/src/modules/social-share/dto` | dir | 026 | — |
| apps/backend/src/modules/social-share/dto | `apps/backend/src/modules/social-share/dto/share-intent.dto.ts` | file | 026 | DTO |
| apps/backend/src/modules/social-share/resolvers | `apps/backend/src/modules/social-share/resolvers` | dir | 026 | — |
| apps/backend/src/modules/social-share/resolvers | `apps/backend/src/modules/social-share/resolvers/social-share.resolver.ts` | file | 026 | GraphQL resolver |
| apps/backend/src/modules/social-share/services | `apps/backend/src/modules/social-share/services` | dir | 026 | — |
| apps/backend/src/modules/social-share/services | `apps/backend/src/modules/social-share/services/flex-message-builder.service.ts` | file | 026 | NestJS service |
| apps/backend/src/modules/social-share/services | `apps/backend/src/modules/social-share/services/social-share.service.ts` | file | 026 | NestJS service |
| apps/backend/src/modules/squad | `apps/backend/src/modules/squad` | dir | 096 | — |
| apps/backend/src/modules/squad | `apps/backend/src/modules/squad/squad.controller.ts` | file | 096 | REST controller |
| apps/backend/src/modules/squad | `apps/backend/src/modules/squad/squad.module.ts` | file | 096 | NestJS module |
| apps/backend/src/modules/squad | `apps/backend/src/modules/squad/squad.resolver.ts` | file | 096 | GraphQL resolver |
| apps/backend/src/modules/squad/application | `apps/backend/src/modules/squad/application` | dir | 096 | — |
| apps/backend/src/modules/squad/application | `apps/backend/src/modules/squad/application/create-squad.usecase.ts` | file | 096 | — |
| apps/backend/src/modules/squad/application | `apps/backend/src/modules/squad/application/join-squad.usecase.ts` | file | 096 | — |
| apps/backend/src/modules/squad/domain | `apps/backend/src/modules/squad/domain` | dir | 096 | — |
| apps/backend/src/modules/squad/domain | `apps/backend/src/modules/squad/domain/squad.entity.ts` | file | 096 | DDD entity |
| apps/backend/src/modules/storage | `apps/backend/src/modules/storage` | dir | 074 | — |
| apps/backend/src/modules/storage/services | `apps/backend/src/modules/storage/services/r2-lifecycle.service.ts` | file | 123 | NestJS service |
| apps/backend/src/modules/storage/services | `apps/backend/src/modules/storage/services/storage-budget.service.ts` | file | 123 | NestJS service |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream` | dir | 000, 043, 044, 045, 047, 050, 053, 054, 058, 078, 093, 099, 100, 102, 119, 126 | — |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/ffmpeg.service.ts` | file | 044 | NestJS service |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/hls-manifest.service.ts` | file | 055 | NestJS service |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/hls-player.interface.ts` | file | 065 | — |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/hls-segmenter.service.ts` | file | 044 | NestJS service |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/hls-stream.controller.ts` | file | 053 | REST controller |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/hls-stream.module.ts` | file | 053 | NestJS module |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/hls-token-generator.service.ts` | file | 053 | NestJS service |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/hls-transcoder.service.ts` | file | 036 | NestJS service |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/live-access.controller.ts` | file | 100 | REST controller |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/live-gatekeeper.service.ts` | file | 100 | NestJS service |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/live-stream.gateway.ts` | file | 100 | — |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/live-stream.resolver.ts` | file | 100 | GraphQL resolver |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/live-to-vod.service.ts` | file | 102 | NestJS service |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/preview-stream.controller.ts` | file | 051 | REST controller |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/progress.resolver.ts` | file | 064 | GraphQL resolver |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/r2-uploader.service.ts` | file | 102 | NestJS service |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/stream-sync.gateway.ts` | file | 070 | — |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/stream.controller.ts` | file | 044, 045, 067 | REST controller |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/stream.module.ts` | file | 044, 045, 054, 058 | NestJS module |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/stream.resolver.ts` | file | 044, 054 | GraphQL resolver |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/stream.service.ts` | file | 045, 054, 067, 092 | NestJS service |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/thumbnail-scrubbing.service.ts` | file | 058 | NestJS service |
| apps/backend/src/modules/stream | `apps/backend/src/modules/stream/transcoder.worker.ts` | file | 044, 102 | — |
| apps/backend/src/modules/stream/api | `apps/backend/src/modules/stream/api` | dir | 045 | — |
| apps/backend/src/modules/stream/api/graphql | `apps/backend/src/modules/stream/api/graphql` | dir | 045 | — |
| apps/backend/src/modules/stream/api/graphql | `apps/backend/src/modules/stream/api/graphql/stream.resolver.ts` | file | 045 | GraphQL resolver |
| apps/backend/src/modules/stream/application | `apps/backend/src/modules/stream/application` | dir | 102 | — |
| apps/backend/src/modules/stream/application | `apps/backend/src/modules/stream/application/live-to-vod.service.ts` | file | 102 | NestJS service |
| apps/backend/src/modules/stream/application | `apps/backend/src/modules/stream/application/transcode-processor.worker.ts` | file | 102 | — |
| apps/backend/src/modules/stream/controllers | `apps/backend/src/modules/stream/controllers` | dir | 050, 058 | — |
| apps/backend/src/modules/stream/controllers | `apps/backend/src/modules/stream/controllers/hls-stream.controller.ts` | file | 050 | REST controller |
| apps/backend/src/modules/stream/controllers | `apps/backend/src/modules/stream/controllers/scrubbing.controller.ts` | file | 058 | REST controller |
| apps/backend/src/modules/stream/domain | `apps/backend/src/modules/stream/domain` | dir | 045, 102 | — |
| apps/backend/src/modules/stream/domain | `apps/backend/src/modules/stream/domain/live-session.aggregate.ts` | file | 102 | — |
| apps/backend/src/modules/stream/domain | `apps/backend/src/modules/stream/domain/progress-tracker.entity.ts` | file | 045 | DDD entity |
| apps/backend/src/modules/stream/domain | `apps/backend/src/modules/stream/domain/video-manifest.value-object.ts` | file | 045 | — |
| apps/backend/src/modules/stream/domain/events | `apps/backend/src/modules/stream/domain/events` | dir | 102 | — |
| apps/backend/src/modules/stream/dto | `apps/backend/src/modules/stream/dto` | dir | 050, 053, 054, 058, 100 | — |
| apps/backend/src/modules/stream/dto | `apps/backend/src/modules/stream/dto/hls-token.dto.ts` | file | 053 | DTO |
| apps/backend/src/modules/stream/dto | `apps/backend/src/modules/stream/dto/live-entitlement.dto.ts` | file | 100 | DTO |
| apps/backend/src/modules/stream/dto | `apps/backend/src/modules/stream/dto/stream-payload.dto.ts` | file | 054 | DTO |
| apps/backend/src/modules/stream/dto | `apps/backend/src/modules/stream/dto/stream-request.dto.ts` | file | 050 | DTO |
| apps/backend/src/modules/stream/dto | `apps/backend/src/modules/stream/dto/sync-progress.dto.ts` | file | 054 | DTO |
| apps/backend/src/modules/stream/dto | `apps/backend/src/modules/stream/dto/video-scrubbing.dto.ts` | file | 058 | DTO |
| apps/backend/src/modules/stream/dtos | `apps/backend/src/modules/stream/dtos` | dir | 044 | — |
| apps/backend/src/modules/stream/dtos | `apps/backend/src/modules/stream/dtos/video-transcode.dto.ts` | file | 044 | DTO |
| apps/backend/src/modules/stream/guards | `apps/backend/src/modules/stream/guards` | dir | 050, 053 | — |
| apps/backend/src/modules/stream/guards | `apps/backend/src/modules/stream/guards/hls-entitlement.guard.ts` | file | 053 | NestJS guard |
| apps/backend/src/modules/stream/guards | `apps/backend/src/modules/stream/guards/video-rate-limit.guard.ts` | file | 050 | NestJS guard |
| apps/backend/src/modules/stream/infrastructure | `apps/backend/src/modules/stream/infrastructure` | dir | 045, 102 | — |
| apps/backend/src/modules/stream/infrastructure | `apps/backend/src/modules/stream/infrastructure/cloudflare-r2-signer.service.ts` | file | 045 | NestJS service |
| apps/backend/src/modules/stream/infrastructure | `apps/backend/src/modules/stream/infrastructure/ffmpeg-transcoder.adapter.ts` | file | 102 | — |
| apps/backend/src/modules/stream/infrastructure | `apps/backend/src/modules/stream/infrastructure/r2-vault-storage.adapter.ts` | file | 102 | — |
| apps/backend/src/modules/stream/infrastructure | `apps/backend/src/modules/stream/infrastructure/redis-analytics-publisher.service.ts` | file | 045 | NestJS service |
| apps/backend/src/modules/stream/processors | `apps/backend/src/modules/stream/processors` | dir | 058 | — |
| apps/backend/src/modules/stream/processors | `apps/backend/src/modules/stream/processors/vtt-generator.processor.ts` | file | 058 | — |
| apps/backend/src/modules/stream/progress | `apps/backend/src/modules/stream/progress` | dir | 046 | — |
| apps/backend/src/modules/stream/progress | `apps/backend/src/modules/stream/progress/progress.controller.ts` | file | 046 | REST controller |
| apps/backend/src/modules/stream/progress | `apps/backend/src/modules/stream/progress/progress.module.ts` | file | 046 | NestJS module |
| apps/backend/src/modules/stream/progress | `apps/backend/src/modules/stream/progress/progress.resolver.ts` | file | 046 | GraphQL resolver |
| apps/backend/src/modules/stream/progress | `apps/backend/src/modules/stream/progress/progress.service.ts` | file | 046 | NestJS service |
| apps/backend/src/modules/stream/progress/dto | `apps/backend/src/modules/stream/progress/dto` | dir | 046 | — |
| apps/backend/src/modules/stream/progress/dto | `apps/backend/src/modules/stream/progress/dto/sync-progress.input.ts` | file | 046 | DTO |
| apps/backend/src/modules/stream/progress/dto | `apps/backend/src/modules/stream/progress/dto/sync-progress.response.ts` | file | 046 | DTO |
| apps/backend/src/modules/stream/services | `apps/backend/src/modules/stream/services` | dir | 044, 050, 058 | — |
| apps/backend/src/modules/stream/services | `apps/backend/src/modules/stream/services/caption-processor.service.ts` | file | 094 | NestJS service |
| apps/backend/src/modules/stream/services | `apps/backend/src/modules/stream/services/ffmpeg-transcoder.service.ts` | file | 044 | NestJS service |
| apps/backend/src/modules/stream/services | `apps/backend/src/modules/stream/services/hls-security.service.ts` | file | 050 | NestJS service |
| apps/backend/src/modules/stream/services | `apps/backend/src/modules/stream/services/hls-segmenter.service.ts` | file | 044 | NestJS service |
| apps/backend/src/modules/stream/services | `apps/backend/src/modules/stream/services/stream-security.service.ts` | file | 044 | NestJS service |
| apps/backend/src/modules/stream/services | `apps/backend/src/modules/stream/services/thumbnail-scrubbing.service.ts` | file | 058 | NestJS service |
| apps/backend/src/modules/stream/services | `apps/backend/src/modules/stream/services/transcript-vector.service.ts` | file | 091 | NestJS service |
| apps/backend/src/modules/stream/services | `apps/backend/src/modules/stream/services/video-session.service.ts` | file | 050 | NestJS service |
| apps/backend/src/modules/stream/workers | `apps/backend/src/modules/stream/workers` | dir | 044 | — |
| apps/backend/src/modules/stream/workers | `apps/backend/src/modules/stream/workers/video-transcode.processor.ts` | file | 044 | — |
| apps/backend/src/modules/support | `apps/backend/src/modules/support` | dir | 103 | — |
| apps/backend/src/modules/support | `apps/backend/src/modules/support/support.module.ts` | file | 103 | NestJS module |
| apps/backend/src/modules/support/application | `apps/backend/src/modules/support/application` | dir | 103 | — |
| apps/backend/src/modules/support/application/use-cases | `apps/backend/src/modules/support/application/use-cases` | dir | 103 | — |
| apps/backend/src/modules/support/application/use-cases | `apps/backend/src/modules/support/application/use-cases/create-ticket.use-case.ts` | file | 103 | — |
| apps/backend/src/modules/support/application/use-cases | `apps/backend/src/modules/support/application/use-cases/escalate-to-agent.use-case.ts` | file | 103 | — |
| apps/backend/src/modules/support/application/use-cases | `apps/backend/src/modules/support/application/use-cases/resolve-ticket.use-case.ts` | file | 103 | — |
| apps/backend/src/modules/support/domain | `apps/backend/src/modules/support/domain` | dir | 103 | — |
| apps/backend/src/modules/support/domain/entities | `apps/backend/src/modules/support/domain/entities` | dir | 103 | — |
| apps/backend/src/modules/support/domain/value-objects | `apps/backend/src/modules/support/domain/value-objects` | dir | 103 | — |
| apps/backend/src/modules/support/infrastructure | `apps/backend/src/modules/support/infrastructure` | dir | 103 | — |
| apps/backend/src/modules/support/infrastructure/repositories | `apps/backend/src/modules/support/infrastructure/repositories` | dir | 103 | — |
| apps/backend/src/modules/support/infrastructure/websocket | `apps/backend/src/modules/support/infrastructure/websocket` | dir | 103 | — |
| apps/backend/src/modules/sync | `apps/backend/src/modules/sync` | dir | 057, 070 | — |
| apps/backend/src/modules/sync | `apps/backend/src/modules/sync/sync.module.ts` | file | 057, 070 | NestJS module |
| apps/backend/src/modules/sync/ | `apps/backend/src/modules/sync/` | dir | 057 | — |
| apps/backend/src/modules/sync/application | `apps/backend/src/modules/sync/application` | dir | 057 | — |
| apps/backend/src/modules/sync/application/use-cases | `apps/backend/src/modules/sync/application/use-cases` | dir | 057 | — |
| apps/backend/src/modules/sync/application/use-cases | `apps/backend/src/modules/sync/application/use-cases/sync-ebook-progress.use-case.ts` | file | 057 | — |
| apps/backend/src/modules/sync/application/use-cases | `apps/backend/src/modules/sync/application/use-cases/sync-video-progress.use-case.ts` | file | 057 | — |
| apps/backend/src/modules/sync/application/workers | `apps/backend/src/modules/sync/application/workers` | dir | 057 | — |
| apps/backend/src/modules/sync/application/workers | `apps/backend/src/modules/sync/application/workers/progress-persistence.worker.ts` | file | 057 | — |
| apps/backend/src/modules/sync/domain | `apps/backend/src/modules/sync/domain` | dir | 057 | — |
| apps/backend/src/modules/sync/domain/events | `apps/backend/src/modules/sync/domain/events` | dir | 057 | — |
| apps/backend/src/modules/sync/domain/events | `apps/backend/src/modules/sync/domain/events/progress-updated.event.ts` | file | 057 | — |
| apps/backend/src/modules/sync/domain/services | `apps/backend/src/modules/sync/domain/services` | dir | 057 | — |
| apps/backend/src/modules/sync/domain/services | `apps/backend/src/modules/sync/domain/services/conflict-resolver.service.ts` | file | 057 | NestJS service |
| apps/backend/src/modules/sync/dto | `apps/backend/src/modules/sync/dto` | dir | 070 | — |
| apps/backend/src/modules/sync/dto | `apps/backend/src/modules/sync/dto/cross-device-sync.dto.ts` | file | 070 | DTO |
| apps/backend/src/modules/sync/gateways | `apps/backend/src/modules/sync/gateways` | dir | 070 | — |
| apps/backend/src/modules/sync/gateways | `apps/backend/src/modules/sync/gateways/cross-device-sync.gateway.ts` | file | 070 | — |
| apps/backend/src/modules/sync/infrastructure | `apps/backend/src/modules/sync/infrastructure` | dir | 057 | — |
| apps/backend/src/modules/sync/infrastructure/adapters | `apps/backend/src/modules/sync/infrastructure/adapters` | dir | 057 | — |
| apps/backend/src/modules/sync/infrastructure/adapters | `apps/backend/src/modules/sync/infrastructure/adapters/redis-io.adapter.ts` | file | 057 | — |
| apps/backend/src/modules/sync/infrastructure/gateways | `apps/backend/src/modules/sync/infrastructure/gateways` | dir | 057 | — |
| apps/backend/src/modules/sync/infrastructure/gateways | `apps/backend/src/modules/sync/infrastructure/gateways/progress-sync.gateway.ts` | file | 057 | — |
| apps/backend/src/modules/sync/repositories | `apps/backend/src/modules/sync/repositories` | dir | 070 | — |
| apps/backend/src/modules/sync/repositories | `apps/backend/src/modules/sync/repositories/sync-state.repository.ts` | file | 070 | — |
| apps/backend/src/modules/sync/services | `apps/backend/src/modules/sync/services` | dir | 070 | — |
| apps/backend/src/modules/sync/services | `apps/backend/src/modules/sync/services/cross-device-sync.service.ts` | file | 070 | NestJS service |
| apps/backend/src/modules/sync/services | `apps/backend/src/modules/sync/services/session-handshake.service.ts` | file | 070 | NestJS service |
| apps/backend/src/modules/tax | `apps/backend/src/modules/tax` | dir | 082, 114 | — |
| apps/backend/src/modules/tax/application | `apps/backend/src/modules/tax/application` | dir | 082 | — |
| apps/backend/src/modules/tax/application/dto | `apps/backend/src/modules/tax/application/dto` | dir | 082 | — |
| apps/backend/src/modules/tax/application/dto | `apps/backend/src/modules/tax/application/dto/tax-request.dto.ts` | file | 082 | DTO |
| apps/backend/src/modules/tax/application/use-cases | `apps/backend/src/modules/tax/application/use-cases` | dir | 082 | — |
| apps/backend/src/modules/tax/application/use-cases | `apps/backend/src/modules/tax/application/use-cases/calculate-tax.use-case.ts` | file | 082 | — |
| apps/backend/src/modules/tax/application/use-cases | `apps/backend/src/modules/tax/application/use-cases/generate-50-tawi-pdf.use-case.ts` | file | 082 | — |
| apps/backend/src/modules/tax/domain | `apps/backend/src/modules/tax/domain` | dir | 082 | — |
| apps/backend/src/modules/tax/domain/entities | `apps/backend/src/modules/tax/domain/entities` | dir | 082 | — |
| apps/backend/src/modules/tax/domain/entities | `apps/backend/src/modules/tax/domain/entities/tax-certificate.entity.ts` | file | 082 | DDD entity |
| apps/backend/src/modules/tax/domain/services | `apps/backend/src/modules/tax/domain/services` | dir | 082 | — |
| apps/backend/src/modules/tax/domain/services | `apps/backend/src/modules/tax/domain/services/tax-calculator.domain-service.ts` | file | 082 | NestJS service |
| apps/backend/src/modules/tax/infrastructure | `apps/backend/src/modules/tax/infrastructure` | dir | 082 | — |
| apps/backend/src/modules/tax/infrastructure/pdf-generator | `apps/backend/src/modules/tax/infrastructure/pdf-generator` | dir | 082 | — |
| apps/backend/src/modules/tax/infrastructure/pdf-generator | `apps/backend/src/modules/tax/infrastructure/pdf-generator/pdf-compiler.service.ts` | file | 082 | NestJS service |
| apps/backend/src/modules/tax/infrastructure/pdf-generator/templates | `apps/backend/src/modules/tax/infrastructure/pdf-generator/templates` | dir | 082 | — |
| apps/backend/src/modules/tax/infrastructure/pdf-generator/templates | `apps/backend/src/modules/tax/infrastructure/pdf-generator/templates/50-tawi-template.tsx` | file | 082 | — |
| apps/backend/src/modules/tax/infrastructure/repositories | `apps/backend/src/modules/tax/infrastructure/repositories` | dir | 082 | — |
| apps/backend/src/modules/tax/infrastructure/repositories | `apps/backend/src/modules/tax/infrastructure/repositories/tax-prisma.repository.ts` | file | 082 | — |
| apps/backend/src/modules/tax/presentation | `apps/backend/src/modules/tax/presentation` | dir | 082 | — |
| apps/backend/src/modules/tax/presentation/graphql | `apps/backend/src/modules/tax/presentation/graphql` | dir | 082 | — |
| apps/backend/src/modules/tax/presentation/graphql | `apps/backend/src/modules/tax/presentation/graphql/tax.resolver.ts` | file | 082 | GraphQL resolver |
| apps/backend/src/modules/tax/presentation/webhooks | `apps/backend/src/modules/tax/presentation/webhooks` | dir | 082 | REST webhook |
| apps/backend/src/modules/tax/presentation/webhooks | `apps/backend/src/modules/tax/presentation/webhooks/tax-export.controller.ts` | file | 082 | REST webhook |
| apps/backend/src/modules/tenant | `apps/backend/src/modules/tenant` | dir | 030, 072 | — |
| apps/backend/src/modules/tenant | `apps/backend/src/modules/tenant/tenant-theme.module.ts` | file | 030 | NestJS module |
| apps/backend/src/modules/tenant | `apps/backend/src/modules/tenant/tenant-theme.resolver.ts` | file | 030 | GraphQL resolver |
| apps/backend/src/modules/tenant | `apps/backend/src/modules/tenant/tenant-theme.service.ts` | file | 030 | NestJS service |
| apps/backend/src/modules/tenant | `apps/backend/src/modules/tenant/tenant.controller.ts` | file | 072 | REST controller |
| apps/backend/src/modules/tenant | `apps/backend/src/modules/tenant/tenant.module.ts` | file | 072 | NestJS module |
| apps/backend/src/modules/tenant | `apps/backend/src/modules/tenant/tenant.service.ts` | file | 005, 072 | NestJS service |
| apps/backend/src/modules/tenant-orchestration | `apps/backend/src/modules/tenant-orchestration` | dir | 108 | — |
| apps/backend/src/modules/tenant-orchestration | `apps/backend/src/modules/tenant-orchestration/tenant-orchestration.module.ts` | file | 108 | NestJS module |
| apps/backend/src/modules/tenant-orchestration/controllers | `apps/backend/src/modules/tenant-orchestration/controllers` | dir | 108 | — |
| apps/backend/src/modules/tenant-orchestration/controllers | `apps/backend/src/modules/tenant-orchestration/controllers/tenant-orchestration.controller.ts` | file | 108 | REST controller |
| apps/backend/src/modules/tenant-orchestration/dto | `apps/backend/src/modules/tenant-orchestration/dto` | dir | 108 | — |
| apps/backend/src/modules/tenant-orchestration/dto | `apps/backend/src/modules/tenant-orchestration/dto/create-tenant.dto.ts` | file | 108 | DTO |
| apps/backend/src/modules/tenant-orchestration/dto | `apps/backend/src/modules/tenant-orchestration/dto/update-company-status.dto.ts` | file | 108 | DTO |
| apps/backend/src/modules/tenant-orchestration/resolvers | `apps/backend/src/modules/tenant-orchestration/resolvers` | dir | 108 | — |
| apps/backend/src/modules/tenant-orchestration/resolvers | `apps/backend/src/modules/tenant-orchestration/resolvers/tenant-orchestration.resolver.ts` | file | 108 | GraphQL resolver |
| apps/backend/src/modules/tenant-orchestration/services | `apps/backend/src/modules/tenant-orchestration/services` | dir | 108 | — |
| apps/backend/src/modules/tenant-orchestration/services | `apps/backend/src/modules/tenant-orchestration/services/domain-verification.service.ts` | file | 108 | NestJS service |
| apps/backend/src/modules/tenant-orchestration/services | `apps/backend/src/modules/tenant-orchestration/services/tenant-provisioning.service.ts` | file | 108 | NestJS service |
| apps/backend/src/modules/tenant-orchestration/services | `apps/backend/src/modules/tenant-orchestration/services/tenant-quota-enforcer.service.ts` | file | 108 | NestJS service |
| apps/backend/src/modules/tenant/domain | `apps/backend/src/modules/tenant/domain` | dir | 072 | — |
| apps/backend/src/modules/tenant/domain/entities | `apps/backend/src/modules/tenant/domain/entities` | dir | 072 | — |
| apps/backend/src/modules/tenant/domain/entities | `apps/backend/src/modules/tenant/domain/entities/company-theme.entity.ts` | file | 072 | DDD entity |
| apps/backend/src/modules/tenant/domain/services | `apps/backend/src/modules/tenant/domain/services` | dir | 072 | — |
| apps/backend/src/modules/tenant/domain/services | `apps/backend/src/modules/tenant/domain/services/contrast-calculator.service.ts` | file | 072 | NestJS service |
| apps/backend/src/modules/tenant/domain/value-objects | `apps/backend/src/modules/tenant/domain/value-objects` | dir | 072 | — |
| apps/backend/src/modules/tenant/domain/value-objects | `apps/backend/src/modules/tenant/domain/value-objects/theme-color.vo.ts` | file | 072 | — |
| apps/backend/src/modules/tenant/dto | `apps/backend/src/modules/tenant/dto` | dir | 030, 072 | — |
| apps/backend/src/modules/tenant/dto | `apps/backend/src/modules/tenant/dto/create-tenant.dto.ts` | file | 072 | DTO |
| apps/backend/src/modules/tenant/dto | `apps/backend/src/modules/tenant/dto/tenant-branding.dto.ts` | file | 030 | DTO |
| apps/backend/src/modules/tenant/dto | `apps/backend/src/modules/tenant/dto/update-navbar-theme.input.ts` | file | 030 | DTO |
| apps/backend/src/modules/tenant/dto | `apps/backend/src/modules/tenant/dto/update-theme.dto.ts` | file | 072 | DTO |
| apps/backend/src/modules/tenant/infrastructure | `apps/backend/src/modules/tenant/infrastructure` | dir | 072 | — |
| apps/backend/src/modules/tenant/infrastructure/cache | `apps/backend/src/modules/tenant/infrastructure/cache` | dir | 072 | — |
| apps/backend/src/modules/tenant/infrastructure/cache | `apps/backend/src/modules/tenant/infrastructure/cache/tenant-redis.cache.ts` | file | 072 | — |
| apps/backend/src/modules/tenant/infrastructure/persistence | `apps/backend/src/modules/tenant/infrastructure/persistence` | dir | 072 | — |
| apps/backend/src/modules/tenant/infrastructure/persistence | `apps/backend/src/modules/tenant/infrastructure/persistence/tenant-prisma.repository.ts` | file | 072 | — |
| apps/backend/src/modules/user | `apps/backend/src/modules/user` | dir | 107 | — |
| apps/backend/src/modules/user-inspector | `apps/backend/src/modules/user-inspector` | dir | 110 | — |
| apps/backend/src/modules/user-inspector | `apps/backend/src/modules/user-inspector/user-inspector.module.ts` | file | 110 | NestJS module |
| apps/backend/src/modules/user-inspector/controllers | `apps/backend/src/modules/user-inspector/controllers` | dir | 110 | — |
| apps/backend/src/modules/user-inspector/controllers | `apps/backend/src/modules/user-inspector/controllers/user-inspector.controller.ts` | file | 110 | REST controller |
| apps/backend/src/modules/user-inspector/dto | `apps/backend/src/modules/user-inspector/dto` | dir | 110 | — |
| apps/backend/src/modules/user-inspector/dto | `apps/backend/src/modules/user-inspector/dto/session-revoke.dto.ts` | file | 110 | DTO |
| apps/backend/src/modules/user-inspector/dto | `apps/backend/src/modules/user-inspector/dto/user-360-query.dto.ts` | file | 110 | DTO |
| apps/backend/src/modules/user-inspector/dto/(E-Book | `apps/backend/src/modules/user-inspector/dto/(E-Book` | dir | 110 | DTO |
| apps/backend/src/modules/user-inspector/repositories | `apps/backend/src/modules/user-inspector/repositories` | dir | 110 | — |
| apps/backend/src/modules/user-inspector/repositories | `apps/backend/src/modules/user-inspector/repositories/user-inspector.repository.ts` | file | 110 | — |
| apps/backend/src/modules/user-inspector/resolvers | `apps/backend/src/modules/user-inspector/resolvers` | dir | 110 | — |
| apps/backend/src/modules/user-inspector/resolvers | `apps/backend/src/modules/user-inspector/resolvers/user-inspector.resolver.ts` | file | 110 | GraphQL resolver |
| apps/backend/src/modules/user-inspector/services | `apps/backend/src/modules/user-inspector/services` | dir | 110 | — |
| apps/backend/src/modules/user-inspector/services | `apps/backend/src/modules/user-inspector/services/rfm-calculator.service.ts` | file | 110 | NestJS service |
| apps/backend/src/modules/user-inspector/services | `apps/backend/src/modules/user-inspector/services/security-telemetry.service.ts` | file | 110 | NestJS service |
| apps/backend/src/modules/user-inspector/services | `apps/backend/src/modules/user-inspector/services/user-inspector.service.ts` | file | 110 | NestJS service |
| apps/backend/src/modules/user-preference | `apps/backend/src/modules/user-preference` | dir | 066 | — |
| apps/backend/src/modules/user-preference | `apps/backend/src/modules/user-preference/user-preference.module.ts` | file | 066 | NestJS module |
| apps/backend/src/modules/user-preference | `apps/backend/src/modules/user-preference/user-preference.repository.ts` | file | 066 | — |
| apps/backend/src/modules/user-preference | `apps/backend/src/modules/user-preference/user-preference.resolver.ts` | file | 066 | GraphQL resolver |
| apps/backend/src/modules/user-preference | `apps/backend/src/modules/user-preference/user-preference.service.ts` | file | 066 | NestJS service |
| apps/backend/src/modules/user-preference/dto | `apps/backend/src/modules/user-preference/dto` | dir | 066 | — |
| apps/backend/src/modules/user-preference/dto | `apps/backend/src/modules/user-preference/dto/update-preference.dto.ts` | file | 066 | DTO |
| apps/backend/src/modules/user-preference/entities | `apps/backend/src/modules/user-preference/entities` | dir | 066 | — |
| apps/backend/src/modules/user-preference/entities | `apps/backend/src/modules/user-preference/entities/user-preference.entity.ts` | file | 066 | DDD entity |
| apps/backend/src/modules/vector-search | `apps/backend/src/modules/vector-search` | dir | 091 | — |
| apps/backend/src/modules/vector-search | `apps/backend/src/modules/vector-search/vector-search.module.ts` | file | 091 | NestJS module |
| apps/backend/src/modules/vector-search/controllers | `apps/backend/src/modules/vector-search/controllers` | dir | 091 | — |
| apps/backend/src/modules/vector-search/controllers | `apps/backend/src/modules/vector-search/controllers/vector-search.controller.ts` | file | 091 | REST controller |
| apps/backend/src/modules/vector-search/resolvers | `apps/backend/src/modules/vector-search/resolvers` | dir | 091 | — |
| apps/backend/src/modules/vector-search/resolvers | `apps/backend/src/modules/vector-search/resolvers/vector-search.resolver.ts` | file | 091 | GraphQL resolver |
| apps/backend/src/modules/vector-search/services | `apps/backend/src/modules/vector-search/services` | dir | 091 | — |
| apps/backend/src/modules/vector-search/services | `apps/backend/src/modules/vector-search/services/embedding-generator.service.ts` | file | 091 | NestJS service |
| apps/backend/src/modules/vector-search/services | `apps/backend/src/modules/vector-search/services/pgvector-repository.service.ts` | file | 091 | NestJS service |
| apps/backend/src/modules/vector-search/services | `apps/backend/src/modules/vector-search/services/semantic-search.service.ts` | file | 091 | NestJS service |
| apps/backend/src/modules/vector-store | `apps/backend/src/modules/vector-store` | dir | 092 | — |
| apps/backend/src/modules/version | `apps/backend/src/modules/version` | dir | 033 | — |
| apps/backend/src/modules/version | `apps/backend/src/modules/version/version.controller.ts` | file | 033 | REST controller |
| apps/backend/src/modules/version | `apps/backend/src/modules/version/version.module.ts` | file | 033 | NestJS module |
| apps/backend/src/modules/version | `apps/backend/src/modules/version/version.service.ts` | file | 033 | NestJS service |
| apps/backend/src/modules/version/dto | `apps/backend/src/modules/version/dto` | dir | 033 | — |
| apps/backend/src/modules/version/dto | `apps/backend/src/modules/version/dto/check-version.dto.ts` | file | 033 | DTO |
| apps/backend/src/modules/version/dto | `apps/backend/src/modules/version/dto/create-version.dto.ts` | file | 033 | DTO |
| apps/backend/src/modules/viewport | `apps/backend/src/modules/viewport/viewport.controller.ts` | file | 056 | REST controller |
| apps/backend/src/modules/viewport | `apps/backend/src/modules/viewport/viewport.service.ts` | file | 056 | NestJS service |
| apps/backend/src/modules/wallet | `apps/backend/src/modules/wallet` | dir | 017 | — |
| apps/backend/src/modules/wallet/application | `apps/backend/src/modules/wallet/application` | dir | 017 | — |
| apps/backend/src/modules/wallet/application | `apps/backend/src/modules/wallet/application/wallet-topup.controller.ts` | file | 017 | REST controller |
| apps/backend/src/modules/wallet/application | `apps/backend/src/modules/wallet/application/wallet.resolver.ts` | file | 017 | GraphQL resolver |
| apps/backend/src/modules/wallet/application | `apps/backend/src/modules/wallet/application/wallet.service.ts` | file | 017 | NestJS service |
| apps/backend/src/modules/wallet/domain | `apps/backend/src/modules/wallet/domain` | dir | 017 | — |
| apps/backend/src/modules/wallet/domain | `apps/backend/src/modules/wallet/domain/wallet-calculator.ts` | file | 017 | — |
| apps/backend/src/modules/wallet/domain | `apps/backend/src/modules/wallet/domain/wallet.entity.ts` | file | 017 | DDD entity |
| apps/backend/src/modules/wallet/infrastructure | `apps/backend/src/modules/wallet/infrastructure` | dir | 017 | — |
| apps/backend/src/modules/wallet/infrastructure | `apps/backend/src/modules/wallet/infrastructure/redis-lock.adapter.ts` | file | 017 | — |
| apps/backend/src/modules/wallet/infrastructure | `apps/backend/src/modules/wallet/infrastructure/wallet-prisma.repo.ts` | file | 017 | — |
| apps/backend/src/modules/watermark | `apps/backend/src/modules/watermark` | dir | 042 | — |
| apps/backend/src/modules/watermark | `apps/backend/src/modules/watermark/watermark.module.ts` | file | 042 | NestJS module |
| apps/backend/src/modules/watermark/application | `apps/backend/src/modules/watermark/application` | dir | 042 | — |
| apps/backend/src/modules/watermark/application/queries | `apps/backend/src/modules/watermark/application/queries` | dir | 042 | — |
| apps/backend/src/modules/watermark/application/queries | `apps/backend/src/modules/watermark/application/queries/get-watermark-seed.handler.ts` | file | 042 | — |
| apps/backend/src/modules/watermark/application/services | `apps/backend/src/modules/watermark/application/services` | dir | 042 | — |
| apps/backend/src/modules/watermark/application/services | `apps/backend/src/modules/watermark/application/services/forensic-extractor.service.ts` | file | 042 | NestJS service |
| apps/backend/src/modules/watermark/application/services | `apps/backend/src/modules/watermark/application/services/watermark-crypto.service.ts` | file | 042 | NestJS service |
| apps/backend/src/modules/watermark/backend | `apps/backend/src/modules/watermark/backend` | dir | 043 | — |
| apps/backend/src/modules/watermark/backend/jobs | `apps/backend/src/modules/watermark/backend/jobs` | dir | 043 | — |
| apps/backend/src/modules/watermark/backend/jobs/transcoder | `apps/backend/src/modules/watermark/backend/jobs/transcoder` | dir | 043 | — |
| apps/backend/src/modules/watermark/backend/jobs/transcoder | `apps/backend/src/modules/watermark/backend/jobs/transcoder/ffmpeg-worker.processor.ts` | file | 043 | — |
| apps/backend/src/modules/watermark/backend/jobs/transcoder | `apps/backend/src/modules/watermark/backend/jobs/transcoder/hls-encryptor.ts` | file | 043 | — |
| apps/backend/src/modules/watermark/backend/jobs/transcoder | `apps/backend/src/modules/watermark/backend/jobs/transcoder/watermark-injector.ts` | file | 043 | — |
| apps/backend/src/modules/watermark/backend/modules | `apps/backend/src/modules/watermark/backend/modules` | dir | 043 | — |
| apps/backend/src/modules/watermark/backend/modules/stream | `apps/backend/src/modules/watermark/backend/modules/stream` | dir | 043 | — |
| apps/backend/src/modules/watermark/backend/modules/stream | `apps/backend/src/modules/watermark/backend/modules/stream/stream.module.ts` | file | 043 | NestJS module |
| apps/backend/src/modules/watermark/backend/modules/stream/controllers | `apps/backend/src/modules/watermark/backend/modules/stream/controllers` | dir | 043 | — |
| apps/backend/src/modules/watermark/backend/modules/stream/controllers | `apps/backend/src/modules/watermark/backend/modules/stream/controllers/stream.controller.ts` | file | 043 | REST controller |
| apps/backend/src/modules/watermark/backend/modules/stream/controllers | `apps/backend/src/modules/watermark/backend/modules/stream/controllers/upload.controller.ts` | file | 043 | REST controller |
| apps/backend/src/modules/watermark/backend/modules/stream/services | `apps/backend/src/modules/watermark/backend/modules/stream/services` | dir | 043 | — |
| apps/backend/src/modules/watermark/backend/modules/stream/services | `apps/backend/src/modules/watermark/backend/modules/stream/services/stream.service.ts` | file | 043 | NestJS service |
| apps/backend/src/modules/watermark/backend/modules/stream/services | `apps/backend/src/modules/watermark/backend/modules/stream/services/video-upload.service.ts` | file | 043 | NestJS service |
| apps/backend/src/modules/watermark/domain | `apps/backend/src/modules/watermark/domain` | dir | 042 | — |
| apps/backend/src/modules/watermark/domain | `apps/backend/src/modules/watermark/domain/watermark-seed.entity.ts` | file | 042 | DDD entity |
| apps/backend/src/modules/watermark/domain/value-objects | `apps/backend/src/modules/watermark/domain/value-objects` | dir | 042 | — |
| apps/backend/src/modules/watermark/domain/value-objects | `apps/backend/src/modules/watermark/domain/value-objects/hmac-signature.vo.ts` | file | 042 | — |
| apps/backend/src/modules/watermark/infrastructure | `apps/backend/src/modules/watermark/infrastructure` | dir | 042 | — |
| apps/backend/src/modules/watermark/infrastructure/graphql | `apps/backend/src/modules/watermark/infrastructure/graphql` | dir | 042 | — |
| apps/backend/src/modules/watermark/infrastructure/graphql | `apps/backend/src/modules/watermark/infrastructure/graphql/watermark.resolver.ts` | file | 042 | GraphQL resolver |
| apps/backend/src/modules/watermark/infrastructure/repositories | `apps/backend/src/modules/watermark/infrastructure/repositories` | dir | 042 | — |
| apps/backend/src/modules/watermark/infrastructure/repositories | `apps/backend/src/modules/watermark/infrastructure/repositories/watermark-seed.repository.ts` | file | 042 | — |
| apps/backend/src/modules/watermark/workers | `apps/backend/src/modules/watermark/workers` | dir | 043 | — |
| apps/backend/src/modules/watermark/workers/cloudflare | `apps/backend/src/modules/watermark/workers/cloudflare` | dir | 043 | — |
| apps/backend/src/modules/watermark/workers/cloudflare | `apps/backend/src/modules/watermark/workers/cloudflare/video-event-router.ts` | file | 043 | — |
| apps/backend/src/presentation | `apps/backend/src/presentation` | dir | 106 | — |
| apps/backend/src/presentation/decorators | `apps/backend/src/presentation/decorators` | dir | 106 | — |
| apps/backend/src/presentation/decorators | `apps/backend/src/presentation/decorators/require-bitwise.decorator.ts` | file | 106 | — |
| apps/backend/src/presentation/decorators | `apps/backend/src/presentation/decorators/require-scopes.decorator.ts` | file | 106 | — |
| apps/backend/src/presentation/guards | `apps/backend/src/presentation/guards` | dir | 106 | — |
| apps/backend/src/presentation/guards | `apps/backend/src/presentation/guards/bitwise-permission.guard.ts` | file | 106 | NestJS guard |
| apps/backend/src/presentation/guards | `apps/backend/src/presentation/guards/jwt-scope.guard.ts` | file | 106 | NestJS guard |
| apps/backend/src/shared | `apps/backend/src/shared` | dir | 000, 102 | — |
| apps/backend/src/src | `apps/backend/src/src` | dir | 000 | — |
| apps/backend/src/strategies | `apps/backend/src/strategies/jwt.strategy.ts` | file | 005 | — |
| apps/backend/src/testing/k6 | `apps/backend/src/testing/k6` | dir | 126 | — |
| apps/backend/src/testing/k6 | `apps/backend/src/testing/k6/phase126-stress-test.ts` | file | 126 | — |
| apps/backend/src/webhooks | `apps/backend/src/webhooks/line-messaging.controller.ts` | file | 034 | REST webhook |
| apps/backend/src/workers/cloudflare | `apps/backend/src/workers/cloudflare/video-event-router.ts` | file | 043 | — |
| apps/backend/test | `apps/backend/test` | dir | 001 | — |
| apps/frontend | `apps/frontend` | dir | 001 | — |
| apps/frontend | `apps/frontend/instrumentation.ts` | file | 121 | Frontend file |
| apps/frontend | `apps/frontend/middleware.ts` | file | 001, 005, 021, 025, 028, 071, 072 | Next.js Edge middleware |
| apps/frontend | `apps/frontend/next.config.mjs` | file | 029 | Frontend file |
| apps/frontend | `apps/frontend/next.config.ts` | file | 001 | Frontend file |
| apps/frontend | `apps/frontend/package.json` | file | 001 | Frontend file |
| apps/frontend | `apps/frontend/postcss.config.mjs` | file | 001 | Frontend file |
| apps/frontend | `apps/frontend/sentry.client.config.ts` | file | 121 | Frontend file |
| apps/frontend | `apps/frontend/sentry.server.config.ts` | file | 121 | Frontend file |
| apps/frontend | `apps/frontend/tsconfig.json` | file | 001 | Frontend file |
| apps/frontend/app | `apps/frontend/app` | dir | 001 | Frontend file |
| apps/frontend/app | `apps/frontend/app/global.css` | file | 030 | Frontend file |
| apps/frontend/app | `apps/frontend/app/globals.css` | file | 001 | Frontend file |
| apps/frontend/app | `apps/frontend/app/layout.tsx` | file | 001 | React component/page |
| apps/frontend/app | `apps/frontend/app/page.tsx` | file | 001 | React component/page |
| apps/frontend/app/(liff | `apps/frontend/app/(liff` | dir | 000, 001, 025, 027, 029, 073, 093, 130 | Frontend file |
| apps/frontend/app/(web | `apps/frontend/app/(web` | dir | 130 | Frontend file |
| apps/frontend/app/api | `apps/frontend/app/api` | dir | 001 | Frontend file |
| apps/frontend/app/api/health | `apps/frontend/app/api/health` | dir | 001 | Frontend file |
| apps/frontend/app/api/health | `apps/frontend/app/api/health/route.ts` | file | 001 | Frontend file |
| apps/frontend/components | `apps/frontend/components` | dir | 001 | Frontend file |
| apps/frontend/components/admin | `apps/frontend/components/admin/audit-log-viewer.tsx` | file | 118 | React component/page |
| apps/frontend/components/admin | `apps/frontend/components/admin/permission-matrix-builder.tsx` | file | 106 | React component/page |
| apps/frontend/components/admin/kyc-modal | `apps/frontend/components/admin/kyc-modal` | dir | 109 | Frontend file |
| apps/frontend/components/admin/user-table | `apps/frontend/components/admin/user-table` | dir | 109 | Frontend file |
| apps/frontend/components/affiliate | `apps/frontend/components/affiliate` | dir | 079 | Frontend file |
| apps/frontend/components/ai | `apps/frontend/components/ai` | dir | 092 | Frontend file |
| apps/frontend/components/analytics | `apps/frontend/components/analytics` | dir | 116 | Frontend file |
| apps/frontend/components/analytics | `apps/frontend/components/analytics/HeatmapViewer.tsx` | file | 052 | React component/page |
| apps/frontend/components/auth | `apps/frontend/components/auth/LineOAPromptModal.tsx` | file | 034 | React component/page |
| apps/frontend/components/auth | `apps/frontend/components/auth/qr-code-display.tsx` | file | 007 | React component/page |
| apps/frontend/components/auth | `apps/frontend/components/auth/qr-code-scanner.tsx` | file | 007 | React component/page |
| apps/frontend/components/auth/ | `apps/frontend/components/auth/` | dir | 006 | Frontend file |
| apps/frontend/components/builder | `apps/frontend/components/builder` | dir | 074 | Frontend file |
| apps/frontend/components/cart/ | `apps/frontend/components/cart/` | dir | 011 | Frontend file |
| apps/frontend/components/catalog/ | `apps/frontend/components/catalog/` | dir | 009 | Frontend file |
| apps/frontend/components/certificate | `apps/frontend/components/certificate` | dir | 048 | Frontend file |
| apps/frontend/components/certificate | `apps/frontend/components/certificate/CertificateVerificationBadge.tsx` | file | 105 | React component/page |
| apps/frontend/components/certificate | `apps/frontend/components/certificate/CertificateViewCard.tsx` | file | 105 | React component/page |
| apps/frontend/components/chat | `apps/frontend/components/chat` | dir | 103 | Frontend file |
| apps/frontend/components/checkout | `apps/frontend/components/checkout/coupon-selector.tsx` | file | 117 | React component/page |
| apps/frontend/components/checkout | `apps/frontend/components/checkout/PaywallModal.tsx` | file | 051 | React component/page |
| apps/frontend/components/checkout | `apps/frontend/components/checkout/PromptPayCheckout.tsx` | file | 031 | React component/page |
| apps/frontend/components/checkout | `apps/frontend/components/checkout/PromptPayQrDisplay.tsx` | file | 016 | React component/page |
| apps/frontend/components/checkout | `apps/frontend/components/checkout/PromptPayQRWidget.tsx` | file | 013 | React component/page |
| apps/frontend/components/checkout | `apps/frontend/components/checkout/slip-upload-zone.tsx` | file | 015 | React component/page |
| apps/frontend/components/checkout | `apps/frontend/components/checkout/SlipPhotoPicker.tsx` | file | 016 | React component/page |
| apps/frontend/components/checkout | `apps/frontend/components/checkout/SlipUploadModal.tsx` | file | 014 | React component/page |
| apps/frontend/components/co-pilot | `apps/frontend/components/co-pilot` | dir | 094 | Frontend file |
| apps/frontend/components/creator | `apps/frontend/components/creator/video-upload-progress.tsx` | file | 044 | React component/page |
| apps/frontend/components/dashboard | `apps/frontend/components/dashboard` | dir | 073 | Frontend file |
| apps/frontend/components/dispute | `apps/frontend/components/dispute` | dir | 113 | Frontend file |
| apps/frontend/components/dispute | `apps/frontend/components/dispute/LiffDisputeDrawer.tsx` | file | 113 | React component/page |
| apps/frontend/components/download-manager | `apps/frontend/components/download-manager` | dir | 068 | Frontend file |
| apps/frontend/components/download-manager | `apps/frontend/components/download-manager/DownloadManagerDrawer.tsx` | file | 068 | React component/page |
| apps/frontend/components/finance/ | `apps/frontend/components/finance/` | dir | 081 | Frontend file |
| apps/frontend/components/flash-sale | `apps/frontend/components/flash-sale` | dir | 087 | Frontend file |
| apps/frontend/components/flash-sale | `apps/frontend/components/flash-sale/CountdownTimer.tsx` | file | 087 | React component/page |
| apps/frontend/components/flex-builder | `apps/frontend/components/flex-builder` | dir | 024 | Frontend file |
| apps/frontend/components/flex-builder | `apps/frontend/components/flex-builder/FlexMessagePreview.tsx` | file | 024 | React component/page |
| apps/frontend/components/fulfillment | `apps/frontend/components/fulfillment` | dir | 077 | Frontend file |
| apps/frontend/components/gamification | `apps/frontend/components/gamification` | dir | 083, 096 | Frontend file |
| apps/frontend/components/gift | `apps/frontend/components/gift` | dir | 089 | Frontend file |
| apps/frontend/components/gift | `apps/frontend/components/gift/GiftCreatorStudio.tsx` | file | 089 | React component/page |
| apps/frontend/components/group-buying | `apps/frontend/components/group-buying` | dir | 090 | Frontend file |
| apps/frontend/components/group-buying | `apps/frontend/components/group-buying/BuddyPassShareCard.tsx` | file | 090 | React component/page |
| apps/frontend/components/header | `apps/frontend/components/header/DynamicHeaderIntegrator.tsx` | file | 023 | React component/page |
| apps/frontend/components/hr | `apps/frontend/components/hr` | dir | 098 | Frontend file |
| apps/frontend/components/identity | `apps/frontend/components/identity` | dir | 003 | Frontend file |
| apps/frontend/components/inspector | `apps/frontend/components/inspector` | dir | 110 | Frontend file |
| apps/frontend/components/inventory | `apps/frontend/components/inventory` | dir | 075 | Frontend file |
| apps/frontend/components/keep-alive | `apps/frontend/components/keep-alive/KeepAliveProvider.tsx` | file | 031 | React component/page |
| apps/frontend/components/keep-alive | `apps/frontend/components/keep-alive/useKeepAlive.ts` | file | 031 | Frontend file |
| apps/frontend/components/kyc | `apps/frontend/components/kyc` | dir | 085, 111 | Frontend file |
| apps/frontend/components/library/ | `apps/frontend/components/library/` | dir | 018 | Frontend file |
| apps/frontend/components/liff | `apps/frontend/components/liff/LiffNavbarCustomizer.tsx` | file | 030 | React component/page |
| apps/frontend/components/live | `apps/frontend/components/live` | dir | 101 | Frontend file |
| apps/frontend/components/live | `apps/frontend/components/live/LiveChatOverlay.tsx` | file | 099 | React component/page |
| apps/frontend/components/live | `apps/frontend/components/live/LiveInteractionOverlay.tsx` | file | 101 | React component/page |
| apps/frontend/components/live | `apps/frontend/components/live/LivePollModal.tsx` | file | 099 | React component/page |
| apps/frontend/components/live | `apps/frontend/components/live/WebRtcIvsPlayer.tsx` | file | 099 | React component/page |
| apps/frontend/components/messaging | `apps/frontend/components/messaging` | dir | 084 | Frontend file |
| apps/frontend/components/moderation | `apps/frontend/components/moderation` | dir | 112 | Frontend file |
| apps/frontend/components/navigation | `apps/frontend/components/navigation/liff-router-provider.tsx` | file | 027 | React component/page |
| apps/frontend/components/network | `apps/frontend/components/network/NetworkStatusBanner.tsx` | file | 069 | React component/page |
| apps/frontend/components/offline | `apps/frontend/components/offline/SyncStatusBadge.tsx` | file | 064 | React component/page |
| apps/frontend/components/payment | `apps/frontend/components/payment/PromptPayCheckoutCard.tsx` | file | 020 | React component/page |
| apps/frontend/components/payment | `apps/frontend/components/payment/PromptPayQrModal.tsx` | file | 012 | React component/page |
| apps/frontend/components/payment | `apps/frontend/components/payment/SlipUploadDrawer.tsx` | file | 124 | React component/page |
| apps/frontend/components/payment/ | `apps/frontend/components/payment/` | dir | 020 | Frontend file |
| apps/frontend/components/payout | `apps/frontend/components/payout` | dir | 086 | Frontend file |
| apps/frontend/components/payout | `apps/frontend/components/payout/PayoutRequestForm.tsx` | file | 086 | React component/page |
| apps/frontend/components/pdp | `apps/frontend/components/pdp` | dir | 010 | Frontend file |
| apps/frontend/components/pdp | `apps/frontend/components/pdp/ProductDetailPage.tsx` | file | 010 | React component/page |
| apps/frontend/components/performance | `apps/frontend/components/performance` | dir | 029 | Frontend file |
| apps/frontend/components/permissions | `apps/frontend/components/permissions/PermissionDialog.tsx` | file | 032 | React component/page |
| apps/frontend/components/permissions | `apps/frontend/components/permissions/PrePermissionSheet.tsx` | file | 032 | React component/page |
| apps/frontend/components/player | `apps/frontend/components/player` | dir | 000 | Frontend file |
| apps/frontend/components/player | `apps/frontend/components/player/AdaptiveHlsPlayer.tsx` | file | 056 | React component/page |
| apps/frontend/components/player | `apps/frontend/components/player/hls-video-player.tsx` | file | 050 | React component/page |
| apps/frontend/components/player | `apps/frontend/components/player/HLSPlayerOverlay.tsx` | file | 026 | React component/page |
| apps/frontend/components/player | `apps/frontend/components/player/HlsPlayerSyncOverlay.tsx` | file | 057 | React component/page |
| apps/frontend/components/player | `apps/frontend/components/player/HlsPreviewPlayer.tsx` | file | 051 | React component/page |
| apps/frontend/components/player | `apps/frontend/components/player/HlsQuizPlayer.tsx` | file | 047 | React component/page |
| apps/frontend/components/player | `apps/frontend/components/player/HlsVideoPlayer.tsx` | file | 031, 045, 053 | React component/page |
| apps/frontend/components/player | `apps/frontend/components/player/OfflineHlsPlayer.tsx` | file | 063 | React component/page |
| apps/frontend/components/player | `apps/frontend/components/player/QualitySelector.tsx` | file | 045 | React component/page |
| apps/frontend/components/player | `apps/frontend/components/player/SpeedController.tsx` | file | 045 | React component/page |
| apps/frontend/components/player | `apps/frontend/components/player/thumbnail-preview-tooltip.tsx` | file | 058 | React component/page |
| apps/frontend/components/player | `apps/frontend/components/player/video-scrubbing-bar.tsx` | file | 058 | React component/page |
| apps/frontend/components/player | `apps/frontend/components/player/VideoWatermarkOverlay.tsx` | file | 042, 045 | React component/page |
| apps/frontend/components/promotion | `apps/frontend/components/promotion` | dir | 088 | Frontend file |
| apps/frontend/components/promotion | `apps/frontend/components/promotion/StackableCouponDrawer.tsx` | file | 088 | React component/page |
| apps/frontend/components/providers | `apps/frontend/components/providers` | dir | 001 | Frontend file |
| apps/frontend/components/providers | `apps/frontend/components/providers/liff-provider.tsx` | file | 001 | React component/page |
| apps/frontend/components/providers | `apps/frontend/components/providers/tenant-provider.tsx` | file | 001 | React component/page |
| apps/frontend/components/pwa | `apps/frontend/components/pwa/offline-indicator.tsx` | file | 062 | React component/page |
| apps/frontend/components/quiz | `apps/frontend/components/quiz` | dir | 093 | Frontend file |
| apps/frontend/components/quiz | `apps/frontend/components/quiz/InVideoQuizOverlay.tsx` | file | 047 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader` | dir | 000, 004, 005, 015, 093, 109, 126 | Frontend file |
| apps/frontend/components/reader | `apps/frontend/components/reader/AdaptiveCanvasReader.tsx` | file | 056 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/AiAskModal.tsx` | file | 091 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/AiReaderOverlay.tsx` | file | 092 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/BookmarkManager.tsx` | file | 041 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/canvas-reader.tsx` | file | 029 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/CanvasMultiResolutionScaler.tsx` | file | 060 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/CanvasPreviewReader.tsx` | file | 051 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/CanvasReader.tsx` | file | 031, 040, 124 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/CanvasReaderEngine.tsx` | file | 042, 055 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/CanvasReaderOverlay.tsx` | file | 026 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/CanvasReaderSafeAreaWrapper.tsx` | file | 022 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/CanvasReaderSyncOverlay.tsx` | file | 057 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/DrmShuffledCanvasReader.tsx` | file | 049 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/DualDrmCanvasReader.tsx` | file | 061 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/DynamicDprManager.ts` | file | 060 | Frontend file |
| apps/frontend/components/reader | `apps/frontend/components/reader/EdgeAwareCanvasReader.tsx` | file | 125 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/ForegroundWatermarkOverlay.tsx` | file | 042 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/forensic-watermark.ts` | file | 061 | Frontend file |
| apps/frontend/components/reader | `apps/frontend/components/reader/ForensicWatermarkOverlay.tsx` | file | 060 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/HighlightAnnotationOverlay.tsx` | file | 041 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/LineLiffCanvasReader.tsx` | file | 023, 041, 069 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/MarginNoteDrawer.tsx` | file | 095 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/OfflineCanvasReader.tsx` | file | 063 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/PageNavigationSlider.tsx` | file | 041 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/r2-vector-fetcher.ts` | file | 036 | Frontend file |
| apps/frontend/components/reader | `apps/frontend/components/reader/ReaderControlBar.tsx` | file | 041 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/ReaderGestureMapper.tsx` | file | 059 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/ReaderKeyboardHandler.tsx` | file | 059 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/ResilientCanvasReader.tsx` | file | 124 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/SocialReadingOverlay.tsx` | file | 095 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/ThemeSettingsPopover.tsx` | file | 041 | React component/page |
| apps/frontend/components/reader | `apps/frontend/components/reader/webgl-deshuffler.ts` | file | 061 | Frontend file |
| apps/frontend/components/reader/hooks | `apps/frontend/components/reader/hooks/useSlidingWindow.ts` | file | 040 | Frontend lib/hook/store |
| apps/frontend/components/reader/utils | `apps/frontend/components/reader/utils/memoryManager.ts` | file | 040 | Frontend file |
| apps/frontend/components/reader/watermark | `apps/frontend/components/reader/watermark/ForensicWatermark.tsx` | file | 040 | React component/page |
| apps/frontend/components/recommendation | `apps/frontend/components/recommendation` | dir | 104 | Frontend file |
| apps/frontend/components/recommendation | `apps/frontend/components/recommendation/AIRecommendedSlate.tsx` | file | 104 | React component/page |
| apps/frontend/components/reconciliation | `apps/frontend/components/reconciliation` | dir | 115 | Frontend file |
| apps/frontend/components/reward | `apps/frontend/components/reward` | dir | 083 | Frontend file |
| apps/frontend/components/sandbox | `apps/frontend/components/sandbox` | dir | 035 | Frontend file |
| apps/frontend/components/search | `apps/frontend/components/search/predictive-search-bar.tsx` | file | 009 | React component/page |
| apps/frontend/components/search | `apps/frontend/components/search/SemanticSearchInput.tsx` | file | 091 | React component/page |
| apps/frontend/components/security | `apps/frontend/components/security` | dir | 119 | Frontend file |
| apps/frontend/components/security | `apps/frontend/components/security/login-history-modal.tsx` | file | 120 | React component/page |
| apps/frontend/components/security | `apps/frontend/components/security/masked-field.tsx` | file | 107 | React component/page |
| apps/frontend/components/security | `apps/frontend/components/security/PdpaConsentModal.tsx` | file | 129 | React component/page |
| apps/frontend/components/security/ | `apps/frontend/components/security/` | dir | 129 | Frontend file |
| apps/frontend/components/share | `apps/frontend/components/share/FlexShareButton.tsx` | file | 080 | React component/page |
| apps/frontend/components/share | `apps/frontend/components/share/NativeActionButton.tsx` | file | 026 | React component/page |
| apps/frontend/components/squad | `apps/frontend/components/squad` | dir | 096 | Frontend file |
| apps/frontend/components/squad | `apps/frontend/components/squad/StudySquadDashboard.tsx` | file | 096 | React component/page |
| apps/frontend/components/storefront | `apps/frontend/components/storefront` | dir | 010 | Frontend file |
| apps/frontend/components/storefront | `apps/frontend/components/storefront/StorefrontHome.tsx` | file | 010 | React component/page |
| apps/frontend/components/stream | `apps/frontend/components/stream/AdaptiveHlsPlayer.tsx` | file | 055 | React component/page |
| apps/frontend/components/stream | `apps/frontend/components/stream/AdaptiveVideoPlayer.tsx` | file | 067 | React component/page |
| apps/frontend/components/stream | `apps/frontend/components/stream/DynamicLiveWatermark.tsx` | file | 100 | React component/page |
| apps/frontend/components/stream | `apps/frontend/components/stream/hls-r2-player.tsx` | file | 036 | React component/page |
| apps/frontend/components/stream | `apps/frontend/components/stream/HlsVideoPlayer.tsx` | file | 043 | React component/page |
| apps/frontend/components/stream | `apps/frontend/components/stream/LivePlayerWithVODFallback.tsx` | file | 102 | React component/page |
| apps/frontend/components/stream | `apps/frontend/components/stream/LiveStreamGatekeeperPlayer.tsx` | file | 100 | React component/page |
| apps/frontend/components/studio | `apps/frontend/components/studio/curriculum-builder.tsx` | file | 078 | React component/page |
| apps/frontend/components/studio | `apps/frontend/components/studio/hls-uploader.tsx` | file | 078 | React component/page |
| apps/frontend/components/studio | `apps/frontend/components/studio/quiz-builder.tsx` | file | 078 | React component/page |
| apps/frontend/components/studio | `apps/frontend/components/studio/VideoUploaderStudio.tsx` | file | 043 | React component/page |
| apps/frontend/components/super-admin/tenants | `apps/frontend/components/super-admin/tenants` | dir | 108 | Frontend file |
| apps/frontend/components/support | `apps/frontend/components/support` | dir | 103 | Frontend file |
| apps/frontend/components/tax | `apps/frontend/components/tax` | dir | 082 | Frontend file |
| apps/frontend/components/theme | `apps/frontend/components/theme` | dir | 072 | Frontend file |
| apps/frontend/components/theme | `apps/frontend/components/theme/theme-toggle.tsx` | file | 066 | React component/page |
| apps/frontend/components/thermal-print | `apps/frontend/components/thermal-print` | dir | 076 | Frontend file |
| apps/frontend/components/ui | `apps/frontend/components/ui` | dir | 001 | Frontend file |
| apps/frontend/components/updater | `apps/frontend/components/updater/AutoUpdateChecker.tsx` | file | 033 | React component/page |
| apps/frontend/components/video | `apps/frontend/components/video/AiVideoOverlay.tsx` | file | 092 | React component/page |
| apps/frontend/components/video | `apps/frontend/components/video/HlsVideoPlayer.tsx` | file | 046, 054 | React component/page |
| apps/frontend/components/video | `apps/frontend/components/video/InVideoNoteEngine.tsx` | file | 065 | React component/page |
| apps/frontend/components/video | `apps/frontend/components/video/NoteListDrawer.tsx` | file | 065 | React component/page |
| apps/frontend/components/video | `apps/frontend/components/video/VideoResumeToast.tsx` | file | 054 | React component/page |
| apps/frontend/components/video/hooks | `apps/frontend/components/video/hooks/useVideoProgressSync.ts` | file | 046 | Frontend lib/hook/store |
| apps/frontend/components/viewport | `apps/frontend/components/viewport/UniversalViewportRouter.tsx` | file | 056 | React component/page |
| apps/frontend/components/wallet | `apps/frontend/components/wallet` | dir | 017 | Frontend file |
| apps/frontend/components/wallet | `apps/frontend/components/wallet/OneClickBuyButton.tsx` | file | 017 | React component/page |
| apps/frontend/hooks | `apps/frontend/hooks/use-liff-navigation.ts` | file | 027 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/use-liff.ts` | file | 021 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/use-permission.ts` | file | 106 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useCrossDeviceSync.ts` | file | 070 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useDevicePermissions.ts` | file | 032 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useDynamicHeader.ts` | file | 023 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useEnvironmentDetection.ts` | file | 022 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useForensicWatermark.ts` | file | 042 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useLiffTheme.ts` | file | 030 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useLineAuth.ts` | file | 005 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useLineAuthAndFriendship.ts` | file | 034 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useLineFlexShare.ts` | file | 080 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useLineLiffAuth.ts` | file | 129 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useLineShareTargetPicker.ts` | file | 026 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useLiveSocket.ts` | file | 101 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useNetworkBandwidth.ts` | file | 067 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useNetworkStatus.ts` | file | 069 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useProgressSync.ts` | file | 057, 064 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useReaderNavigation.ts` | file | 059 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useReadWatchTracker.ts` | file | 052 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useRedisEdgeChunk.ts` | file | 039 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useRetinaCanvasScaler.ts` | file | 060 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useSlipVerification.ts` | file | 014 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useVideoProgress.ts` | file | 054 | Frontend lib/hook/store |
| apps/frontend/hooks | `apps/frontend/hooks/useViewportEnvironment.ts` | file | 056 | Frontend lib/hook/store |
| apps/frontend/lib | `apps/frontend/lib/api-client.ts` | file | 122 | Frontend lib/hook/store |
| apps/frontend/lib | `apps/frontend/lib/apollo-client.ts` | file | 004 | Frontend lib/hook/store |
| apps/frontend/lib | `apps/frontend/lib/auth-session.ts` | file | 005 | Frontend lib/hook/store |
| apps/frontend/lib | `apps/frontend/lib/hls-quality-selector.ts` | file | 067 | Frontend lib/hook/store |
| apps/frontend/lib | `apps/frontend/lib/liff-sdk.ts` | file | 027 | Frontend lib/hook/store |
| apps/frontend/lib | `apps/frontend/lib/offline-queue-db.ts` | file | 069 | Frontend lib/hook/store |
| apps/frontend/lib/crypto | `apps/frontend/lib/crypto/offline-drm.ts` | file | 068 | Frontend lib/hook/store |
| apps/frontend/lib/fingerprint | `apps/frontend/lib/fingerprint` | dir | 119 | Frontend lib/hook/store |
| apps/frontend/lib/fingerprint | `apps/frontend/lib/fingerprint/fingerprint-collector.ts` | file | 119 | Frontend lib/hook/store |
| apps/frontend/lib/liff | `apps/frontend/lib/liff/liff-sdk.ts` | file | 021 | Frontend lib/hook/store |
| apps/frontend/lib/observability | `apps/frontend/lib/observability/liff-logger.ts` | file | 121 | Frontend lib/hook/store |
| apps/frontend/lib/offline | `apps/frontend/lib/offline/background-sync-manager.ts` | file | 064 | Frontend lib/hook/store |
| apps/frontend/lib/offline | `apps/frontend/lib/offline/indexeddb-queue.ts` | file | 064 | Frontend lib/hook/store |
| apps/frontend/lib/offline | `apps/frontend/lib/offline/indexeddb-schema.ts` | file | 063 | Frontend lib/hook/store |
| apps/frontend/lib/offline | `apps/frontend/lib/offline/offline-manager.ts` | file | 063 | Frontend lib/hook/store |
| apps/frontend/lib/prefetch | `apps/frontend/lib/prefetch` | dir | 029 | Frontend lib/hook/store |
| apps/frontend/lib/pwa | `apps/frontend/lib/pwa/background-sync.ts` | file | 062 | Frontend lib/hook/store |
| apps/frontend/lib/pwa | `apps/frontend/lib/pwa/indexeddb-engine.ts` | file | 062 | Frontend lib/hook/store |
| apps/frontend/lib/pwa | `apps/frontend/lib/pwa/sw-register.ts` | file | 062 | Frontend lib/hook/store |
| apps/frontend/lib/pwa | `apps/frontend/lib/pwa/workbox-strategy.ts` | file | 062 | Frontend lib/hook/store |
| apps/frontend/lib/storage | `apps/frontend/lib/storage/opfs-engine.ts` | file | 068 | Frontend lib/hook/store |
| apps/frontend/lib/tenant | `apps/frontend/lib/tenant/tenant-resolver.ts` | file | 071 | Frontend lib/hook/store |
| apps/frontend/lib/tenant | `apps/frontend/lib/tenant/theme-provider.tsx` | file | 071 | React component/page |
| apps/frontend/modules/download-manager | `apps/frontend/modules/download-manager` | dir | 068 | Frontend file |
| apps/frontend/providers | `apps/frontend/providers/LiffAuthProvider.tsx` | file | 006 | React component/page |
| apps/frontend/providers | `apps/frontend/providers/NetworkMonitorProvider.tsx` | file | 069 | React component/page |
| apps/frontend/providers | `apps/frontend/providers/SafeAreaProvider.tsx` | file | 022 | React component/page |
| apps/frontend/providers | `apps/frontend/providers/TenantThemeProvider.tsx` | file | 030 | React component/page |
| apps/frontend/providers | `apps/frontend/providers/theme-provider.tsx` | file | 066 | React component/page |
| apps/frontend/public | `apps/frontend/public/service-worker.js` | file | 063 | Frontend file |
| apps/frontend/public | `apps/frontend/public/sw-prefetch.js` | file | 029 | Frontend file |
| apps/frontend/public | `apps/frontend/public/sw.js` | file | 062, 064 | Frontend file |
| apps/frontend/service-workers | `apps/frontend/service-workers/sw-update-handler.ts` | file | 033 | Frontend file |
| apps/frontend/stores | `apps/frontend/stores/headerStore.ts` | file | 023 | Frontend lib/hook/store |
| apps/frontend/stores | `apps/frontend/stores/use-navigation-store.ts` | file | 027 | Frontend lib/hook/store |
| apps/frontend/stores | `apps/frontend/stores/use-theme-store.ts` | file | 066 | Frontend lib/hook/store |
| apps/frontend/stores | `apps/frontend/stores/useCartStore.ts` | file | 011 | Frontend lib/hook/store |
| apps/frontend/stores | `apps/frontend/stores/useNoteStore.ts` | file | 065 | Frontend lib/hook/store |
| apps/frontend/stores | `apps/frontend/stores/useReaderStore.ts` | file | 041, 059 | Frontend lib/hook/store |
| apps/frontend/styles | `apps/frontend/styles/globals.css` | file | 072 | Frontend file |
| apps/frontend/styles | `apps/frontend/styles/safe-area.css` | file | 022 | Frontend file |
| apps/frontend/types | `apps/frontend/types/liff.d.ts` | file | 021 | Frontend file |
| apps/frontend/workers | `apps/frontend/workers/download-worker.ts` | file | 068 | Frontend file |
| apps/frontend/workers | `apps/frontend/workers/pixel-unshuffle.worker.ts` | file | 049 | Frontend file |
| e2e | `e2e/checkout-flow.spec.ts` | file | 020 | — |
| packages/db | `packages/db` | dir | 001 | — |
| packages/db/migrations | `packages/db/migrations` | dir | 128 | — |
| packages/db/prisma | `packages/db/prisma/seed.ts` | file | 009, 074, 076 | — |
| packages/db/prisma/migrations | `packages/db/prisma/migrations` | dir | 095 | — |
| packages/db/prisma/migrations/ | `packages/db/prisma/migrations/` | dir | 008 | — |
| packages/db/prisma/migrations/20261005 | `packages/db/prisma/migrations/20261005` | dir | 091 | — |
| packages/db/prisma/schema.prisma | `packages/db/prisma/schema.prisma` | dir | 000, 001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 021, 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046, 047, 048, 049, 050, 051, 052, 053, 054, 055, 056, 057, 058, 059, 060, 061, 062, 063, 064, 065, 066, 067, 068, 069, 070, 071, 072, 073, 074, 075, 076, 077, 078, 079, 080, 081, 082, 083, 084, 085, 086, 087, 088, 089, 090, 091, 092, 093, 094, 095, 096, 097, 098, 099, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 126, 127, 128, 129, 130 | Prisma SSOT รวม 279 models |
| packages/db/src | `packages/db/src/index.ts` | file | 001 | — |
| packages/eslint-config | `packages/eslint-config` | dir | 001 | — |
| packages/shared | `packages/shared` | dir | 001 | — |
| packages/shared/src/schemas | `packages/shared/src/schemas/affiliate-contract.ts` | file | 079 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/analytics-contract.ts` | file | 052, 116 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/auth-contract.ts` | file | 005, 006 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/b2b-contract.ts` | file | 097, 098 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/book-pipeline.zod.ts` | file | 038 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/canvas-scaler.schema.ts` | file | 060 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/catalog.zod.ts` | file | 008 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/certificate-contract.ts` | file | 048 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/certificate-verification.schema.ts` | file | 105 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/chunk-cache.schema.ts` | file | 039 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/clearinghouse-contract.ts` | file | 114 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/coupon-contract.ts` | file | 117 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/cross-device-sync.schema.ts` | file | 070 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/drm-contract.ts` | file | 049 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/drm-shuffling.schema.ts` | file | 061 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/ebook-course-contract.ts` | file | 037 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/entitlement.schema.ts` | file | 012 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/environment-contract.ts` | file | 022 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/flash-sale-contract.ts` | file | 087 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/flex-share.schema.ts` | file | 080 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/fulfillment-contract.ts` | file | 076 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/gift-contract.ts` | file | 089 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/group-buying-contract.ts` | file | 090 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/header-contract.ts` | file | 023 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/hls-stream-contract.ts` | file | 053 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/identity.zod.ts` | file | 003 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/infra-env.schema.ts` | file | 002 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/inspector-contract.ts` | file | 110 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/inventory-contract.ts` | file | 075 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/keep-alive-contract.ts` | file | 031 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/kyc-contract.ts` | file | 085 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/library-contract.ts` | file | 018 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/liff-auth.schema.ts` | file | 021 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/line-oa-contract.ts` | file | 034 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/line-receipt.schema.ts` | file | 019 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/line-review-contract.ts` | file | 035 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/live-contract.ts` | file | 099, 101 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/live-entitlement-contract.ts` | file | 100 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/live-to-vod.schema.ts` | file | 102 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/navigation-event-contract.ts` | file | 059 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/network-status.schema.ts` | file | 069 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/offline-sync-schema.ts` | file | 062 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/offline-sync.schema.ts` | file | 063 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/order.schema.ts` | file | 012 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/payment-slip.schema.ts` | file | 015 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/payment.schema.ts` | file | 012 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/pdpa-scope.schema.ts` | file | 107 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/permission-contract.ts` | file | 032 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/permission-matrix.schema.ts` | file | 106 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/phase001-init.ts` | file | 001 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/product-builder.schema.ts` | file | 074 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/product-search.schema.ts` | file | 009 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/progress-sync-contract.ts` | file | 057 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/progress-sync.schema.ts` | file | 046, 064 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/promotion.schema.ts` | file | 088 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/promptpay-schema.ts` | file | 013 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/quiz-contract.ts` | file | 047 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/r2-lifecycle.schema.ts` | file | 123 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/r2-storage-contract.ts` | file | 036 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/reader-control-contract.ts` | file | 041 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/reader.schema.ts` | file | 040 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/recommendation.contract.ts` | file | 104 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/reconciliation-contract.ts` | file | 115 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/resolver-contract.ts` | file | 025 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/scrubbing-vtt.schema.ts` | file | 058 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/sdid-contract.ts` | file | 000, 001, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 021, 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046, 047, 048, 049, 050, 051, 052, 053, 054, 055, 056, 057, 058, 059, 060, 061, 062, 063, 064, 065, 066, 067, 068, 069, 070, 071, 072, 073, 074, 075, 076, 077, 078, 079, 080, 081, 082, 083, 084, 085, 086, 087, 088, 089, 090, 091, 092, 093, 094, 095, 096, 097, 098, 099, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/security-csp.schema.ts` | file | 028 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/slip-picker.zod.ts` | file | 016 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/slip-verification.schema.ts` | file | 014 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/social-reading.schema.ts` | file | 095 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/squad-gamification.zod.ts` | file | 096 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/storefront.schema.ts` | file | 010 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/stream-contract.ts` | file | 045 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/tax-contract.ts` | file | 082 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/telemetry-contract.ts` | file | 121 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/telemetry.ts` | file | 130 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/tenant-branding.schema.ts` | file | 030 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/tenant-contract.ts` | file | 071 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/theme-contract.ts` | file | 072 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/theme-preference.schema.ts` | file | 066 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/version-contract.ts` | file | 033 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/video-pipeline-contract.ts` | file | 043 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/video-quality-schema.ts` | file | 067 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/video-security.schema.ts` | file | 050 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/viewport-contract.ts` | file | 056 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/wallet-contract.ts` | file | 017 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/watermark-contract.ts` | file | 042 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/zod-graphql-contracts.ts` | file | 004 | Zod SSOT contract |
| packages/shared/src/schemas | `packages/shared/src/schemas/zod-stream.ts` | file | 054 | Zod SSOT contract |
| packages/shared/src/schemas/progress-sync.schema | `packages/shared/src/schemas/progress-sync.schema` | dir | 046 | Zod SSOT contract |
| packages/shared/src/schemas/zod-stream | `packages/shared/src/schemas/zod-stream` | dir | 054 | Zod SSOT contract |
| packages/shared/src/types | `packages/shared/src/types/entitlement.ts` | file | 068 | — |
| packages/shared/src/types | `packages/shared/src/types/graphql.ts` | file | 004 | — |
| packages/shared/src/types | `packages/shared/src/types/tenant-config.ts` | file | 073 | — |
| packages/shared/src/types | `packages/shared/src/types/tenant.ts` | file | 006 | — |
| packages/shared/src/utils | `packages/shared/src/utils` | dir | 010 | — |
| packages/tsconfig | `packages/tsconfig` | dir | 001 | — |
| scripts | `scripts/check-bundle-size.ts` | file | 029 | Script/QA |
| scripts | `scripts/verify-phase001.ts` | file | 001 | Script/QA |
| test | `test/csp-whitelisting.spec.ts` | file | 028 | — |
| test/chaos | `test/chaos/k6-slip-timeout-simulation.js` | file | 124 | — |
