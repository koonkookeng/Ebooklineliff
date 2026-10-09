// SSOT Phase 107 Task 4 — PII GraphQL resolver (code-first)
// Canonical: apps/backend/src/modules/pii/pii.resolver.ts
// - Query.piiPolicy / Mutation.upsertUserPii / requestUnmaskPiiField.
// - Zero new deps.
import { Args, Context, Field, ID, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { PiiService, defaultCanUnmask } from './pii.service';
import { PII_UNMASK_MAX_PER_DAY, type SensitiveFieldType } from '@repo/shared';

@ObjectType('PiiPolicyPayload')
class PiiPolicyGql {
  @Field()
  tenantId!: string;

  @Field()
  role!: string;

  @Field()
  canUnmask!: boolean;

  @Field()
  maxUnmasksPerDay!: number;
}

@ObjectType('UnmaskResultPayload')
class UnmaskResultGql {
  @Field()
  plainText!: string;

  @Field()
  expiresInSec!: number;
}

interface GqlContext {
  req?: { user?: { id: string; role: string; tenantId: string }; ip?: string; headers?: Record<string, string> };
}

@Resolver()
@UseGuards(JwtAuthGuard)
export class PiiResolver {
  constructor(private readonly pii: PiiService) {}

  @Query(() => PiiPolicyGql)
  async piiPolicy(
    @Args('tenantId', { type: () => ID }) tenantId: string,
    @Args('role') role: string,
  ): Promise<PiiPolicyGql> {
    return { tenantId, role, canUnmask: defaultCanUnmask(role), maxUnmasksPerDay: PII_UNMASK_MAX_PER_DAY };
  }

  @Mutation(() => Boolean)
  async upsertUserPii(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('phone', { nullable: true }) phone: string | null,
    @Args('bankAccount', { nullable: true }) bankAccount: string | null,
    @Args('idCard', { nullable: true }) idCard: string | null,
  ): Promise<boolean> {
    await this.pii.upsertUserPii(userId, {
      phone: phone ?? undefined,
      bankAccount: bankAccount ?? undefined,
      idCard: idCard ?? undefined,
    });
    return true;
  }

  @Mutation(() => UnmaskResultGql)
  async requestUnmaskPiiField(
    @Args('targetUserId', { type: () => ID }) targetUserId: string,
    @Args('fieldType') fieldType: string,
    @Args('reason') reason: string,
    @Context() ctx: GqlContext,
  ): Promise<UnmaskResultGql> {
    return this.pii.requestUnmask({
      actorUserId: ctx.req?.user?.id ?? 'unknown',
      actorRole: ctx.req?.user?.role ?? 'MEMBER',
      tenantId: ctx.req?.user?.tenantId ?? 'default',
      targetUserId,
      fieldType: fieldType as SensitiveFieldType,
      reason,
      ipAddress: ctx.req?.ip ?? 'unknown',
      userAgent: ctx.req?.headers?.['user-agent'] ?? 'Unknown',
    });
  }
}
