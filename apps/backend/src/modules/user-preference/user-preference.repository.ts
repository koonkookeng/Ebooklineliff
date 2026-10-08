// SSOT Phase 066 §5.2 — UserPreferenceRepository (Prisma adapter)
// Canonical: apps/backend/src/modules/user-preference/user-preference.repository.ts
// (legacy src/backend/modules/user-preference/user-preference.repository.ts)
// - Thin adapter over the structural PreferenceTables port (tsx-safe).
// - Zero new deps.
import type { UpdatePreferenceInput } from '@repo/shared';

export interface PreferenceRecord {
  userId: string;
  themeMode: string;
  fontSizePx: number;
  fontFamily: string;
  lineHeightRatio: number;
  brightnessLevel: number;
  autoSyncWithSystem: boolean;
  updatedAt: Date | string;
}

export interface PreferenceTables {
  userReadingPreference: {
    findUnique(args: unknown): Promise<PreferenceRecord | null>;
    upsert(args: unknown): Promise<PreferenceRecord>;
  };
}

export function toTransport(row: PreferenceRecord, userId: string): Record<string, unknown> {
  return {
    userId,
    themeMode: row.themeMode,
    fontSizePx: row.fontSizePx,
    fontFamily: row.fontFamily,
    lineHeightRatio: row.lineHeightRatio,
    brightnessLevel: row.brightnessLevel,
    autoSyncWithSystem: row.autoSyncWithSystem,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

export class UserPreferenceRepository {
  constructor(private readonly tables?: PreferenceTables) {}

  findByUser(userId: string): Promise<PreferenceRecord | null> {
    if (!this.tables) return Promise.resolve(null);
    return this.tables.userReadingPreference.findUnique({ where: { userId } }).catch(() => null);
  }

  upsert(userId: string, input: UpdatePreferenceInput): Promise<PreferenceRecord | null> {
    if (!this.tables) return Promise.resolve(null);
    return this.tables.userReadingPreference
      .upsert({ where: { userId }, update: { ...input }, create: { userId, ...input } })
      .catch(() => null);
  }
}
