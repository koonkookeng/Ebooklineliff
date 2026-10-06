// SSOT Phase 010 §6.1 — Storefront home (hero carousel + quick links + feed, 5 states, <30MB)
'use client';

import React from 'react';
import Link from 'next/link';
import type { ProductCard, StorefrontBanner } from '@repo/shared';
import { discountPercent, effectivePrice } from '@repo/shared';

export type StorefrontUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface Props {
  banners: StorefrontBanner[];
  products: ProductCard[];
  uiState: StorefrontUiState;
  onRetry?: () => void;
}

const QUICK_LINKS = [
  { href: '/catalog?productTypes=PHYSICAL_BOOK', icon: '📚', label: 'หนังสือเล่ม' },
  { href: '/catalog?productTypes=EBOOK', icon: '📖', label: 'E-Book' },
  { href: '/catalog?productTypes=ELEARNING_COURSE', icon: '🎓', label: 'คอร์สเรียน' },
  { href: '/catalog?productTypes=HYBRID_BUNDLE', icon: '🎁', label: 'แพ็กเกจสุดคุ้ม' },
] as const;

export function ProductCardView({ product }: { product: ProductCard }) {
  const off = discountPercent(product);
  return (
    <Link
      href={`/pdp/${product.slug}`}
      className="bg-white rounded-xl overflow-hidden border border-gray-100 shadow-xs flex flex-col"
    >
      <div className="relative aspect-3/4 w-full bg-gray-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={product.coverImageUrl} alt={product.title} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        <span className="absolute top-2 left-2 text-[10px] bg-black/70 text-white px-2 py-0.5 rounded-md font-mono">
          {product.productType}
        </span>
        {off > 0 && (
          <span className="absolute top-2 right-2 text-[10px] bg-red-500 text-white px-2 py-0.5 rounded-md font-bold">
            -{off}%
          </span>
        )}
      </div>
      <div className="p-2.5 flex flex-col justify-between flex-1">
        <h3 className="text-xs font-medium line-clamp-2 text-gray-800">{product.title}</h3>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-sm font-bold text-[var(--tenant-primary,#06C755)]">
            ฿{effectivePrice(product).toLocaleString()}
          </span>
          {product.discountPrice !== null && product.discountPrice < product.price && (
            <span className="text-[10px] text-gray-400 line-through">฿{product.price.toLocaleString()}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function StorefrontHome({ banners, products, uiState, onRetry }: Props) {
  if (uiState === 'LIFF_INIT' || uiState === 'LOADING') {
    return (
      <div className="flex flex-col min-h-screen bg-[var(--tenant-bg,#F8F9FA)] pb-20" aria-busy="true">
        <div className="h-14 bg-white/80 border-b px-4 py-3">
          <div className="h-6 w-32 rounded bg-gray-100 animate-pulse" />
        </div>
        <div className="p-4">
          <div className="h-40 rounded-2xl bg-gray-100 animate-pulse" />
        </div>
        <div className="px-4 grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (uiState === 'ERROR') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 p-6 text-center">
        <p className="text-sm text-gray-600">โหลดหน้าร้านไม่สำเร็จ กรุณาลองใหม่</p>
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

  return (
    <div className="flex flex-col min-h-screen bg-[var(--tenant-bg,#F8F9FA)] pb-20">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-[var(--tenant-primary,#06C755)]">OmniStore</h1>
        <div className="flex items-center space-x-3">
          <Link href="/catalog" aria-label="ค้นหาสินค้า" className="p-2 rounded-full bg-gray-100 text-gray-700">
            🔍
          </Link>
        </div>
      </header>

      {banners.length > 0 && (
        <section aria-label="โปรโมชัน" className="w-full overflow-x-auto flex snap-x snap-mandatory p-4 gap-4">
          {banners.map((b) => (
            <Link
              key={b.id}
              href={b.targetUrl}
              className="snap-center shrink-0 w-[85vw] h-40 relative rounded-2xl overflow-hidden shadow-sm bg-gray-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.imageUrl} alt={b.title} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
            </Link>
          ))}
        </section>
      )}

      <section aria-label="หมวดหมู่" className="grid grid-cols-4 gap-3 px-4 py-2 text-center text-xs font-medium">
        {QUICK_LINKS.map((q) => (
          <Link key={q.href} href={q.href} className="p-3 bg-white rounded-xl shadow-xs flex flex-col items-center gap-1">
            <span className="text-xl" aria-hidden="true">{q.icon}</span>
            {q.label}
          </Link>
        ))}
      </section>

      <section className="px-4 mt-4">
        <h2 className="text-base font-bold mb-3 text-gray-900">สินค้าแนะนำสำหรับคุณ</h2>
        {products.length === 0 ? (
          <p className="text-xs text-gray-500">ยังไม่มีสินค้าแนะนำในขณะนี้</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {products.slice(0, 20).map((p) => (
              <ProductCardView key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default StorefrontHome;
