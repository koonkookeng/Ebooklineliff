// SSOT Phase 096 Task 5 — Squad dashboard (dep-free + Flex invite)
// Canonical: apps/frontend/components/squad/StudySquadDashboard.tsx
// - RISK_CALL: no lucide/shadcn (spec asks them) — native elements keep
//   LIFF RAM <30MB (Gate 5). Share rides window.liff with clipboard
//   fallback (026/079/080/089/090/095 precedent).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import type { SquadDetail } from '../../lib/squad/squad-client';

interface LiffGlobal {
  isApiAvailable(api: string): boolean;
  shareTargetPicker(messages: unknown[]): Promise<{ status: string } | null>;
}

function liffGlobal(): LiffGlobal | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { liff?: LiffGlobal }).liff ?? null;
}

export function StudySquadDashboard(props: { squad: SquadDetail; flexMessageJson?: string; inviteUrl?: string }) {
  const { squad, flexMessageJson, inviteUrl } = props;
  const [isSharing, setIsSharing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleShareToLine() {
    if (isSharing) return;
    setIsSharing(true);
    setMsg(null);
    try {
      const liff = liffGlobal();
      if (liff?.isApiAvailable('shareTargetPicker') && flexMessageJson) {
        const out = await liff.shareTargetPicker([JSON.parse(flexMessageJson) as unknown]);
        setMsg(out ? 'ส่งคำชวนเข้ากลุ่มแล้ว!' : 'ยกเลิกการแชร์');
      } else if (inviteUrl) {
        await navigator.clipboard.writeText(inviteUrl).catch(() => undefined);
        setMsg('คัดลอกลิงก์ชวนเพื่อนเรียบร้อยแล้ว!');
      } else {
        setMsg('ไม่พบข้อมูลการแชร์');
      }
    } catch (e) {
      setMsg(`ERROR: ${(e as Error).message}`);
    } finally {
      setIsSharing(false);
    }
  }

  return (
    <div>
      <div>
        <span>Active Squad</span>
        <h2>{squad.name}</h2>
      </div>
      <div>
        <span>
          🔥 {squad.totalPoints.toLocaleString('th-TH')} PTS
        </span>
      </div>
      <div>
        <h3>
          Squad Members ({squad.members.length}/{squad.maxMembers})
        </h3>
        {squad.members.map((member) => (
          <div key={member.userId}>
            <span>{member.displayName}</span>
            <span>+{member.pointsContributed} PTS</span>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => void handleShareToLine()} disabled={isSharing}>
        {isSharing ? 'กำลังเปิด LINE...' : 'ชวนเพื่อนเข้ากลุ่มผ่าน LINE'}
      </button>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}

export default StudySquadDashboard;
