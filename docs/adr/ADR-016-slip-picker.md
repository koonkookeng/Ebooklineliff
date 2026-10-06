# ADR-016 — LIFF Native Photo Picker Checkout

- Status: Accepted
- Phase: PHASE-016-SLIP-PICKER
- Date: 2026-10-06

## Context
Phases 012–015 built the verify engine; three upload components already
exist (modal, zone, widget). Phase 016 adds the LINE-native entry point:
`liff.chooseImage()` where hosted, album/camera fallback elsewhere, a
composed QR+picker order page, and client-observed checkout analytics.
Two doc prescriptions are deliberately not built (reasoned below).

## Decision
- SSOT: `packages/shared/src/schemas/slip-picker.schema.ts` (picker source
  enum, 3 analytics events, 10MB source guard, 300KB target). Verify/
  provider/response shapes are NOT duplicated from Phases 014/015.
  Prisma + sdid-contract are untouched (both READ_ONLY in the phase
  boundary — and nothing new is needed).
- No presigned-URL endpoint: uploads stay server-side SigV4 (the existing
  `SlipUploadService`). Rationale: R2 secrets never reach the client,
  slip bytes are magic-byte validated server-side, and the forensic
  SHA-256 stays trustworthy (a client-reported hash or a second server
  re-fetch would weaken it or cost the <1s budget). Zero-egress is
  preserved (R2→EasySlip fetch is egress-free). The doc's `Button`/
  `lucide-react`/`node-fetch` imports are likewise superseded by repo
  policy (native buttons, inline SVG, global fetch).
- `liff.chooseImage` is capability-detected behind a dynamic import (no
  static `@line/liff` dep — it is not installed; standard LIFF webviews
  fall through to album/camera file inputs, mirroring the doc's own
  fallback logic).
- Single compression: `useSlipVerification` now returns `compressedKb` on
  its outcome, so the picker emits analytics without a second canvas pass
  (review catch — double compression on low-end phones).
- New surface: `SlipPhotoPicker` (native→album/camera, preview with revoke
  discipline, analytics around the single pipeline), `PromptPayQrDisplay`
  (presentational QR+amount+countdown; the bundled widget flow is
  untouched), `[orderId]` page (order fetch + fractional QR mint +
  Display/Picker composition + tenant `?color&logo` + IndexedDB
  last-known fallback offline), `GET /api/checkout/orders/[id]` proxy,
  `POST /api/v1/payment/slip-analytics` ingest (Zod-validated →
  `stream:analytics:payments`, best-effort ack even on Redis outage).
- Backend wiring: `SlipPickerAnalyticsService` + `SlipPickerController`
  registered in OrderModule; `slip-picker.dto.ts` holds the thin types.
  The payment-root `slip-verification.service` needed no changes
  (verified in review).

## Consequences
- Trade-off: `?amount=`-style display params are untrusted display only;
  the server remains the amount source of truth at verify time.
- Trade-off: IndexedDB cache is last-known (possibly stale) and clearly
  labeled offline in the UI; it never authorizes payment.
- Rollback: delete the picker page/routes; schemas additive.

## Gates (9/9)
1. SSOT sync (Zod≡service≡tests, 5 groups) 2. tsc (0 new backend
errors, frontend clean) 3. 5 picker/page states 4. replay/rate guards
inherited (012–015 regressions green) 5. ≤300KB + revoke + bundle
guard PASS 6. R2 zero-egress preserved 7. atomic txn path unchanged
(<1s) 8. picker analytics fan-out ordered 9. this ADR.
