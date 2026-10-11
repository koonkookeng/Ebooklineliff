// SSOT Phase 129 §5/§8.1 — LINE compliance service (revocation + whitelist)
// Canonical: apps/backend/src/modules/line-compliance/line-compliance.service.ts
// (legacy src/backend/modules/line-compliance/line-compliance.service.ts)
// - revokeUserTokens(): blacklists the user scope in Redis (JTI lane,
//   106 precedent) so stolen/rotated LINE sessions die within the 1s
//   BDD-2 budget. verifyWhitelist(): pure LIFF-domain allowlist check
//   (§8.1 matrix — HTTPS + registered domains only).
// - Ports-based (tsx-importable). Zero new deps.
import { Injectable } from '@nestjs/common';

export interface ComplianceEdgePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<void>;
}

/** Registered LIFF serving domains (§8.1 matrix, HTTPS only). */
export const LINE_LIFF_WHITELIST = [
  'https://liff.line.me',
  'https://liff.omnichannel.com',
  'https://miniapp.line.me',
];

export function verifyWhitelist(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return LINE_LIFF_WHITELIST.some((allowed) => {
      const host = new URL(allowed).host;
      return parsed.host === host || parsed.host.endsWith(`.${host}`);
    });
  } catch {
    return false;
  }
}

export function revocationKey(userId: string): string {
  return `line:revoked:{${userId}}`;
}

@Injectable()
export class LineComplianceService {
  constructor(private readonly edge: ComplianceEdgePort) {}

  /** Revoke all LINE-bound tokens for a user (returns keys written). */
  async revokeUserTokens(userId: string, ttlSeconds = 86400): Promise<number> {
    try {
      await this.edge.set(revocationKey(userId), String(Date.now()), 'EX', ttlSeconds);
      return 1;
    } catch {
      return 0;
    }
  }

  async isRevoked(userId: string): Promise<boolean> {
    try {
      return (await this.edge.get(revocationKey(userId))) !== null;
    } catch {
      return false; // fail-open read (revocation writes stay authoritative)
    }
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const LineComplianceServiceService = LineComplianceService;
