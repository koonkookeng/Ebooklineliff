// SSOT Phase 102 — Legacy R2 uploader alias (canonical: modules/stream/infrastructure)
// - The vault single source lives in
//   infrastructure/r2-vault-storage.adapter.ts (§9 — no duplicated upload
//   logic). This file only re-exports it for the IN_SCOPE stream path.
//   Zero new deps.
export { R2VaultStorageAdapter } from './infrastructure/r2-vault-storage.adapter';

// Back-compat alias for the early double-suffixed class name.
export { R2VaultStorageAdapter as R2UploaderServiceService } from './infrastructure/r2-vault-storage.adapter';
