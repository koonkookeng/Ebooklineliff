// SSOT Phase 011 — Cart REST (Next.js proxy path: smart-cart CRUD + shipping quotes)
// Canonical: apps/backend/src/modules/cart/presentation/rest/cart.controller.ts
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseGuards, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { CalculateShippingInputSchema, type Carrier } from '@repo/shared';
import { CartService } from '../../application/cart.service';
import { AddToCartUseCase } from '../../application/use-cases/add-to-cart.usecase';
import { SplitCartCalculatorUseCase } from '../../application/use-cases/split-cart-calculator.usecase';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';

interface AuthedReq {
  user?: { id?: string };
  headers: Record<string, string | undefined>;
}

function actor(req: AuthedReq): { userId: string; tenantId: string } {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedException('Unauthorized');
  const t = req.headers['x-tenant-id'];
  return { userId, tenantId: t ?? 'default' };
}

@Controller('api/cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly addToCart: AddToCartUseCase,
    private readonly splitCalc: SplitCartCalculatorUseCase,
  ) {}

  @Get()
  get(@Query('shippingAddressId') shippingAddressId: string | undefined, @Req() req: AuthedReq) {
    const { userId, tenantId } = actor(req);
    return this.splitCalc.execute(userId, shippingAddressId, tenantId);
  }

  @Post('items')
  add(@Body() body: { productId?: string; quantity?: number }, @Req() req: AuthedReq) {
    const { userId, tenantId } = actor(req);
    if (!body?.productId) throw new BadRequestException('Missing product id');
    return this.addToCart.execute(userId, { productId: body.productId, quantity: body.quantity ?? 1 }, tenantId);
  }

  @Patch('items/:id')
  update(@Param('id') id: string, @Body() body: { quantity?: number }, @Req() req: AuthedReq) {
    const { userId, tenantId } = actor(req);
    if (typeof body?.quantity !== 'number') throw new BadRequestException('Invalid quantity');
    return this.cart.updateQuantity(userId, id, body.quantity, tenantId);
  }

  @Delete('items/:id')
  remove(@Param('id') id: string, @Req() req: AuthedReq) {
    const { userId, tenantId } = actor(req);
    return this.cart.removeItem(userId, id, tenantId);
  }

  @Post('shipping/quote')
  async quote(
    @Body() body: { shippingAddressId?: string; preferredCarrier?: Carrier },
    @Req() req: AuthedReq,
  ) {
    const { userId, tenantId } = actor(req);
    // cartId is required by the §3.1 contract but unused downstream (ownership derives
    // from the JWT userId); the nil UUID satisfies shape validation without a lookup.
    const parsed = CalculateShippingInputSchema.safeParse({
      cartId: '00000000-0000-0000-0000-000000000000',
      shippingAddressId: body?.shippingAddressId,
      preferredCarrier: body?.preferredCarrier,
    });
    if (!parsed.success) throw new BadRequestException('Invalid shipping input');
    return this.cart.calculateShipping(userId, parsed.data.shippingAddressId, parsed.data.preferredCarrier, tenantId);
  }
}
