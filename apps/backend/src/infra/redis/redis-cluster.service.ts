// SSOT Phase 002 §6.1 — Redis Cluster client + sliding-window chunk protocol
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis, { Cluster } from 'ioredis';
import {
  VIDEO_SCRAPE_RISK_WINDOW_SEC,
  videoHeartbeatKey,
  videoRequestStreamKey,
  videoRiskScoreKey,
} from '@repo/shared';

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

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.del(...keys);
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

  // Phase 039 §5.2 — binary-safe edge chunk surface (additive; no behavior change)
  async set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown> {
    const setFn = this.client.set.bind(this.client) as (...a: unknown[]) => Promise<unknown>;
    return setFn(key, value, ...args);
  }

  // Phase 087 — atomic Lua eval (additive; flash-sale stock locks).
  // Cluster-safe only when ALL script keys share one hash tag.
  async evalLua(script: string, keys: string[], argv: Array<string | number>): Promise<unknown> {
    const evalFn = this.client.eval.bind(this.client) as (...a: unknown[]) => Promise<unknown>;
    return evalFn(script, keys.length, ...keys, ...argv);
  }

  // Phase 087 — signed counter restores (additive; hold-release sweeper).
  async incrby(key: string, n: number): Promise<number> {
    return this.client.incrby(key, n);
  }

  async decrby(key: string, n: number): Promise<number> {
    return this.client.decrby(key, n);
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    return (await this.client.getBuffer(key)) as Buffer | null;
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  /** Paginated SCAN for pattern invalidation (BDD-3 <100ms cluster sweep). */
  async scanKeys(pattern: string, pageSize = 100): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', pageSize);
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    return found;
  }

  // Phase 046 §4.2 — write-behind progress buffer primitives (additive)
  async hset(key: string, fields: Record<string, string>): Promise<void> {
    await this.client.hset(key, fields);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return (await this.client.hgetall(key)) as Record<string, string>;
  }

  async zincrby(key: string, increment: number, member: string): Promise<void> {
    await this.client.zincrby(key, increment, member);
  }

  // Phase 046 §8.1 — fixed-window rate-limit counter (additive)
  async incr(key: string): Promise<number> {
    return await this.client.incr(key);
  }

  // Phase 052 §5.2 — analytics fan-in: batched XADD via single pipeline round-trip.
  async xaddPipeline(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void> {
    if (batch.length === 0) return;
    const pipeline = this.client.pipeline();
    for (const fields of batch) {
      const args: string[] = [];
      for (const [k, v] of Object.entries(fields)) args.push(k, String(v));
      pipeline.xadd(streamKey, '*', ...args);
    }
    await pipeline.exec();
  }

  // Phase 050 §5.2 — HLS sliding-window segment guard (additive; <5ms per request).
  // Atomic ZREMRANGEBYSCORE + ZADD + ZCARD + EXPIRE via pipeline: returns live count.
  async trackVideoSegment(key: string, windowSec: number): Promise<number> {
    const now = Date.now();
    const windowStart = now - windowSec * 1000;
    const member = `${now}:${Math.random().toString(36).slice(2)}`;
    const results = await (this.client as unknown as {
      pipeline(cmds: Array<[string, ...unknown[]]>): { exec(): Promise<Array<[Error | null, unknown]>> };
    })
      .pipeline([
        ['zremrangebyscore', key, 0, windowStart],
        ['zadd', key, now, member],
        ['zcard', key],
        ['expire', key, windowSec + 1],
      ])
      .exec();
    return Number(results[2]?.[1] ?? 0);
  }

  // Phase 050 §7.1 — scraping risk score (5-min window; AI ban threshold = 100).
  async incrementScrapingViolationScore(userId: string, clientIp: string, weight = 10): Promise<number> {
    const key = videoRiskScoreKey(userId);
    const score = await this.client.incrby(key, weight);
    if (score === weight) await this.client.expire(key, VIDEO_SCRAPE_RISK_WINDOW_SEC);
    await this.client
      .xadd(
        videoRequestStreamKey(),
        '*',
        'userId',
        userId,
        'ip',
        clientIp,
        'score',
        String(score),
        'ts',
        String(Date.now()),
      )
      .catch(() => undefined);
    return score;
  }

  // Phase 050 §3 BDD — playback heartbeat so SUCCESS resumes cross-device.
  async setPlaybackHeartbeat(userId: string, lessonId: string): Promise<void> {
    await this.client.setex(videoHeartbeatKey(userId, lessonId), 3600, String(Date.now()));
  }

  async getPlaybackHeartbeat(userId: string, lessonId: string): Promise<number | null> {
    const raw = await this.client.get(videoHeartbeatKey(userId, lessonId));
    return raw ? Number(raw) : null;
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
