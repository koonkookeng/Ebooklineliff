// SSOT Phase 008 §5.1 — catalog admin REST (seller CRUD + stock + soft-delete)
// Canonical: apps/backend/src/modules/catalog/presentation/rest/catalog-admin.controller.ts
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseGuards, ForbiddenException, BadRequestException } from '@nestjs/common';
import { CreateProductUseCase } from '../../application/commands/create-product.command';
import { UpdateStockUseCase } from '../../application/commands/update-stock.command';
import { GetProductBySlugUseCase } from '../../application/queries/get-product-by-slug.query';
import { ListCatalogUseCase } from '../../application/queries/list-catalog.query';
import { PrismaCatalogRepository } from '../../infrastructure/repositories/prisma-catalog.repository';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import type { CreateProduct } from '@repo/shared';

interface AuthedReq {
  user?: { id?: string; role?: string };
  headers: Record<string, string | undefined>;
}

function sellerOnly(req: AuthedReq): void {
  const role = req.user?.role;
  if (role !== 'SELLER' && role !== 'SUPER_ADMIN' && role !== 'FINANCE_ADMIN') {
    throw new ForbiddenException('Seller role required');
  }
}

@Controller('admin/catalog')
export class CatalogAdminController {
  constructor(
    private readonly createProductCmd: CreateProductUseCase,
    private readonly updateStockCmd: UpdateStockUseCase,
    private readonly bySlugQuery: GetProductBySlugUseCase,
    private readonly listQuery: ListCatalogUseCase,
    private readonly repo: PrismaCatalogRepository,
  ) {}

  @Get()
  async listPublic(
    @Query('tenantId') tenantId: string | undefined,
    @Query('productType') productType: string | undefined,
    @Query('search') search: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
  ) {
    return this.listQuery.execute({
      tenantId,
      productType: productType as never,
      search,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  @Get(':slug')
  async bySlug(@Param('slug') slug: string) {
    return this.bySlugQuery.execute(slug);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: CreateProduct, @Req() req: AuthedReq) {
    sellerOnly(req);
    return this.createProductCmd.execute(body);
  }

  @Patch(':id/stock')
  @UseGuards(JwtAuthGuard)
  async stock(@Param('id') id: string, @Body() body: { deltaQty?: number }, @Req() req: AuthedReq) {
    sellerOnly(req);
    if (typeof body?.deltaQty !== 'number') throw new BadRequestException('Invalid stock delta');
    return this.updateStockCmd.execute({ productId: id, deltaQty: body.deltaQty });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req: AuthedReq) {
    sellerOnly(req);
    return this.repo.softDelete(id);
  }
}
