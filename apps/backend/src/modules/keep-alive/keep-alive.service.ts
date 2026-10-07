// SSOT Phase 031 §5.1 — Keep-alive service (Nest facade over the use-case)
// Canonical: apps/backend/src/modules/keep-alive/keep-alive.service.ts
// (legacy src/backend/modules/keep-alive/keep-alive.service.ts)
// - Maps Zod/edge errors to HTTP semantics (400 validation, 404 unknown row);
//   infra failures stay fail-open (local IDB remains the source of truth).
// - Zero new deps: Prisma SSOT + KeepAliveRedisRepository only.
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { KeepAliveRedisRepository } from '../../infra/redis/keep-alive-redis.repository';
import { latestViewportState, syncViewportState } from './application/sync-state.usecase';

interface SessionStateTable {
  userLiffSessionState: {
    upsert: (args: unknown) => Promise<{ lastActiveAt: Date }>;
    findUnique: (args: unknown) => Promise<{ stateJson: unknown; lastActiveAt: Date } | null>;
  };
}

@Injectable()
export class KeepAliveService {
  private readonly logger = new Logger(KeepAliveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly edge: KeepAliveRedisRepository,
  ) {}

  private get table(): SessionStateTable {
    return this.prisma as unknown as SessionStateTable;
  }

  private ports() {
    return {
      upsert: (args: { whereUser: string; tenantId: string; viewportType: string; stateJson: unknown }) =>
        this.table.userLiffSessionState.upsert({
          where: { userId_tenantId_viewportType: { userId: args.whereUser, tenantId: args.tenantId, viewportType: args.viewportType } },
          update: { stateJson: args.stateJson },
          create: { userId: args.whereUser, tenantId: args.tenantId, viewportType: args.viewportType, stateJson: args.stateJson },
        }),
      findLatest: (args: { userId: string; tenantId: string; viewportType: string }) =>
        this.table.userLiffSessionState
          .findUnique({ where: { userId_tenantId_viewportType: { userId: args.userId, tenantId: args.tenantId, viewportType: args.viewportType } } })
          .catch(() => null),
      cacheSet: (userId: string, tenantId: string, viewportType: string, stateJson: string) => this.edge.set(userId, tenantId, viewportType, stateJson),
      cacheGet: (userId: string, tenantId: string, viewportType: string) => this.edge.get(userId, tenantId, viewportType),
      publish: (channel: string, message: string) => this.edge.publish(channel, message),
      warn: (message: string) => this.logger.warn(message),
    };
  }

  async syncState(body: unknown) {
    try {
      return await syncViewportState(this.ports(), body);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Invalid keep-alive sync payload');
    }
  }

  async latestState(userId: string, tenantId: string, viewportType: string) {
    try {
      const out = await latestViewportState(this.ports(), userId, tenantId, viewportType);
      if (!out.success) throw new NotFoundException('No keep-alive state found');
      return out;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new BadRequestException(err instanceof Error ? err.message : 'Invalid keep-alive query');
    }
  }
}
