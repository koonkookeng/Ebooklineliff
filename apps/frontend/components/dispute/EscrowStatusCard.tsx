// SSOT Phase 113 §2/§6 — escrow status card + dispute timeline (dep-free)
// Canonical: apps/frontend/components/dispute/EscrowStatusCard.tsx
// - 7-day hold countdown, status badge, refund/timeline ledger.
// - Zero new deps (React only).
'use client';

import React from 'react';
import type { DisputeDetailView, EscrowStatusView } from '../../lib/dispute/dispute-client';

export function escrowBadge(status: string): { label: string; color: 'green' | 'amber' | 'red' | 'gray' } {
  if (status === 'HELD') return { label: 'HELD · พักเงิน 7 วัน', color: 'amber' };
  if (status === 'DISPUTED_HOLD') return { label: 'DISPUTED_HOLD · ระงับจ่าย', color: 'red' };
  if (status === 'RELEASED_TO_SELLER') return { label: 'RELEASED_TO_SELLER · จ่ายผู้ขายแล้ว', color: 'green' };
  if (status === 'REFUNDED_TO_BUYER') return { label: 'REFUNDED_TO_BUYER · คืนผู้ซื้อแล้ว', color: 'green' };
  if (status === 'PARTIALLY_REFUNDED') return { label: 'PARTIALLY_REFUNDED · คืนบางส่วน', color: 'amber' };
  return { label: status, color: 'gray' };
}

export function EscrowStatusCard(props: { escrow: EscrowStatusView | null; dispute: DisputeDetailView | null }) {
  const { escrow, dispute } = props;
  if (!escrow) return <p>ยังไม่มีข้อมูล Escrow สำหรับคำสั่งซื้อนี้</p>;
  const badge = escrowBadge(escrow.status);
  const daysLeft = Math.max(0, Math.ceil((new Date(escrow.holdingUntil).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

  return (
    <div>
      <h2>สถานะ Escrow</h2>
      <p data-testid="escrow-badge" data-color={badge.color}>{badge.label}</p>
      <p>ยอดพัก ฿{Number(escrow.grossAmount).toLocaleString()} · {escrow.status === 'HELD' ? `เหลือ ${daysLeft} วันก่อนปล่อยให้ผู้ขาย` : `ครบกำหนด ${new Date(escrow.holdingUntil).toLocaleDateString('th-TH')}`}</p>
      {escrow.expired && escrow.status === 'HELD' && <p role="alert">ครบกำหนดพักเงินแล้ว — รอระบบปล่อยให้ผู้ขาย</p>}
      {dispute && (
        <div>
          <h3>ข้อพิพาท {dispute.disputeNo} · {dispute.status}</h3>
          <p>ขอคืน ฿{Number(dispute.requestedRefundAmount).toLocaleString()}{dispute.approvedRefundAmount !== null ? ` · อนุมัติ ฿${Number(dispute.approvedRefundAmount).toLocaleString()}` : ''}</p>
          <ol data-testid="dispute-timeline">
            {dispute.timelines.map((t) => (
              <li key={t.id}>
                [{t.actorRole}] {t.actionState}{t.note ? ` — ${t.note}` : ''}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
