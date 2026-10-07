// SSOT Phase 000 (URL builder) + Phase 036 §5.1 (SigV4 S3-compatible transport)
// Canonical: apps/backend/src/infra/cloudflare/r2-storage.service.ts
// (legacy src/backend/infra/cloudflare/r2-storage.service.ts)
// - Phase 000 surface (objectUrl/chunkPath/hlsPath) preserved verbatim.
// - Phase 036 transport: R2 is S3-compatible — signed GET/PUT + presigned URLs
//   via SigV4 implemented on node:crypto + global fetch (zero new deps;
//   RISK_CALL deviation: no @aws-sdk/client-s3 in this monorepo).
// - Missing R2 credentials fail explicit 503 (never a fabricated URL, Gate 4).
// - Zero new deps.
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacHex(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDates(now: Date = new Date()): { amzDate: string; dateStamp: string } {
  const p = (n: number) => String(n).padStart(2, '0');
  const amzDate =
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

@Injectable()
export class R2StorageService {
  private readonly logger = new Logger(R2StorageService.name);
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

  /** Read R2 credentials (throws 503 when unconfigured — explicit, Gate 4). */
  config(): R2Config {
    const accountId = process.env.R2_ACCOUNT_ID ?? '';
    const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? '';
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? '';
    const bucket = process.env.R2_VAULT_BUCKET ?? 'omni-commerce-vault';
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new ServiceUnavailableException('R2 storage not configured');
    }
    return { accountId, accessKeyId, secretAccessKey, bucket };
  }

  endpointFor(accountId: string): string {
    if (this.endpoint) return this.endpoint;
    return `https://${accountId}.r2.cloudflarestorage.com`;
  }

  private signingKey(secret: string, dateStamp: string): Buffer {
    const kDate = hmacHex(`AWS4${secret}`, dateStamp);
    const kRegion = hmacHex(kDate, 'auto');
    const kService = hmacHex(kRegion, 's3');
    return hmacHex(kService, 'aws4_request');
  }

  /** SigV4 presigned GET URL (short-lived bearer, BDD Scenario 2: 60s HLS). */
  presignedGetUrl(objectKey: string, expiresInSeconds: number, contentType?: string): string {
    const cfg = this.config();
    const host = new URL(this.endpointFor(cfg.accountId)).host;
    const { amzDate, dateStamp } = amzDates();
    const credential = `${cfg.accessKeyId}/${dateStamp}/auto/s3/aws4_request`;
    const params: Array<[string, string]> = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', credential],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(Math.max(1, Math.min(expiresInSeconds, 604800)))],
      ['X-Amz-SignedHeaders', 'host'],
    ];
    if (contentType) params.push(['response-content-type', contentType]);
    const canonicalQuery = params
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .sort()
      .join('&');
    const canonicalRequest = [
      'GET',
      `/${cfg.bucket}/${objectKey.split('/').map((s) => encodeURIComponent(s)).join('/')}`,
      canonicalQuery,
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const scope = `${dateStamp}/auto/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const signature = hmacHex(this.signingKey(cfg.secretAccessKey, dateStamp), stringToSign).toString('hex');
    return `https://${host}/${cfg.bucket}/${objectKey}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  /** SigV4 presigned PUT URL (creator direct upload, §3.2 mutation). */
  presignedPutUrl(objectKey: string, contentType: string, expiresInSeconds: number): string {
    const cfg = this.config();
    const host = new URL(this.endpointFor(cfg.accountId)).host;
    const { amzDate, dateStamp } = amzDates();
    const credential = `${cfg.accessKeyId}/${dateStamp}/auto/s3/aws4_request`;
    const params: Array<[string, string]> = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', credential],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(Math.max(1, Math.min(expiresInSeconds, 604800)))],
      ['X-Amz-SignedHeaders', 'host'],
    ];
    const canonicalQuery = params
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .sort()
      .join('&');
    const canonicalRequest = [
      'PUT',
      `/${cfg.bucket}/${objectKey.split('/').map((s) => encodeURIComponent(s)).join('/')}`,
      canonicalQuery,
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const scope = `${dateStamp}/auto/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const signature = hmacHex(this.signingKey(cfg.secretAccessKey, dateStamp), stringToSign).toString('hex');
    return `https://${host}/${cfg.bucket}/${objectKey}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  private authHeader(
    cfg: R2Config,
    method: string,
    objectKey: string,
    payloadHash: string,
    contentType: string,
    amzDate: string,
    dateStamp: string,
  ): string {
    const host = new URL(this.endpointFor(cfg.accountId)).host;
    const canonicalRequest = [
      method,
      `/${cfg.bucket}/${objectKey.split('/').map((s) => encodeURIComponent(s)).join('/')}`,
      '',
      `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
      'content-type;host;x-amz-content-sha256;x-amz-date',
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/auto/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const signature = hmacHex(this.signingKey(cfg.secretAccessKey, dateStamp), stringToSign).toString('hex');
    return `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=${signature}`;
  }

  /** Signed GET object as text (chunk/manifest fetch, BDD Scenario 1). */
  async getObjectText(objectKey: string): Promise<string> {
    const cfg = this.config();
    const { amzDate, dateStamp } = amzDates();
    const payloadHash = sha256Hex('');
    const url = `${this.endpointFor(cfg.accountId)}/${cfg.bucket}/${objectKey}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: this.authHeader(cfg, 'GET', objectKey, payloadHash, 'application/octet-stream', amzDate, dateStamp),
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
      },
    });
    if (!res.ok) throw new Error(`R2 GET ${res.status} for ${objectKey}`);
    return res.text();
  }

  /** Signed PUT object (chunk/segment upload, BDD Scenario 3). */
  async putObject(objectKey: string, body: string | Buffer, contentType: string): Promise<{ eTag: string }> {
    const cfg = this.config();
    const { amzDate, dateStamp } = amzDates();
    const payload = typeof body === 'string' ? body : body.toString('utf-8');
    const payloadHash = sha256Hex(payload);
    const url = `${this.endpointFor(cfg.accountId)}/${cfg.bucket}/${objectKey}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader(cfg, 'PUT', objectKey, payloadHash, contentType, amzDate, dateStamp),
        'Content-Type': contentType,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
      },
      body: payload,
    });
    if (!res.ok) {
      this.logger.warn(`R2 PUT failed: ${res.status} for ${objectKey}`);
      throw new Error(`R2 PUT ${res.status} for ${objectKey}`);
    }
    return { eTag: res.headers.get('etag') ?? '' };
  }
}
