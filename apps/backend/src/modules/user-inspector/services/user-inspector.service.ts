// SSOT Phase 110 §5.2 — 360 profile orchestrator (cache-first + PDPA mask)
// Canonical: apps/backend/src/modules/user-inspector/services/user-inspector.service.ts
// - 60s Redis cache (<100ms BDD bound); LTV from COMPLETED orders; RFM via
//   calculator (metric upsert is its own write — reads stay N+1-free).
// - PDPA §8.1: SUPPORT_STAFF receives masked IP/device/session telemetry.
// - Zero new deps.
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { UserInspectorRepository } from '../repositories/user-inspector.repository';
import { RfmCalculatorService } from './rfm-calculator.service';
import {
  User360ProfileSchema,
  INSPECTOR_RECENT_LIMIT,
  maskIp,
  maskDevice,
  isMaskedInspectorRole,
} from '@repo/shared';

@Injectable()
export class UserInspectorService {
  constructor(
    private readonly repo: UserInspectorRepository,
    private readonly rfm: RfmCalculatorService,
  ) {}

  async getUser360Profile(userId: string, viewerRole = 'SUPER_ADMIN') {
    if (!userId) throw new BadRequestException('Missing userId');
    const cached = await this.repo.getCached360(userId);
    const raw = cached ? (JSON.parse(cached) as Record<string, unknown>) : await this.buildProfile(userId);
    if (!cached) await this.repo.setCached360(userId, JSON.stringify(raw));
    return isMaskedInspectorRole(viewerRole) ? this.maskTelemetry(raw) : raw;
  }

  private maskTelemetry(raw: Record<string, unknown>): Record<string, unknown> {
    const logs = (raw['recentSecurityLogs'] as Array<Record<string, unknown>> | undefined ?? []).map((l) => ({
      ...l,
      ipAddress: maskIp(String(l['ipAddress'] ?? '')),
      deviceFingerprint: maskDevice((l['deviceFingerprint'] as string | null) ?? null),
      lineSessionId: maskDevice((l['lineSessionId'] as string | null) ?? null),
    }));
    return { ...raw, recentSecurityLogs: logs, maskedForSupport: true };
  }

  private async buildProfile(userId: string) {
    const header = await this.repo.getUserHeader(userId);
    if (!header) throw new NotFoundException(`User with ID ${userId} not found`);

    const [orders, recentReading, recentSecurity, recentVideo] = await Promise.all([
      this.repo.getCompletedOrders(userId),
      this.repo.getRecentReading(userId, INSPECTOR_RECENT_LIMIT),
      this.repo.getSecurityLogs(userId, INSPECTOR_RECENT_LIMIT, 0),
      this.repo.getVideoTelemetry(userId),
    ]);
    const ltv = orders.reduce((acc, o) => acc + Number(o.netAmount), 0);
    const metric =
      header.user360Metric ??
      (await this.rfm.recalculate(userId).then(() => this.repo.getUserHeader(userId).then((h) => h?.user360Metric ?? null)));

    const titles = await this.repo.getEbookTitles(recentReading.map((r) => r.ebookId));
    const videoSlice = recentVideo.slice(0, INSPECTOR_RECENT_LIMIT);
    const lessonMap = await this.repo.getLessonMap(videoSlice.map((v) => v.lessonId));
    const payload = {
      userId: header.id,
      displayName: header.displayName,
      email: header.email,
      lineUserId: header.lineUserId,
      walletBalance: Number(header.walletBalance),
      rewardPoints: header.rewardPoints,
      lifetimeValueAmount: Math.round(ltv * 100) / 100,
      totalOrdersCount: orders.length,
      rfmScore: {
        recencyScore: metric?.recencyScore ?? 1,
        frequencyScore: metric?.frequencyScore ?? 1,
        monetaryScore: metric?.monetaryScore ?? 1,
        segmentLabel: metric?.rfmSegment ?? 'NEW_USER',
      },
      riskLevel: metric?.riskLevel ?? 'LOW',
      recentReadingLogs: recentReading.map((r) => ({
        ebookId: r.ebookId,
        bookTitle: titles.get(r.ebookId) ?? r.ebookId,
        pageNumber: r.pageNumber,
        dwellTimeSeconds: r.dwellTimeSeconds,
        timestamp: r.createdAt.toISOString(),
      })),
      recentLearningLogs: videoSlice.map((v) => {
        const meta = lessonMap.get(v.lessonId);
        const durationSec = meta?.durationSec ?? 0;
        return {
          courseId: v.courseId,
          lessonId: v.lessonId,
          lessonTitle: meta?.title ?? v.lessonId,
          watchedDurationSec: v.watchedSec,
          completionPercentage: durationSec > 0 ? Math.min(100, Math.round((v.watchedSec / durationSec) * 100)) : 0,
          timestamp: v.lastWatchedAt.toISOString(),
        };
      }),
      recentSecurityLogs: recentSecurity.rows.map((s) => ({
        id: s.id,
        activityType: s.activityType,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        deviceFingerprint: s.deviceFingerprint,
        lineSessionId: s.lineSessionId,
        riskLevel: s.riskLevel,
        createdAt: s.createdAt.toISOString(),
      })),
      createdAt: header.createdAt.toISOString(),
    };
    // Partial-validate the wire core (telemetry arrays validated at ingestion).
    User360ProfileSchema.pick({
      userId: true, displayName: true, email: true, lineUserId: true,
      walletBalance: true, rewardPoints: true, lifetimeValueAmount: true,
      totalOrdersCount: true, rfmScore: true, recentReadingLogs: true,
      recentLearningLogs: true, recentSecurityLogs: true,
    }).parse(payload);
    return payload;
  }

  async getReadingHeatmap(userId: string, ebookId: string) {
    if (!userId || !ebookId) throw new BadRequestException('Missing heatmap query');
    const header = await this.repo.getUserHeader(userId);
    if (!header) throw new NotFoundException(`User with ID ${userId} not found`);
    const [cells, titles] = await Promise.all([
      this.repo.getReadingHeatmap(userId, ebookId),
      this.repo.getEbookTitles([ebookId]),
    ]);
    return { userId, ebookId, bookTitle: titles.get(ebookId) ?? ebookId, cells };
  }

  async getVideoAnalytics(userId: string, courseId: string) {
    if (!userId || !courseId) throw new BadRequestException('Missing video analytics query');
    const header = await this.repo.getUserHeader(userId);
    if (!header) throw new NotFoundException(`User with ID ${userId} not found`);
    const rows = await this.repo.getVideoTelemetry(userId, courseId);
    const lessons = await this.repo.getLessonMap(rows.map((r) => r.lessonId));
    const breakdown = rows.map((r) => {
      const meta = lessons.get(r.lessonId);
      const durationSec = meta?.durationSec ?? 0;
      return {
        lessonId: r.lessonId,
        lessonTitle: meta?.title ?? r.lessonId,
        watchedSec: r.watchedSec,
        durationSec,
        isCompleted: r.isCompleted,
        completionPercentage: durationSec > 0 ? Math.min(100, Math.round((r.watchedSec / durationSec) * 100)) : 0,
      };
    });
    const totalWatched = breakdown.reduce((a, b) => a + b.watchedSec, 0);
    const totalDuration = breakdown.reduce((a, b) => a + b.durationSec, 0);
    return {
      courseId,
      totalWatchedSeconds: totalWatched,
      overallCompletionPercentage: totalDuration > 0 ? Math.round((totalWatched / totalDuration) * 100) : 0,
      lessonBreakdown: breakdown,
    };
  }

  async getSecurityLogs(userId: string, limit: number, offset: number, viewerRole = 'SUPER_ADMIN') {
    if (!userId) throw new BadRequestException('Missing userId');
    const header = await this.repo.getUserHeader(userId);
    if (!header) throw new NotFoundException(`User with ID ${userId} not found`);
    const { rows, total } = await this.repo.getSecurityLogs(userId, limit, offset);
    const masked = isMaskedInspectorRole(viewerRole);
    return {
      userId,
      total,
      limit,
      offset,
      logs: rows.map((s) => ({
        id: s.id,
        activityType: s.activityType,
        ipAddress: masked ? maskIp(s.ipAddress) : s.ipAddress,
        userAgent: s.userAgent,
        deviceFingerprint: masked ? maskDevice(s.deviceFingerprint) : s.deviceFingerprint,
        lineSessionId: masked ? maskDevice(s.lineSessionId) : s.lineSessionId,
        riskLevel: s.riskLevel,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  /** Admin backfill lane (Phase 052 owns the LIFF hot path). */
  async ingestReadingBatch(rows: Array<{ userId: string; ebookId: string; pageNumber: number; dwellTimeSeconds: number; sessionToken?: string }>) {
    let written = 0;
    for (const row of rows) {
      await this.repo.ingestReadingRow(row);
      written++;
    }
    return { success: true, written };
  }

  async ingestVideoBatch(rows: Array<{ userId: string; courseId: string; lessonId: string; watchedSec: number; maxPositionSec: number; isCompleted: boolean }>) {
    let written = 0;
    for (const row of rows) {
      await this.repo.upsertVideoRow(row);
      written++;
    }
    return { success: true, written };
  }

  async revokeAllSessions(userId: string, reason: string, adminId: string) {    const header = await this.repo.getUserHeader(userId);
    if (!header) throw new NotFoundException(`User with ID ${userId} not found`);
    const { revokedDb, revokedKeys } = await this.repo.revokeUserSessions(userId);
    await this.repo.recordSecurityEvent({
      userId,
      activityType: 'SESSION_REVOKED',
      ipAddress: 'ADMIN_CONSOLE',
      userAgent: 'ADMIN_SYSTEM',
      riskLevel: 'HIGH',
      metadata: { reason, revokedDb, revokedKeys, revokedBy: adminId },
    });
    return { success: true, revokedSessionsCount: revokedDb + revokedKeys, timestamp: new Date().toISOString() };
  }
}
