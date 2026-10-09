// SSOT Phase 099 Task 6 — R2 VOD adapter (zero-egress archive path)
// Canonical: apps/backend/src/modules/live/infrastructure/adapters/cloudflare-r2-vod.adapter.ts
// - Pure path/URL builders + a narrow R2 put delegate port (the real bytes
//   ride the shared R2 vault client; this adapter owns key layout only).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { liveVodPrefix } from '@repo/shared';

export interface R2PutPort {
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

@Injectable()
export class CloudflareR2VodAdapter {
  constructor(private readonly store?: R2PutPort) {}

  masterKey(sessionId: string): string {
    return liveVodPrefix(sessionId);
  }

  segmentKey(sessionId: string, seq: number): string {
    return `live-vod/${sessionId}/hls/seg-${String(seq).padStart(5, '0')}.ts`;
  }

  masterUrl(sessionId: string, cdnOrigin?: string): string {
    const origin = (cdnOrigin ?? process.env['R2_PUBLIC_ORIGIN'] ?? 'https://vod.local').replace(/\/$/, '');
    return `${origin}/${this.masterKey(sessionId)}`;
  }

  async archiveManifest(sessionId: string, manifest: string): Promise<string> {
    if (!this.store) return this.masterKey(sessionId);
    await this.store.putObject(this.masterKey(sessionId), new TextEncoder().encode(manifest), 'application/vnd.apple.mpegurl');
    return this.masterKey(sessionId);
  }
}
