// SSOT Phase 057 §5.1 — Redis IO adapter (Socket.io Redis Adapter equivalent)
// Canonical: apps/backend/src/modules/sync/infrastructure/adapters/redis-io.adapter.ts
// (legacy src/backend/modules/sync/infrastructure/adapters/redis-io.adapter.ts)
// - TRANSPORT NOTE (ADR-057): socket.io is not installed (LIFF bundle + zero-
//   new-dep policy). This adapter provides the same horizontal scale-out role
//   — room broadcast via Redis Pub/Sub — over RedisPubSubAdapter, and the SSE
//   gateway delivers frames to devices subscribed to the user room.
// - Implements the use-case bus ports (tsx-importable).
import { Injectable } from '@nestjs/common';
import { RedisPubSubAdapter } from '../../../../infra/redis/redis-pubsub.adapter';
import type { ProgressUpdatedEnvelope } from '../../domain/events/progress-updated.event';
import type { EbookSyncBusPort } from '../../application/use-cases/sync-ebook-progress.use-case';
import type { VideoSyncBusPort } from '../../application/use-cases/sync-video-progress.use-case';

@Injectable()
export class RedisIoAdapter implements EbookSyncBusPort, VideoSyncBusPort {
  constructor(private readonly rooms: RedisPubSubAdapter) {}

  async broadcast(envelope: ProgressUpdatedEnvelope): Promise<void> {
    await this.rooms.publishRoom(envelope.channel, envelope.event, envelope.payload);
  }
}
