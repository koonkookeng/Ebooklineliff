// SSOT Phase 066 §5.2 — UserPreferenceService (cache + fan-out + analytics)
// Canonical: apps/backend/src/modules/user-preference/user-preference.service.ts
// (legacy src/backend/modules/user-preference/user-preference.service.ts)
// - getPreference: read-through 24h edge cache, auto-create row defaults.
// - updatePreference: Zod-gated atomic upsert → cache write → Redis room
//   fan-out (<100ms budget) → analytics stream (circadian engine).
// - syncOfflinePreference: LWW merge for offline mutations (BDD-2).
// - tsx-safe structural ports. Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  UpdatePreferenceInputSchema,
  UserReadingPreferenceSchema,
  PREF_CACHE_TTL_SEC,
  PREF_ANALYTICS_STREAM,
  PREFERENCE_UPDATED_EVENT,
  preferenceCacheKey,
  preferenceChannel,
  type UpdatePreferenceInput,
} from '@repo/shared';
import { DEFAULT_PREFERENCE, mergePreference, type UserPreferenceEntity } from './entities/user-preference.entity';
import { UserPreferenceRepository, toTransport } from './user-preference.repository';

export interface PreferenceCache {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
  del(...keys: string[]): Promise<void>;
  xaddPipeline(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

export interface PreferenceBus {
  publishRoom(channel: string, event: string, data: unknown): Promise<void>;
}

@Injectable()
export class UserPreferenceService {
  constructor(
    private readonly repo?: UserPreferenceRepository,
    private readonly cache?: PreferenceCache,
    private readonly bus?: PreferenceBus,
    private readonly onChanged?: (event: { userId: string; themeMode: string; triggerSource: string }) => void,
  ) {}

  private shape(row: Record<string, unknown>, userId: string): UserPreferenceEntity {
    const parsed = UserReadingPreferenceSchema.safeParse({ ...DEFAULT_PREFERENCE, ...row, userId });
    if (parsed.success) return parsed.data as UserPreferenceEntity;
    return { ...DEFAULT_PREFERENCE, userId, updatedAt: new Date().toISOString() };
  }

  async getPreference(userId: string): Promise<UserPreferenceEntity> {
    const key = preferenceCacheKey(userId);
    try {
      const hit = await this.cache?.get(key);
      if (hit) return this.shape(JSON.parse(hit) as Record<string, unknown>, userId);
    } catch {
      // cache fail-open
    }
    const row = await this.repo?.findByUser(userId).catch(() => null);
    if (!row) {
      const created = await this.repo?.upsert(userId, {}).catch(() => null);
      const pref = this.shape(created ? toTransport(created, userId) : {}, userId);
      await this.cache?.setex(key, PREF_CACHE_TTL_SEC, JSON.stringify(pref)).catch(() => undefined);
      return pref;
    }
    const pref = this.shape(toTransport(row, userId), userId);
    await this.cache?.setex(key, PREF_CACHE_TTL_SEC, JSON.stringify(pref)).catch(() => undefined);
    return pref;
  }

  async updatePreference(
    userId: string,
    input: unknown,
    triggerSource = 'READER_TOOLBAR',
  ): Promise<{ ok: boolean; preference?: UserPreferenceEntity; error?: string }> {
    const parsed = UpdatePreferenceInputSchema.safeParse(input ?? {});
    if (!parsed.success || !this.repo) return { ok: false, error: 'INVALID_INPUT' };
    const clean: UpdatePreferenceInput = parsed.data;
    if (Object.keys(clean).length === 0) return { ok: true, preference: await this.getPreference(userId) };
    const row = await this.repo.upsert(userId, clean);
    if (!row) return { ok: false, error: 'WRITE_FAILED' };
    const pref = this.shape(toTransport(row, userId), userId);
    const key = preferenceCacheKey(userId);
    await this.cache?.setex(key, PREF_CACHE_TTL_SEC, JSON.stringify(pref)).catch(() => undefined);
    await this.bus?.publishRoom(preferenceChannel(userId), PREFERENCE_UPDATED_EVENT, pref).catch(() => undefined);
    await this.cache
      ?.xaddPipeline(PREF_ANALYTICS_STREAM, [
        { userId, newTheme: pref.themeMode, triggerSource, at: Date.now() },
      ])
      .catch(() => undefined);
    try {
      this.onChanged?.({ userId, themeMode: pref.themeMode, triggerSource });
    } catch {
      // analytics fan-out best-effort
    }
    return { ok: true, preference: pref };
  }

  /** Offline drain: single-row LWW (newer updatedAt wins, BDD-2). */
  async syncOfflinePreference(
    userId: string,
    incoming: Partial<UserPreferenceEntity> & { updatedAt: string },
  ): Promise<{ ok: boolean; preference?: UserPreferenceEntity }> {
    const server = await this.getPreference(userId);
    const merged = mergePreference(server, incoming);
    if (merged === server) return { ok: true, preference: server };
    const { updatedAt: _ignored, userId: _u, ...fields } = merged;
    void _ignored;
    void _u;
    return this.updatePreference(userId, fields, 'OFFLINE_SYNC');
  }
}
