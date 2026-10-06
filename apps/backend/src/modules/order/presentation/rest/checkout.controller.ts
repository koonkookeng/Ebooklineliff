// SSOT Phase 012 — Checkout REST (Next.js proxy path: smart orders)
// Canonical: apps/backend/src/modules/order/presentation/rest/checkout.controller.ts
import { Controller, Get, Post, Param, Body, Req, UseGuards, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { CreateOrderInputSchema } from '@repo/shared';
import { CheckoutService } from '../../services/checkout.service';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';

interface AuthedReq {
  user?: { id?: string };
}

function actor(req: AuthedReq): string {
  if (!req.user?.id) throw new UnauthorizedException('Unauthorized');
  return req.user.id;
}

@Controller('api/checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('orders')
  create(@Body() body: unknown, @Req() req: AuthedReq) {
    const parsed = CreateOrderInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid checkout payload');
    return this.checkout.createOrder(actor(req), parsed.data);
  }

  @Get('orders/:id')
  get(@Param('id') id: string, @Req() req: AuthedReq) {
    return this.checkout.getOrder(actor(req), id);
  }
}
