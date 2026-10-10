// SSOT Phase 110 §3.2 — Inspector GraphQL resolver (code-first)
// Canonical: apps/backend/src/modules/user-inspector/resolvers/user-inspector.resolver.ts
// - Intent names match spec §3.2 verbatim (getUser360Profile /
//   getUserReadingHeatmap / getUserVideoWatchAnalytics /
//   getUserSecurityAuditLogs / revokeUserActiveSessions /
//   recalculateUserRFMScore / flagUserRiskLevel).
// - RISK_CALL: runtime TS twin enums mirror the Zod SSOT (Phase 108/109 twin
//   precedent) with load-time drift guards.
// - Zero new deps.
import { Resolver, Query, Mutation, Args, Int, Float, ID, ObjectType, Field, registerEnumType } from '@nestjs/graphql';
import { UseGuards, SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { AdminRbacGuard, ADMIN_ROLES_KEY } from '../../admin/user-management/guards/admin-rbac.guard';
import { UserInspectorService } from '../services/user-inspector.service';
import { RfmCalculatorService } from '../services/rfm-calculator.service';
import { SecurityTelemetryService } from '../services/security-telemetry.service';
import { RiskLevelEnum, UserActivityTypeEnum } from '@repo/shared';

enum InspectorRiskLevelGql {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}
registerEnumType(InspectorRiskLevelGql, { name: 'InspectorRiskLevel' });

enum InspectorActivityTypeGql {
  LOGIN_LIFF = 'LOGIN_LIFF',
  LOGIN_WEB = 'LOGIN_WEB',
  PURCHASE_COMPLETED = 'PURCHASE_COMPLETED',
  EBOOK_PAGE_READ = 'EBOOK_PAGE_READ',
  COURSE_VIDEO_WATCH = 'COURSE_VIDEO_WATCH',
  SLIP_UPLOADED = 'SLIP_UPLOADED',
  AFFILIATE_CLICK = 'AFFILIATE_CLICK',
  SESSION_REVOKED = 'SESSION_REVOKED',
}
registerEnumType(InspectorActivityTypeGql, { name: 'InspectorActivityType' });

for (const v of RiskLevelEnum.options) {
  if ((InspectorRiskLevelGql as Record<string, string>)[v] !== v) throw new Error(`InspectorRiskLevelGql drift: ${v}`);
}
for (const v of UserActivityTypeEnum.options) {
  if ((InspectorActivityTypeGql as Record<string, string>)[v] !== v) throw new Error(`InspectorActivityTypeGql drift: ${v}`);
}

export const RequireGqlInspectorRoles = (...roles: string[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

export const GqlInspectorAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const gql = GqlExecutionContext.create(ctx);
  const req = gql.getContext()?.req as { user?: { id?: string; sub?: string; role?: string }; ip?: string } | undefined;
  return { adminId: req?.user?.id ?? req?.user?.sub ?? '', role: req?.user?.role ?? '', ip: req?.ip ?? 'unknown' };
});

@ObjectType()
class RFMScorePayload {
  @Field(() => Int) recencyScore!: number;
  @Field(() => Int) frequencyScore!: number;
  @Field(() => Int) monetaryScore!: number;
  @Field() segmentLabel!: string;
}

@ObjectType()
class User360ProfilePayload {
  @Field(() => ID) userId!: string;
  @Field() displayName!: string;
  @Field({ nullable: true }) email?: string;
  @Field({ nullable: true }) lineUserId?: string;
  @Field(() => Float) walletBalance!: number;
  @Field(() => Int) rewardPoints!: number;
  @Field(() => Float) lifetimeValueAmount!: number;
  @Field(() => Int) totalOrdersCount!: number;
  @Field(() => RFMScorePayload) rfmScore!: RFMScorePayload;
  @Field(() => InspectorRiskLevelGql) riskLevel!: InspectorRiskLevelGql;
  @Field() createdAt!: string;
}

@ObjectType()
class EbookPageHeatmapPayload {
  @Field(() => Int) pageNumber!: number;
  @Field(() => Int) totalDwellTimeSec!: number;
  @Field(() => Int) readCount!: number;
  @Field() lastReadAt!: string;
}

@ObjectType()
class LessonWatchDetail {
  @Field(() => ID) lessonId!: string;
  @Field() lessonTitle!: string;
  @Field(() => Int) watchedSec!: number;
  @Field(() => Int) durationSec!: number;
  @Field() isCompleted!: boolean;
}

@ObjectType()
class VideoWatchAnalyticsPayload {
  @Field(() => ID) courseId!: string;
  @Field(() => Int) totalWatchedSeconds!: number;
  @Field(() => Float) overallCompletionPercentage!: number;
  @Field(() => [LessonWatchDetail]) lessonBreakdown!: LessonWatchDetail[];
}

@ObjectType()
class SecurityAuditLogPayload {
  @Field(() => ID) id!: string;
  @Field(() => InspectorActivityTypeGql) activityType!: InspectorActivityTypeGql;
  @Field() ipAddress!: string;
  @Field() userAgent!: string;
  @Field({ nullable: true }) deviceFingerprint?: string;
  @Field({ nullable: true }) lineSessionId?: string;
  @Field(() => InspectorRiskLevelGql) riskLevel!: InspectorRiskLevelGql;
  @Field() createdAt!: string;
}

@ObjectType()
class SessionRevokePayload {
  @Field() success!: boolean;
  @Field(() => Int) revokedSessionsCount!: number;
  @Field() timestamp!: string;
}

@ObjectType()
class RiskFlagPayload {
  @Field() success!: boolean;
  @Field(() => ID) userId!: string;
  @Field(() => InspectorRiskLevelGql) updatedRiskLevel!: InspectorRiskLevelGql;
}

@Resolver()
@UseGuards(JwtAuthGuard, AdminRbacGuard)
export class UserInspectorResolver {
  constructor(
    private readonly inspector: UserInspectorService,
    private readonly rfm: RfmCalculatorService,
    private readonly security: SecurityTelemetryService,
  ) {}

  @Query(() => User360ProfilePayload)
  async getUser360Profile(
    @Args('userId', { type: () => ID }) userId: string,
    @GqlInspectorAdmin() admin: { role: string },
  ) {
    const p = (await this.inspector.getUser360Profile(userId, admin.role)) as {
      userId: string; displayName: string; email: string | null; lineUserId: string | null;
      walletBalance: number; rewardPoints: number; lifetimeValueAmount: number; totalOrdersCount: number;
      rfmScore: RFMScorePayload; riskLevel: string; createdAt: string;
    };
    return {
      ...p,
      email: p.email ?? undefined,
      lineUserId: p.lineUserId ?? undefined,
      riskLevel: p.riskLevel as InspectorRiskLevelGql,
    };
  }

  @Query(() => [EbookPageHeatmapPayload])
  async getUserReadingHeatmap(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('ebookId', { type: () => ID }) ebookId: string,
  ) {
    const heat = await this.inspector.getReadingHeatmap(userId, ebookId);
    return heat.cells;
  }

  @Query(() => VideoWatchAnalyticsPayload)
  async getUserVideoWatchAnalytics(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('courseId', { type: () => ID }) courseId: string,
  ) {
    return this.inspector.getVideoAnalytics(userId, courseId);
  }

  @Query(() => [SecurityAuditLogPayload])
  async getUserSecurityAuditLogs(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('limit', { type: () => Int, nullable: true }) limit = 20,
    @Args('offset', { type: () => Int, nullable: true }) offset = 0,
    @GqlInspectorAdmin() admin: { role: string },
  ) {
    const out = await this.inspector.getSecurityLogs(userId, limit, offset, admin.role);
    return out.logs.map((l) => ({
      ...l,
      activityType: l.activityType as InspectorActivityTypeGql,
      deviceFingerprint: l.deviceFingerprint ?? undefined,
      lineSessionId: l.lineSessionId ?? undefined,
      riskLevel: l.riskLevel as InspectorRiskLevelGql,
    }));
  }

  @Mutation(() => SessionRevokePayload)
  @RequireGqlInspectorRoles('SUPER_ADMIN', 'FINANCE_ADMIN')
  async revokeUserActiveSessions(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('reason') reason: string,
    @GqlInspectorAdmin() admin: { adminId: string },
  ) {
    return this.inspector.revokeAllSessions(userId, reason, admin.adminId);
  }

  @Mutation(() => RFMScorePayload)
  async recalculateUserRFMScore(@Args('userId', { type: () => ID }) userId: string) {
    return this.rfm.recalculate(userId);
  }

  @Mutation(() => RiskFlagPayload)
  @RequireGqlInspectorRoles('SUPER_ADMIN', 'FINANCE_ADMIN')
  async flagUserRiskLevel(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('riskLevel') riskLevel: string,
    @Args('note') note: string,
    @GqlInspectorAdmin() admin: { adminId: string; ip: string },
  ) {
    const out = await this.security.flagRisk(userId, riskLevel, note, admin.adminId, admin.ip);
    return { ...out, updatedRiskLevel: out.updatedRiskLevel as InspectorRiskLevelGql };
  }
}
