// SSOT Phase 103 — Support module wiring
// Canonical: apps/backend/src/modules/support/support.module.ts
// - Repository + use-cases + SSE gateway; RAG/sentiment via AiBotModule.
// - RISK_CALL: SSE not WS (099/100 precedent). Zero new deps.
import { Module } from '@nestjs/common';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { R2StorageModule } from '../../infra/cloudflare/r2-storage.module';
import { AiBotModule } from '../ai-bot/ai-bot.module';
import { PrismaSupportRepository } from './repositories/support.repository';
import { CreateTicketUseCase } from './application/use-cases/create-ticket.use-case';
import { EscalateToAgentUseCase } from './application/use-cases/escalate-to-agent.use-case';
import { ResolveTicketUseCase } from './application/use-cases/resolve-ticket.use-case';
import { SupportChatGateway } from './infrastructure/websocket/support-chat.gateway';
import { SupportController } from './support.controller';

@Module({
  imports: [AiBotModule, R2StorageModule],
  controllers: [SupportController],
  providers: [
    PrismaSupportRepository,
    CreateTicketUseCase,
    EscalateToAgentUseCase,
    ResolveTicketUseCase,
    {
      provide: SupportChatGateway,
      useFactory: (redis: RedisClusterService) =>
        new SupportChatGateway(
          {
            xaddPipeline: (s: string, b: Array<Record<string, string | number>>) =>
              redis.xaddPipeline(s, b),
          },
          {
            publish: (c: string, m: string) => redis.publish(c, m),
            subscribe: (c: string, h: (m: string) => void) => redis.subscribe(c, h),
          },
          { verify: () => null },
        ),
      inject: [RedisClusterService],
    },
  ],
  exports: [CreateTicketUseCase, EscalateToAgentUseCase, ResolveTicketUseCase, PrismaSupportRepository],
})
export class SupportModule {}
