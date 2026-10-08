// SSOT Phase 060 §5.1 — legacy-path alias (filefolder.md canonical mapping)
// Canonical: apps/backend/src/modules/reader/resolvers/reader.resolver.ts
// (legacy src/backend/modules/reader/resolvers/reader.resolver.ts)
// - Re-export only; the retina query lives on the module-root ReaderResolver
//   (single code-first intent layer, Phase 040 precedent).
export * from '../reader.resolver';
