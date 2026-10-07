// SSOT Phase 044 Task 5 — R2UploaderService (concurrent zero-egress sync)
// Canonical: apps/backend/src/infra/cloudflare/r2-uploader.service.ts
// (legacy src/infra/cloudflare/r2-uploader.service.ts)
// - Uploads an in-memory file set with bounded concurrency (default 6) and
//   per-file content types; skips nothing, fails fast with the key attached.
// - Thin orchestration over R2StorageService.putObjectBuffer (single S3
//   client per §9) + caller-supplied buffers (the worker stages tmp files).
// - tsx-safe (no param decorators). Zero new deps.
import { Injectable } from '@nestjs/common';

export interface R2UploadFile {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface R2PutPort {
  putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<unknown>;
}

const DEFAULT_CONCURRENCY = 6;

async function eachLimit<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  const workers: Array<Promise<void>> = [];
  let index = 0;
  const next = async (): Promise<void> => {
    while (index < items.length) {
      const item = items[index] as T;
      index += 1;
      await run(item);
    }
  };
  const count = Math.max(1, Math.min(limit, items.length));
  for (let i = 0; i < count; i += 1) workers.push(next());
  await Promise.all(workers);
}

@Injectable()
export class R2UploaderService {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(private readonly putter?: R2PutPort) {}

  async uploadAll(files: R2UploadFile[], concurrency: number = DEFAULT_CONCURRENCY): Promise<number> {
    if (!this.putter) throw new Error('R2 uploader unavailable');
    if (files.length === 0) throw new Error('Nothing to upload');
    await eachLimit(files, concurrency, async (file) => {
      try {
        await this.putter!.putObjectBuffer(file.key, file.body, file.contentType);
      } catch (error) {
        throw new Error(`R2 upload failed for ${file.key}: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    });
    return files.length;
  }
}
