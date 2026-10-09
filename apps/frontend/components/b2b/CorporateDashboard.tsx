// SSOT Phase 097 Task 7 — Corporate HR dashboard (dep-free pool table)
// Canonical: apps/frontend/components/b2b/CorporateDashboard.tsx
// - License pool utilization + funnel per pool. Zero-dep (React only).
'use client';

import React, { useEffect, useState } from 'react';
import { b2bApi } from '../../lib/b2b/b2b-client';

interface PoolRow {
  licenseId: string;
  productTitle: string;
  totalSeats: number;
  usedSeats: number;
  remainingSeats: number;
  status: string;
  assigned: number;
  activeUsers: number;
}

export function CorporateDashboard(props: { corporateAccountId: string }) {
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    b2bApi()
      .dashboard(props.corporateAccountId)
      .then((r) => {
        if (live) setRows(r.licenses);
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [props.corporateAccountId]);

  if (error) return <p role="alert">{error}</p>;

  return (
    <div>
      <h2>Corporate Dashboard: ติดตามสิทธิ์และการเรียน</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.licenseId}>
            <span>{r.productTitle}</span>{' '}
            <span>
              ใช้ {r.usedSeats}/{r.totalSeats} · เหลือ {r.remainingSeats} · {r.status}
            </span>{' '}
            <span>
              พนักงาน {r.activeUsers}/{r.assigned}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default CorporateDashboard;
