// SSOT Phase 018 §6 — Library asset card (lazy cover, badge, progress, resume)
// Canonical: apps/frontend/components/library/LibraryAssetCard.tsx
// RAM budget: plain <img loading="lazy"> (no next/image runtime, no icon deps).
'use client';

import React from 'react';
import { resumePath, type DigitalAsset } from '../../lib/library';

const TYPE_LABEL: Record<DigitalAsset['assetType'], string> = {
  EBOOK: 'E-Book',
  ELEARNING_COURSE: 'คอร์สเรียน',
  HYBRID_BUNDLE: 'แพ็กเกจชุด',
  LIVE_CLASS: 'Live Class',
};

interface Props {
  asset: DigitalAsset;
  accent?: string;
}

export function LibraryAssetCard({ asset, accent = '#059669' }: Props) {
  const href = resumePath(asset);
  const resumeLabel =
    asset.assetType === 'EBOOK'
      ? `อ่านต่อหน้า ${asset.lastAccessedPage ?? 1}`
      : asset.assetType === 'ELEARNING_COURSE'
        ? 'เรียนต่อ'
        : 'เปิดดู';
  return (
    <a
      href={href}
      className="group bg-white rounded-2xl p-3 border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
    >
      <div>
        <div className="relative w-full aspect-[3/4] rounded-xl overflow-hidden mb-2.5 bg-slate-100">
          <img
            src={asset.coverImageUrl}
            alt={asset.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          <div className="absolute top-2 left-2 bg-slate-900/80 px-2 py-0.5 rounded-md text-[10px] text-white font-medium">
            {TYPE_LABEL[asset.assetType]}
          </div>
          {asset.progressPercentage >= 100 && (
            <div className="absolute top-2 right-2 bg-emerald-600 px-2 py-0.5 rounded-md text-[10px] text-white font-bold">
              จบแล้ว
            </div>
          )}
        </div>
        <h3 className="text-xs font-semibold text-slate-800 line-clamp-2 mb-1">{asset.title}</h3>
      </div>
      <div className="mt-2">
        <div className="flex justify-between text-[10px] text-slate-500 mb-1">
          <span>ความคืบหน้า</span>
          <span className="font-semibold" style={{ color: accent }}>
            {asset.progressPercentage}%
          </span>
        </div>
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${asset.progressPercentage}%`, background: accent }} />
        </div>
        <span className="mt-2 block text-center text-[11px] font-bold text-white rounded-lg py-1.5" style={{ background: accent }}>
          {resumeLabel}
        </span>
      </div>
    </a>
  );
}

export default LibraryAssetCard;
