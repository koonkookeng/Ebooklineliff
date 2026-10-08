// SSOT Phase 051 §8.1 — preview HLS tokens (60s TTL, segment-bound, §8.1)
// Canonical: apps/backend/src/modules/preview/services/hls-token.service.ts
// (legacy src/backend/modules/preview/services/hls-token.service.ts)
// - Playlist is TRIMMED server-side to the 120s preview window (cumulative
//   EXTINF); every listed segment carries a token bound to (lesson, segment,
//   exp) so deep-linking segment N+1 is cryptographically impossible.
// - Separate secret scope from Phase 050 full-stream tokens. Zero new deps.
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PREVIEW_HLS_TOKEN_TTL_SEC } from '@repo/shared';

function b64urlEncode(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function b64urlDecode(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

@Injectable()
export class PreviewHlsTokenService {
  constructor(private readonly secret: string = process.env.PREVIEW_HLS_SECRET || 'dev-preview-hls-secret') {}

  mintSegmentToken(lessonId: string, segmentName: string, ttlSec: number = PREVIEW_HLS_TOKEN_TTL_SEC): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const body = b64urlEncode(`pv1.${lessonId}.${segmentName}.${exp}`);
    const sig = createHmac('sha256', this.secret).update(body).digest('hex');
    return `${body}.${sig}`;
  }

  verifySegmentToken(token: string, lessonId: string, segmentName: string): void {
    const parts = token.split('.');
    if (parts.length !== 2) throw new HttpException('Invalid preview token', HttpStatus.UNAUTHORIZED);
    const [body, sig] = parts;
    const expected = createHmac('sha256', this.secret).update(body).digest('hex');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new HttpException('Invalid preview token signature', HttpStatus.UNAUTHORIZED);
    }
    let decoded: string;
    try {
      decoded = b64urlDecode(body);
    } catch {
      throw new HttpException('Invalid preview token encoding', HttpStatus.UNAUTHORIZED);
    }
    // segment names are [a-zA-Z0-9_.-]+ with a single dot before ts|m4s
    // ('key'/'playlist' are preview control pseudo-segments)
    const match = /^pv1\.([0-9a-f-]{36})\.([A-Za-z0-9_\-]+\.(?:ts|m4s)|key|playlist)\.(\d+)$/i.exec(decoded);
    if (!match || match[1].toLowerCase() !== lessonId.toLowerCase() || match[2] !== segmentName) {
      throw new HttpException('Preview token scope mismatch', HttpStatus.FORBIDDEN);
    }
    if (Number(match[3]) * 1000 < Date.now()) {
      throw new HttpException('Preview token expired', HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * Trim a master/variant playlist to the preview window and rewrite every
   * media URI to a signed preview-segment URL. EXT-X-KEY targets the preview
   * key endpoint (per-lesson derived key, rotated with the token window).
   */
  buildPreviewPlaylist(lessonId: string, maxSec: number, masterText: string): string {
    let budget = maxSec;
    const out: string[] = [];
    const lines = masterText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        const dur = /^#EXTINF:([0-9.]+)/.exec(trimmed);
        if (dur) {
          if (budget <= 0) break; // window exhausted: drop this segment + tail
          budget -= Number(dur[1]);
        }
        out.push(
          trimmed.startsWith('#EXT-X-KEY')
            ? trimmed.replace(
                /URI="[^"]*"/,
                `URI="/api/v1/preview/video/key?lessonId=${lessonId}&token=${this.mintSegmentToken(lessonId, 'key')}"`,
              )
            : line,
        );
        continue;
      }
      const name = trimmed.split('/').pop() as string;
      out.push(
        `/api/v1/preview/video/segments/${name}?lessonId=${lessonId}&token=${this.mintSegmentToken(lessonId, name)}`,
      );
    }
    return out.join('\n');
  }

  /** Deterministic per-lesson preview content key (16B, token-window scoped). */
  derivePreviewKey(lessonId: string): Buffer {
    const window = Math.floor(Date.now() / 1000 / PREVIEW_HLS_TOKEN_TTL_SEC);
    return createHmac('sha256', this.secret).update(`preview-key:${lessonId}:${window}`).digest().subarray(0, 16);
  }
}
