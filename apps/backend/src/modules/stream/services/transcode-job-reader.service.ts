// SSOT Phase 044 — TranscodeJobReaderService (ledger status reads)
// Canonical: apps/backend/src/modules/stream/services/transcode-job-reader.service.ts
// - Single injectable behind the job-status REST/GQL (no interface tokens).
// - tsx-safe (no param decorators). Zero new deps.
import { Injectable } from '@nestjs/common';

export interface TranscodeJobStatus {
  jobId: string;
  lessonId: string;
  status: string;
  progressPercentage: number;
  masterPlaylistUrl: string | null;
  errorMessage: string | null;
  variants: Array<{ quality: string; totalChunks: number; avgChunkSizeBytes: number }>;
}

export interface TranscodeJobTables {
  videoTranscodeJob: {
    findUnique(args: unknown): Promise<{
      id: string;
      lessonId: string;
      status: string;
      progressPercentage: number;
      masterPlaylistUrl: string | null;
      errorMessage: string | null;
      variants: Array<{ quality: string; totalChunks: number; avgChunkSizeBytes: number }>;
    } | null>;
  };
}

@Injectable()
export class TranscodeJobReaderService {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(private readonly tables?: TranscodeJobTables) {}

  async findJobWithVariants(jobId: string): Promise<TranscodeJobStatus | null> {
    const row = await this.tables?.videoTranscodeJob
      .findUnique({ where: { id: jobId }, include: { variants: true } })
      .catch(() => null);
    if (!row) return null;
    return {
      jobId: row.id,
      lessonId: row.lessonId,
      status: row.status,
      progressPercentage: row.progressPercentage,
      masterPlaylistUrl: row.masterPlaylistUrl,
      errorMessage: row.errorMessage,
      variants: row.variants,
    };
  }
}
