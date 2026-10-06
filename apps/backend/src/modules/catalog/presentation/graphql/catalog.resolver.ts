// SSOT Phase 008 §5.1 — catalog GraphQL presentation (storefront queries + seller mutations)
// Canonical: apps/backend/src/modules/catalog/presentation/graphql/catalog.resolver.ts
// (legacy src/backend/modules/catalog/presentation/graphql/catalog.resolver.ts)
import { Resolver, Query, Mutation, Args, Context, InputType, Field, ObjectType, Int, Float, ID } from '@nestjs/graphql';
import { BadRequestException, ForbiddenException, UseGuards } from '@nestjs/common';
import { CreateProductUseCase } from '../../application/commands/create-product.command';
import { UpdateStockUseCase } from '../../application/commands/update-stock.command';
import { GetProductBySlugUseCase } from '../../application/queries/get-product-by-slug.query';
import { ListCatalogUseCase } from '../../application/queries/list-catalog.query';
import { PrismaCatalogRepository } from '../../infrastructure/repositories/prisma-catalog.repository';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import type { GraphQLContext } from '../../../../api/graphql/context/graphql-context.factory';

@ObjectType('CatalogStock')
class CatalogStock {
  @Field(() => Int) stockQty!: number;
  @Field(() => Int) reservedQty!: number;
  @Field(() => Int) available!: number;
  @Field() sku!: string;
}

@ObjectType('CatalogProduct')
class CatalogProduct {
  @Field(() => ID) id!: string;
  @Field({ nullable: true }) tenantId!: string | null;
  @Field() sellerId!: string;
  @Field() title!: string;
  @Field() slug!: string;
  @Field({ nullable: true }) description!: string | null;
  @Field() productType!: string;
  @Field() status!: string;
  @Field(() => Float) priceBaht!: number;
  @Field(() => Float, { nullable: true }) discountBaht!: number | null;
  @Field() isPublished!: boolean;
  @Field(() => CatalogStock, { nullable: true }) stock!: CatalogStock | null;
  @Field(() => [String]) bundleChildIds!: string[];
}

@InputType('PhysicalDetailInput')
class PhysicalDetailInput {
  @Field({ nullable: true }) isbn?: string;
  @Field(() => Int) weightGrams!: number;
  @Field(() => Int, { defaultValue: 0 }) stockQty!: number;
  @Field() sku!: string;
}

@InputType('EbookDetailInput')
class EbookDetailInput {
  @Field(() => Int) totalPages!: number;
  @Field(() => Int, { defaultValue: 10 }) previewPages!: number;
  @Field() storagePathR2!: string;
  @Field() fileHash!: string;
}

@InputType('CourseDetailInput')
class CourseDetailInput {
  @Field(() => Float, { defaultValue: 0 }) totalHours!: number;
}

@InputType('CreateProductInput')
class CreateProductInput {
  @Field({ nullable: true }) tenantId?: string;
  @Field() sellerId!: string;
  @Field() title!: string;
  @Field() slug!: string;
  @Field() description!: string;
  @Field() coverImageUrl!: string;
  @Field() productType!: string;
  @Field(() => Float) price!: number;
  @Field(() => Float, { nullable: true }) discountPrice?: number;
  @Field(() => PhysicalDetailInput, { nullable: true }) physicalDetail?: PhysicalDetailInput;
  @Field(() => EbookDetailInput, { nullable: true }) ebookDetail?: EbookDetailInput;
  @Field(() => CourseDetailInput, { nullable: true }) courseDetail?: CourseDetailInput;
  @Field(() => [String], { nullable: true }) bundleItemIds?: string[];
}

function toPayload(p: {
  id: string; tenantId: string | null; sellerId: string; title: string; slug: string;
  description?: string | null;
  productType: string; status: string; priceSatang: number; discountSatang: number | null;
  isPublished: boolean; stock: CatalogStock | null; bundleChildIds: string[];
}): CatalogProduct {
  const out = new CatalogProduct();
  out.id = p.id;
  out.tenantId = p.tenantId;
  out.sellerId = p.sellerId;
  out.title = p.title;
  out.slug = p.slug;
  out.description = p.description ?? null;
  out.productType = p.productType;
  out.status = p.status;
  out.priceBaht = p.priceSatang / 100;
  out.discountBaht = p.discountSatang === null ? null : p.discountSatang / 100;
  out.isPublished = p.isPublished;
  out.stock = p.stock;
  out.bundleChildIds = p.bundleChildIds;
  return out;
}

function sellerOnly(ctx: GraphQLContext): void {
  const role = ctx.req.user?.role;
  if (role !== 'SELLER' && role !== 'SUPER_ADMIN' && role !== 'FINANCE_ADMIN') {
    throw new ForbiddenException('Seller role required');
  }
}

@Resolver('CatalogProduct')
export class CatalogResolver {
  constructor(
    private readonly createProductCmd: CreateProductUseCase,
    private readonly updateStockCmd: UpdateStockUseCase,
    private readonly bySlugQuery: GetProductBySlugUseCase,
    private readonly listQuery: ListCatalogUseCase,
    private readonly repo: PrismaCatalogRepository,
  ) {}

  @Query('productBySlug')
  async productBySlug(@Args('slug') slug: string) {
    return this.bySlugQuery.execute(slug);
  }

  @Query('catalogList')
  async catalogList(
    @Args('tenantId', { nullable: true }) tenantId: string | undefined,
    @Args('productType', { nullable: true }) productType: string | undefined,
    @Args('search', { nullable: true }) search: string | undefined,
    @Args('page', { type: () => Int, nullable: true }) page: number | undefined,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize: number | undefined,
    @Context() ctx: GraphQLContext,
  ) {
    const fallback = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ctx.tenantId)
      ? ctx.tenantId
      : undefined;
    const items = await this.listQuery.execute({
      tenantId: tenantId ?? fallback,
      productType: productType as never,
      search,
      page: page ?? 1,
      pageSize: pageSize ?? 20,
    });
    return { ...items, items: items.items.map(toPayload) };
  }

  @Mutation('createProduct')
  @UseGuards(JwtAuthGuard)
  async createProduct(@Args('input') input: CreateProductInput, @Context() ctx: GraphQLContext) {
    sellerOnly(ctx);
    const created = await this.createProductCmd.execute({
      tenantId: input.tenantId,
      sellerId: input.sellerId,
      title: input.title,
      slug: input.slug,
      description: input.description,
      coverImageUrl: input.coverImageUrl,
      productType: input.productType as never,
      price: input.price,
      discountPrice: input.discountPrice,
      physicalDetail: input.physicalDetail as never,
      ebookDetail: input.ebookDetail as never,
      courseDetail: input.courseDetail as never,
      bundleItemIds: input.bundleItemIds as never,
    });
    return toPayload(created);
  }

  @Mutation('deleteProduct')
  @UseGuards(JwtAuthGuard)
  async deleteProduct(@Args('productId') productId: string, @Context() ctx: GraphQLContext) {
    sellerOnly(ctx);
    if (!productId) throw new BadRequestException('Missing product id');
    return toPayload(await this.repo.softDelete(productId));
  }

  @Mutation('updateStock')
  @UseGuards(JwtAuthGuard)
  async updateStock(
    @Args('productId') productId: string,
    @Args('deltaQty', { type: () => Int }) deltaQty: number,
    @Context() ctx: GraphQLContext,
  ) {
    sellerOnly(ctx);
    return toPayload(await this.updateStockCmd.execute({ productId, deltaQty }));
  }
}
