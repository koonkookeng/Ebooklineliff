// SSOT Phase 066 §5.1 — User-preference entity (defaults + LWW merge)
// Canonical: apps/backend/src/modules/user-preference/entities/user-preference.entity.ts
// (legacy src/backend/modules/user-preference/entities/user-preference.entity.ts)
// - Pure + tsx-safe. Zero new deps.
import type { ReadingThemeMode, ReadingFontFamily } from '@repo/shared';

export interface UserPreferenceEntity {
  userId: string;
  themeMode: ReadingThemeMode;
  fontSizePx: number;
  fontFamily: ReadingFontFamily;
  lineHeightRatio: number;
  brightnessLevel: number;
  autoSyncWithSystem: boolean;
  updatedAt: string;
}

export const DEFAULT_PREFERENCE: Omit<UserPreferenceEntity, 'userId' | 'updatedAt'> = {
  themeMode: 'SYSTEM',
  fontSizePx: 16,
  fontFamily: 'PROMPT',
  lineHeightRatio: 1.5,
  brightnessLevel: 100,
  autoSyncWithSystem: true,
};

/** Last-write-wins merge for offline sync (BDD-2): newer updatedAt wins. */
export function mergePreference(
  server: UserPreferenceEntity,
  incoming: Partial<UserPreferenceEntity> & { updatedAt: string },
): UserPreferenceEntity {
  if (new Date(incoming.updatedAt).getTime() <= new Date(server.updatedAt).getTime()) return server;
  return { ...server, ...incoming };
}
