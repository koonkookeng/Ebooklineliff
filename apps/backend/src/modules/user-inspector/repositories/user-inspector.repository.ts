// SSOT Phase 110 §5.1 — Inspector structural Prisma repository
// Canonical: apps/backend/src/modules/user-inspector/repositories/user-inspector.repository.ts
// - Composite-index reads only ([userId,ebookId], [userId,courseId],
//   [userId,createdAt]); per-page aggregates in ONE groupBy (no N+1).
// - Title enrichment batched (product/lesson maps, no per-row queries).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { INSPECTOR_CACHE_TTL_SEC, inspectorCacheKey } from '@repo/shared';

@Injectable()
export class UserInspectorRepository {
  constructor(
    public readonly prisma: PrismaService,
    public readonly redis: RedisClusterService,
  ) {}

  async getUserHeader(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { user360Metric: true },
    });
  }

  async getCompletedOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId, orderStatus: 'COMPLETED' },
      select: { id: true, netAmount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getEbookTitles(ebookIds: string[]): Promise<Map<string, string>> {
    if (ebookIds.length === 0) return new Map();
    const rows = await this.prisma.product.findMany({
      where: { id: { in: [...new Set(ebookIds)] } },
      select: { id: true, title: true },
    });
    return new Map(rows.map((r) => [r.id, r.title]));
  }

  async getLessonMap(lessonIds: string[]): Promise<Map<string, { title: string; durationSec: number; courseId: string }>> {
    if (lessonIds.length === 0) return new Map();
    const lessons = await this.prisma.courseLesson.findMany({
      where: { id: { in: [...new Set(lessonIds)] } },
      select: { id: true, title: true, durationSec: true, section: { select: { courseId: true } } },
    });
    return new Map(lessons.map((l) => [l.id, { title: l.title, durationSec: l.durationSec, courseId: l.section.courseId }]));
  }

  async getReadingHeatmap(userId: string, ebookId: string) {
    const groups = await this.prisma.ebookPageReadLog.groupBy({
      by: ['pageNumber'],
      where: { userId, ebookId },
      _sum: { dwellTimeSeconds: true },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { pageNumber: 'asc' },
    });
    return groups.map((g) => ({
      pageNumber: g.pageNumber,
      totalDwellTimeSec: g._sum.dwellTimeSeconds ?? 0,
      readCount: g._count._all,
      lastReadAt: (g._max.createdAt ?? new Date(0)).toISOString(),
    }));
  }

  async getRecentReading(userId: string, take: number) {
    return this.prisma.ebookPageReadLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async getVideoTelemetry(userId: string, courseId?: string) {
    return this.prisma.userVideoWatchTelemetry.findMany({
      where: courseId ? { userId, courseId } : { userId },
      orderBy: { lastWatchedAt: 'desc' },
    });
  }

  async getSecurityLogs(userId: string, limit: number, offset: number) {
    const [rows, total] = await Promise.all([
      this.prisma.userSecurityAuditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.userSecurityAuditLog.count({ where: { userId } }),
    ]);
    return { rows, total };
  }

  async recordSecurityEvent(data: {
    userId: string; activityType: 'LOGIN_LIFF' | 'LOGIN_WEB' | 'PURCHASE_COMPLETED' | 'EBOOK_PAGE_READ' | 'COURSE_VIDEO_WATCH' | 'SLIP_UPLOADED' | 'AFFILIATE_CLICK' | 'SESSION_REVOKED';
    ipAddress: string; userAgent: string; deviceFingerprint?: string | null; lineSessionId?: string | null;
    geoCountry?: string | null; geoCity?: string | null;
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; metadata?: Record<string, string | number | boolean | null>;
  }) {
    return this.prisma.userSecurityAuditLog.create({
      data: {
        userId: data.userId,
        activityType: data.activityType,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        deviceFingerprint: data.deviceFingerprint ?? null,
        lineSessionId: data.lineSessionId ?? null,
        geoCountry: data.geoCountry ?? null,
        geoCity: data.geoCity ?? null,
        riskLevel: data.riskLevel ?? 'LOW',
        metadata: data.metadata ?? undefined,
      },
    });
  }

  async distinctIpsSince(userId: string, since: Date): Promise<string[]> {
    const rows = await this.prisma.userSecurityAuditLog.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { ipAddress: true },
      take: 100,
    });
    return [...new Set(rows.map((r) => r.ipAddress))];
  }

  async upsertMetric(userId: string, data: {
    lifetimeValue: number; totalOrders: number; totalEbooksRead: number; totalCoursesEnrolled: number;
    recencyScore: number; frequencyScore: number; monetaryScore: number; rfmSegment: string;
  }) {
    return this.prisma.user360Metric.upsert({
      where: { userId },
      update: { ...data, lastCalculatedAt: new Date() },
      create: { userId, ...data },
    });
  }

  async setRiskLevel(userId: string, riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL') {
    return this.prisma.user360Metric.upsert({
      where: { userId },
      update: { riskLevel, lastCalculatedAt: new Date() },
      create: { userId, riskLevel },
    });
  }

  async distinctCoursesEnrolled(userId: string): Promise<number> {
    const [telemetryCourses, progressLessons] = await Promise.all([
      this.prisma.userVideoWatchTelemetry.findMany({ where: { userId }, select: { courseId: true } }),
      this.prisma.courseLearningProgress.findMany({ where: { userId }, select: { lessonId: true }, take: 500 }),
    ]);
    const courseIds = new Set(telemetryCourses.map((t) => t.courseId));
    if (progressLessons.length > 0) {
      const lessons = await this.prisma.courseLesson.findMany({
        where: { id: { in: [...new Set(progressLessons.map((p) => p.lessonId))] } },
        select: { section: { select: { courseId: true } } },
      });
      for (const l of lessons) courseIds.add(l.section.courseId);
    }
    return courseIds.size;
  }

  async distinctEbooksRead(userId: string): Promise<number> {
    const [fromLogs, fromProgress] = await Promise.all([
      this.prisma.ebookPageReadLog.findMany({ where: { userId }, select: { ebookId: true }, take: 1000 }),
      this.prisma.ebookReadingProgress.findMany({ where: { userId }, select: { ebookId: true } }),
    ]);
    return new Set([...fromLogs.map((r) => r.ebookId), ...fromProgress.map((r) => r.ebookId)]).size;
  }

  /** 1-click revoke: DB sessions + device registries + Redis tokens (Gate 7). */
  async revokeUserSessions(userId: string): Promise<{ revokedDb: number; revokedKeys: number }> {
    const active = await this.prisma.session.findMany({
      where: { userId, isRevoked: false },
      select: { sessionToken: true },
    });
    const result = await this.prisma.$transaction(async (tx) => {
      const marked = await tx.session.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true } });
      // UserDeviceSession keeps its rows (audit trail) — flagged revoked.
      const devices = await tx.userDeviceSession.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true } });
      // Ephemeral registries (socket/video) are safe to drop on revoke.
      const [live, streams] = await Promise.all([
        tx.activeDeviceSession.deleteMany({ where: { userId } }),
        tx.videoStreamSession.deleteMany({ where: { userId } }),
      ]);
      return { marked: marked.count, devices: devices.count, live: live.count, streams: streams.count };
    });
    let revokedKeys = 0;
    for (const s of active) {
      await this.redis.del(`session:${s.sessionToken}`).catch(() => undefined);
      revokedKeys++;
    }
    await this.redis.del(inspectorCacheKey(userId)).catch(() => undefined);
    return { revokedDb: result.marked + result.devices + result.live + result.streams, revokedKeys };
  }

  /** Admin backfill lane (Phase 052 owns the LIFF hot path). */
  async ingestReadingRow(row: { userId: string; ebookId: string; pageNumber: number; dwellTimeSeconds: number; sessionToken?: string }) {
    return this.prisma.ebookPageReadLog.create({ data: row });
  }

  async upsertVideoRow(row: { userId: string; courseId: string; lessonId: string; watchedSec: number; maxPositionSec: number; isCompleted: boolean }) {
    return this.prisma.userVideoWatchTelemetry.upsert({
      where: { userId_lessonId: { userId: row.userId, lessonId: row.lessonId } },
      update: { watchedSec: row.watchedSec, maxPositionSec: row.maxPositionSec, isCompleted: row.isCompleted, lastWatchedAt: new Date() },
      create: row,
    });
  }

  async invalidate360(userId: string): Promise<void> {
    await this.redis.del(inspectorCacheKey(userId)).catch(() => undefined);
  }

  async getCached360(userId: string): Promise<string | null> {
    return this.redis.get(inspectorCacheKey(userId)).catch(() => null);
  }

  async setCached360(userId: string, payload: string): Promise<void> {
    await this.redis.setex(inspectorCacheKey(userId), INSPECTOR_CACHE_TTL_SEC, payload).catch(() => undefined);
  }
}
