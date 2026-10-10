// SSOT Phase 110 BDD-2 — security telemetry (anomaly + risk flags)
// Canonical: apps/backend/src/modules/user-inspector/services/security-telemetry.service.ts
// - Concurrency anomaly: ≥3 distinct IPs inside 60s → HIGH +
//   SUSPICIOUS_CONCURRENCY audit row (fraud trigger for 1-click revoke).
// - flagRisk: manual risk override + immutable audit row (Gate 7 atomic).
// - Zero new deps.
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { UserInspectorRepository } from '../repositories/user-inspector.repository';
import {
  RiskLevelEnum,
  CONCURRENCY_IP_THRESHOLD,
  CONCURRENCY_WINDOW_SEC,
  ANOMALY_STATE_SUSPICIOUS_CONCURRENCY,
} from '@repo/shared';

export interface ConcurrencyVerdict {
  anomalous: boolean;
  state: string | null;
  distinctIps: string[];
  windowSec: number;
}

@Injectable()
export class SecurityTelemetryService {
  constructor(private readonly repo: UserInspectorRepository) {}

  async recordEvent(input: {
    userId: string;
    activityType: 'LOGIN_LIFF' | 'LOGIN_WEB' | 'PURCHASE_COMPLETED' | 'EBOOK_PAGE_READ' | 'COURSE_VIDEO_WATCH' | 'SLIP_UPLOADED' | 'AFFILIATE_CLICK' | 'SESSION_REVOKED';
    ipAddress: string;
    userAgent: string;
    deviceFingerprint?: string | null;
    lineSessionId?: string | null;
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }) {
    if (!input.userId || !input.ipAddress) throw new BadRequestException('Missing telemetry identity');
    return this.repo.recordSecurityEvent(input);
  }

  async detectConcurrencyAnomaly(userId: string): Promise<ConcurrencyVerdict> {
    const since = new Date(Date.now() - CONCURRENCY_WINDOW_SEC * 1000);
    const ips = await this.repo.distinctIpsSince(userId, since);
    if (ips.length >= CONCURRENCY_IP_THRESHOLD) {
      await this.repo.recordSecurityEvent({
        userId,
        activityType: 'SESSION_REVOKED',
        ipAddress: 'ANOMALY_ENGINE',
        userAgent: 'ADMIN_SYSTEM',
        riskLevel: 'HIGH',
        metadata: { state: ANOMALY_STATE_SUSPICIOUS_CONCURRENCY, distinctIps: ips.length, windowSec: CONCURRENCY_WINDOW_SEC },
      }).catch(() => undefined);
      await this.repo.setRiskLevel(userId, 'HIGH').catch(() => undefined);
      await this.repo.invalidate360(userId);
      return { anomalous: true, state: ANOMALY_STATE_SUSPICIOUS_CONCURRENCY, distinctIps: ips, windowSec: CONCURRENCY_WINDOW_SEC };
    }
    return { anomalous: false, state: null, distinctIps: ips, windowSec: CONCURRENCY_WINDOW_SEC };
  }

  async flagRisk(userId: string, riskLevel: string, note: string, adminId: string, clientIp: string) {
    const parsed = RiskLevelEnum.safeParse(riskLevel);
    if (!parsed.success) throw new BadRequestException('Invalid risk level');
    if (!note || note.trim().length < 5) throw new BadRequestException('กรุณาระบุหมายเหตุประกอบการ flag อย่างน้อย 5 ตัวอักษร');
    const user = await this.repo.getUserHeader(userId);
    if (!user) throw new NotFoundException(`User with ID ${userId} not found`);

    return this.repo.prisma.$transaction(async (tx) => {
      await tx.user360Metric.upsert({
        where: { userId },
        update: { riskLevel: parsed.data, lastCalculatedAt: new Date() },
        create: { userId, riskLevel: parsed.data },
      });
      await tx.userSecurityAuditLog.create({
        data: {
          userId,
          activityType: 'SESSION_REVOKED',
          ipAddress: clientIp,
          userAgent: 'ADMIN_CONSOLE',
          riskLevel: parsed.data,
          metadata: { state: 'MANUAL_RISK_FLAG', note: note.trim(), flaggedBy: adminId },
        },
      });
      await this.repo.invalidate360(userId);
      return { success: true, userId, updatedRiskLevel: parsed.data };
    });
  }
}
