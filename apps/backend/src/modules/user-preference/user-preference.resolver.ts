// SSOT Phase 066 §5.1 — UserPreferenceResolver (code-first GQL)
// Canonical: apps/backend/src/modules/user-preference/user-preference.resolver.ts
// (legacy src/backend/modules/user-preference/user-preference.resolver.ts)
// - Queries: getUserReadingPreference. Mutations: updateUserReadingPreference.
// - Realtime subscription rides SSE (PreferenceSyncController.stream) per
//   ADR-057 transport policy; SDL declares the Subscription contract.
// - Zero new deps.
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UserPreferenceService } from './user-preference.service';

interface PreferenceGqlContext {
  req?: { user?: { id?: string } };
}

@Resolver('UserReadingPreference')
export class UserPreferenceResolver {
  constructor(private readonly prefs: UserPreferenceService) {}

  private userId(ctx: PreferenceGqlContext): string {
    const id = ctx?.req?.user?.id;
    if (!id) throw new Error('Missing session identity');
    return id;
  }

  @Query('getUserReadingPreference')
  async getUserReadingPreference(@Context() ctx: PreferenceGqlContext) {
    return this.prefs.getPreference(this.userId(ctx));
  }

  @Mutation('updateUserReadingPreference')
  async updateUserReadingPreference(
    @Args('input') input: Record<string, unknown>,
    @Context() ctx: PreferenceGqlContext,
  ) {
    const res = await this.prefs.updatePreference(this.userId(ctx), input ?? {});
    if (!res.ok || !res.preference) throw new Error(res.error ?? 'UPDATE_FAILED');
    return res.preference;
  }
}
