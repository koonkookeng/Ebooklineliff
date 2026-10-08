// SSOT Phase 070 §3.2 — CrossDeviceResolver (code-first handoff GQL)
// Canonical: apps/backend/src/modules/sync/cross-device.resolver.ts
// (legacy src/backend/modules/sync/cross-device.resolver.ts)
// - Queries: getLatestCrossDeviceState / generateDesktopHandshakeQr.
// - Mutations: syncCrossDevicePosition / authorizeDesktopSession.
// - Realtime subscription rides the 057 SSE room stream (ADR-057); SDL
//   declares the Subscription contract.
// - Zero new deps.
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CrossDeviceStateService } from './cross-device-state.service';
import { SessionHandshakeService } from '../auth/session-handshake.service';

interface CrossDeviceGqlContext {
  req?: { user?: { id?: string; lineUserId?: string }; ip?: string; headers?: Record<string, string | undefined> };
}

@Resolver('CrossDeviceSync')
export class CrossDeviceResolver {
  constructor(
    private readonly state: CrossDeviceStateService,
    private readonly handshake: SessionHandshakeService,
  ) {}

  private userId(ctx: CrossDeviceGqlContext): string {
    const id = ctx?.req?.user?.id;
    if (!id) throw new Error('Missing session identity');
    return id;
  }

  @Query('getLatestCrossDeviceState')
  async getLatestCrossDeviceState(
    @Args('productId') productId: string,
    @Args('contentType') contentType: string,
    @Context() ctx: CrossDeviceGqlContext,
  ) {
    const latest = await this.state.getLatest(this.userId(ctx), String(productId), String(contentType));
    if (!latest) throw new Error('NO_SYNC_STATE');
    return latest;
  }

  @Query('generateDesktopHandshakeQr')
  async generateDesktopHandshakeQr(
    @Args('targetRedirectUrl') targetRedirectUrl: string,
    @Context() ctx: CrossDeviceGqlContext,
  ) {
    const userId = this.userId(ctx);
    const lineUserId = ctx?.req?.user?.lineUserId ?? userId;
    const res = await this.handshake.issueHandshake(userId, String(lineUserId), String(targetRedirectUrl));
    if (!res.ok) throw new Error(res.error ?? 'HANDSHAKE_FAILED');
    return { handshakeToken: res.handshakeToken, expiresAt: res.expiresAt, targetRedirectUrl: res.targetRedirectUrl };
  }

  @Mutation('syncCrossDevicePosition')
  async syncCrossDevicePosition(@Args('input') input: Record<string, unknown>, @Context() ctx: CrossDeviceGqlContext) {
    const res = await this.state.pushPosition(this.userId(ctx), input ?? {});
    if (!res.ok) throw new Error(res.error ?? 'SYNC_FAILED');
    return { success: true, resolvedPosition: res.resolvedPosition ?? 0, conflictResolved: res.conflictResolved ?? false };
  }

  @Mutation('authorizeDesktopSession')
  async authorizeDesktopSession(
    @Args('handshakeToken') handshakeToken: string,
    @Context() ctx: CrossDeviceGqlContext,
  ) {
    const res = await this.handshake.authorizeHandshake(this.userId(ctx), String(handshakeToken), `web-${Date.now().toString(36)}`);
    if (!res.ok) throw new Error(res.error ?? 'AUTHORIZE_FAILED');
    return { sessionFingerprint: res.sessionFingerprint };
  }
}
