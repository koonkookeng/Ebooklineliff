// SSOT Phase 004 Task 004.5 — order/payment resolver (dynamic PromptPay; slip verify = webhook)
import { Resolver, Mutation, Args, Context } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { GqlAuthGuard } from '../../../modules/auth/guards/gql-auth.guard';
import type { GraphQLContext } from '../context/graphql-context.factory';

@Resolver('OrderPayload')
export class OrderPaymentResolver {
  constructor(private readonly prisma: PrismaService) {}

  @Mutation('createOrder')
  @UseGuards(GqlAuthGuard)
  async createOrder(
    @Args('productIds', { type: () => [String] }) productIds: string[],
    @Context() ctx: GraphQLContext & { user: { id: string } },
  ) {
    if (!productIds || productIds.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products not found');
    }
    const netAmount = products.reduce((sum, p) => sum + Number(p.discountPrice ?? p.price), 0);
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        userId: ctx.user.id,
        netAmount,
        orderItems: {
          create: products.map((p) => ({
            productId: p.id,
            price: p.discountPrice ?? p.price,
            quantity: 1,
          })),
        },
      },
    });
    return { orderId: order.id, orderNumber, netAmount, orderStatus: order.orderStatus };
  }
}
