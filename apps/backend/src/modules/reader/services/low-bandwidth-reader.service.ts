// SSOT Phase 055 §5.1 — Brotli vector-chunk compression engine (edge-cached)
// Canonical: apps/backend/src/modules/reader/services/low-bandwidth-reader.service.ts
// (legacy src/backend/modules/reader/low-bandwidth-reader.service.ts)
// - Raw SVG → Brotli (q11 on SLOW_2G/GOOD_3G, q6 otherwise) → Redis 24h →
//   base64 wire payload + sha256 checksum + 12-hex watermark hash.
// - Constructor takes ports — no Nest param decorators (tsx-importable).
// - SVG source is the entitled ReaderService payload (single source; the
//   24h brotli cell is a derived cache, never authoritative).
import { Injectable, NotFoundException } from '@nestjs/common';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import {
  LOW_NET_CHUNK_CACHE_TTL_SEC,
  LowBandwidthChunkRequestSchema,
  brotliQualityFor,
  isLowBandwidthTier,
  type LowBandwidthChunkResponse,
  type NetworkQualityTier,
} from '@repo/shared';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

export interface LowBandwidthChunkSource {
  fetchSvg(productId: string, pageNumber: number, userId: string, tenantId: string): Promise<string>;
}

export interface LowBandwidthChunkCache {
  getBuffer(key: string): Promise<Buffer | null>;
  setBuffer(key: string, value: Buffer, ttlSeconds: number): Promise<void>;
}

export function lowBandwidthCacheKey(productId: string, pageNumber: number, format = 'BROTLI'): string {
  return `ebook:chunk:${format.toLowerCase()}:${productId}:${pageNumber}`;
}

@Injectable()
export class LowBandwidthReaderService {
  constructor(
    private readonly source: LowBandwidthChunkSource,
    private readonly cache: LowBandwidthChunkCache,
  ) {}

  async getCompressedVectorChunk(
    productId: string,
    pageNumber: number,
    tier: NetworkQualityTier,
    userId: string,
    tenantId = 'default',
    format: 'BROTLI' | 'GZIP' | 'RAW_SVG' = 'BROTLI',
  ): Promise<LowBandwidthChunkResponse> {
    const req = LowBandwidthChunkRequestSchema.parse({
      productId,
      pageNumber,
      networkQuality: tier,
      compressFormat: format,
    });
    const key = lowBandwidthCacheKey(req.productId, req.pageNumber, req.compressFormat);
    let cell = await this.cache.getBuffer(key).catch(() => null);
    if (!cell) {
      const svg = await this.source.fetchSvg(req.productId, req.pageNumber, userId, tenantId).catch(() => null);
      if (!svg) throw new NotFoundException('E-Book asset not found');
      const raw = Buffer.from(svg, 'utf8');
      if (req.compressFormat === 'GZIP') {
        cell = await gzipAsync(raw);
      } else if (req.compressFormat === 'RAW_SVG') {
        cell = raw;
      } else {
        cell = await brotli(raw, {
          params: { [constants.BROTLI_PARAM_QUALITY]: brotliQualityFor(req.networkQuality) },
        });
      }
      await this.cache.setBuffer(key, cell, LOW_NET_CHUNK_CACHE_TTL_SEC).catch(() => undefined);
    }
    const userIdHash = createHash('sha256').update(userId).digest('hex').substring(0, 12);
    return {
      pageNumber: req.pageNumber,
      compressedPayloadBase64: cell.toString('base64'),
      byteLength: cell.length,
      isLowBandwidthMode: isLowBandwidthTier(req.networkQuality),
      forensicWatermarkHash: userIdHash,
      checksumSha256: createHash('sha256').update(cell).digest('hex'),
    };
  }
}
