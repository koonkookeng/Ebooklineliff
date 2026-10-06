// SSOT Phase 024 — Delivery status callback (HMAC-gated, fail-closed)
// Canonical: apps/backend/src/modules/line-service-message/webhooks/line-delivery-status.controller.ts
// - LINE delivery webhooks carry no user session; authenticity comes from an HMAC
//   ticket (server secret) minted at dispatch time. Unknown/forged tickets → 404
//   (no oracle for log ids).
// - Only forward transitions allowed: QUEUED/PROCESSING → DELIVERED/FAILED.
import { Body, Controller, HttpCode, HttpStatus, NotFoundException, Post } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../infra/database/prisma.service';
import { verifyDeliveryTicket } from './delivery-ticket.util';

export { signDeliveryTicket, verifyDeliveryTicket } from './delivery-ticket.util';

const CallbackSchema = z.object({
  logId: z.string().uuid(),
  status: z.enum(['DELIVERED', 'FAILED']),
  errorCode: z.string().optional(),
  sig: z.string().min(1),
});

@Controller('api/v1/service-message/delivery')
export class LineDeliveryStatusController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  async callback(@Body() body: unknown): Promise<{ ok: boolean }> {
    const parsed = CallbackSchema.safeParse(body);
    if (!parsed.success) throw new NotFoundException('Not found');
    const { logId, status, errorCode, sig } = parsed.data;
    if (!verifyDeliveryTicket(logId, status, sig)) throw new NotFoundException('Not found');

    const updated = await this.prisma.notificationLog
      .update({
        where: { id: logId },
        data: {
          status,
          ...(status === 'DELIVERED'
            ? { deliveredAt: new Date(), errorCode: null }
            : { errorCode: errorCode ?? 'DELIVERY_CALLBACK' }),
        },
      })
      .catch(() => null);
    if (!updated) throw new NotFoundException('Not found');
    return { ok: true };
  }
}
