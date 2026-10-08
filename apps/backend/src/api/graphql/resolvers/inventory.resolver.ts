// SSOT Phase 075 §3.2 — legacy alias (canonical lives in modules/inventory)
// Canonical: apps/backend/src/api/graphql/resolvers/inventory.resolver.ts
// Re-export only (Phase 026/028/029 precedent); registered once via InventoryModule.
export { InventoryResolver } from '../../../modules/inventory/presentation/inventory.resolver';
