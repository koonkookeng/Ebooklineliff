// SSOT Phase 106 Task 5 — SecurityMatrix GraphQL resolver (code-first, §3.2 intent)
// Canonical: apps/backend/src/modules/security-matrix/security-matrix.resolver.ts
// - Query.getTenantRoleMatrix / evaluateUserAccess / inspectActiveJwtScopes
// - Mutation.updateRoleBitwiseMatrix / revokeJwtScope / issueScopedTemporaryToken
// - Zero new deps.
import { Args, Context, Field, Float, ID, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { BitwiseEvaluatorService } from '../../application/services/bitwise-evaluator.service';
import { ScopeMatcherService } from '../../application/services/scope-matcher.service';
import { PrismaSecurityRoleRepository } from '../../infrastructure/persistence/prisma-security-role.repository';
import { TokenScopeService } from '../auth/services/token-scope.service';

@ObjectType('BitwisePermissionMatrix')
class BitwisePermissionMatrixGql {
  @Field(() => ID)
  roleId!: string;

  @Field()
  roleName!: string;

  @Field(() => ID)
  tenantId!: string;

  @Field()
  permissionBitmask!: string;

  @Field(() => [String])
  grantedScopes!: string[];

  @Field()
  updatedAt!: string;
}

@ObjectType('PermissionEvaluationResult')
class PermissionEvaluationResultGql {
  @Field()
  allowed!: boolean;

  @Field()
  missingBits!: string;

  @Field(() => [String])
  missingScopes!: string[];

  @Field(() => Float)
  evaluatedInMs!: number;
}

interface GqlContext {
  req?: { user?: { id: string; tenantId: string; bitmask?: string; scopes?: string[] } };
}

@Resolver()
@UseGuards(JwtAuthGuard)
export class SecurityMatrixResolver {
  constructor(
    private readonly repo: PrismaSecurityRoleRepository,
    private readonly bitwise: BitwiseEvaluatorService,
    private readonly scopes: ScopeMatcherService,
    private readonly tokens: TokenScopeService,
  ) {}

  @Query(() => BitwisePermissionMatrixGql)
  async getTenantRoleMatrix(
    @Args('tenantId', { type: () => ID }) tenantId: string,
    @Args('roleId', { type: () => ID }) roleId: string,
  ): Promise<BitwisePermissionMatrixGql> {
    const matrix = await this.repo.getMatrix(tenantId, roleId);
    if (!matrix) throw new Error('Role matrix not found');
    return matrix as BitwisePermissionMatrixGql;
  }

  @Query(() => PermissionEvaluationResultGql)
  async evaluateUserAccess(
    @Args('tenantId', { type: () => ID }) _tenantId: string,
    @Args('requiredBitmask') requiredBitmask: string,
    @Args('requiredScope') requiredScope: string,
    @Context() ctx: GqlContext,
  ): Promise<PermissionEvaluationResultGql> {
    const user = ctx.req?.user;
    const bit = this.bitwise.evaluate(user?.bitmask ?? '0', requiredBitmask);
    const scope = this.scopes.evaluate([requiredScope], user?.scopes ?? []);
    return {
      allowed: bit.allowed && scope.allowed,
      missingBits: bit.missingBits,
      missingScopes: scope.missingScopes,
      evaluatedInMs: bit.evaluatedInMs,
    };
  }

  @Query(() => [String])
  async inspectActiveJwtScopes(@Context() ctx: GqlContext): Promise<string[]> {
    return ctx.req?.user?.scopes ?? [];
  }

  @Mutation(() => BitwisePermissionMatrixGql)
  async updateRoleBitwiseMatrix(
    @Args('tenantId', { type: () => ID }) tenantId: string,
    @Args('roleId', { type: () => ID }) roleId: string,
    @Args('bitmask') bitmask: string,
    @Args('scopes', { type: () => [String] }) scopes: string[],
    @Context() ctx: GqlContext,
  ): Promise<BitwisePermissionMatrixGql> {
    const matrix = await this.repo.updateMatrix({
      tenantId,
      roleId,
      roleName: roleId,
      bitmask,
      scopes,
      actorUserId: ctx.req?.user?.id ?? 'unknown',
      ipAddress: 'unknown',
      userAgent: 'Unknown',
    });
    return matrix as BitwisePermissionMatrixGql;
  }

  @Mutation(() => Boolean)
  async revokeJwtScope(
    @Args('jti', { type: () => ID }) jti: string,
    @Args('reason') reason: string,
    @Context() ctx: GqlContext,
  ): Promise<boolean> {
    return this.tokens.revokeScope(jti, ctx.req?.user?.id ?? 'unknown', reason);
  }

  @Mutation(() => String)
  async issueScopedTemporaryToken(
    @Args('targetTenantId', { type: () => ID }) targetTenantId: string,
    @Args('requestedScopes', { type: () => [String] }) requestedScopes: string[],
    @Args('ttlSeconds', { type: () => Int, nullable: true }) ttlSeconds: number | null,
    @Context() ctx: GqlContext,
  ): Promise<string> {
    return this.tokens.issueScopedTemporaryToken({
      userId: ctx.req?.user?.id ?? 'unknown',
      targetTenantId,
      bitmask: ctx.req?.user?.bitmask ?? '0',
      requestedScopes,
      ttlSeconds: ttlSeconds ?? undefined,
    });
  }
}
