/**
 * Phase 000 — NestJS EasySlip webhook: LIFF slip upload -> verify -> 200 in <1s.
 */
import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';

const WebhookDto = z.object({
  orderId: z.string().uuid(),
  slipImageUrl: z.string().url(),
  expectedAmount: z.number().positive(),
  expectedAccount: z.string().min(1),
});

@Controller('webhooks/easyslip')
export class EasyslipWebhookController {
  constructor(private readonly verifier: { verifyAndGrant(...a: never[]): Promise<unknown> }) {}

  @Post()
  async handle(@Body() body: unknown) {
    const dto = WebhookDto.parse(body);
    const out = await (this.verifier.verifyAndGrant as (...a: unknown[]) => Promise<unknown>)(
      dto.orderId,
      dto.slipImageUrl,
      dto.expectedAmount,
      dto.expectedAccount,
    );
    return { ok: true, data: out };
  }
}
