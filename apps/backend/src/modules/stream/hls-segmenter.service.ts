// SSOT Phase 044 Task 4 — HlsSegmenterService (RFC8216 + 2MB guard, pure)
// Canonical: apps/backend/src/modules/stream/hls-segmenter.service.ts
// (legacy src/backend/modules/stream/hls-segmenter.service.ts)
// - validateMasterPlaylist: minimal RFC 8216 shape (EXTM3U + versioned
//   variant entries); validateSegments: every .ts ≤ 2MB (§10 Auto-QA).
// - buildVariantMetadata: per-quality stats for VideoQualityVariant rows.
// - buildMasterPlaylist: deterministic master from variant entries.
// - Pure + tsx-safe. Zero new deps.
import { Injectable } from '@nestjs/common';
import { HLS_SEGMENT_MAX_BYTES, type HlsVariantMetadata, type TranscodeQuality } from '@repo/shared';

export interface SegmentFile {
  name: string;
  sizeBytes: number;
}

export interface VariantSpec {
  quality: TranscodeQuality;
  bandwidthBitsPerSec: number;
  width: number;
  height: number;
  playlistFileName: string;
  segments: SegmentFile[];
}

export function validateMasterPlaylist(text: string): { ok: boolean; reason?: string } {
  if (!text.startsWith('#EXTM3U')) return { ok: false, reason: 'missing EXTM3U header' };
  if (!text.includes('#EXT-X-STREAM-INF')) return { ok: false, reason: 'no variant entries' };
  return { ok: true };
}

export function validateSegments(files: SegmentFile[]): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const file of files) {
    if (!file.name.endsWith('.ts')) continue;
    if (file.sizeBytes > HLS_SEGMENT_MAX_BYTES) {
      violations.push(`${file.name}: ${file.sizeBytes} bytes exceeds 2MB`);
    }
    if (file.sizeBytes <= 0) violations.push(`${file.name}: empty segment`);
  }
  return { ok: violations.length === 0, violations };
}

export function buildVariantMetadata(spec: VariantSpec): HlsVariantMetadata {
  const ts = spec.segments.filter((s) => s.name.endsWith('.ts'));
  const total = ts.reduce((sum, s) => sum + s.sizeBytes, 0);
  return {
    quality: spec.quality,
    bandwidthBitsPerSec: spec.bandwidthBitsPerSec,
    resolutionWidth: spec.width,
    resolutionHeight: spec.height,
    playlistFileName: spec.playlistFileName,
    chunkCount: ts.length,
    averageChunkSizeBytes: ts.length === 0 ? 0 : Math.round(total / ts.length),
  };
}

export function buildMasterPlaylist(entries: Array<{ playlistFileName: string; bandwidthBitsPerSec: number; width: number; height: number }>): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const entry of entries) {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${entry.bandwidthBitsPerSec},RESOLUTION=${entry.width}x${entry.height}`);
    lines.push(entry.playlistFileName);
  }
  return `${lines.join('\n')}\n`;
}

@Injectable()
export class HlsSegmenterService {
  validateMasterPlaylist = validateMasterPlaylist;
  validateSegments = validateSegments;
  buildVariantMetadata = buildVariantMetadata;
  buildMasterPlaylist = buildMasterPlaylist;
}
