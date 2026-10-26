// SSOT Phase 129 Gate 2/§8.2 — consent lifecycle manager (Article 26)
// Canonical: apps/backend/src/modules/pdpa/services/consent-manager.service.ts
// (legacy src/backend/modules/pdpa/services/consent-manager.service.ts)
// - Edge-first current-purpose read (24h); every grant/withdraw writes one
//   UserConsentHistory row per changed purpose (Article 30 ROPA trail).
//   Mandatory purposes can never be withdrawn while the account lives
//   (strict gate; withdrawal rides the DSR erasure lane instead).
// - Ports-based (tsx-importable). Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MANDATORY_PURPOSES,
  PDPA_CONSENT_VERSION,
  hasMandatoryConsent,
  newlyGrantedPurposes,
  withdrawnPurposes,
  type ConsentPurpose,
} from '@repo/shared';

export interface ConsentHistoryRow {
  userId: string;
  purpose: string;
  isGranted: boolean;
  consentVersion: string;
  ipAddress: string;
  userAgent: string;
  createdAt: Date | string;
}

export interface ConsentDbPort {
  userConsentHistory: {
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
    findMany(args: Record<string, unknown>): Promise<ConsentHistoryRow[]>;
  };
}

export interface ConsentEdgePort {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
  del(...keys: string[]): Promise<void>;
}

export const CONSENT_CACHE_TTL_SEC = 86400;
export function consentCurrentKey(userId: string): string {
  return `pdpa:consent:{${userId}}:current`;
}

export interface ConsentGrantInput {
  consentVersion: string;
  acceptedPurposes: ConsentPurpose[];
  ipAddress: string;
  userAgent: string;
  acceptedAt: string;
}

@Injectable()
export class ConsentManagerService {
  constructor(
    private readonly db: ConsentDbPort,
    private readonly edge?: ConsentEdgePort,
  ) {}

  /** Edge-first current purposes (null = never recorded). */
  async acceptedPurposes(userId: string): Promise<{ purposes: string[]; version: string } | null> {
    try {
      const raw = await this.edge?.get(consentCurrentKey(userId));
      if (raw) {
        const parsed = JSON.parse(raw) as { purposes: string[]; version: string };
        if (Array.isArray(parsed.purposes)) return parsed;
      }
    } catch {
      /* fall through to the ledger */
    }
    const rows = await this.db.userConsentHistory
      .findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 16 })
      .catch(() => []);
    if (rows.length === 0) return null;
    const latest = new Map<string, ConsentHistoryRow>();
    for (const row of rows) {
      if (!latest.has(row.purpose)) latest.set(row.purpose, row);
    }
    const purposes = [...latest.entries()].filter(([, r]) => r.isGranted).map(([p]) => p);
    const version = rows[0].consentVersion;
    const snapshot = { purposes, version };
    try {
      await this.edge?.setex(consentCurrentKey(userId), CONSENT_CACHE_TTL_SEC, JSON.stringify(snapshot));
    } catch {
      /* cache loss is non-fatal */
    }
    return snapshot;
  }

  /** Record a grant/withdraw; ledgers one row per changed purpose. */
  async recordConsent(
    userId: string,
    input: ConsentGrantInput,
  ): Promise<{ granted: string[]; withdrawn: string[]; version: string }> {
    if (!hasMandatoryConsent(input.acceptedPurposes)) {
      throw new BadRequestException('NECESSARY_TERMS consent is mandatory');
    }
    // Only the currently published notice can be recorded. Accepting a
    // stale version would write a grant the strict guard then rejects,
    // locking the user out until they somehow re-consent again.
    if (input.consentVersion !== PDPA_CONSENT_VERSION) {
      throw new BadRequestException('PDPA_CONSENT_VERSION_STALE');
    }
    const before = (await this.acceptedPurposes(userId).catch(() => null))?.purposes ?? [];
    const granted = newlyGrantedPurposes(before, input.acceptedPurposes);
    const withdrawn = withdrawnPurposes(before, input.acceptedPurposes).filter(
      (p) => !(MANDATORY_PURPOSES as readonly string[]).includes(p),
    );
    const at = new Date(input.acceptedAt);
    const rows = [
      ...granted.map((purpose) => ({
        userId, purpose, isGranted: true,
        consentVersion: input.consentVersion, ipAddress: input.ipAddress, userAgent: input.userAgent, createdAt: at,
      })),
      ...withdrawn.map((purpose) => ({
        userId, purpose, isGranted: false,
        consentVersion: input.consentVersion, ipAddress: input.ipAddress, userAgent: input.userAgent, createdAt: at,
      })),
    ];
    // First-ever grant also ledgers the mandatory base row explicitly.
    if (before.length === 0 && !granted.includes('NECESSARY_TERMS' as ConsentPurpose)) {
      rows.push({
        userId, purpose: 'NECESSARY_TERMS', isGranted: true,
        consentVersion: input.consentVersion, ipAddress: input.ipAddress, userAgent: input.userAgent, createdAt: at,
      });
    }
    if (rows.length > 0) await this.db.userConsentHistory.createMany({ data: rows });
    try {
      await this.edge?.del(consentCurrentKey(userId));
    } catch {
      /* stale cache self-heals on TTL */
    }
    return { granted, withdrawn, version: input.consentVersion };
  }

  /** GQL §3.2 status payload. */
  async statusPayload(userId: string): Promise<{
    isNecessaryAccepted: boolean;
    isMarketingAccepted: boolean;
    isAnalyticsAccepted: boolean;
    consentVersion: string;
    updatedAt: string;
  }> {
    const current = await this.acceptedPurposes(userId).catch(() => null);
    const purposes = current?.purposes ?? [];
    return {
      isNecessaryAccepted: purposes.includes('NECESSARY_TERMS'),
      isMarketingAccepted: purposes.includes('MARKETING_PROMOTION'),
      isAnalyticsAccepted: purposes.includes('ANALYTICS_BEHAVIOR'),
      consentVersion: current?.version ?? PDPA_CONSENT_VERSION,
      updatedAt: new Date().toISOString(),
    };
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const ConsentManagerServiceService = ConsentManagerService;
