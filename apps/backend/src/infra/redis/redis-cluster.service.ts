// SSOT Phase 002 §6.1 — Redis Cluster client + sliding-window chunk protocol
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis, { Cluster } from 'ioredis';

@Injectable()
export class RedisClusterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisClusterService.name);
  private client!: Cluster;

  onModuleInit() {
    const nodes = (process.env.REDIS_CLUSTER_NODES || '172.28.0.11:6379').split(',').map((node) => {
      const [host, port] = node.split(':');
      return { host, port: parseInt(port, 10) };
    });

    this.client = new Redis.Cluster(nodes, {
      redisOptions: {
        password: process.env.REDIS_PASSWORD,
      },
      dnsLookup: (address, callback) => callback(null, address, 4),
      enableReadyCheck: true,
      scaleReads: 'slave', // Offload read queries to replicas
      maxRedirections: 16,
    });

    this.client.on('connect', () => this.logger.log('Redis Cluster Connected Successfully.'));
    this.client.on('error', (err) => this.logger.error('Redis Cluster Error:', err));
  }

  // E-Book Canvas Reader sliding window caching protocol (< 30MB RAM control)
  async getEbookPageChunk(productId: string, pageNumber: number): Promise<string | null> {
    const key = `ebook:chunk:{${productId}}:${pageNumber}`; // Hashtag {} pins key to same slot
    return await this.client.get(key);
  }

  async setEbookPageChunk(
    productId: string,
    pageNumber: number,
    chunkData: string,
    ttlSeconds = 86400,
  ): Promise<void> {
    const key = `ebook:chunk:{${productId}}:${pageNumber}`;
    await this.client.setex(key, ttlSeconds, chunkData);
  }

  // Phase 005 §5.2/§10.2 — generic session edge cache (<1ms verify; PG fallback on failure)
  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    await this.client.setex(key, ttlSeconds, value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  // Phase 006 §7.1 — auth analytics events (best-effort; consumers subscribe to `auth-events`)
  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message);
  }

  // Phase 007 — QR sync: atomic single-use claim + dedicated subscriber (cluster-safe)
  async setnx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const res = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  }

  /** Atomic read-and-delete (Redis 6.2+ GETDEL) for single-use handoff codes. */
  async getdel(key: string): Promise<string | null> {
    return await this.client.getdel(key);
  }

  private subscriber: import('ioredis').Cluster | null = null;
  private subscriptions = new Map<string, Set<(message: string) => void>>();

  async subscribe(channel: string, handler: (message: string) => void): Promise<() => void> {
    if (!this.subscriber) {
      this.subscriber = this.client.duplicate() as import('ioredis').Cluster;
      this.subscriber.on('message', (ch: string, message: string) => {
        for (const fn of this.subscriptions.get(ch) ?? []) {
          try {
            fn(message);
          } catch {
            // never break the subscriber loop on handler errors
          }
        }
      });
    }
    let set = this.subscriptions.get(channel);
    if (!set) {
      set = new Set();
      this.subscriptions.set(channel, set);
      await this.subscriber.subscribe(channel);
    }
    set.add(handler);
    return () => {
      const live = this.subscriptions.get(channel);
      if (!live) return;
      live.delete(handler);
      if (live.size === 0) {
        this.subscriptions.delete(channel);
        void this.subscriber?.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  // Phase 004 §4.1 — entitlement flag cache (DB fallback on miss)
  async getEntitlementFlag(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async setEntitlementFlag(key: string, ttlSeconds = 3600): Promise<void> {
    await this.client.setex(key, ttlSeconds, 'TRUE');
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
