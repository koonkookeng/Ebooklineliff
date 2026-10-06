// SSOT Phase 009 §5.1 — Product search REST (LIFF predictive <50ms + faceted catalog)
// Canonical: apps/backend/src/modules/catalog/presentation/rest/product-search.controller.ts
import { Controller, Get, Query, Req, BadRequestException } from '@nestjs/common';
import { ProductFilterInputSchema } from '@repo/shared';
import { SearchProductsQuery } from '../../application/queries/search-products.query';
import { PredictiveSearchQuery } from '../../application/queries/predictive-search.query';
import { SearchProductsHandler } from '../../application/handlers/search-products.handler';
import { PredictiveSearchHandler } from '../../application/handlers/predictive-search.handler';

interface ReqLike {
  headers: Record<string, string | string[] | undefined>;
  user?: { id?: string };
}

function headerTenant(req: ReqLike): string | undefined {
  const h = req.headers['x-tenant-id'];
  const v = Array.isArray(h) ? h[0] : h;
  return v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : undefined;
}

@Controller('api/search')
export class ProductSearchController {
  constructor(
    private readonly searchHandler: SearchProductsHandler,
    private readonly predictiveHandler: PredictiveSearchHandler,
  ) {}

  /** GET /api/search/predictive?q=...&limit=5 — debounced 150ms by client, Redis <5ms on hit. */
  @Get('predictive')
  async predictive(
    @Query('q') q: string,
    @Query('limit') limitRaw: string | undefined,
    @Req() req: ReqLike,
  ) {
    if (!q?.trim()) throw new BadRequestException('Missing query param q');
    const limit = limitRaw ? Number(limitRaw) : 5;
    return this.predictiveHandler.execute(
      new PredictiveSearchQuery(q, limit, headerTenant(req), req.user?.id),
    );
  }

  /** GET /api/search/catalog?query=&productTypes=EBOOK&minPrice=&maxPrice=&sortBy=&page=&limit= */
  @Get('catalog')
  async catalog(@Query() qs: Record<string, string | string[] | undefined>, @Req() req: ReqLike) {
    const str = (v: string | string[] | undefined): string | undefined =>
      Array.isArray(v) ? v[0] : v;
    const list = (v: string | string[] | undefined): string[] | undefined =>
      Array.isArray(v) ? v : v ? v.split(',') : undefined;
    const parsed = ProductFilterInputSchema.safeParse({
      tenantId: headerTenant(req) ?? str(qs['tenantId']),
      query: str(qs['query'] ?? qs['q']),
      productTypes: list(qs['productTypes']) as never,
      categoryIds: list(qs['categoryIds']),
      minPrice: qs['minPrice'] !== undefined ? Number(str(qs['minPrice'])) : undefined,
      maxPrice: qs['maxPrice'] !== undefined ? Number(str(qs['maxPrice'])) : undefined,
      inStockOnly: str(qs['inStockOnly']) === 'true',
      ratingMin: qs['ratingMin'] !== undefined ? Number(str(qs['ratingMin'])) : undefined,
      sortBy: (str(qs['sortBy']) as never) ?? 'RELEVANCE',
      page: qs['page'] !== undefined ? Number(str(qs['page'])) : 1,
      limit: qs['limit'] !== undefined ? Number(str(qs['limit'])) : 20,
      cursor: str(qs['cursor']),
    });
    if (!parsed.success) throw new BadRequestException('Invalid catalog filter');
    return this.searchHandler.execute(new SearchProductsQuery(parsed.data));
  }
}
