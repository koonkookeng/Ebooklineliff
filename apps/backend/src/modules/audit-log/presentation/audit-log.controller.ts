// SSOT Phase 118 Task 3 — audit REST (auditor-scoped reads + verify)
// Canonical: apps/backend/src/modules/audit-log/presentation/audit-log.controller.ts
// (legacy src/backend/modules/audit-log/presentation/audit-log.controller.ts)
// - GET logs (SUPER_ADMIN/FINANCE_ADMIN/auditor roles; hash details stay
//   server-side — the UI calls verify separately) / GET verify (chain
//   window) / POST append (admin actions; prefer in-txn service calls).
// - Zero new deps.
import { Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { assertAuditViewer, type AuditActorContext } from '../domain/audit-log.entity';
import { AuditLogService } from '../application/audit-log.service';

type LooseReq = Record<string, unknown>;

const READ_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR', 'SUPPORT_STAFF']);

function actorOf(req: LooseReq): AuditActorContext {
  const user = (req['user'] as { id?: string; role?: string; email?: string } | undefined) ?? {};
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  const fwd = headers['x-forwarded-for'] ?? '';
  if (!user.id || !user.role) throw new ForbiddenException('Audit console requires an authenticated admin');
  return {
    id: user.id,
    role: user.role,
    email: user.email ?? 'unknown',
    ipAddress: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
    userAgent: headers['user-agent'] ?? 'unknown',
  };
}

@Controller('api/v1/admin/audit')
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  @Get('logs')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async logs(
    @Req() req: LooseReq,
    @Query('actorId') actorId: string | undefined,
    @Query('actionCategory') actionCategory: string | undefined,
    @Query('integrityStatus') integrityStatus: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    const actor = actorOf(req);
    if (!READ_ROLES.has(actor.role)) throw new ForbiddenException('Audit console requires an admin role');
    const reveal = actor.role === 'SUPER_ADMIN' || actor.role === 'FINANCE_ADMIN';
    const rows = (await this.audit.list({
      ...(actorId ? { actorId } : {}),
      ...(actionCategory ? { actionCategory } : {}),
      ...(integrityStatus ? { integrityStatus } : {}),
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    })) as Record<string, unknown>[];
    // Gate 4 (§2.1): hash material only for auditor roles.
    if (reveal) return rows;
    return rows.map((r) => ({ ...r, previousHash: '••••', currentHash: '••••', signature: '••••' }));
  }

  @Get('verify')
  @UseGuards(JwtAuthGuard, TenantGuard)
  verify(@Req() req: LooseReq, @Query('take') take: string | undefined) {
    const actor = actorOf(req);
    assertAuditViewer(actor.role);
    return this.audit.verifyChain(0, take ? Number(take) : 1000);
  }

  @Post('append')
  @UseGuards(JwtAuthGuard, TenantGuard)
  append(@Req() req: LooseReq, @Body() body: unknown) {
    const actor = actorOf(req);
    const b = (body ?? {}) as { actionCategory?: string; actionName?: string; targetEntity?: string; targetEntityId?: string; payloadBefore?: unknown; payloadAfter?: unknown };
    return this.audit.append(actor, {
      actionCategory: b.actionCategory ?? '',
      actionName: b.actionName ?? '',
      targetEntity: b.targetEntity ?? '',
      ...(b.targetEntityId ? { targetEntityId: b.targetEntityId } : {}),
      ...(b.payloadBefore !== undefined ? { payloadBefore: b.payloadBefore } : {}),
      ...(b.payloadAfter !== undefined ? { payloadAfter: b.payloadAfter } : {}),
    });
  }
}
