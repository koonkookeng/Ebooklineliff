# ADR-048: Auto-Certificate PDF Engine (QR + HMAC-SHA256 Verification)

- Status: Accepted (Atomic Phase 048, PHASE-048-CERT-QR)
- Date: 2026-10-07
- SSOT: `packages/shared/src/schemas/certificate-contract.ts`
  (`CertificateStatusEnum`, `GenerateCertificateInputSchema`,
  `VerifyCertificateResponseSchema`, `CertificatePayloadSchema`,
  `CertificateItemSchema` + `generateCertificateNo`/`buildVerifyUrl`/
  `buildHmacPayload`/`signCertificate`/`certificateR2Path` helpers)
  + `packages/db/prisma/schema.prisma` (`CourseCertificate` with
  `@@unique(userId, courseId)`, `User.courseCertificates` /
  `CourseDetail.certificates` back-relations; zero destructive changes)

## Context

Course completion must mint a tamper-evident PDF certificate in <1.2s,
verifiable by third parties in <200ms via QR scan, with zero new
dependencies, LIFF RAM <30MB, and R2 zero-egress delivery.

## Decision

1. **Completion-gate on the per-lesson model**: `CourseLearningProgress` is
   keyed `(userId, lessonId)`, so the generator collects lesson ids via
   `CourseDetail → sections → lessons` and requires every row `isCompleted`
   (fail-fast 400 otherwise); the `CourseCompletedEventHandler` stays
   idempotent on `@@unique(userId, courseId)` and emits `certificate.issued`
   through a local `CertificateEventBus` port (node:events, no
   `@nestjs/event-emitter` dep).
2. **HMAC bound to identity**: signature payload is
   `certNo:userId:courseId:displayName` (SSOT `buildHmacPayload`), verified
   with length-guarded `timingSafeEqual` (no throw on forged lengths);
   revoked/expired statuses verify as invalid.
3. **Lazy heavy deps**: `qrcode`/`puppeteer-core`/`@sparticuz/chromium` are
   prod-only and lazy-required inside adapters with deterministic fallbacks,
   so contract tests and typecheck stay dependency-free; PDF bytes land on
   R2 via `putObjectBuffer` (`certificates/<CERT>.pdf`).
4. **Public verification is rate-limited**: 20 req/min/IP fixed window on
   the shared Redis cluster; GraphQL (`verifyCertificate`,
   `getMyCertificates`, `issueCourseCertificate`) is code-first with an SDL
   supplement, REST lives under `/api/v1/certificate`, and the LIFF verify
   page implements the 5-state machine with inline-SVG glyphs (no
   lucide-react dep, per zero-new-deps precedent).

## Consequences

- Duplicate issuance races collapse to 400 via the unique gate + P2002 map.
- Forged/unequal-length signatures return `isValid: false`, never 500.
- 9 contract checks x3 loops + 047/046/045 regressions green; backend
  typecheck keeps only the 1 pre-existing reader legacy-alias error.
