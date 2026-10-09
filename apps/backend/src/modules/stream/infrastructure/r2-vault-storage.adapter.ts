// SSOT Phase 102 Task 5 — R2 vault storage adapter (zero-egress delegate)
// Canonical: apps/backend/src/modules/stream/infrastructure/r2-vault-storage.adapter.ts
// - Narrow put/get delegate over the shared R2StorageService vault; owns
//   the live-vod key layout only (bytes ride the existing vault client).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { vodR2Prefix } from '@repo/shared';

export interface VaultPort {
  putObjectBuffer(objectKey: string, body: Buffer, contentType: string): Promise<unknown>;
  getObjectBuffer(objectKey: string): Promise<Buffer>;
}

@Injectable()
export class R2VaultStorageAdapter {
  constructor(private readonly vault: VaultPort) {}

  sourceKey(sessionId: string): string {
    return `${vodR2Prefix(sessionId)}/source.mp4`;
  }

  async stageSource(sessionId: string, bytes: Buffer): Promise<string> {
    const key = this.sourceKey(sessionId);
    await this.vault.putObjectBuffer(key, bytes, 'video/mp4');
    return key;
  }

  async fetchBytes(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Recording fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
