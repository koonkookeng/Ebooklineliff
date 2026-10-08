// SSOT Phase 059 §5.1 — ReaderPreferenceService (nav & gesture prefs)
// Canonical: apps/backend/src/modules/reader/application/reader-preference.service.ts
// (legacy src/backend/modules/reader/application/reader-preference.service.ts)
// - getUserPreference: Prisma row → sanitized UserReaderPreference (fail-open
//   defaults; never 404s — LIFF renders with defaults).
// - updatePreference: atomic upsert (Gate 7) + Zod gate + sanitized custom
//   keymap; emits a best-effort event for the Redis stream (Gate 8).
// - tsx-safe (no param decorators; structural ports). Zero new deps.
import { Injectable, NotFoundException } from '@nestjs/common';
import { UserReaderPreferenceSchema, type UserReaderPreference } from '@repo/shared';
import { sanitizeKeybindings } from '../domain/value-objects/keybinding.vo';

export interface NavPreferenceRow {
  userId: string;
  invertTapZones: boolean;
  swipeSensitivity: number;
  enableKeyboardShortcuts: boolean;
  hapticFeedbackEnabled: boolean;
  customKeybindingsJson: unknown;
}

export interface NavPreferenceTables {
  userReaderPreference: {
    findUnique(args: unknown): Promise<NavPreferenceRow | null>;
    upsert(args: unknown): Promise<NavPreferenceRow>;
  };
}

export interface NavPreferenceInput {
  invertTap?: boolean;
  enableKeybindings?: boolean;
  invertTapZones?: boolean;
  swipeSensitivity?: number;
  enableKeyboardShortcuts?: boolean;
  hapticFeedbackEnabled?: boolean;
  customKeybindingsJson?: unknown;
}

const DEFAULTS: UserReaderPreference = {
  userId: '00000000-0000-0000-0000-000000000000',
  invertTapZones: false,
  swipeSensitivity: 1,
  enableKeyboardShortcuts: true,
  hapticFeedbackEnabled: true,
};

function toPreference(userId: string, row: NavPreferenceRow | null): UserReaderPreference {
  if (!row) return { ...DEFAULTS, userId };
  const candidate = {
    userId,
    invertTapZones: row.invertTapZones,
    swipeSensitivity: row.swipeSensitivity,
    enableKeyboardShortcuts: row.enableKeyboardShortcuts,
    hapticFeedbackEnabled: row.hapticFeedbackEnabled,
  };
  const verified = UserReaderPreferenceSchema.safeParse(candidate);
  if (verified.success) return verified.data;
  return { ...DEFAULTS, userId };
}

@Injectable()
export class ReaderPreferenceService {
  constructor(
    private readonly tables?: NavPreferenceTables,
    private readonly onEvent?: (event: { kind: string; userId: string }) => void,
  ) {}

  async getUserPreference(userId: string): Promise<UserReaderPreference> {
    const row = await this.tables?.userReaderPreference.findUnique({ where: { userId } }).catch(() => null);
    return toPreference(userId, row ?? null);
  }

  async updatePreference(userId: string, input: NavPreferenceInput): Promise<boolean> {
    if (!this.tables) throw new NotFoundException('Reader preferences unavailable');
    const invert = input.invertTapZones ?? input.invertTap ?? DEFAULTS.invertTapZones;
    const keys = input.enableKeyboardShortcuts ?? input.enableKeybindings ?? DEFAULTS.enableKeyboardShortcuts;
    const sensitivity = typeof input.swipeSensitivity === 'number' ? Math.max(0.1, Math.min(2.0, input.swipeSensitivity)) : 1.0;
    const haptic = input.hapticFeedbackEnabled ?? true;
    const customKeybindingsJson =
      input.customKeybindingsJson === undefined ? undefined : sanitizeKeybindings(input.customKeybindingsJson);
    await this.tables.userReaderPreference.upsert({
      where: { userId },
      create: {
        userId,
        invertTapZones: invert,
        swipeSensitivity: sensitivity,
        enableKeyboardShortcuts: keys,
        hapticFeedbackEnabled: haptic,
        ...(customKeybindingsJson === undefined ? {} : { customKeybindingsJson }),
      },
      update: {
        invertTapZones: invert,
        swipeSensitivity: sensitivity,
        enableKeyboardShortcuts: keys,
        hapticFeedbackEnabled: haptic,
        ...(customKeybindingsJson === undefined ? {} : { customKeybindingsJson }),
      },
    });
    try {
      this.onEvent?.({ kind: 'READER_PREFERENCE_CHANGED', userId });
    } catch {
      // analytics is best-effort
    }
    return true;
  }
}
