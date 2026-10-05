// SSOT Phase 004 §5.3 — E-Book reader resolver (entitlement gate + edge chunk + watermark)
import { Resolver, Query, Args, Context } from '@nestjs/graphql';
import { ForbiddenException, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { GqlAuthGuard } from '../../../modules/auth/guards/gql-auth.guard';
import { GetEbookChunkInputSchema } from '@repo/shared';
import type { GraphQLContext } from '../context/graphql-context.factory';

@Resolver('EbookChunkPayload')
export class EbookReaderResolver {
  constructor(
    private prisma: PrismaService,
    private redis: RedisClusterService,
  ) {}

  @Query('getEbookPageChunk')
  @UseGuards(GqlAuthGuard)
  async getEbookPageChunk(
    @Args('productId') productId: string,
    @Args('pageNumber') pageNumber: number,
    @Context() ctx: GraphQLContext & { user: { id: string; displayName?: string; lineUserId?: string } },
  ) {
    const { productId: pid, pageNumber: page } = GetEbookChunkInputSchema.parse({
      productId,
      pageNumber,
    });
    const userId = ctx.user.id;

    // 1. Entitlement check (Redis edge -> Prisma fallback)
    const entitlementKey = `user:entitlement:${userId}:${pid}`;
    const cached = await this.redis.getEntitlementFlag(entitlementKey);
    if (!cached) {
      const entitlement = await this.prisma.entitlement.findUnique({
        where: { userId_productId: { userId, productId: pid } },
      });
      if (!entitlement) {
        throw new ForbiddenException('User does not hold entitlement for this product.');
      }
      await this.redis.setEntitlementFlag(entitlementKey);
    }

    // 2. Vector SVG chunk (sliding-window edge cache)
    let vectorSvgContent = await this.redis.getEbookPageChunk(pid, page);
    if (!vectorSvgContent) {
      vectorSvgContent = await this.fetchChunkFromR2(pid, page);
      await this.redis.setEbookPageChunk(pid, page, vectorSvgContent);
    }

    // 3. Dynamic forensic watermark payload
    return {
      pageNumber: page,
      vectorSvgContent,
      watermarkText: `${ctx.user.displayName ?? 'reader'} (${ctx.user.lineUserId ?? userId})`,
      userIdHash: Buffer.from(userId).toString('hex').substring(0, 8),
      timestamp: new Date().toISOString(),
      hasPrevious: page > 1,
      hasNext: true,
    };
  }

  private async fetchChunkFromR2(productId: string, pageNumber: number): Promise<string> {
    // R2 retrieval (zero egress); Phase 036 wires real vault client
    void productId;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200"><text x="50" y="50">Page ${pageNumber} Encrypted Content</text></svg>`;
  }
}
