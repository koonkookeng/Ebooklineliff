/**
 * Phase 000 — Cloudflare R2 Zero-Egress vault client.
 * E-book vector chunks (SVG/JSON) + HLS .m3u8/.ts served via R2, cached at edge.
 * Cost rule: storage only ($0.015/GB/mo), egress = 0.
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class R2StorageService {
  private endpoint = process.env.R2_ENDPOINT ?? '';
  private bucket = process.env.R2_BUCKET ?? 'ebook-chunks';

  /** Public edge URL for a stored object (served through CDN/R2, no egress fee). */
  objectUrl(storagePath: string): string {
    return `${this.endpoint}/${this.bucket}/${storagePath}`;
  }

  chunkPath(productId: string, page: number): string {
    return `ebooks/${productId}/page-${page}.svg`;
  }

  hlsPath(courseId: string, rendition: string, segment: string): string {
    return `hls/${courseId}/${rendition}/${segment}`;
  }
}
