// SSOT Phase 107 Task 4 — PII REST controller (unmask + policy + vault upsert)
// Canonical: apps/backend/src/modules/pii/pii.controller.ts
// - POST /api/v1/pii/unmask — JWT-guarded, reason-gated, quota-capped, audited.
// - GET /api/v1/pii/policy?tenantId=&role= — effective unmask policy read.
// - POST /api/v1/pii/vault — SUPER_ADMIN/COMPLIANCE-gated PII ingestion (BDD Sc. 1).
// - Zero new deps.
import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { PiiService, defaultCanUnmask } from './pii.service';
import { PII_UNMASK_MAX_PER_DAY, UnmaskRequestSchema, type SensitiveFieldType } from '@repo/shared';

interface AuthedRequest {
  user?: { id: string; role: string; tenantId: string };
  ip?: string;
  headers?: Record<string, string>;
}

@Controller('api/v1/pii')
@UseGuards(JwtAuthGuard)
export class PiiController {
  constructor(private readonly pii: PiiService) {}

  @Get('policy')
  async policy(@Query('tenantId') tenantId: string, @Query('role') role: string): Promise<unknown> {
    return {
      success: true,
      data: { tenantId: tenantId ?? 'default', role: role ?? 'MEMBER', canUnmask: defaultCanUnmask(role ?? ''), maxUnmasksPerDay: PII_UNMASK_MAX_PER_DAY },
    };
  }

  @Post('vault')
  async upsertVault(@Body() body: { userId?: string; phone?: string; bankAccount?: string; idCard?: string }, @Req() req: AuthedRequest): Promise<unknown> {
    const role = req.user?.role ?? 'MEMBER';
    if (role !== 'SUPER_ADMIN' && role !== 'COMPLIANCE_OFFICER' && role !== 'TENANT_ADMIN') {
      return { success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลส่วนบุคคลนี้' };
    }
    if (!body?.userId) return { success: false, message: 'userId required' };
    await this.pii.upsertUserPii(body.userId, { phone: body.phone, bankAccount: body.bankAccount, idCard: body.idCard });
    return { success: true, message: 'PII vault stored (encrypted)' };
  }

  @Post('unmask')
  async unmask(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const parsed = UnmaskRequestSchema.safeParse(body);
    if (!parsed.success) return { success: false, message: 'Invalid unmask request' };
    const result = await this.pii.requestUnmask({
      actorUserId: req.user?.id ?? 'unknown',
      actorRole: req.user?.role ?? 'MEMBER',
      tenantId: req.user?.tenantId ?? 'default',
      targetUserId: parsed.data.targetEntityId,
      fieldType: parsed.data.fieldType as SensitiveFieldType,
      reason: parsed.data.reason,
      ipAddress: req.ip ?? 'unknown',
      userAgent: req.headers?.['user-agent'] ?? 'Unknown',
    });
    return { success: true, data: result };
  }
}
