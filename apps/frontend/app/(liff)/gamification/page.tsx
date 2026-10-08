// SSOT Phase 083 Task 6-8 — Gamification Hub (streak + badges + catalog)
// Canonical: apps/frontend/app/(liff)/gamification/page.tsx
'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useGamificationHub } from '../../../hooks/useGamificationHub';
import { DailyStreakWidget } from '../../../components/gamification/DailyStreakWidget';
import { BadgeGallery } from '../../../components/gamification/BadgeGallery';
import { RewardCatalogDrawer } from '../../../components/reward/RewardCatalogDrawer';
import { gameApi, type CheckinResult } from '../../../lib/gamification/gamification-client';

function GamificationInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const { status, error, profile, badges, catalog, setProfile, retry } = useGamificationHub(slug);
  const [toast, setToast] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<CheckinResult['badgeUnlocked']>(null);

  if (status === 'LIFF_INIT' || status === 'LOADING') return <p>กำลังโหลด Gamification Hub…</p>;
  if (status === 'ERROR' || !profile) {
    return (
      <div>
        <p role="alert">โหลดไม่สำเร็จ{error ? `: ${error}` : ''}</p>
        <button type="button" onClick={retry}>
          ลองใหม่
        </button>
      </div>
    );
  }

  async function doCheckin(): Promise<CheckinResult> {
    const data = await gameApi(slug).checkin();
    setProfile((p) =>
      p ? { ...p, currentStreak: data.currentStreak, rewardPoints: p.rewardPoints + data.pointsEarned, hasCheckedInToday: true } : p,
    );
    return data;
  }

  return (
    <div>
      <h1>Gamification Hub</h1>
      <DailyStreakWidget
        currentStreak={profile.currentStreak}
        hasCheckedInToday={profile.hasCheckedInToday}
        rewardPoints={profile.rewardPoints}
        streakFreezeCount={profile.streakFreezeCount}
        onCheckin={doCheckin}
        onCheckinSuccess={(d) => {
          setToast(d.message);
          setUnlocked(d.badgeUnlocked);
        }}
      />
      {toast && <p role="status">{toast}</p>}
      {unlocked && (
        <div role="dialog" aria-label="Badge unlocked">
          <p>ปลดล็อก {unlocked.badgeName}!</p>
          <button type="button" onClick={() => setUnlocked(null)}>
            ปิด
          </button>
        </div>
      )}
      <BadgeGallery badges={badges} streakDays={profile.currentStreak} />
      <RewardCatalogDrawer
        slug={slug}
        items={catalog}
        walletPoints={profile.rewardPoints}
        onRedeemed={(remaining) => setProfile((p) => (p ? { ...p, rewardPoints: remaining } : p))}
      />
    </div>
  );
}

export default function LiffGamificationPage() {
  return (
    <Suspense fallback={<p>กำลังโหลด Gamification Hub…</p>}>
      <GamificationInner />
    </Suspense>
  );
}
