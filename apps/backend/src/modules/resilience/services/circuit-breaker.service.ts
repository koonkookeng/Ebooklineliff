// SSOT Phase 122 Task 4 §5.3 — production circuit breaker (CLOSED/OPEN/HALF_OPEN)
// Canonical: apps/backend/src/modules/resilience/services/circuit-breaker.service.ts
// (legacy src/backend/modules/resilience/circuit-breaker.service.ts)
// - Redis-backed states with rolling 30s failure/total counters: trips when
//   total >= minimumNumberOfCalls AND failure ratio >= threshold (BDD-2).
// - RISK_CALL deviation (additive-only, documented): stateless HALF_OPEN
//   recovery — OPEN rows carry opened_at; the first request after cooldown
//   becomes the probe (no process-local setTimeout, survives restarts).
// - Every action races timeoutMs (3s default); transitions stream to
//   CIRCUIT_EVENT_STREAM best-effort for the 121 metrics lane. An optional
//   onTransition hook lets hosts record Prometheus gauges without a module
//   cycle. Fail-open: Redis faults degrade to direct execution.
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import {
  CIRCUIT_COOLDOWN_SEC,
  CIRCUIT_EVENT_STREAM,
  CIRCUIT_WINDOW_SEC,
  CircuitBreakerConfigSchema,
  EXTERNAL_CALL_TIMEOUT_MS,
  circuitFailureKey,
  circuitOpenedAtKey,
  circuitStateKey,
  circuitTripped,
  type CircuitBreakerConfig,
  type CircuitState,
} from '@repo/shared';

/** Minimal Redis surface the breaker needs (structural; no hard import). */
export interface CircuitRedisPort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  xaddPipeline(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

export interface CircuitTransition {
  serviceName: string;
  from: CircuitState;
  to: CircuitState;
  at: number;
}

const TOTAL_SUFFIX = ':total';

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  constructor(
    private readonly redis: CircuitRedisPort,
    private readonly onTransition?: (t: CircuitTransition) => void,
  ) {}

  /** Current state (CLOSED on miss/fault). */
  async getState(serviceName: string): Promise<CircuitState> {
    try {
      const raw = await this.redis.get(circuitStateKey(serviceName));
      return raw === 'OPEN' || raw === 'HALF_OPEN' ? raw : 'CLOSED';
    } catch {
      return 'CLOSED';
    }
  }

  private async publish(from: CircuitState, to: CircuitState, serviceName: string): Promise<void> {
    const event: CircuitTransition = { serviceName, from, to, at: Date.now() };
    try {
      this.onTransition?.(event);
    } catch {
      // Host hooks never break the breaker.
    }
    try {
      await this.redis.xaddPipeline(CIRCUIT_EVENT_STREAM, [
        { event: 'circuit.transition', service: serviceName, from, to, at: event.at },
      ]);
    } catch {
      // Telemetry never breaks request handling.
    }
  }

  private async trip(serviceName: string, failures: number, total: number, from: CircuitState = 'CLOSED'): Promise<void> {
    try {
      await this.redis.set(circuitStateKey(serviceName), 'OPEN', 'EX', CIRCUIT_COOLDOWN_SEC);
      await this.redis.set(circuitOpenedAtKey(serviceName), String(Date.now()), 'EX', CIRCUIT_COOLDOWN_SEC);
    } catch {
      // State writes are best-effort; the next read still gates.
    }
    this.logger.error(`Circuit Breaker for [${serviceName}] TRIPPED to OPEN (${failures}/${total}).`);
    await this.publish(from, 'OPEN', serviceName);
  }

  private async recover(serviceName: string): Promise<void> {
    try {
      await this.redis.set(circuitStateKey(serviceName), 'CLOSED');
      await this.redis.del(circuitFailureKey(serviceName), `${circuitFailureKey(serviceName)}${TOTAL_SUFFIX}`, circuitOpenedAtKey(serviceName));
    } catch {
      // Recovery writes are best-effort.
    }
    this.logger.log(`Circuit Breaker for [${serviceName}] recovered to CLOSED.`);
    await this.publish('HALF_OPEN', 'CLOSED', serviceName);
  }

  private async recordSample(serviceName: string, success: boolean): Promise<{ failures: number; total: number }> {
    const failureKey = circuitFailureKey(serviceName);
    const totalKey = `${failureKey}${TOTAL_SUFFIX}`;
    try {
      const total = await this.redis.incr(totalKey);
      await this.redis.expire(totalKey, CIRCUIT_WINDOW_SEC);
      let failures = 0;
      if (success) {
        const raw = await this.redis.get(failureKey);
        failures = raw ? Number.parseInt(raw, 10) || 0 : 0;
      } else {
        failures = await this.redis.incr(failureKey);
        await this.redis.expire(failureKey, CIRCUIT_WINDOW_SEC);
      }
      return { failures, total };
    } catch {
      return { failures: success ? 0 : 1, total: 1 };
    }
  }

  /**
   * Execute action behind the breaker; fallback serves degraded responses
   * (queued processing on LIFF) when OPEN or on fault/timeout.
   */
  async executeWithCircuitBreaker<T>(
    serviceName: string,
    action: () => Promise<T>,
    fallbackAction: () => Promise<T>,
    rawConfig?: Partial<CircuitBreakerConfig>,
  ): Promise<T> {
    const config = CircuitBreakerConfigSchema.parse({ serviceName, ...rawConfig });
    let state = await this.getState(serviceName);

    if (state === 'OPEN') {
      let cooled = false;
      try {
        const openedAtRaw = await this.redis.get(circuitOpenedAtKey(serviceName));
        const openedAt = openedAtRaw ? Number.parseInt(openedAtRaw, 10) : Number.NaN;
        cooled = Number.isFinite(openedAt) && Date.now() - openedAt >= config.cooldownPeriodMs;
        if (cooled) {
          await this.redis.set(circuitStateKey(serviceName), 'HALF_OPEN');
          await this.publish('OPEN', 'HALF_OPEN', serviceName);
          this.logger.log(`Circuit Breaker for [${serviceName}] set to HALF_OPEN probe mode.`);
          state = 'HALF_OPEN';
        }
      } catch {
        // Probe promotion is best-effort; stay OPEN on fault.
      }
      if (!cooled) {
        this.logger.warn(`Circuit Breaker for [${serviceName}] is OPEN. Executing Fallback Strategy.`);
        return fallbackAction();
      }
    }

    const timeoutMs = config.timeoutMs || EXTERNAL_CALL_TIMEOUT_MS;
    // NOTE: the timer is NOT unref'd — an unref'd timer as the sole live
    // handle lets Node exit before it fires (hangs the race as a silent
    // early exit). It is always cleared below instead.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        action(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('EXTERNAL_API_TIMEOUT')), timeoutMs);
        }),
      ]);
      await this.recordSample(serviceName, true);
      if (state === 'HALF_OPEN') await this.recover(serviceName);
      return result;
    } catch (error) {
      this.logger.error(`Error on External API call [${serviceName}]: ${(error as Error).message}`);
      const { failures, total } = await this.recordSample(serviceName, false);
      if (
        state !== 'HALF_OPEN' &&
        total >= config.minimumNumberOfCalls &&
        circuitTripped(failures, total, config.failureThresholdPercentage)
      ) {
        await this.trip(serviceName, failures, total, state);
      } else if (state === 'HALF_OPEN') {
        await this.trip(serviceName, failures, total, state);
      }
      return fallbackAction();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { CircuitBreakerService as CircuitBreakerServiceService };
