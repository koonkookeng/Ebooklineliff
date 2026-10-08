'use client';

// SSOT Phase 073 Task 7 — Product Builder (multi-format upsert Studio)
// Canonical: apps/frontend/app/(dashboard)/merchant/products/page.tsx
import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { merchantApi } from '../../../../lib/dashboard/dashboard-client';

function BuilderInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: '', slug: '', description: '', coverImageUrl: '',
    productType: 'PHYSICAL_BOOK', price: '100', stockQty: '10', sku: '',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await merchantApi(slug).upsertProduct({
        title: form.title, slug: form.slug, description: form.description,
        coverImageUrl: form.coverImageUrl, productType: form.productType,
        price: Number(form.price),
        ...(form.productType === 'PHYSICAL_BOOK'
          ? { physicalDetail: { weightGrams: 500, stockQty: Number(form.stockQty), sku: form.sku } }
          : {}),
      });
      setMsg(`บันทึกสำเร็จ (${res.updated ? 'อัปเดต' : 'สร้างใหม่'}): ${res.slug}`);
    } catch (err) {
      setMsg(`ERROR: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <h1>Product Builder</h1>
      <form onSubmit={submit} className="merchant-form">
        <input placeholder="ชื่อสินค้า (≥3 ตัวอักษร)" value={form.title} onChange={set('title')} required minLength={3} />
        <input placeholder="slug" value={form.slug} onChange={set('slug')} required minLength={3} />
        <input placeholder="คำอธิบาย" value={form.description} onChange={set('description')} required />
        <input placeholder="URL รูปปก" value={form.coverImageUrl} onChange={set('coverImageUrl')} required />
        <select value={form.productType} onChange={set('productType')}>
          <option value="PHYSICAL_BOOK">หนังสือเล่ม</option>
          <option value="EBOOK">E-Book</option>
          <option value="ELEARNING_COURSE">คอร์สเรียน</option>
          <option value="HYBRID_BUNDLE">Bundle</option>
        </select>
        <input placeholder="ราคา" type="number" min={1} value={form.price} onChange={set('price')} required />
        {form.productType === 'PHYSICAL_BOOK' && (
          <>
            <input placeholder="SKU" value={form.sku} onChange={set('sku')} required />
            <input placeholder="สต็อก" type="number" min={0} value={form.stockQty} onChange={set('stockQty')} required />
          </>
        )}
        <button type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกสินค้า'}</button>
      </form>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}

export default function MerchantProductsPage() {
  return (
    <Suspense fallback={null}>
      <BuilderInner />
    </Suspense>
  );
}
