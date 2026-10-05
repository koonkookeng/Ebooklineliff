# memory.md — Long-term Memory (130 Phases)

- SSOT: `schema.md` (279 models / 117 enums consolidated) + `filefolder.md` (2168 canonical paths: 1374 files + 794 dirs, Turborepo `apps/* + packages/*`)
- Canonical mapping: `src/backend/** -> apps/backend/src/**`, `src/frontend/** -> apps/frontend/**`, `src/shared/** -> packages/shared/src/**`, `src/database/prisma/** -> packages/db/prisma/**`
- Phase 000 core models: User, Product, PhysicalDetail, EbookDetail, CourseDetail, Entitlement, Order, OrderItem, PaymentSlip, EbookReadingProgress, CourseLearningProgress
- Constraints: LIFF RAM < 30MB, Slip < 1s atomic, R2 zero-egress, 5 UI states, 9 gatekeepers
- Roadmap: `docs/phase-roadmap-130.md` (Atomic 000-130)
- Last scaffold: run `node scripts/scaffold-from-inventory.mjs` to regenerate tree from filefolder.md + full prisma from schema.md
- Phase 001 DONE (b23e83d): monorepo core verified 100/100 (prisma valid + backend/frontend typecheck + zod 5/5 + health runtime); next: Phase 002
- Phase 002 DONE (a531265): infra engine verified 100/100 incl. Phase001 regression (compose config + phase002 typecheck + infra zod 3/3); next: Phase 003
