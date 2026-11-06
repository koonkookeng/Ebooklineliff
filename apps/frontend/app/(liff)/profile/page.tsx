// SSOT Phase 003 §2.2 — LIFF profile home (address book entry, 5-state)
// Canonical: apps/frontend/app/(liff)/profile/page.tsx
// (legacy src/frontend/app/(liff)/profile/*)
// - Hosts the AddressBookManager (BUSINESS_GOAL multi-address book).
//   Text-first, <30MB. Zero new deps.
'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AddressBookManager } from '@/components/identity/AddressBookManager';
import { LevelBadge } from '@/components/identity/LevelBadge';
import { DailyAttendanceCalendar } from '@/components/gamification/DailyAttendanceCalendar';
import { gameApi, type GamificationProfile } from '@/lib/gamification/gamification-client';

function ProfileInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [profile, setProfile] = useState<GamificationProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    gameApi(slug).profile()
      .then(setProfile)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="p-8 text-center">กำลังโหลด...</div>;

  return (
    <main className="p-4 flex flex-col gap-6 bg-background min-h-screen">
      <div className="flex items-center gap-4 py-4">
        <div className="w-16 h-16 rounded-full bg-muted overflow-hidden border-2 border-primary/20">
          <img src="/api/placeholder/64/64" alt="Avatar" className="w-full h-full object-cover" />
        </div>
        <div>
          <h1 className="text-xl font-bold">คุณ ผู้ใช้งาน</h1>
          <p className="text-sm text-muted-foreground">ID: #88293</p>
        </div>
      </div>

      {profile && (
        <>
          <LevelBadge level="VIP" xp={profile.rewardPoints % 100} nextLevelXp={100} />
          <DailyAttendanceCalendar 
            currentStreak={profile.currentStreak} 
            hasCheckedInToday={profile.hasCheckedInToday}
            onCheckin={() => {
              gameApi(slug).checkin().then(res => {
                if (res.success) {
                   setProfile(p => p ? ({ ...p, currentStreak: res.currentStreak, hasCheckedInToday: true }) : p);
                }
              });
            }}
          />
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <a href="/profile/kyc" className="p-4 bg-card border border-border rounded-xl text-center shadow-sm">
          <div className="text-2xl mb-1">🛡️</div>
          <div className="text-sm font-bold">ยืนยันตัวตน</div>
          <div className="text-[10px] text-muted-foreground">e-KYC Verified</div>
        </a>
        <button className="p-4 bg-card border border-border rounded-xl text-center shadow-sm">
          <div className="text-2xl mb-1">🔗</div>
          <div className="text-sm font-bold">เชื่อมต่อ LINE</div>
          <div className="text-[10px] text-muted-foreground">Connected</div>
        </button>
      </div>

      <section className="mt-2">
        <h2 className="text-lg font-bold mb-4">สมุดที่อยู่จัดส่ง</h2>
        <AddressBookManager />
      </section>

      <div className="h-20" />
    </main>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<main className="p-8 text-center"><p>กำลังโหลดโปรไฟล์…</p></main>}>
      <ProfileInner />
    </Suspense>
  );
}
