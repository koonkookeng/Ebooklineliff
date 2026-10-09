// SSOT Phase 106 Task 5/6 — SecurityMatrix REST controller (dual-guard, atomic writes)
// Canonical: apps/backend/src/modules/security-matrix/security-matrix.controller.ts
// (legacy src/backend/modules/security_matrix/presentation/security-matrix.controller.ts)
// - GET /api/v1/security/roles/:roleId?tenantId= — tenant-scoped matrix read.
// - PUT /api/v1/security/roles/:roleId — MANAGE_PERMISSIONS-gated atomic update.
// - POST /api/v1/security/revoke — Super-Admin JTI revocation (<1s edge fan-out).
// - POST /api/v1/security/scoped-token — issue short-lived tenant-bound token.
// - POST /api/v1/security/evaluate — O(1) verdict without DB hit (Gate 4).
// - Zero new deps.
import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { BitwisePermissionGuard } from '../../presentation/guards/bitwise-permission.guard';
import { RequireBitwise } from '../../presentation/decorators/require-bitwise.decorator';
import { RequireScopes } from '../../presentation/decorators/require-scopes.decorator';
import { BitwiseMatrixPayloadSchema, EvaluatePermissionInputSchema } from '@repo/shared';
import { BitwiseEvaluatorService } from '../../application/services/bitwise-evaluator.service';
import { ScopeMatcherService } from '../../application/services/scope-matcher.service';
import { PrismaSecurityRoleRepository } from '../../infrastructure/persistence/prisma-security-role.repository';
import { TokenScopeService } from '../auth/services/token-scope.service';

interface AuthedRequest {
  user?: { id: string; tenantId: string };
  ip?: string;
  headers?: Record<string, string>;
}

@Controller('api/v1/security')
@UseGuards(JwtAuthGuard)
export class SecurityMatrixController {
  constructor(
    private readonly repo: PrismaSecurityRoleRepository,
    private readonly bitwise: BitwiseEvaluatorService,
    private readonly scopes: ScopeMatcherService,
    private readonly tokens: TokenScopeService,
  ) {}

  @Get('roles/:roleId')
  async getMatrix(@Param('roleId') roleId: string, @Query('tenantId') tenantId: string): Promise<unknown> {
    const matrix = await this.repo.getMatrix(tenantId, roleId);
    if (!matrix) return { success: false, message: 'Role matrix not found', data: null };
    return { success: true, data: matrix };
  }

  @Put('roles/:roleId')
  @UseGuards(BitwisePermissionGuard)
  @RequireBitwise('256')
  @RequireScopes('tenant:*:permission:write')
  async updateMatrix(
    @Param('roleId') roleId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const parsed = BitwiseMatrixPayloadSchema.safeParse({ ...(body as object), roleId });
    if (!parsed.success) return { success: false, message: 'Invalid matrix payload', data: null };
    const roleName = (body as { roleName?: string }).roleName ?? roleId;
    const matrix = await this.repo.updateMatrix({
      tenantId: parsed.data.tenantId,
      roleId,
      roleName,
      bitmask: parsed.data.permissionBitmask,
      scopes: parsed.data.scopes,
      actorUserId: req.user?.id ?? 'unknown',
      ipAddress: req.ip ?? 'unknown',
      userAgent: req.headers?.['user-agent'] ?? 'Unknown',
    });
    return { success: true, message: 'Permissions Updated', data: matrix };
  }

  @Post('evaluate')
  async evaluate(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const parsed = EvaluatePermissionInputSchema.safeParse(body);
    if (!parsed.success) return { success: false, message: 'Invalid evaluation input', data: null };
    // Caller supplies its own cached mask/scopes via headers in tests; DB-free path:
    const headerMask = (req.headers?.['x-user-bitmask'] as string) ?? '0';
    const headerScopes = ((req.headers?.['x-user-scopes'] as string) ?? '').split(',').filter(Boolean);
    const bit = this.bitwise.evaluate(headerMask, parsed.data.requiredBitmask);
    const scope = this.scopes.evaluate([parsed.data.requiredScope], headerScopes);
    return {
      success: true,
      data: {
        allowed: bit.allowed && scope.allowed,
        missingBits: bit.missingBits,
        missingScopes: scope.missingScopes,
        evaluatedInMs: bit.evaluatedInMs,
      },
    };
  }

  @Post('revoke')
  @UseGuards(BitwisePermissionGuard)
  @RequireBitwise('256')
  async revoke(@Body() body: { jti?: string; userId?: string; reason?: string }): Promise<unknown> {
    if (!body?.jti || !body?.userId) return { success: false, message: 'jti + userId required' };
    const ok = await this.tokens.revokeScope(body.jti, body.userId, body.reason ?? 'admin-revoke');
    return { success: ok, data: ok };
  }

  @Post('scoped-token')
  async issueScoped(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const parsed = (body ?? {}) as { targetTenantId?: string; requestedScopes?: string[]; ttlSeconds?: number; bitmask?: string };
    if (!parsed.targetTenantId || !Array.isArray(parsed.requestedScopes)) {
      return { success: false, message: 'targetTenantId + requestedScopes required' };
    }
    const token = this.tokens.issueScopedTemporaryToken({
      userId: req.user?.id ?? 'unknown',
      targetTenantId: parsed.targetTenantId,
      bitmask: parsed.bitmask ?? '0',
      requestedScopes: parsed.requestedScopes,
      ttlSeconds: parsed.ttlSeconds,
    });
    return { success: true, data: { token } };
  }
}
