// SSOT Phase 010 §6.2 — Universal multi-format PDP (physical/ebook/course/bundle, sticky CTA)
'use client';

import React, { useState } from 'react';
import type { ProductDetail } from '@repo/shared';
import { effectivePrice } from '@repo/shared';
import { PreviewModal, type PreviewKind } from './PreviewModal';

export type PdpUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface Props {
  product: ProductDetail | null;
  uiState: PdpUiState;
  previewAssetUrl?: string | null;
  onRetry?: () => void;
  onAddToCart?: (product: ProductDetail) => void;
  onBuyNow?: (product: ProductDetail) => void;
  // Atomic Phase 026: optional share slot (host page injects NativeActionButton).
  shareSlot?: React.ReactNode;
}

export function ProductDetailPage({ product, uiState, previewAssetUrl = null, onRetry, onAddToCart, onBuyNow, shareSlot = null }: Props) {
  const [activeTab, setActiveTab] = useState<'overview' | 'curriculum'>('overview');
  const [preview, setPreview] = useState<PreviewKind | null>(null);

  if (uiState === 'LIFF_INIT' || uiState === 'LOADING') {
    return (
      <div className="min-h-screen bg-white pb-24" aria-busy="true">
        <div className="w-full aspect-4/3 bg-gray-100 animate-pulse" />
        <div className="p-4 space-y-2">
          <div className="h-5 w-2/3 rounded bg-gray-100 animate-pulse" />
          <div className="h-8 w-1/3 rounded bg-gray-100 animate-pulse" />
        </div>
      </div>
    );
  }

  if (uiState === 'ERROR' || !product) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 p-6 text-center">
        <p className="text-sm text-gray-600">ไม่พบข้อมูลสินค้า</p>
        <button
          type="button"
          onClick={onRetry}
          className="text-sm px-5 py-2 rounded-full bg-[var(--tenant-primary,#06C755)] text-white font-bold"
        >
          ลองใหม่อีกครั้ง
        </button>
      </div>
    );
  }

  const openPreview = (): void => {
    if (product.productType === 'EBOOK') setPreview('EBOOK_SAMPLE');
    else if (product.productType === 'ELEARNING_COURSE' || product.productType === 'LIVE_CLASS') setPreview('COURSE_TRAILER');
  };

  return (
    <div className="min-h-screen bg-white pb-24">
      <div className="relative w-full aspect-4/3 bg-gray-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={product.coverImageUrl} alt={product.title} className="absolute inset-0 h-full w-full object-contain" />
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs bg-[var(--tenant-primary,#06C755)] text-white px-2 py-0.5 rounded-full font-semibold">
            {product.productType}
          </span>
          <span className="text-xs text-gray-500">ขายแล้ว {product.soldCount} ชิ้น</span>
          {product.isBestseller && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">ขายดี</span>
          )}
        </div>
        <h1 className="text-lg font-bold text-gray-900">{product.title}</h1>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-[var(--tenant-primary,#06C755)]">
            ฿{effectivePrice(product).toLocaleString()}
          </span>
          {product.discountPrice !== null && product.discountPrice < product.price && (
            <span className="text-sm text-gray-400 line-through">฿{product.price.toLocaleString()}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>★ {product.rating.toFixed(1)}</span>
          <span>·</span>
          <span>โดย {product.sellerName}</span>
        </div>
      </div>

      {(product.productType === 'EBOOK' ||
        product.productType === 'ELEARNING_COURSE' ||
        product.productType === 'LIVE_CLASS') && (
        <div className="px-4 py-2 border-y border-gray-100 flex gap-2">
          <button
            type="button"
            onClick={openPreview}
            className="flex-1 py-2 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200"
          >
            {product.productType === 'EBOOK' ? '📖 ทดลองอ่าน 10 หน้าแรกฟรี' : '▶️ ทดลองเรียนบทแรกฟรี'}
          </button>
        </div>
      )}

      {product.productType === 'PHYSICAL_BOOK' && product.physicalDetail && (
        <div className="px-4 py-2 border-y border-gray-100 text-xs text-gray-600 space-y-1">
          <p>คงเหลือ {product.physicalDetail.stockQty} ชิ้น</p>
          <p>น้ำหนัก {product.physicalDetail.weightGrams} กรัม · จัดส่ง 2–4 วันทำการ</p>
        </div>
      )}

      {/* Atomic Phase 026: viral share slot (all product types, host-injected). */}
      {shareSlot && <div className="px-4 py-2 border-b border-gray-100">{shareSlot}</div>}

      <div className="p-4">
        <div className="flex border-b border-gray-200 mb-3" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            onClick={() => setActiveTab('overview')}
            className={`pb-2 px-4 text-sm font-medium ${activeTab === 'overview' ? 'border-b-2 border-[var(--tenant-primary,#06C755)] text-[var(--tenant-primary,#06C755)]' : 'text-gray-500'}`}
          >
            รายละเอียด
          </button>
          {product.courseDetail && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'curriculum'}
              onClick={() => setActiveTab('curriculum')}
              className={`pb-2 px-4 text-sm font-medium ${activeTab === 'curriculum' ? 'border-b-2 border-[var(--tenant-primary,#06C755)] text-[var(--tenant-primary,#06C755)]' : 'text-gray-500'}`}
            >
              เนื้อหาคอร์ส ({product.courseDetail.totalLessons} บทเรียน)
            </button>
          )}
        </div>

        {activeTab === 'overview' ? (
          <div className="text-xs leading-relaxed text-gray-600 space-y-2">
            <p>{product.description}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {product.courseDetail?.sections.map((s, idx) => (
              <div key={s.id} className="border rounded-lg p-2.5 text-xs">
                <div className="font-semibold text-gray-800 mb-1">
                  ส่วนที่ {idx + 1}: {s.title}
                </div>
                {s.lessons.map((l) => (
                  <div key={l.id} className="flex justify-between py-1 text-gray-500 pl-2">
                    <span>
                      {l.isPreview && <span className="mr-1 text-emerald-600">▶</span>}
                      {l.title}
                    </span>
                    <span>{Math.floor(l.durationSec / 60)} นาที</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3 px-4 flex items-center justify-between gap-3 shadow-lg z-50">
        <button
          type="button"
          aria-label="หยิบใส่ตะกร้า"
          onClick={() => onAddToCart?.(product)}
          className="p-2.5 border border-gray-200 rounded-xl text-gray-600"
        >
          🛒
        </button>
        <button
          type="button"
          onClick={() => onBuyNow?.(product)}
          className="flex-1 py-3 bg-[var(--tenant-primary,#06C755)] text-white font-bold rounded-xl text-sm shadow-md active:scale-95 transition-transform"
        >
          ซื้อทันที · ฿{effectivePrice(product).toLocaleString()}
        </button>
      </div>

      <PreviewModal
        open={preview !== null}
        kind={preview ?? 'EBOOK_SAMPLE'}
        title={product.title}
        assetUrl={previewAssetUrl}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}

export default ProductDetailPage;
