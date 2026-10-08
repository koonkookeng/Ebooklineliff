# ADR-074 — Universal Product Builder Wizard

## Status
Accepted (verified 100/100 x3 post-refactor + Phase073/071/008 regressions green).

## Context
Phase 074 needs a 4-format product wizard (physical/ebook/course/bundle)
with 5s draft autosave, R2 direct upload, and atomic publish. Prior art:
073 dashboard upsert (single-format), 008 catalog, 036 R2 vault, 043/044
transcode, 071 guards. 074 adds the full studio without duplicating them.

## Decision
- **SSOT**: `product-builder.schema.ts` keeps spec-verbatim Zod (§3.1) +
  step-gate schemas (basics/pricing) for mid-wizard validation; slug regex
  typo fixed; `ProductTypeEnum` reused from sdid-contract.
- **Prisma expand-contract**: `ProductDraft` only (BundleItem/sections/
  lessons pre-exist — relation-name variance `ChildProducts` kept, no
  rename migration).
- **Backend**: scaffold dirs implemented (DraftStorage Redis+PG, atomic
  publish txn for all 4 formats + PRODUCT_PUBLISHED_EVENT via xaddPipeline,
  R2 presign delegate with tenant-vaulted keys, dual-guard REST, code-first
  GQL + SDL, module wiring). Spec bugs fixed (nil-uuid upsert, `as any`,
  tx-return shape).
- **Frontend**: `(studio)/builder` wizard with react-hook-form (present dep,
  KYC precedent) but WITHOUT zodResolver (RHF/resolvers type variance —
  manual safeParse gates from the same SSOT file instead); CSS slide (no
  framer-motion dep); 5s autosave hook with restore; 4 tenant proxies.
  Inactive type subtrees unregistered on switch (refine hygiene).
- **Upload**: builder presign only — bytes bypass servers; transcode stays
  in 043/044 by objectKey handoff.

## Consequences
- `ProductBuilderModule` renamed from scaffold `ProductBuilderModuleModule`
  (no importers existed — verified).
- Follow-ups: Playwright wizard E2E (§10), AI metadata (092/094), SSR
  initialTheme for builder.
