// SSOT Phase 009 §5.1 — PredictiveSearch CQRS query (DTO; validated at handler boundary)
// Canonical: apps/backend/src/modules/catalog/application/queries/predictive-search.query.ts
export class PredictiveSearchQuery {
  constructor(
    readonly query: string,
    readonly limit = 5,
    readonly tenantId?: string,
    readonly lineUserId?: string,
  ) {}
}
