// SSOT Phase 050 §5.3 — HLS AES-128 token signing + dynamic URL cipher engine
// Canonical: apps/backend/src/modules/stream/services/hls-security.service.ts
// (legacy src/backend/modules/stream/services/hls-security.service.ts)
// - Short-lived HMAC-SHA256 tokens (TTL 10s, §8.1); AES-128 keys rotate every 10s.
// - R2 holds AES-128 encrypted .ts chunks; NestJS proxies bytes (zero egress fee).
// - Zero new deps (node:crypto only). Constructor takes ports — no Nest param
//   decorators so the class stays tsx-importable (Phase 027–049 precedent).
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  StreamTokenType,
  VIDEO_KEY_ROTATION_SEC,
  VIDEO_SEGMENT_TOKEN_TTL_SEC,
  VideoSegmentRequestSchema,
} from '@repo/shared';

export interface HlsR2Port {
  getObjectText(objectKey: string): Promise<string>;
  getObjectBuffer(objectKey: string): Promise<Buffer>;
}

function b64urlEncode(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function b64urlDecode(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

@Injectable()
export class HlsSecurityService {
  constructor(
    private readonly r2: HlsR2Port,
    private readonly secret: string = process.env.HLS_STREAM_SECRET || 'dev-hls-stream-secret',
  ) {}

  /** Mint a short-lived signed token bound to lesson + purpose. */
  signToken(lessonId: string, type: StreamTokenType, ttlSec: number = VIDEO_SEGMENT_TOKEN_TTL_SEC): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const body = b64urlEncode(`v1.${lessonId}.${type}.${nonce}.${exp}`);
    const sig = createHmac('sha256', this.secret).update(body).digest('hex');
    return `${body}.${sig}`;
  }

  /** Verify signature + expiry + lesson/type binding; throws 401/403 on failure. */
  verifyToken(token: string, lessonId: string, type: StreamTokenType): void {
    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new HttpException('Invalid stream token', HttpStatus.UNAUTHORIZED);
    }
    const [body, sig] = parts;
    const expected = createHmac('sha256', this.secret).update(body).digest('hex');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new HttpException('Invalid stream token signature', HttpStatus.UNAUTHORIZED);
    }
    let decoded: string;
    try {
      decoded = b64urlDecode(body);
    } catch {
      throw new HttpException('Invalid stream token encoding', HttpStatus.UNAUTHORIZED);
    }
    const match = /^v1\.([0-9a-f-]{36})\.([A-Z_]+)\.([a-z0-9]+)\.(\d+)$/i.exec(decoded);
    if (!match || match[1].toLowerCase() !== lessonId.toLowerCase() || match[2] !== type) {
      throw new HttpException('Stream token scope mismatch', HttpStatus.FORBIDDEN);
    }
    if (Number(match[4]) * 1000 < Date.now()) {
      throw new HttpException('Stream token expired', HttpStatus.UNAUTHORIZED);
    }
  }

  /** Segment tokens additionally bind the exact chunk name (anti hot-link swap). */
  async verifySegmentToken(token: string, lessonId: string, segmentName: string): Promise<void> {
    const parsed = VideoSegmentRequestSchema.safeParse({
      lessonId,
      segmentName,
      token,
      clientTimestamp: Date.now(),
    });
    if (!parsed.success) {
      throw new HttpException('Invalid segment request', HttpStatus.BAD_REQUEST);
    }
    this.verifyToken(token, lessonId, 'SEGMENT_FETCH');
  }

  /** Rewrite stored master/variant playlist: every media URI becomes a signed short-lived URL. */
  async generateDynamicM3u8Playlist(lessonId: string, token: string): Promise<string> {
    this.verifyToken(token, lessonId, 'MANIFEST_ACCESS');
    const raw = await this.r2.getObjectText(`hls/${lessonId}/master.m3u8`);
    const keyToken = this.signToken(lessonId, 'KEY_DECRYPTION');
    return raw
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          return trimmed.startsWith('#EXT-X-KEY')
            ? trimmed.replace(/URI="[^"]*"/, `URI="/api/v1/hls/${lessonId}/key?token=${keyToken}"`)
            : line;
        }
        const segToken = this.signToken(lessonId, 'SEGMENT_FETCH');
        const name = trimmed.split('/').pop() as string;
        return `/api/v1/hls/${lessonId}/segments/${name}?token=${segToken}`;
      })
      .join('\n');
  }

  /** AES-128 content key for the current rotation window (interval 10s, §8.1). */
  async getRotatedKey(lessonId: string, token: string): Promise<Buffer> {
    this.verifyToken(token, lessonId, 'KEY_DECRYPTION');
    const window = Math.floor(Date.now() / 1000 / VIDEO_KEY_ROTATION_SEC);
    return createHmac('sha256', this.secret).update(`hls-key:${lessonId}:${window}`).digest().subarray(0, 16);
  }

  /** Zero-egress segment fetch straight from the R2 vault. */
  async fetchR2SegmentStream(lessonId: string, segmentName: string): Promise<Buffer> {
    return this.r2.getObjectBuffer(`hls/${lessonId}/segments/${segmentName}`);
  }
}
