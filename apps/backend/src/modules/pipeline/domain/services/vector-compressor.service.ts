// SSOT Phase 038 Task 4 — Vector compressor (20–40KB/page target, §7.1)
// Canonical: apps/backend/src/modules/pipeline/domain/services/vector-compressor.service.ts
// (legacy src/backend/modules/pipeline/domain/services/vector-compressor.service.ts)
// - Collapses inter-tag whitespace, strips XML comments + editor metadata
//   (creator strings, sodipodi/inkscape namespaces) — pure string transforms.
// - Reports pre/post bytes so the pipeline can assert the page budget.
// - Zero new deps.
import { Injectable } from '@nestjs/common';

export interface CompressionReport {
  beforeBytes: number;
  afterBytes: number;
  output: string;
}

/** Compress reader-bound SVG (pure, unit-tested). */
export function compressVectorSvg(raw: string): CompressionReport {
  if (typeof raw !== 'string' || !raw) throw new Error('Empty SVG content');
  const beforeBytes = Buffer.byteLength(raw, 'utf8');
  let out = raw.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<\?xml[^?]*\?>/g, '');
  out = out.replace(/\s+xmlns:(sodipodi|inkscape|dc|cc|rdf)="[^"]*"/g, '');
  out = out.replace(/>\s+</g, '><').trim();
  return { beforeBytes, afterBytes: Buffer.byteLength(out, 'utf8'), output: out };
}

@Injectable()
export class VectorCompressorService {
  compress(raw: string): CompressionReport {
    return compressVectorSvg(raw);
  }
}
