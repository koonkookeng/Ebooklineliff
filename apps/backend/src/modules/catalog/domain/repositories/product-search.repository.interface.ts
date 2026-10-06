// SSOT Phase 009 §5.1 — Product search repository port (DDD interface)
// Canonical: apps/backend/src/modules/catalog/domain/repositories/product-search.repository.interface.ts
import type { ProductFilterInput, ProductSearchResponse, PredictiveSuggestion } from '@repo/shared';

export const PRODUCT_SEARCH_REPOSITORY = Symbol('PRODUCT_SEARCH_REPOSITORY');

export interface IProductSearchRepository {
  search(filter: ProductFilterInput): Promise<ProductSearchResponse>;
  predictive(query: string, limit: number): Promise<PredictiveSuggestion[]>;
}
