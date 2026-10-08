// SSOT Phase 059 §5.1 — ReaderPreferenceResolver (code-first thin shell)
// Canonical: apps/backend/src/modules/reader/infrastructure/api/reader-preference.resolver.ts
// (legacy src/backend/modules/reader/infrastructure/api/reader-preference.resolver.ts)
// - Query.getReaderPreference(userId) / Mutation.updateReaderPreference —
//   JWT context identity; decorator-free logic lives in the service/command
//   (tsx-safe). This file keeps the Nest shell (parity-checked).
// - Zero new deps.
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ReaderPreferenceService } from '../../application/reader-preference.service';
import { updateReaderPreferenceCommand } from '../../application/commands/update-preference.command';

interface PreferenceContext {
  req?: { user?: { id?: string } };
}

@Resolver('ReaderPreference')
export class ReaderPreferenceResolver {
  constructor(private readonly prefService: ReaderPreferenceService) {}

  @Query('getReaderPreference')
  async getReaderPreference(@Args('userId') userId: string, @Context() ctx: PreferenceContext) {
    const identity = ctx?.req?.user?.id ?? userId;
    if (!identity) throw new Error('Missing session identity');
    return this.prefService.getUserPreference(identity);
  }

  @Mutation('updateReaderPreference')
  async updateReaderPreference(
    @Args('userId') userId: string,
    @Args('invertTap') invertTap: boolean,
    @Args('enableKeybindings') enableKeybindings: boolean,
    @Context() ctx: PreferenceContext,
  ) {
    const identity = ctx?.req?.user?.id ?? userId;
    if (!identity) throw new Error('Missing session identity');
    return updateReaderPreferenceCommand(this.prefService, identity, { invertTap, enableKeybindings });
  }
}
