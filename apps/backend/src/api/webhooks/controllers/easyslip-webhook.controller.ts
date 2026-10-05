// SSOT Phase 004 §5.4 — EasySlip slip-verification webhook (atomic, <1s)
// NOTE: global prefix api/v1 applies (main.ts) → POST /api/v1/webhooks/payment/easyslip
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { HmacSignatureGuard } from '../guards/hmac-signature.guard';
import { EasySlipWebhookPayloadSchema } from '@repo/shared';

@Controller('webhooks/payment')
export class EasySlipWebhookController {
  constructor(private prisma: PrismaService) {}

  @Post('easyslip')
  @HttpCode(HttpStatus.OK)
  @UseGuards(HmacSignatureGuard)
  async handleSlipWebhook(@Body() rawBody: unknown) {
    // 1. Zod validation
    const parseResult = EasySlipWebhookPayloadSchema.safeParse(rawBody);
    if (!parseResult.success) {
      throw new BadRequestException('Invalid Webhook Payload Structure');
    }
    const payload = parseResult.data;

    // 2. Atomic transaction: verify order + unlock entitlements (idempotent)
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNumber: payload.transRef },
        include: { orderItems: true },
      });

      if (!order || order.orderStatus === 'COMPLETED') {
        return { success: false, message: 'Order already processed or not found' };
      }

      if (Number(order.netAmount) > payload.amount.value) {
        throw new BadRequestException('Payment Amount Mismatch');
      }

      await tx.order.update({
        where: { id: order.id },
        data: { orderStatus: 'COMPLETED' },
      });

      for (const item of order.orderItems) {
        await tx.entitlement.upsert({
          where: { userId_productId: { userId: order.userId, productId: item.productId } },
          update: { accessType: 'FULL_PURCHASE' },
          create: { userId: order.userId, productId: item.productId, accessType: 'FULL_PURCHASE' },
        });
      }

      return { success: true, orderId: order.id };
    });

    return { status: 'SUCCESS', data: result };
  }
}
