// SSOT Phase 027 §5 — Navigation session service (atomic upsert + Redis edge)
// Canonical: apps/backend/src/modules/navigation/navigation.service.ts
// (legacy src/backend/modules/navigation/navigation.service.ts)
// - Zero new deps: Prisma SSOT + RedisClusterService (get/setex/del/publish) only.
// - Gate 7: single active row per user via @unique userId upsert (atomic, no
//   read-modify-write race); P2002 impossible on upsert path by construction.
// - Edge-first restore: Redis hit returns without DB; corrupt entries self-heal.
// - §7.1 analytics: drop-off events publish best-effort (never throw the UX path).
// - stackDepth/isDirtyState derive from the client snapshot (validated JSON) with
//   hard caps (NAV_STACK_MAX_DEPTH / 32KB) so a hostile client cannot blow RAM/rows.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import {
  NavigationStateSchema,
  NavigationSyncPayloadSchema,
  NavDropOffEventSchema,
  NAV_SESSION_TTL_SEC,
  NAV_STACK_MAX_DEPTH,
  NAV_DROP_OFF_CHANNEL,
  navSessionKey,
  type NavigationSyncPayload,
} from '@repo/shared';
import {
  NavigationRestoreResponseSchema,
  type NavigationRestoreResponse,
} from './dto/navigation-response.dto';

interface SnapshotShape {
  tenantId?: unknown;
  currentRoute?: unknown;
  canGoBack?: unknown;
  stackDepth?: unknown;
  isDirtyState?: unknown;
  historyStack?: unknown;
  isModalOpen?: unknown;
  activeModalId?: unknown;
}

function parseSnapshot(raw: string): SnapshotShape | null {
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === 'object' && v !== null ? (v as SnapshotShape) : null;
  } catch {
    return null;
  }
}

@Injectable()
export class NavigationService {
  private readonly logger = new Logger(NavigationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  sessionKey(userId: string): string {
    return navSessionKey(userId);
  }

  /** Atomic save (Gate 7): validate → derive → upsert → edge-cache → true. */
  async saveSession(body: unknown): Promise<boolean> {
    const parsed = NavigationSyncPayloadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid navigation sync payload');
    const data: NavigationSyncPayload = parsed.data;

    const snapshot = parseSnapshot(data.stateSnapshotJson);
    const state = NavigationStateSchema.safeParse({
      tenantId: typeof snapshot?.tenantId === 'string' ? snapshot.tenantId : 'default',
      currentRoute: data.lastPathname,
      canGoBack: snapshot?.canGoBack ?? false,
      stackDepth: snapshot?.stackDepth ?? 1,
      isModalOpen: snapshot?.isModalOpen ?? false,
      activeModalId: snapshot?.activeModalId ?? null,
      isDirtyState: snapshot?.isDirtyState ?? false,
      historyStack: Array.isArray(snapshot?.historyStack) ? snapshot.historyStack : [],
    });
    if (!state.success) throw new BadRequestException('Invalid navigation state snapshot');
    const cappedDepth = Math.min(state.data.stackDepth, NAV_STACK_MAX_DEPTH);
    const cappedStack = state.data.historyStack.slice(0, NAV_STACK_MAX_DEPTH);

    await (this.prisma as unknown as {
      userNavigationSession: {
        upsert: (args: unknown) => Promise<unknown>;
      };
    }).userNavigationSession.upsert({
      where: { userId: data.userId },
      update: {
        tenantId: state.data.tenantId,
        lastPathname: data.lastPathname,
        stackDepth: cappedDepth,
        isDirtyState: state.data.isDirtyState,
        stateSnapshotJson: { ...state.data, stackDepth: cappedDepth, historyStack: cappedStack },
      },
      create: {
        userId: data.userId,
        tenantId: state.data.tenantId,
        lastPathname: data.lastPathname,
        stackDepth: cappedDepth,
        isDirtyState: state.data.isDirtyState,
        stateSnapshotJson: { ...state.data, stackDepth: cappedDepth, historyStack: cappedStack },
      },
    });

    await this.redis
      .setex(this.sessionKey(data.userId), NAV_SESSION_TTL_SEC, data.stateSnapshotJson)
      .catch((err: unknown) => {
        this.logger.warn(`Navigation edge-cache write failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });
    return true;
  }

  /** Restore (edge-first): Redis hit → Prisma row → { found:false }. */
  async getSession(userId: string): Promise<NavigationRestoreResponse> {
    if (!userId) throw new BadRequestException('Missing user id');
    const cached = await this.redis.get(this.sessionKey(userId)).catch(() => null);
    if (cached) {
      const parsed = parseSnapshot(cached);
      const state = NavigationStateSchema.safeParse({
        ...(parsed ?? {}),
        currentRoute: typeof parsed?.currentRoute === 'string' ? parsed.currentRoute : '/',
      });
      if (state.success) {
        return NavigationRestoreResponseSchema.parse({
          found: true,
          lastPathname: state.data.currentRoute,
          payload: {
            tenantId: state.data.tenantId,
            currentRoute: state.data.currentRoute,
            canGoBack: state.data.canGoBack,
            stackDepth: state.data.stackDepth,
            isDirtyState: state.data.isDirtyState,
            historyStack: state.data.historyStack.map((h) => ({
              id: h.id,
              pathname: h.pathname,
              timestamp: h.timestamp,
              isDirty: h.isDirty,
            })),
          },
        });
      }
      this.logger.warn(`Corrupt navigation edge entry rebuilt: ${this.sessionKey(userId)}`);
    }

    const row = await (this.prisma as unknown as {
      userNavigationSession: { findUnique: (args: unknown) => Promise<unknown> };
    }).userNavigationSession.findUnique({ where: { userId } });
    if (!row || typeof row !== 'object') return { found: false, lastPathname: null, payload: null };
    const r = row as { lastPathname: string; stateSnapshotJson: unknown };
    const snap = typeof r.stateSnapshotJson === 'string' ? parseSnapshot(r.stateSnapshotJson) : (r.stateSnapshotJson as SnapshotShape);
    const state = NavigationStateSchema.safeParse({
      ...(snap ?? {}),
      currentRoute:
        typeof (snap as SnapshotShape | null)?.currentRoute === 'string'
          ? (snap as SnapshotShape).currentRoute
          : r.lastPathname,
    });
    if (!state.success) return { found: false, lastPathname: r.lastPathname, payload: null };
    return {
      found: true,
      lastPathname: r.lastPathname,
      payload: {
        tenantId: state.data.tenantId,
        currentRoute: state.data.currentRoute,
        canGoBack: state.data.canGoBack,
        stackDepth: state.data.stackDepth,
        isDirtyState: state.data.isDirtyState,
        historyStack: state.data.historyStack.map((h) => ({
          id: h.id,
          pathname: h.pathname,
          timestamp: h.timestamp,
          isDirty: h.isDirty,
        })),
      },
    };
  }

  /** Clear on confirmed exit (§8.1 sanitization runs client-side; this drops server rows). */
  async clearSession(userId: string): Promise<boolean> {
    if (!userId) throw new BadRequestException('Missing user id');
    await (this.prisma as unknown as {
      userNavigationSession: { deleteMany: (args: unknown) => Promise<unknown> };
    }).userNavigationSession.deleteMany({ where: { userId } }).catch(() => undefined);
    await this.redis.del(this.sessionKey(userId)).catch(() => undefined);
    return true;
  }

  /** §7.1 drop-off telemetry: validated, published best-effort, always resolves. */
  async recordDropOff(body: unknown): Promise<boolean> {
    const parsed = NavDropOffEventSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid drop-off event');
    await this.redis.publish(NAV_DROP_OFF_CHANNEL, JSON.stringify(parsed.data)).catch((err: unknown) => {
      this.logger.warn(`Drop-off publish failed: ${err instanceof Error ? err.message : 'unknown'}`);
    });
    return true;
  }
}
