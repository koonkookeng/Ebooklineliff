# ADR-068: In-App Download Manager (Encrypted Offline Storage)

- Status: Accepted (Atomic Phase 068, PHASE-068-DOWNLOAD-MGR)
- Date: 2026-10-08
- SSOT: `packages/shared/src/schemas/offline-license.schema.ts`
  (`DownloadStatusEnum`, `StorageCategoryEnum`, `DownloadTaskSchema`,
  `StorageQuotaSchema`, `OfflineLicenseTokenSchema` + chunk/quota/
  license budgets + `licenseCanonical`/`isStorageLow`/
  `downloadProgress` helpers)
  + Prisma `OfflineLicense` / `DeviceStorageProfile`
  (+ `User`/`Product` back-relations)

## Context

Phase 062/063 own the generic offline queue + media caches (063 DRM
leases cover short-lived playback grants). Phase 068 adds the user-facing
download layer: resumable encrypted downloads, offline license gilt for
long-lived offline access, quota UI, and expiry/eviction.

## Decision

1. **RISK_CALL deviations (zero-new-dep LIFF policy):**
   - No `dexie.js` — OPFS primary + tiny dedicated `zene-downloads`
     IDB fallback (legacy devices); the shared 063 IDB is untouched.
   - No `lucide-react` / shadcn `@/components/ui` (neither vendored) —
     Tailwind + inline SVG/emoji, same 5 states, 44px targets.
   - No `CurrentUser` decorator (does not exist in this codebase) —
     `req.user` identity like every other controller.
   - HMAC-SHA256 license signatures instead of ED25519 (no new key
     infra; same tamper-evidence for server-issued opaque tokens).
   - Trust model (§8.1): authenticity is bound at issuance over TLS;
     the content key is delivered once and stored device-local
     (same-origin); escrow cipher (AES-256-GCM, Phase 003 envelope
     pattern) enables server recovery. Offline checks = expiry +
     SHA-256 integrity (no client-side secrets to steal).
   - `src/frontend/modules/download-manager/**` maps to the
     established `stores/use-download-store.ts` + `lib/download/` +
     `components/download-manager/` (no parallel modules/ tree).
2. **Memory:** worker fetches ≤2MB Range slices, encrypts in-worker,
   transfers ciphertext (transferables); main thread appends to OPFS.
   ≤2MB in flight; plaintext never persisted.
3. **License lifecycle:** entitlement-gated issue → atomic upsert on
   `@@unique(userId, productId, deviceIdHash)` → validity reads
   (VALID/EXPIRED/REVOKED/MISSING) → owner-only revoke; 7d default,
   30d max; issue/revoke fanned to `events:offline-license`.
4. **Analytics (Task 7):** pulse POST when online, else dedicated
   `zene-download-events` IDB drained on `online` — isolated from the
   052 telemetry queue (no cross-phase poisoning).
5. **UI:** `DownloadManagerDrawer` (IDLE → progress/pause/resume/cancel
   → OFFLINE_READY / EXPIRED overlay), `StorageUsageBar` (10% warning),
   4 license proxies.

## Consequences

- Full offline reads/watching behind license + quota guards.
- Follow-ups: ED25519 migration if cross-vendor verification is needed;
  LRU auto-eviction policy engine.
