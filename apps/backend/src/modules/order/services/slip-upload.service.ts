// SSOT Phase 012 §6.1/§8 — Slip image upload to R2 (SigV4 S3 PUT, zero new deps)
// Canonical: apps/backend/src/modules/order/services/slip-upload.service.ts
// Serves POST /api/storage/upload-slip (spec §6.1). Public URL via R2_PUBLIC_DOMAIN
// so EasySlip can fetch it (zero egress). 503 when R2 env is absent (honest degrade).
import { createHash, createHmac } from 'node:crypto';
import { Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';

export const MAX_SLIP_BYTES = 5 * 1024 * 1024;

const sha256hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

/** Detect png/jpeg/webp by magic bytes (never trust client contentType). */
export function detectImageType(buf: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export interface SigV4Input {
  method: string;
  url: URL;
  payloadHash: string;
  accessKey: string;
  secretKey: string;
  region?: string;
  service?: string;
  now?: Date;
}

/** Pure SigV4 signer — byte-verified against the AWS documented test vector (see tests). */
export function signS3Request(input: SigV4Input): { authorization: string; amzDate: string } {
  const region = input.region ?? 'auto';
  const service = input.service ?? 's3';
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = input.url.pathname;
  const canonicalQuery = input.url.searchParams.toString();
  const host = input.url.host;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${input.payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [input.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, input.payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${input.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
  };
}

function r2Config(): { endpoint: string; bucket: string; accessKey: string; secret: string; publicDomain: string } {
  const endpoint = process.env.R2_ENDPOINT ?? '';
  const bucket = process.env.R2_BUCKET ?? process.env.R2_BUCKET_NAME ?? '';
  const accessKey = process.env.R2_ACCESS_KEY_ID ?? '';
  const secret = process.env.R2_SECRET_ACCESS_KEY ?? '';
  const publicDomain = (process.env.R2_PUBLIC_DOMAIN ?? '').replace(/\/$/, '');
  if (!endpoint || !bucket || !accessKey || !secret || !publicDomain) {
    throw new ServiceUnavailableException('Slip storage (R2) is not configured');
  }
  return { endpoint: endpoint.replace(/\/$/, ''), bucket, accessKey, secret, publicDomain };
}

@Injectable()
export class SlipUploadService {
  async uploadSlipImage(orderId: string, filename: string, contentType: string, dataBase64: string): Promise<{ slipImageUrl: string }> {
    if (!orderId) throw new BadRequestException('Missing order id');
    let buf: Buffer;
    try {
      buf = Buffer.from(dataBase64, 'base64');
    } catch {
      throw new BadRequestException('Invalid image data');
    }
    if (buf.length === 0 || buf.length > MAX_SLIP_BYTES) {
      throw new BadRequestException('Slip image must be 1 byte – 5 MB');
    }
    const kind = detectImageType(buf);
    if (!kind) throw new BadRequestException('Slip must be PNG, JPEG or WebP');
    void contentType;
    void filename;
    const cfg = r2Config();
    const ext = kind === 'jpeg' ? 'jpg' : kind;
    const key = `slips/${orderId}/${Date.now().toString(36)}.${ext}`;
    const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${key}`);
    const payloadHash = sha256hex(buf);
    const { authorization, amzDate } = signS3Request({
      method: 'PUT',
      url,
      payloadHash,
      accessKey: cfg.accessKey,
      secretKey: cfg.secret,
    });
    const res = await fetch(url.toString(), {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        'Content-Type': `image/${ext}`,
        'Content-Length': String(buf.length),
      },
      body: new Uint8Array(buf),
    }).catch(() => null);
    if (!res || !res.ok) throw new ServiceUnavailableException('Slip upload to storage failed');
    return { slipImageUrl: `${cfg.publicDomain}/${key}` };
  }
}
