// SSOT Phase 083 §4 — Level Badge Component (Responsive, <30MB)
// Canonical: apps/frontend/components/identity/LevelBadge.tsx
'use client';

import React from 'react';

type Level = 'Member' | 'VIP' | 'Diamond';

interface LevelBadgeProps {
  level: Level;
  xp?: number;
  nextLevelXp?: number;
}

const LEVEL_CONFIG: Record<Level, { color: string; bg: string; icon: string }> = {
  Member: { color: 'text-slate-600', bg: 'bg-slate-100', icon: '🥉' },
  VIP: { color: 'text-amber-600', bg: 'bg-amber-100', icon: '🥈' },
  Diamond: { color: 'text-blue-600', bg: 'bg-blue-100', icon: '💎' },
};

export function LevelBadge({ level, xp = 0, nextLevelXp = 100 }: LevelBadgeProps) {
  const config = LEVEL_CONFIG[level];
  const progress = Math.min(100, (xp / nextLevelXp) * 100);

  return (
    <div className={`p-4 rounded-2xl border border-border bg-card shadow-sm`}>
      <div className="flex items-center gap-4">
        <div className={`w-16 h-16 rounded-full ${config.bg} flex items-center justify-center text-3xl shadow-inner`}>
          {config.icon}
        </div>
        <div className="flex-1">
          <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Level Status</div>
          <div className={`text-xl font-black ${config.color}`}>{level}</div>
          <div className="mt-2 w-full bg-muted rounded-full h-2 overflow-hidden">
            <div 
              className="bg-primary h-full transition-all duration-1000" 
              style={{ width: `${progress}%` }} 
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-muted-foreground font-mono">
            <span>XP: {xp}</span>
            <span>NEXT: {nextLevelXp}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
