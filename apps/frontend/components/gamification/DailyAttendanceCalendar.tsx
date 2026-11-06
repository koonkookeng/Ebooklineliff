// SSOT Phase 083 §3 — Daily Attendance Calendar (Responsive, <30MB)
// Canonical: apps/frontend/components/gamification/DailyAttendanceCalendar.tsx
'use client';

import React from 'react';

interface DailyAttendanceCalendarProps {
  currentStreak: number;
  hasCheckedInToday: boolean;
  onCheckin: () => void;
}

export function DailyAttendanceCalendar({ currentStreak, hasCheckedInToday, onCheckin }: DailyAttendanceCalendarProps) {
  // Generate last 7 days for the weekly view
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return {
      dayName: d.toLocaleDateString('th-TH', { weekday: 'short' }),
      date: d.getDate(),
      isToday: i === 6,
      // Mock logic: if streak >= (6-i), they checked in
      checkedIn: i < 6 ? Math.random() > 0.3 : hasCheckedInToday, 
    };
  });

  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="font-bold text-lg">เช็กอินรายวัน</h3>
          <p className="text-sm text-muted-foreground">สะสมแต้มต่อเนื่อง {currentStreak} วัน</p>
        </div>
        <div className="bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1">
          <span>🔥</span> {currentStreak}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2 mb-6">
        {days.map((d, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <span className="text-[10px] text-muted-foreground uppercase">{d.dayName}</span>
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                d.checkedIn
                  ? 'bg-primary text-white shadow-lg shadow-primary/20'
                  : d.isToday
                  ? 'border-2 border-primary text-primary animate-pulse'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {d.checkedIn ? '✓' : d.date}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={onCheckin}
        disabled={hasCheckedInToday}
        className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
          hasCheckedInToday
            ? 'bg-muted text-muted-foreground cursor-not-allowed'
            : 'bg-primary text-white shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98]'
        }`}
      >
        {hasCheckedInToday ? 'เช็กอินวันนี้แล้ว' : 'เช็กอินรับ 10 Points วันนี้'}
      </button>
    </div>
  );
}
