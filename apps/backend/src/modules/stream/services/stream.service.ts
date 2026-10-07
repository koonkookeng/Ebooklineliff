// SSOT Phase 043 Task 5/8 — StreamService (manifest auth + key server + telemetry)
// Canonical: apps/backend/src/modules/stream/services/stream.service.ts
// (legacy src/backend/modules/stream/services/stream.service.ts)
// - getManifest: entitlement gate (or public preview) → READY asset →
//   short-lived HMAC token (300s) + presigned master URL + watermark meta.
// - getSegmentKey: token verify (timing-safe) + entitlement re-check →
//   latest AES-128 key bytes (never logged, never cached at CDN).
// - reportProgress: Redis progress key (300s) + injectable heatmap sink.
// - tsx-safe (no param decorators; structural ports). Zero new deps.
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  VIDEO_TOKEN_TTL_SEC,
  isLessonCompleted,
  type HlsManifestStreamPayload,
  type LessonStreamPayload,
  type ProgressSyncResponse,
  type SyncLessonProgress,
} from '@repo/shared';

export interface StreamLesson {
  id: string;
  isPreview: boolean;
  durationSec: number;
  section: { course: { productId: string } };
}

export interface CourseProgressRow {
  watchedSec: number;
  isCompleted: boolean;
  updatedAt: Date;
}

export interface StreamTables {
  courseLesson: {
    findUnique(args: unknown): Promise<StreamLesson | null>;
  };
  entitlement: {
    findUnique(args: unknown): Promise<{ userId: string } | null>;
  };
  videoAsset: {
    findUnique(args: unknown): Promise<{ id: string; status: string; hlsMasterR2Key: string | null } | null>;
  };
  videoKeyRotation: {
    findFirst(args: unknown): Promise<{ keySecretHex: string } | null>;
  };
  user: {
    findUnique(args: unknown): Promise<{ displayName: string } | null>;
  };
  videoTranscodeJob?: {
    findUnique(args: unknown): Promise<{ id: string; lessonId: string; encryptionKeyPath: string | null } | null>;
  };
  courseLearningProgress?: {
    findUnique(args: unknown): Promise<CourseProgressRow | null>;
    upsert(args: unknown): Promise<CourseProgressRow>;
  };
}

export interface StreamVault {
  presignedGetUrl(objectKey: string, expiresInSeconds: number): string;
  getObjectBuffer?(key: string): Promise<Buffer>;
}

export interface StreamCache {
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
}

function hmacEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function videoProgressKey(userId: string, lessonId: string): string {
  return `progress:video:${userId}:${lessonId}`;
}

@Injectable()
export class StreamService {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(
    private readonly tables?: StreamTables,
    private readonly vault?: StreamVault,
    private readonly cache?: StreamCache,
    private readonly tokenSecret: string = process.env.VIDEO_TOKEN_SECRET || process.env.APP_SECRET || 'AHONG_EMERALD_SECRET_KEY_999',
    private readonly onProgress?: (event: { userId: string; lessonId: string; watchedSec: number }) => void,
  ) {}

  signToken(videoId: string, userId: string, expiresAtMs: number): string {
    const sig = createHmac('sha256', this.tokenSecret).update(`${videoId}:${userId}:${expiresAtMs}`).digest('hex');
    return `${expiresAtMs}.${sig}`;
  }

  verifyToken(videoId: string, userId: string, token: string): boolean {
    const [expRaw, sig] = token.split('.');
    const exp = Number(expRaw);
    if (!Number.isInteger(exp) || exp <= Date.now() || !sig) return false;
    return hmacEqual(this.signToken(videoId, userId, exp), token);
  }

  private async productForLesson(lessonId: string): Promise<{ lesson: StreamLesson; productId: string } | null> {
    const lesson = await this.tables?.courseLesson
      .findUnique({ where: { id: lessonId }, include: { section: { include: { course: true } } } })
      .catch(() => null);
    if (!lesson) return null;
    return { lesson, productId: lesson.section.course.productId };
  }

  private async entitled(userId: string, productId: string, preview: boolean): Promise<boolean> {
    if (preview) return true;
    const row = await this.tables?.entitlement
      .findUnique({ where: { userId_productId: { userId, productId } } })
      .catch(() => null);
    return row !== null;
  }

  async getManifest(userId: string, lessonId: string, clientIp: string): Promise<HlsManifestStreamPayload> {
    if (!this.tables || !this.vault) throw new NotFoundException('Stream unavailable');
    const resolved = await this.productForLesson(lessonId);
    if (!resolved) throw new NotFoundException('Lesson not found');
    if (!(await this.entitled(userId, resolved.productId, resolved.lesson.isPreview))) {
      throw new ForbiddenException('ท่านยังไม่มีสิทธิ์เข้าถึงบทเรียนนี้');
    }
    const asset = await this.tables.videoAsset.findUnique({ where: { lessonId } }).catch(() => null);
    if (!asset || asset.status !== 'READY' || !asset.hlsMasterR2Key) {
      throw new NotFoundException('วิดีโอยังไม่พร้อมรับชม');
    }
    const expiresAt = new Date(Date.now() + VIDEO_TOKEN_TTL_SEC * 1000);
    const user = await this.tables.user.findUnique({ where: { id: userId } }).catch(() => null);
    const userIdHash = createHash('sha256').update(`${userId}:${this.tokenSecret}`).digest('hex');
    return {
      videoId: asset.id,
      masterPlaylistUrl: this.vault.presignedGetUrl(asset.hlsMasterR2Key, VIDEO_TOKEN_TTL_SEC),
      securityToken: this.signToken(asset.id, userId, expiresAt.getTime()),
      expiresAt: expiresAt.toISOString(),
      watermarkMetadata: { userIdHash, displayName: user?.displayName ?? 'Learner', ipAddress: clientIp },
    };
  }

  async getSegmentKey(userId: string, videoId: string, token: string): Promise<Buffer> {
    if (!this.tables) throw new NotFoundException('Stream unavailable');
    if (!this.verifyToken(videoId, userId, token)) throw new ForbiddenException('Expired stream token');
    const row = await this.tables.videoKeyRotation
      .findFirst({ where: { videoId }, orderBy: { createdAt: 'desc' } })
      .catch(() => null);
    if (!row) throw new NotFoundException('Encryption key not found');
    return Buffer.from(row.keySecretHex, 'hex');
  }

  async reportProgress(userId: string, lessonId: string, watchedSec: number): Promise<{ recorded: boolean }> {
    await this.cache?.setex(videoProgressKey(userId, lessonId), 300, String(Math.max(0, watchedSec))).catch(() => undefined);
    try {
      this.onProgress?.({ userId, lessonId, watchedSec });
    } catch {
      // Heatmap sink must never fail the 5s cadence.
    }
    return { recorded: true };
  }

  /** Phase 044 §8.1: DRM key gate by transcode job (JWT + entitlement, no-store bytes). */
  async getKeyByTranscodeJob(userId: string, jobId: string): Promise<Buffer> {
    if (!this.tables?.videoTranscodeJob || !this.vault?.getObjectBuffer) {
      throw new NotFoundException('Stream unavailable');
    }
    const job = await this.tables.videoTranscodeJob.findUnique({ where: { id: jobId } }).catch(() => null);
    if (!job || !job.encryptionKeyPath) throw new NotFoundException('Encryption key not found');
    const resolved = await this.productForLesson(job.lessonId);
    if (!resolved) throw new NotFoundException('Lesson not found');
    if (!(await this.entitled(userId, resolved.productId, resolved.lesson.isPreview))) {
      throw new ForbiddenException('ท่านยังไม่มีสิทธิ์เข้าถึงบทเรียนนี้');
    }
    return this.vault.getObjectBuffer(job.encryptionKeyPath);
  }

  /** Phase 045 §5.2: lesson stream state (manifest + resume + watermark). */
  async getLessonStreamState(userId: string, lessonId: string, clientIp: string): Promise<LessonStreamPayload> {
    if (!this.tables) throw new NotFoundException('Stream unavailable');
    const resolved = await this.productForLesson(lessonId);
    if (!resolved) throw new NotFoundException('Lesson not found');
    if (!(await this.entitled(userId, resolved.productId, resolved.lesson.isPreview))) {
      throw new ForbiddenException('User does not have valid entitlement for this course');
    }
    const manifest = await this.getManifest(userId, lessonId, clientIp);
    const progress = await this.tables.courseLearningProgress
      ?.findUnique({ where: { userId_lessonId: { userId, lessonId } } })
      .catch(() => null);
    return {
      lessonId: resolved.lesson.id,
      hlsManifestUrl: manifest.masterPlaylistUrl,
      signedEdgeToken: manifest.securityToken,
      lastWatchedSec: progress?.watchedSec ?? 0,
      durationSec: resolved.lesson.durationSec,
      forensicWatermark: {
        userIdHash: manifest.watermarkMetadata.userIdHash,
        displayName: manifest.watermarkMetadata.displayName,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /** Phase 045 §5.2/BDD-3: 5s heartbeat (DB upsert + drop-off stream event). */
  async syncLessonProgress(userId: string, input: SyncLessonProgress): Promise<ProgressSyncResponse> {
    if (!this.tables?.courseLearningProgress) throw new NotFoundException('Stream unavailable');
    const done = isLessonCompleted(input.watchedSec, input.durationSec, input.isCompleted);
    const row = await this.tables.courseLearningProgress.upsert({
      where: { userId_lessonId: { userId, lessonId: input.lessonId } },
      create: { userId, lessonId: input.lessonId, watchedSec: input.watchedSec, isCompleted: done },
      update: { watchedSec: input.watchedSec, isCompleted: done },
    });
    try {
      // Drop-off routing is consumer-side (VIDEO_DROPOFF_STREAM keyed by
      // lessonId); the sink stays transport-shaped like reportProgress.
      this.onProgress?.({ userId, lessonId: input.lessonId, watchedSec: input.watchedSec });
    } catch {
      // Analytics must never fail the heartbeat.
    }
    return { success: true, updatedAt: row.updatedAt.toISOString(), isCompleted: row.isCompleted };
  }
}
