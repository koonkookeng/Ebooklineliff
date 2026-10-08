// SSOT Phase 076 §6.1 — Batch thermal label printer (dep-free TSPL/PDF)
// Canonical: apps/frontend/components/thermal-print/BatchThermalLabelPrinter.tsx
// - RISK_CALL (documented): no qrcode.react/jsbarcode (§6.1 asks them) —
//   tracking renders as monospace text + HMAC token string (Gate 4), keeping
//   the LIFF bundle lean. Web Serial TSPL direct stream with PDF fallback
//   (§10 self-heal); single-blob discipline + revoke (Gate 5 <45MB).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import { fulfillmentApi, openBlobAndRevoke, spoolTsplToSerial } from '../../lib/fulfillment/fulfillment-client';

export interface LabelPreview {
  orderId: string;
  orderNumber: string;
  trackingNumber: string | null;
  courierProvider: string;
}

export function BatchThermalLabelPrinter({ slug }: { slug: string }) {
  const [orderIds, setOrderIds] = useState('');
  const [courier, setCourier] = useState('FLASH_EXPRESS');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previews, setPreviews] = useState<LabelPreview[]>([]);
  const [rawTspl, setRawTspl] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProgress(10);
    setMsg(null);
    try {
      const ids = orderIds.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      const res = await fulfillmentApi(slug).print({ orderIds: ids, courierProvider: courier });
      setProgress(80);
      setRawTspl(res.rawTsplCommands);
      setPdfUrl(res.downloadUrl);
      setPreviews(
        ids.map((orderId) => ({ orderId, orderNumber: orderId.slice(0, 8), trackingNumber: null, courierProvider: courier })),
      );
      setProgress(100);
      setMsg(
        res.failedOrders.length === 0
          ? `สร้างใบปะหน้า ${res.totalProcessed} ใบ: ${res.objectKey}`
          : `ERROR: สำเร็จ ${res.totalProcessed}, ล้มเหลว ${res.failedOrders.map((f) => `${f.orderId}(${f.reason})`).join(', ')}`,
      );
    } catch (err) {
      setMsg(`ERROR: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function printStream() {
    if (!rawTspl) return;
    setBusy(true);
    try {
      const spooled = await spoolTsplToSerial(rawTspl).catch(() => false);
      if (!spooled && pdfUrl) {
        // §10 self-heal: fall back to the browser print engine.
        window.open(pdfUrl, '_blank');
        setMsg('ไม่มีพอร์ต Serial — เปิด PDF ในแท็บใหม่แทน');
      } else if (spooled) {
        setMsg(`ส่งคำสั่งพิมพ์ ${previews.length} ใบไปยังเครื่องพิมพ์แล้ว`);
      }
    } finally {
      setBusy(false);
    }
  }

  function downloadTspl() {
    if (!rawTspl) return;
    openBlobAndRevoke(new Blob([rawTspl], { type: 'text/plain' }), 'labels-tspl.txt');
  }

  return (
    <div>
      <form onSubmit={generate} className="merchant-form">
        <input placeholder="Order IDs (คั่นด้วยจุลภาค)" value={orderIds} onChange={(e) => setOrderIds(e.target.value)} required />
        <select value={courier} onChange={(e) => setCourier(e.target.value)}>
          <option value="FLASH_EXPRESS">Flash Express</option>
          <option value="KEX_EXPRESS">KEX</option>
          <option value="JT_EXPRESS">J&T</option>
          <option value="THAILAND_POST">Thailand Post</option>
          <option value="CUSTOM_FLEET">Custom Fleet</option>
        </select>
        <button type="submit" disabled={busy}>{busy ? `กำลังสร้าง ${progress}%` : 'สร้างใบปะหน้า (Batch)'}</button>
      </form>
      {busy && <progress value={progress} max={100} style={{ width: '100%' }} />}
      {previews.length > 0 && (
        <div>
          <div className="merchant-form" style={{ flexDirection: 'row' }}>
            <button type="button" disabled={busy || !rawTspl} onClick={() => void printStream()}>สั่งพิมพ์ Thermal ({previews.length} ใบ)</button>
            <button type="button" disabled={!rawTspl} onClick={downloadTspl}>ดาวน์โหลด TSPL</button>
            {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer">เปิด PDF</a>}
          </div>
          <div className="print-area">
            {previews.map((p) => (
              <div key={p.orderId} className="thermal-label" style={{ width: '100mm', minHeight: '150mm' }}>
                <p><strong>ผู้ส่ง:</strong> {slug}</p>
                <p><strong>Order:</strong> {p.orderNumber}</p>
                <p><strong>ขนส่ง:</strong> {p.courierProvider}</p>
                <p className="font-mono"><strong>Track:</strong> {p.trackingNumber ?? '(ออกเลขแล้วบนเซิร์ฟเวอร์)'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}
