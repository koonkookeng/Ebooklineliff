// SSOT Phase 034 Task 3 — LINE webhooks module (OA follow/unfollow entry)
// Canonical: apps/backend/src/webhooks/line-webhooks.module.ts
// (legacy src/backend/webhooks/line-webhooks.module.ts)
// - Distinct from api/webhooks (Phase 004 provider ACK paths); registers the
//   OA friendship-sync webhook. LineOAService comes from LineOAModule.
// - Zero new deps.
import { Module } from '@nestjs/common';
import { LineOAModule } from '../modules/line-oa/line-oa.module';
import { LineMessagingWebhookController } from './line-messaging.controller';

@Module({
  imports: [LineOAModule],
  controllers: [LineMessagingWebhookController],
})
export class LineWebhooksModule {}
