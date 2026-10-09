// SSOT Phase 098 Task 5 — HR dashboard (dep-free, web-first)
// Canonical: apps/frontend/components/hr/HrDashboard.tsx
// - RISK_CALL: native table/bars (no chart lib) — dashboard runs on Web;
//   LIFF RAM guard applies to employee views, not this console.
// - Zero-dep (React only).
'use client';

import React from 'react';
import { hrApi } from '../../lib/b2b-hr/hr-client';
import { useHrDashboard } from '../../hooks/useHrDashboard';

function Bar(props: { value: number }) {
  return (
    <div style={{ background: '#e2e8f0', borderRadius: 999, height: 10, maxWidth: 120 }}>
      <div style={{ background: '#4f46e5', height: 10, borderRadius: 999, width: `${Math.min(100, Math.max(0, props.value))}%` }} />
    </div>
  );
}

export function HrDashboard(props: { organizationId: string }) {
  const { status, error, data, reload } = useHrDashboard(props.organizationId);

  if (status === 'HR_INIT' || status === 'LOADING') {
    return (
      <div aria-busy="true">
        <p>Loading B2B Metrics...</p>
      </div>
    );
  }

  if (status === 'ERROR' || !data) {
    return (
      <div>
        <p role="alert">{error ?? 'Failed to load HR dashboard'}</p>
        <button type="button" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div>
        <div>
          <h1>B2B Corporate Learning Analytics</h1>
          <p>
            {data.companyName} · Seats {data.usedSeats}/{data.totalSeats} ({data.utilization}%) ·
            Completion {data.completionRate}% · Avg {data.averageScore} · Passed {data.passed} / Failed {data.failed}
          </p>
        </div>
        <button type="button" onClick={() => window.open(hrApi().exportUrl(data.organizationId), '_blank')}>
          Export Executive Report (PDF)
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Employee Name</th>
            <th>Department</th>
            <th>Course Completion Rate</th>
            <th>Avg Quiz Score</th>
            <th>Exam Status</th>
          </tr>
        </thead>
        <tbody>
          {data.employees.map((emp) => (
            <tr key={emp.seatId}>
              <td>{emp.employeeName}</td>
              <td>{emp.department}</td>
              <td>
                <Bar value={emp.attempts > 0 ? 100 : 0} />
                <span>{emp.attempts > 0 ? 100 : 0}%</span>
              </td>
              <td>{emp.averageScore} / 100</td>
              <td>
                <span>{emp.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default HrDashboard;
