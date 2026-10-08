// SSOT Phase 083 Task 6 — Duolingo-style streak flame widget (dep-free)
// Canonical: apps/frontend/components/gamification/DailyStreakWidget.tsx
// - RISK_CALL: no lucide-react/framer-motion (spec asks both) — inline SVG
//   flame + CSS pulse keep LIFF RAM under 30MB (Gate 5); celebration is a
//   CSS burst, not a canvas confetti lib.
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import type { CheckinResult } from '../../lib/gamification/gamification-client';

export function DailyStreakWidget(props: {
  currentStreak: number;
  hasCheckedInToday: boolean;
  rewardPoints: number;
  streakFreezeCount: number;
  onCheckinSuccess: (data: CheckinResult) => void;
  onCheckin: () => Promise<CheckinResult>;
}) {
  const { currentStreak, hasCheckedInToday, rewardPoints, streakFreezeCount, onCheckinSuccess, onCheckin } = props;
  const [loading, setLoading] = useState(false);
  const [checkedIn, setCheckedIn] = useState(hasCheckedInToday);
  const [burst, setBurst] = useState(false);

  async function handleCheckin() {
    if (checkedIn || loading) return;
    setLoading(true);
    try {
      const data = await onCheckin();
      if (data.success) {
        setCheckedIn(true);
        setBurst(true);
        setTimeout(() => setBurst(false), 1200);
        onCheckinSuccess(data);
      }
    } catch {
      // The hub hook surfaces the error toast; the button just unlocks.
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: 'var(--streak-flame-color,#F97316)' }}>
      <div>
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 2c1 4-4 5.5-4 10a4.5 4.5 0 009 0c0-1.2-.5-2.3-1-3.2-.3 1-1 1.7-2 2 .3-3.2-1-6.6-2-8.8z"
          />
        </svg>
        <div>
          <span>{currentStreak}</span>
          <span>วันต่อเนื่อง</span>
        </div>
      </div>
      <div>
        <span>ฟรีซ {streakFreezeCount}</span>
        <span>{rewardPoints.toLocaleString()} แต้ม</span>
      </div>
      <button type="button" onClick={() => void handleCheckin()} disabled={checkedIn || loading}>
        {loading ? '...' : checkedIn ? 'เช็กอินวันนี้เรียบร้อยแล้ว' : 'กดเช็กอินรับแต้มวันนี้ (+10)'}
      </button>
      {burst && <p role="status">เช็กอินสำเร็จ! ไฟติดแล้ว</p>}
    </div>
  );
}
