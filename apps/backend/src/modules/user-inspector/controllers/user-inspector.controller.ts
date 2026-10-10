// SSOT Phase 110 §5.1 — Inspector REST controller
// Canonical: apps/backend/src/modules/user-inspector/controllers/user-inspector.controller.ts
// - JwtAuthGuard + AdminRbacGuard (109) — SUPPORT_STAFF receives masked
//   telemetry (service-level, §8.1); tenant scoping rides X-Tenant-ID.
// - Thin intent adapter: math + ledger live in services (Zero Redundant Code).
// - Zero new deps.
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { AdminRbacGuard, RequireAdminRoles } from '../../admin/user-management/guards/admin-rbac.guard';
import { UserInspectorService } from '../services/user-inspector.service';
import { RfmCalculatorService } from '../services/rfm-calculator.service';
import { SecurityTelemetryService } from '../services/security-telemetry.service';
import { HeatmapQuerySchema, VideoAnalyticsQuerySchema, SecurityLogsQuerySchema, ReadingBatchSchema, VideoBatchSchema } from '../dto/user-360-query.dto';
import { SessionRevokeBodySchema, RiskFlagBodySchema } from '../dto/session-revoke.dto';

interface AuthedRequest extends Record<string, unknown> {
  user?: { id?: string; sub?: string; role?: string };
  ip?: string;
  headers?: Record<string, string | undefined>;
}

function adminOf(req: AuthedRequest): { adminId: string; role: string; ip: string } {
  const adminId = req.user?.id ?? req.user?.sub;
  if (!adminId) throw new BadRequestException('Missing admin identity');
  const fwd = req.headers?.['x-forwarded-for'];
  return { adminId, role: req.user?.role ?? '', ip: fwd ? fwd.split(',')[0].trim() : ((req.ip as string) ?? 'unknown') };
}

@Controller('api/v1/user-inspector')
@UseGuards(JwtAuthGuard, AdminRbacGuard)
export class UserInspectorController {
  constructor(
    private readonly inspector: UserInspectorService,
    private readonly rfm: RfmCalculatorService,
    private readonly security: SecurityTelemetryService,
  ) {}

  @Get('profile/:userId')
  async profile(@Param('userId') userId: string, @Req() req: AuthedRequest) {
    if (!userId) throw new BadRequestException('Missing userId');
    return this.inspector.getUser360Profile(userId, adminOf(req).role);
  }

  @Get('heatmap/:userId/:ebookId')
  async heatmap(@Param('userId') userId: string, @Param('ebookId') ebookId: string) {
    const parsed = HeatmapQuerySchema.safeParse({ userId, ebookId });
    if (!parsed.success) throw new BadRequestException('Invalid heatmap query');
    return this.inspector.getReadingHeatmap(userId, ebookId);
  }

  @Get('video/:userId/:courseId')
  async video(@Param('userId') userId: string, @Param('courseId') courseId: string) {
    const parsed = VideoAnalyticsQuerySchema.safeParse({ userId, courseId });
    if (!parsed.success) throw new BadRequestException('Invalid video analytics query');
    return this.inspector.getVideoAnalytics(userId, courseId);
  }

  @Get('security/:userId')
  async securityLogs(@Param('userId') userId: string, @Query() query: Record<string, unknown>, @Req() req: AuthedRequest) {
    const parsed = SecurityLogsQuerySchema.safeParse({ ...query, userId });
    if (!parsed.success) throw new BadRequestException('Invalid security-log query');
    return this.inspector.getSecurityLogs(userId, parsed.data.limit, parsed.data.offset, adminOf(req).role);
  }

  @Post('revoke/:userId')
  @RequireAdminRoles('SUPER_ADMIN', 'FINANCE_ADMIN')
  async revoke(@Param('userId') userId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = SessionRevokeBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('กรุณาระบุเหตุผลในการยกเลิก session');
    const { adminId } = adminOf(req);
    return this.inspector.revokeAllSessions(userId, parsed.data.reason, adminId);
  }

  @Post('rfm/:userId')
  async recalculateRfm(@Param('userId') userId: string) {
    if (!userId) throw new BadRequestException('Missing userId');
    return this.rfm.recalculate(userId);
  }

  @Post('risk/:userId')
  @RequireAdminRoles('SUPER_ADMIN', 'FINANCE_ADMIN')
  async flagRisk(@Param('userId') userId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = RiskFlagBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid risk-flag payload');
    const { adminId, ip } = adminOf(req);
    return this.security.flagRisk(userId, parsed.data.riskLevel, parsed.data.note, adminId, ip);
  }

  @Get('anomaly/:userId')
  async anomaly(@Param('userId') userId: string) {
    if (!userId) throw new BadRequestException('Missing userId');
    return this.security.detectConcurrencyAnomaly(userId);
  }

  @Post('telemetry/reading')
  @RequireAdminRoles('SUPER_ADMIN', 'FINANCE_ADMIN')
  async ingestReading(@Body() body: unknown) {
    const parsed = ReadingBatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid reading batch');
    return this.inspector.ingestReadingBatch(parsed.data);
  }

  @Post('telemetry/video')
  @RequireAdminRoles('SUPER_ADMIN', 'FINANCE_ADMIN')
  async ingestVideo(@Body() body: unknown) {
    const parsed = VideoBatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid video batch');
    return this.inspector.ingestVideoBatch(parsed.data);
  }
}
