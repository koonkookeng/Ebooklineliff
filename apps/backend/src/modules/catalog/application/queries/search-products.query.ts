// SSOT Phase 009 §5.1 — SearchProducts CQRS query (DTO; validated at handler boundary)
// Canonical: apps/backend/src/modules/catalog/application/queries/search-products.query.ts
import type { ProductFilterInput } from '@repo/shared';

export class SearchProductsQuery {
  constructor(readonly filter: ProductFilterInput) {}
}
