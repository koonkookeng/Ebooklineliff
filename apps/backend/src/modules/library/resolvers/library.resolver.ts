// SSOT Phase 018 §3.2/§5 — Library GraphQL presentation (assets + gate)
// Canonical: apps/backend/src/modules/library/resolvers/library.resolver.ts
// (legacy src/backend/api/graphql/resolvers/library.resolver.ts)
import { Resolver, Query, Args, Context, ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';
import { BadRequestException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { MyLibraryQueryInputSchema } from '@repo/shared';
import { LibraryService } from '../services/library.service';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import type { GraphQLContext } from '../../../api/graphql/context/graphql-context.factory';

@ObjectType('DigitalAsset')
class DigitalAssetGql {
  @Field(() => ID) id!: string;
  @Field(() => ID) productId!: string;
  @Field() title!: string;
  @Field() coverImageUrl!: string;
  @Field() assetType!: string;
  @Field() accessType!: string;
  @Field({ nullable: true }) expiresAt!: string | null;
  @Field(() => Float) progressPercentage!: number;
  @Field(() => Int, { nullable: true }) lastAccessedPage?: number;
  @Field(() => Int, { nullable: true }) lastAccessedTimeSec?: number;
  @Field(() => Int) totalUnits!: number;
  @Field(() => Int) completedUnits!: number;
  @Field() lastAccessedAt!: string;
  @Field() isDownloadAvailableOffline!: boolean;
}

@ObjectType('MyLibraryPayload')
class MyLibraryPayloadGql {
  @Field(() => [DigitalAssetGql]) assets!: DigitalAssetGql[];
  @Field(() => Int) totalCount!: number;
  @Field(() => Int) currentPage!: number;
  @Field(() => Int) totalPages!: number;
  @Field() hasMore!: boolean;
}

@ObjectType('LibraryGateResult')
class LibraryGateResultGql {
  @Field() hasAccess!: boolean;
}

function actor(ctx: GraphQLContext): string {
  const userId = ctx.req.user?.id;
  if (!userId) throw new UnauthorizedException('Unauthorized');
  return userId;
}

@Resolver('Library')
export class LibraryResolver {
  constructor(private readonly library: LibraryService) {}

  @Query('myLibraryAssets')
  @UseGuards(JwtAuthGuard)
  myLibraryAssets(
    @Args('assetType', { nullable: true }) assetType: string | null | undefined,
    @Args('searchQuery', { nullable: true }) searchQuery: string | null | undefined,
    @Args('sortBy', { nullable: true }) sortBy: string | null | undefined,
    @Args('page', { type: () => Int, nullable: true }) page: number | null | undefined,
    @Args('limit', { type: () => Int, nullable: true }) limit: number | null | undefined,
    @Context() ctx: GraphQLContext,
  ) {
    // Explicit nulls (GraphQL) coerce to undefined so Zod optionals stay valid.
    const parsed = MyLibraryQueryInputSchema.safeParse({
      ...(assetType ? { assetType } : {}),
      ...(searchQuery ? { searchQuery } : {}),
      ...(sortBy ? { sortBy } : {}),
      ...(typeof page === 'number' ? { page } : {}),
      ...(typeof limit === 'number' ? { limit } : {}),
    });
    if (!parsed.success) throw new BadRequestException('Invalid library query');
    return this.library.getUserLibraryAssets(actor(ctx), parsed.data);
  }

  @Query('libraryGate')
  @UseGuards(JwtAuthGuard)
  libraryGate(@Args('productId') productId: string, @Context() ctx: GraphQLContext) {
    if (!productId) throw new BadRequestException('Missing product id');
    return this.library.checkAccess(actor(ctx), productId);
  }
}
