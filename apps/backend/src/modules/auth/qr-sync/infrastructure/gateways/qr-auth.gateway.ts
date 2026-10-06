// SSOT Phase 007 §5.2 — QR realtime fan-out over Redis pub/sub (SSE delivery in presentation layer)
// Canonical: .../qr-sync/infrastructure/gateways/qr-auth.gateway.ts
// No socket.io: transport-agnostic broadcast; desktop subscribes via SSE `GET /auth/qr/:qrToken/stream`.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../../../infra/redis/redis-cluster.service';
import { qrChannel } from '../repositories/redis-qr-cache.repository';
import type { QrAuthSocketBroadcast } from '@repo/shared';

@Injectable()
export class QrAuthGateway {
  constructor(private readonly redis: RedisClusterService) {}

  async broadcast(qrToken: string, payload: QrAuthSocketBroadcast): Promise<void> {
    await this.redis.publish(qrChannel(qrToken), JSON.stringify(payload));
  }
}
