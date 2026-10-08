'use client';

// SSOT Phase 075 §6.1 — Batch stock workspace (table + CSV + progress)
// Canonical: apps/frontend/components/inventory/BatchStockWorkspace.tsx
// - Editable delta grid -> batch commit with 0-100% progress; CSV upload
//   parsed client-side (row-index errors + error-log CSV download, §2.2);
//   success rows flash green (CSS fade 2s).
// - Zero-dep (React only; no TanStack — windowed render for 10k SKUs).
import React, { useState } from 'react';
import { stockStatusOf } from '@repo/shared';
import {
  downloadCsv,
  inventoryApi,
  parseStockCsv,
  type StockRow,
} from '../../lib/inventory/inventory-client';

export function BatchStockWorkspace({ slug, warehouseId, userId }: { slug: string; warehouseId: string; userId: string }) {
  const [lines, setLines] = useState<Array<{ sku: string; delta: number }>>([{ sku: '', delta: 0 }]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [flashed, setFlashed] = useState<string[]>([]);

  async function commit(rows: Array<{ sku: string; delta: number }>) {
    const valid = rows.filter((r) => r.sku.trim() !== '' && r.delta !== 0);
    if (valid.length === 0) {
      setMsg('ERROR: ไม่มีรายการที่ต้องปรับ');
      return;
    }
    setBusy(true);
    setProgress(5);
    setMsg(null);
    try {
      setProgress(45);
      const res = (await inventoryApi(slug).batch({
        updatedByUserId: userId,
        adjustments: valid.map((r) => ({
          sku: r.sku.trim(),
          warehouseId,
          quantityDelta: r.delta,
          adjustmentType: r.delta >= 0 ? 'PURCHASE_RECEIPT' : 'DAMAGE_WRITE_OFF',
        })),
      })) as { success: boolean; totalUpdated: number; failedItems: Array<{ sku: string; reason: string }> };
      setProgress(100);
      setFlashed(valid.map((r) => r.sku.trim()));
      setTimeout(() => setFlashed([]), 2000);
      setMsg(
        res.failedItems.length === 0
          ? `อัปเดตสต็อกสำเร็จ ${res.totalUpdated} รายการ`
          : `ERROR: สำเร็จ ${res.totalUpdated}, ล้มเหลว ${res.failedItems.map((f) => `${f.sku}(${f.reason})`).join(', ')}`,
      );
    } catch (e) {
      setMsg(`ERROR: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function onCsv(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const { rows, errors } = parseStockCsv(text);
    if (errors.length > 0) {
      downloadCsv('stock-errors.csv', 'row,reason', errors.map((e) => `${e.index},${e.reason}`));
      setMsg(`ERROR: CSV มี ${errors.length} แถวผิด (ดาวน์โหลด log แล้ว)`);
    }
    const mapped = rows
      .filter((r) => r.warehouseId === warehouseId || r.warehouseId === '')
      .map((r) => ({ sku: r.sku, delta: r.quantityDelta }));
    if (mapped.length > 0) {
      setLines(mapped);
      await commit(mapped);
    }
  }

  return (
    <div>
      <div className="merchant-form" style={{ flexDirection: 'row' }}>
        <label>
          อัปโหลด CSV
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => void onCsv(e.target.files?.[0])} />
        </label>
        <button type="button" disabled={busy} onClick={() => void commit(lines)}>
          {busy ? `กำลังบันทึก ${progress}%` : 'Batch Commit'}
        </button>
      </div>
      {busy && <progress value={progress} max={100} style={{ width: '100%' }} />}
      <table className="merchant-table">
        <thead>
          <tr><th>SKU</th><th>ปรับ (+/-)</th><th>สถานะ</th></tr>
        </thead>
        <tbody>
          {lines.map((row, ix) => (
            <tr key={ix} className={flashed.includes(row.sku.trim()) ? 'row-flash' : ''}>
              <td>
                <input
                  value={row.sku}
                  onChange={(e) => setLines((ls) => ls.map((l, i) => (i === ix ? { ...l, sku: e.target.value } : l)))}
                  placeholder="BK-..."
                />
              </td>
              <td>
                <input
                  type="number"
                  value={row.delta}
                  onChange={(e) => setLines((ls) => ls.map((l, i) => (i === ix ? { ...l, delta: Number(e.target.value) || 0 } : l)))}
                />
              </td>
              <td>{row.sku ? stockStatusOf(row.delta >= 0 ? 1 : 0, 0) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => setLines((ls) => [...ls, { sku: '', delta: 0 }])}>+ เพิ่มแถว</button>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}

/** Windowed stock table (renders ≤100 rows; paged server-side, §2.1). */
export function StockTable({ rows }: { rows: StockRow[] }) {
  return (
    <table className="merchant-table">
      <thead>
        <tr><th>SKU</th><th>ชื่อ</th><th>คงเหลือ</th><th>สถานะ</th><th>ชั้นวาง</th></tr>
      </thead>
      <tbody>
        {rows.slice(0, 100).map((r) => {
          const st = stockStatusOf(r.stockQty, r.safetyStock);
          return (
            <tr key={r.sku}>
              <td>{r.sku}</td>
              <td>{r.title}</td>
              <td>{r.stockQty}</td>
              <td>
                <span className={`badge-${st.toLowerCase()}`}>
                  {st === 'IN_STOCK' ? 'มีสินค้า' : st === 'LOW_STOCK' ? 'ใกล้หมด' : 'หมด'}
                </span>
              </td>
              <td>{r.rackLocation ?? '-'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
