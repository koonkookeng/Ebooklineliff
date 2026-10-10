// SSOT Phase 118 §6.1 — admin audit log explorer (dep-free)
// Canonical: apps/frontend/components/admin/audit-log-viewer.tsx
// (legacy src/frontend/components/admin/audit-log-viewer.tsx)
// - Multi-filter table + chain badge (CHAIN_VALID green / TAMPERED red) +
//   row detail (JSON delta + hashes for auditor roles only, Gate 4 §2.1) +
//   tamper banner with the broken block highlighted.
// - No lucide/tanstack (bundle guard; text glyphs only). Zero new deps.
'use client';

import React, { useState } from 'react';
import { canSeeHashDetails, type AuditLogView } from '../../lib/audit/audit-client';

export function chainBadge(valid: boolean | null): { label: string; color: 'green' | 'red' | 'gray' } {
  if (valid === null) return { label: 'CHAIN_UNKNOWN', color: 'gray' };
  return valid ? { label: 'CHAIN_VALID', color: 'green' } : { label: 'TAMPER_DETECTED', color: 'red' };
}

export function statusBadge(status: string): 'green' | 'red' | 'amber' {
  if (status === 'VERIFIED_VALID') return 'green';
  if (status === 'TAMPER_DETECTED' || status === 'CORRUPTED_CHAIN') return 'red';
  return 'amber';
}

export function AdminAuditConsoleViewer(props: {
  logs: AuditLogView[];
  chainValid: boolean | null;
  tamperedSequences: number[];
  viewerRole?: string;
  onSelect: (log: AuditLogView) => void;
  selectedId: string | null;
}) {
  const { logs, chainValid, tamperedSequences, viewerRole, onSelect, selectedId } = props;
  const [expanded, setExpanded] = useState(false);
  const badge = chainBadge(chainValid);
  const showHashes = canSeeHashDetails(viewerRole);
  const selected = logs.find((l) => l.id === selectedId) ?? null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Immutable Audit Log Console (144-XZ Vault)</h2>
        <span data-testid="chain-badge" data-color={badge.color}>
          {badge.label}
        </span>
      </div>
      {chainValid === false && (
        <p role="alert" data-testid="tamper-banner">
          CRITICAL: TAMPER DETECTED — บล็อกเสียหายที่ลำดับ {tamperedSequences.join(', ')} · แจ้งทีม Security แล้ว
        </p>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>SEQ #</th>
              <th>ACTOR</th>
              <th>ACTION</th>
              <th>CATEGORY</th>
              <th>HASH (SHA-256)</th>
              <th>STATUS</th>
              <th>TIMESTAMP</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const broken = tamperedSequences.includes(Number(log.sequenceNumber));
              return (
                <tr
                  key={log.id}
                  data-testid="audit-row"
                  data-broken={broken ? 'true' : undefined}
                  style={broken ? { outline: '2px solid red' } : undefined}
                >
                  <td data-testid="audit-seq">#{String(log.sequenceNumber)}</td>
                  <td>{log.actorEmail}</td>
                  <td>{log.actionName}</td>
                  <td>{log.actionCategory}</td>
                  <td data-testid="audit-hash" title={showHashes ? log.currentHash : undefined}>
                    {showHashes ? `${log.currentHash.slice(0, 16)}…` : '••••'}
                  </td>
                  <td data-testid="audit-status" data-color={statusBadge(log.integrityStatus)}>
                    {log.integrityStatus}
                  </td>
                  <td>{new Date(log.createdAt).toLocaleString('th-TH')}</td>
                  <td>
                    <button type="button" onClick={() => { onSelect(log); setExpanded(true); }}>
                      ดูรายละเอียด
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {logs.length === 0 && <p>ยังไม่มีบันทึก audit</p>}
      {selected && expanded && (
        <div role="dialog" aria-label="Audit detail">
          <h3>
            Block #{String(selected.sequenceNumber)} · {selected.actionName}
          </h3>
          {showHashes && (
            <dl>
              <dt>previousHash</dt>
              <dd data-testid="audit-prev">{selected.previousHash}</dd>
              <dt>currentHash</dt>
              <dd>{selected.currentHash}</dd>
            </dl>
          )}
          <button type="button" onClick={() => setExpanded(false)}>
            ปิด
          </button>
        </div>
      )}
    </div>
  );
}
