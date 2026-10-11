// SSOT Phase 121 §6.1 — LIFF canvas error boundary (memory-safe, zero-dep)
// Canonical: apps/frontend/components/reader/liff-canvas-error-boundary.tsx
// - Class boundary (function components cannot catch render crashes):
//   ERROR state shows branded fallback (tenant --primary-color / --logo-url
//   vars) with Retry + incident reference id (Sentry lane correlation).
// - Zero hard dep on @sentry/nextjs (absent in repo): capture attempt is a
//   lazy eval('require') best-effort; the always-on lane is liff-logger
//   (500KB ring, sendBeacon flush, PII-scrubbed).
// - Memory guard: no heap retention of children stack beyond the incident
//   line; retry drops the captured error first (GC N-2 discipline).
'use client';

import React from 'react';
import { Logger, flushLiffLogs } from '@/lib/observability/liff-logger';

interface Props {
  productId: string;
  tenantId: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  incidentId: string | null;
}

function trySentryCapture(error: Error, tags: Record<string, string>): string | null {
  try {
    const loader = eval('require') as (id: string) => {
      captureException?: (e: unknown, hint?: unknown) => string;
    };
    const sentry = loader('@sentry/nextjs');
    if (typeof sentry?.captureException === 'function') {
      return sentry.captureException(error, { tags }) ?? null;
    }
  } catch {
    // Zero-dep seam: package absent → local incident id only.
  }
  return null;
}

export class LiffCanvasErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, incidentId: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error): void {
    const { productId, tenantId } = this.props;
    const sentryId = trySentryCapture(error, {
      tenant_id: tenantId,
      product_id: productId,
      platform: 'LINE_LIFF',
    });
    const incidentId = sentryId ?? `LIFF-${Date.now().toString(36).toUpperCase()}`;
    this.setState({ incidentId });
    Logger.error('CanvasReaderCrash', error.message, {
      productId,
      tenantId,
      incidentId,
      stack: String(error.stack ?? '').slice(0, 2048),
    });
    try {
      flushLiffLogs();
    } catch {
      // Flush is best-effort on crash path.
    }
  }

  private handleRetry = (): void => {
    Logger.info('ReaderRecovery', 'user triggered reader recovery', {
      productId: this.props.productId,
      tenantId: this.props.tenantId,
    });
    this.setState({ error: null, incidentId: null });
  };

  render(): React.ReactNode {
    const { error, incidentId } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        className="flex flex-col items-center justify-center min-h-[300px] p-4 text-center"
        style={{ background: 'var(--surface, #fff)' }}
      >
        <h3 className="text-lg font-bold text-red-600">เกิดข้อผิดพลาดในการโหลดหน้าหนังสือ</h3>
        <p className="text-sm text-gray-500 mt-2">ระบบได้บันทึกรายงานปัญหาเรียบร้อยแล้ว</p>
        {incidentId ? (
          <p className="text-xs text-gray-400 mt-1">รหัสอ้างอิง: {incidentId}</p>
        ) : null}
        <button
          type="button"
          onClick={this.handleRetry}
          className="mt-4 px-4 py-2 text-white rounded-lg shadow"
          style={{ background: 'var(--primary-color, #059669)' }}
        >
          ลองใหม่อีกครั้ง
        </button>
      </div>
    );
  }
}
