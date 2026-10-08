// SSOT Phase 069 Task 3 — NetworkHealthService (ping + telemetry ledger)
// Canonical: apps/backend/src/modules/network/network-health.service.ts
// (legacy src/backend/modules/network/network-health.service.ts)
// - pingCheck: pure <5ms payload (no DB touch — Gate 6 zero-egress).
// - logTelemetry: best-effort NetworkTelemetryLog row for disconnection
//   segments >5s (QoE analytics, §7.1).
// - tsx-safe structural ports. Zero new deps.
import { Injectable } from '@nestjs/common';

export interface NetworkHealthTables {
  networkTelemetryLog: {
    create(args: unknown): Promise<unknown>;
  };
}

export interface TelemetryInput {
  userId?: string;
  lineUserId?: string;
  deviceType: string;
  disconnectionSec: number;
  actionsQueued?: number;
  effectiveType?: string;
  tenantId?: string;
}

@Injectable()
export class NetworkHealthService {
  constructor(private readonly tables?: NetworkHealthTables) {}

  pingCheck(tenantId?: string): { status: 'ok'; serverTimestamp: number; tenantId?: string } {
    return { status: 'ok', serverTimestamp: Date.now(), ...(tenantId ? { tenantId } : {}) };
  }

  async logTelemetry(input: TelemetryInput): Promise<{ recorded: boolean }> {
    if (!this.tables || !input || typeof input.deviceType !== 'string') return { recorded: false };
    if (Math.max(0, Math.floor(input.disconnectionSec)) < 5) return { recorded: false };
    await this.tables.networkTelemetryLog
      .create({
        data: {
          userId: input.userId ?? null,
          lineUserId: input.lineUserId ?? null,
          deviceType: input.deviceType.slice(0, 64),
          disconnectionSec: Math.floor(input.disconnectionSec),
          actionsQueued: Math.max(0, Math.floor(input.actionsQueued ?? 0)),
          effectiveType: input.effectiveType?.slice(0, 16) ?? null,
          tenantId: input.tenantId?.slice(0, 64) ?? null,
        },
      })
      .catch(() => null);
    return { recorded: true };
  }
}
