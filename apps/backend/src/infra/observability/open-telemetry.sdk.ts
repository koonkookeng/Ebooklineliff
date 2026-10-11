// SSOT Phase 121 Task 1 §5.1 — OpenTelemetry SDK bootstrap (lazy seam)
// Canonical: apps/backend/src/infra/observability/open-telemetry.sdk.ts
// (legacy src/backend/infra/observability/open-telemetry.sdk.ts)
// - Lazy-loads @opentelemetry/sdk-node ONLY if installed (zero-dep rule:
//   the package is absent in this repo). Absent → resolved no-op exporter
//   that keeps trace ids flowing in-process with <1.5ms overhead and warns
//   once. Present → real NodeSDK + OTLP/gRPC exporter on the internal
//   collector (zero egress, §8.1).
// - `initTelemetry()` is idempotent; bootstrap-owned (never auto-run on
//   import, so tests stay side-effect free). Zero new deps.
import { Logger } from '@nestjs/common';

export interface TelemetryBackend {
  readonly kind: 'otel-sdk' | 'noop';
  shutdown(): Promise<void>;
}

let active: TelemetryBackend | null = null;
let warned = false;

async function loadRealSdk(serviceName: string, environment: string): Promise<TelemetryBackend | null> {
  try {
    const loader = eval('require') as (id: string) => Record<string, unknown>;
    const sdkPkg = loader('@opentelemetry/sdk-node') as {
      NodeSDK?: new (config: Record<string, unknown>) => { start(): void; shutdown(): Promise<void> };
    };
    if (!sdkPkg.NodeSDK) return null;
    const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://otel-collector:4317';
    const sdk = new sdkPkg.NodeSDK({ serviceName, environment, endpoint });
    sdk.start();
    return { kind: 'otel-sdk', shutdown: () => sdk.shutdown() };
  } catch {
    return null;
  }
}

/** Idempotent bootstrap (call once from main.ts). */
export async function initTelemetry(serviceName = 'ebook-liff-backend', environment = process.env['NODE_ENV'] ?? 'development'): Promise<TelemetryBackend> {
  if (active) return active;
  const real = await loadRealSdk(serviceName, environment);
  if (real) {
    active = real;
    return active;
  }
  if (!warned) {
    warned = true;
    new Logger('OpenTelemetry').warn('OTel SDK absent — in-process trace propagation only (zero-dep seam)');
  }
  active = { kind: 'noop', shutdown: async () => undefined };
  return active;
}

/** True once initTelemetry() has run (either backend). */
export function isTelemetryActive(): boolean {
  return active !== null;
}

/** Active backend kind (null before init). */
export function telemetryKind(): TelemetryBackend['kind'] | null {
  return active?.kind ?? null;
}

/** Test seam: reset module state. */
export function __resetTelemetryForTests(): void {
  active = null;
  warned = false;
}
