// SSOT Phase 124 Task 2 §5.1 — chaos fault injector (admin drills only)
// Canonical: apps/backend/src/modules/chaos/chaos-injector.service.ts
// (legacy src/backend/modules/chaos/chaos-injector.service.ts)
// - Registry over structural Redis port (TTL-bounded faults) + best-effort
//   ChaosTestRun ledger (structural Prisma port). Sampling via the SSOT
//   shouldInjectFault gate (failureRate).
// - SAFETY: fail-closed unless CHAOS_ENABLED=1 (faults can never arm in
//   production by accident). Reads never throw (no fault = normal path).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import {
  CHAOS_EVENT_STREAM,
  CHAOS_FAULT_TTL_SEC,
  ChaosInjectionPayloadSchema,
  chaosFaultKey,
  faultIsLive,
  shouldInjectFault,
  type ChaosFaultType,
  type ChaosInjectionPayload,
} from '@repo/shared';

export interface ActiveFault {
  faultId: string;
  faultType: ChaosFaultType;
  targetService: string;
  durationMs: number;
  failureRate: number;
  startedAtMs: number;
}

/** Minimal Redis surface (structural; no hard import). */
export interface ChaosRedisPort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<void>;
  scanKeys?(pattern: string, pageSize?: number): Promise<string[]>;
  xaddPipeline?(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

/** Minimal Prisma surface (structural; best-effort ledger). */
export interface ChaosPrismaPort {
  chaosTestRun: {
    create(args: unknown): Promise<{ id: string }>;
    updateMany(args: unknown): Promise<unknown>;
  };
}

function uid(): string {
  return `fault-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
}

@Injectable()
export class ChaosInjectorService {
  private readonly logger = new Logger(ChaosInjectorService.name);

  constructor(
    private readonly redis: ChaosRedisPort,
    private readonly prisma?: ChaosPrismaPort,
  ) {}

  /** True only in drill environments (fail-closed safety gate). */
  static drillsEnabled(): boolean {
    return process.env['CHAOS_ENABLED'] === '1';
  }

  /** Arm a fault (returns registry id + expiry; no-op unless drills on). */
  async inject(input: ChaosInjectionPayload, triggeredBy: string): Promise<{ faultId: string; expiresAt: string }> {
    const parsed = ChaosInjectionPayloadSchema.parse(input);
    if (!ChaosInjectorService.drillsEnabled()) throw new Error('CHAOS_DISABLED');
    const fault: ActiveFault = {
      faultId: uid(),
      faultType: parsed.faultType,
      targetService: parsed.targetService,
      durationMs: parsed.durationMs,
      failureRate: parsed.failureRate,
      startedAtMs: Date.now(),
    };
    try {
      await this.redis.set(chaosFaultKey(parsed.targetService), JSON.stringify(fault), 'EX', Math.min(CHAOS_FAULT_TTL_SEC, Math.ceil(parsed.durationMs / 1000) + 60));
      await this.redis.xaddPipeline?.(CHAOS_EVENT_STREAM, [
        { event: 'chaos.injected', faultId: fault.faultId, faultType: fault.faultType, service: fault.targetService, at: fault.startedAtMs },
      ]);
    } catch (err) {
      this.logger.warn(`Fault registry fail-open: ${(err as Error).message}`);
    }
    try {
      await this.prisma?.chaosTestRun.create({
        data: { faultType: fault.faultType, targetService: fault.targetService, durationMs: fault.durationMs, failureRate: fault.failureRate, triggeredBy },
      });
    } catch {
      // Ledger is best-effort; the registry is authoritative.
    }
    this.logger.warn(`CHAOS injected ${fault.faultType} on ${fault.targetService} for ${fault.durationMs}ms`);
    return { faultId: fault.faultId, expiresAt: new Date(fault.startedAtMs + fault.durationMs).toISOString() };
  }

  /** Read the live fault for a service (null = normal path). */
  async activeFault(targetService: string): Promise<ActiveFault | null> {
    try {
      const raw = await this.redis.get(chaosFaultKey(targetService));
      if (!raw) return null;
      const fault = JSON.parse(raw) as ActiveFault;
      if (!faultIsLive(true, fault.startedAtMs, fault.durationMs, Date.now())) {
        await this.redis.del(chaosFaultKey(targetService)).catch(() => undefined);
        return null;
      }
      return fault;
    } catch {
      return null;
    }
  }

  /** Sampled fault check (fault type + rate gate). */
  async isFaultActive(targetService: string, faultType: ChaosFaultType, sample = Math.random()): Promise<boolean> {
    if (!ChaosInjectorService.drillsEnabled()) return false;
    const fault = await this.activeFault(targetService);
    return !!fault && fault.faultType === faultType && shouldInjectFault(fault.failureRate, sample);
  }

  /** Disarm a service fault (returns true when one existed). */
  async reset(targetService: string): Promise<boolean> {
    const existed = (await this.activeFault(targetService)) !== null;
    try {
      await this.redis.del(chaosFaultKey(targetService));
      await this.prisma?.chaosTestRun.updateMany({ where: { targetService, isActive: true }, data: { isActive: false, endedAt: new Date() } });
    } catch (err) {
      this.logger.warn(`Fault reset fail-open: ${(err as Error).message}`);
    }
    return existed;
  }
}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { ChaosInjectorService as ChaosInjectorServiceService };
