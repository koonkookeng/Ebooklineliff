// SSOT Phase 028 §8.1 — R2 CORS synchronizer (whitelist-validated rule builder)
// Canonical: apps/backend/src/infra/security/cloudflare-cors.config.ts
// (legacy src/backend/infra/security/cloudflare-cors.config.ts)
// - R2_CORS_RULES mirrors apps/backend/src/infra/cloudflare/r2-cors-policy.json
//   (single edit point: update the JSON, this module re-validates at boot).
// - loadWhitelistRegistry() reads config/line-developers-whitelist.json and
//   validates every entry against DomainWhitelistConfigSchema (fail-fast).
// - Zero new deps (node:fs + zod-via-shared only).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CDN_ASSET,
  CDN_VIDEO,
  DomainWhitelistConfigSchema,
  R2_CORS_MAX_AGE,
  type DomainWhitelistConfig,
} from '@repo/shared';

export interface R2CorsRule {
  AllowedOrigins: string[];
  AllowedMethods: string[];
  AllowedHeaders: string[];
  ExposeHeaders: string[];
  MaxAgeSeconds: number;
}

export const R2_CORS_RULES: R2CorsRule[] = [
  {
    AllowedOrigins: [
      'https://liff.omnichannel.com',
      'https://app.omnichannel.com',
      'https://*.line-scdn.net',
      'https://liff.line.me',
    ],
    AllowedMethods: ['GET', 'HEAD'],
    AllowedHeaders: ['Range', 'Authorization', 'Content-Type', 'If-Match', 'If-Modified-Since'],
    ExposeHeaders: ['Content-Range', 'Content-Length', 'ETag', 'Accept-Ranges'],
    MaxAgeSeconds: R2_CORS_MAX_AGE,
  },
];

/** HLS + ebook chunk origins served over the zero-egress R2 vault (Gate 6). */
export const R2_SERVED_ORIGINS: string[] = [CDN_VIDEO, CDN_ASSET];

function whitelistPath(): string {
  if (process.env.LINE_WHITELIST_PATH) return process.env.LINE_WHITELIST_PATH;
  return join(__dirname, '..', '..', 'config', 'line-developers-whitelist.json');
}

/** Load + Zod-validate the LINE Developers Console registration file. */
export function loadWhitelistRegistry(configPath: string = whitelistPath()): DomainWhitelistConfig[] {
  const raw = readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((entry, i) => {
    const checked = DomainWhitelistConfigSchema.safeParse(entry);
    if (!checked.success) {
      throw new Error(`Invalid whitelist entry #${i}: ${checked.error.issues[0]?.message ?? 'schema violation'}`);
    }
    return checked.data;
  });
}
