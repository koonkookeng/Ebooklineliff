// SSOT Phase 057 §5.2 — Progress sync gateway (SSE realtime + REST ingest)
// Canonical: apps/backend/src/modules/sync/infrastructure/gateways/progress-sync.gateway.ts
// (legacy src/backend/modules/sync/infrastructure/gateways/progress-sync.gateway.ts)
// - TRANSPORT NOTE (ADR-057): socket.io is not installed (LIFF <30MB bundle,
//   Fastify friction, zero-new-dep policy). Realtime runs SSE server→client
//   (@Sse, built into @nestjs/common + rxjs, both existing deps) over the
//   Redis room channel; emits arrive via REST/beacon POST. Same BDD semantics:
//   tenant-isolated rooms, <100ms fan-out, 200-byte wire guard.
// - Session registry: ActiveDeviceSession rows per stream (socketId = stream
//   uuid); removed on unsubscribe. Device fingerprint enforced on ingest.
import { BadRequestException, Body, Controller, Get, Post, Query, Sse } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import {
  ForceSyncInputSchema,
  SYNC_NAMESPACE,
  ebookProgressCacheKey,
  isSyncPayloadWithinBudget,
  syncRoomChannel,
  videoProgressCacheKey,
} from '@repo/shared';
import { syncEbookProgress } from '../../application/use-cases/sync-ebook-progress.use-case';
import { syncVideoProgress } from '../../application/use-cases/sync-video-progress.use-case';
import type { ProgressUpdatedEnvelope } from '../../domain/events/progress-updated.event';
import { RedisIoAdapter } from '../adapters/redis-io.adapter';
import { RedisPubSubAdapter } from '../../../../infra/redis/redis-pubsub.adapter';

export interface SyncSessionStore {
  register(args: { userId: string; deviceId: string; tenantId: string; socketId: string; clientIp: string; userAgent: string }): Promise<void>;
  unregister(socketId: string): Promise<void>;
}

export interface SyncGatewayCache {
  hset(key: string, fields: Record<string, string>): Promise<void>;
}

export interface SyncGatewayQueue {
  enqueue(queue: string, payload: unknown): Promise<void>;
}

@Controller('api/v1/sync')
export class ProgressSyncGateway {
  constructor(
    private readonly rooms: RedisPubSubAdapter,
    private readonly bus: RedisIoAdapter,
    private readonly cache: SyncGatewayCache,
    private readonly queue: SyncGatewayQueue,
    private readonly sessions: SyncSessionStore,
  ) {}

  namespace(): string {
    return SYNC_NAMESPACE;
  }

  /** SSE fan-out: one stream per device, filtered to the user room events. */
  @Sse('stream')
  stream(
    @Query('tenantId') tenantId: string,
    @Query('userId') userId: string,
    @Query('deviceId') deviceId: string,
  ): Observable<{ data: ProgressUpdatedEnvelope }> {
    const socketId = randomUUID();
    const channel = syncRoomChannel(tenantId, userId);
    return new Observable<{ data: ProgressUpdatedEnvelope }>((subscriber) => {
      const teardowns: Array<() => void> = [];
      let released = false;
      void this.sessions
        .register({ userId, deviceId, tenantId, socketId, clientIp: 'sse', userAgent: 'sse' })
        .catch(() => undefined);
      for (const event of ['ebook_page_synced', 'video_progress_synced'] as const) {
        void this.rooms
          .subscribeRoom(channel, event, (data) => {
            subscriber.next({ data: data as ProgressUpdatedEnvelope });
          })
          .then((u) => {
            teardowns.push(u);
          })
          .catch(() => undefined);
      }
      return () => {
        if (released) return;
        released = true;
        for (const teardown of teardowns) teardown();
        void this.sessions.unregister(socketId).catch(() => undefined);
      };
    });
  }

  @Post('ebook')
  async ingestEbook(@Body() body: unknown) {
    if (!isSyncPayloadWithinBudget(body)) {
      throw new BadRequestException('Sync payload exceeds 200-byte zero-egress budget');
    }
    return syncEbookProgress(
      {
        cache: this.cache,
        bus: this.bus,
        queue: { enqueue: (q, p) => this.queue.enqueue(q, p as object) },
      },
      body,
    );
  }

  @Post('video')
  async ingestVideo(@Body() body: unknown) {
    if (!isSyncPayloadWithinBudget(body)) {
      throw new BadRequestException('Sync payload exceeds 200-byte zero-egress budget');
    }
    return syncVideoProgress(
      {
        cache: this.cache,
        bus: this.bus,
        queue: { enqueue: (q, p) => this.queue.enqueue(q, p as object) },
      },
      body,
    );
  }

  /** §3.2 fallback when realtime is unreachable: cache-write + true. */
  @Post('force')
  async forceSync(@Body() body: unknown): Promise<boolean> {
    const input = ForceSyncInputSchema.parse(body);
    if (input.contentType === 'EBOOK' && input.lastPage) {
      await this.cache.hset(ebookProgressCacheKey('force', input.productId), {
        lastPage: String(input.lastPage),
        updatedAt: String(Date.now()),
      });
    } else if (input.contentType === 'COURSE_LESSON' && typeof input.watchedSec === 'number') {
      await this.cache.hset(videoProgressCacheKey('force', input.productId), {
        watchedSec: String(input.watchedSec),
        updatedAt: String(Date.now()),
      });
    }
    return true;
  }

  @Get('health')
  health(): { ok: boolean; namespace: string } {
    return { ok: true, namespace: SYNC_NAMESPACE };
  }
}
