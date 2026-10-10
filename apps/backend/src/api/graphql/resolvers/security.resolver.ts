// SSOT Phase 120 Task 7 §3.2 — IP anomaly GraphQL intents (code-first)
// Canonical: apps/backend/src/api/graphql/resolvers/security.resolver.ts
// (legacy src/backend/api/graphql/resolvers/security.resolver.ts)
// - Mutation.reportLoginEvent (spoof-gated verdict + MFA/BLOCK routing) /
//   Query.myLoginHistory (owner-scoped) / Query.anomalyQueue (admin) /
//   Mutation.blockOwnSession (self-serve revoke via the 119 lane).
// - Provided by DeviceSecurityModule (imported there; this file owns the
//   intent layer, the module owns wiring — 109 admin-user pattern).
// - Zero new deps.
import { Args, Context, Field, Float, Int, ObjectType, Query, Mutation, Resolver } from '@nestjs/graphql';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { IpAnomalyService } from '../../../modules/security/services/ip-anomaly.service';
import { SessionEvictionService } from '../../../modules/security/services/session-eviction.service';

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR', 'SUPPORT_STAFF']);

@ObjectType('LoginVerdictPayload')
class LoginVerdictPayloadGql {
  @Field() actionRequired!: string;
  @Field(() => Float) riskScore!: number;
  @Field() riskLevel!: string;
  @Field() anomalyType!: string;
  @Field() logId!: string;
  @Field(() => Float) elapsedMs!: number;
}

@ObjectType('LoginHistoryNode')
class LoginHistoryNodeGql {
  @Field() id!: string;
  @Field() ipAddress!: string;
  @Field({ nullable: true }) city!: string | null;
  @Field({ nullable: true }) countryCode!: string | null;
  @Field() riskLevel!: string;
  @Field(() => Float) riskScore!: number;
  @Field() anomalyType!: string;
  @Field() mfaChallenged!: boolean;
  @Field() sessionBlocked!: boolean;
  @Field() createdAt!: string;
}

type LooseCtx = Record<string, unknown>;

function actorOf(ctx: LooseCtx): { id: string; role?: string; ip: string; ua: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  const fwd = headers['x-forwarded-for'] ?? '';
  return {
    id: user.id,
    ...(user.role ? { role: user.role } : {}),
    ip: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
    ua: headers['user-agent'] ?? 'unknown',
  };
}

@Resolver('IpAnomaly')
export class SecurityResolver {
  constructor(
    private readonly anomaly: IpAnomalyService,
    private readonly sessions: SessionEvictionService,
  ) {}

  @Mutation('reportLoginEvent')
  reportLoginEvent(
    @Args('ipAddress') ipAddress: string,
    @Args('userAgent') userAgent: string,
    @Args('deviceFingerprint') deviceFingerprint: string,
    @Context() ctx: LooseCtx,
  ) {
    const actor = actorOf(ctx);
    return this.anomaly.processLoginEvent({ userId: actor.id, ipAddress, userAgent, deviceFingerprint });
  }

  @Query('myLoginHistory')
  async myLoginHistory(
    @Args('limit', { nullable: true }) limit: number | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const actor = actorOf(ctx);
    const rows = (await this.anomaly.recentLogins(actor.id, limit ?? 20)) as Record<string, unknown>[];
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: String(r['id'] ?? ''),
      ipAddress: String(r['ipAddress'] ?? ''),
      city: (r['city'] as string | null | undefined) ?? null,
      countryCode: (r['countryCode'] as string | null | undefined) ?? null,
      riskLevel: String(r['riskLevel'] ?? 'LOW'),
      riskScore: Number(r['riskScore'] ?? 0),
      anomalyType: String(r['anomalyType'] ?? 'NORMAL'),
      mfaChallenged: Boolean(r['isMfaChallenged'] ?? false),
      sessionBlocked: Boolean(r['isSessionBlocked'] ?? false),
      createdAt: r['createdAt'] instanceof Date ? (r['createdAt'] as Date).toISOString() : String(r['createdAt'] ?? ''),
    }));
  }

  @Query('anomalyQueue')
  async anomalyQueue(
    @Args('page', { nullable: true }) page: number | undefined,
    @Args('limit', { nullable: true }) limit: number | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const actor = actorOf(ctx);
    if (!actor.role || !ADMIN_ROLES.has(actor.role)) throw new ForbiddenException('Anomaly queue requires a security admin role');
    const p = Math.max(1, page ?? 1);
    const l = Math.min(100, Math.max(1, limit ?? 20));
    const rows = (await this.anomaly.flaggedLogins((p - 1) * l, l)) as Record<string, unknown>[];
    return { items: rows, page: p, limit: l };
  }

  @Mutation('blockOwnSession')
  blockOwnSession(@Context() ctx: LooseCtx) {
    const actor = actorOf(ctx);
    return this.sessions.revokeAll(actor.id, 'USER_BLOCK_SELF').then((r) => r.revoked > 0);
  }
}
