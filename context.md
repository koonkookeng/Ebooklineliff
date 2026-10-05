# context.md — SDID Context (Phase-144-XZ-EXTENDED)

- BUSINESS_GOAL: Multi-tenant e-commerce (physical/ebook/course/live/bundle) + Canvas reader <30MB + HLS + PromptPay auto-slip <1s + Flex viral share
- FRAMEWORK: Next.js 15 / React 19 PWA, Shadcn + Tailwind v4, multi-tenant CSS vars (--primary-color, --logo-url, --font-family)
- BDD:
  - Sliding window N-1,N,N+1 via Redis edge, watermark overlay, GC N-2
  - Slip upload -> NestJS webhook -> EasySlip transRef/account/amount -> atomic COMPLETED + entitlement <1s
- STATE_MACHINE: LIFF_INIT (splash) -> IDLE -> LOADING (skeleton) -> SUCCESS (zustand+canvas) / ERROR (fallback+toast+retry)
- STORAGE: R2 vector SVG chunks + HLS segments, $0 egress; Redis edge cache; IndexedDB offline
- Map legacy `src/*` mentions in Phases/*.md to canonical via filefolder.md rules before generating code.
