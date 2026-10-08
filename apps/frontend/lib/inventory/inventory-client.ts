// SSOT Phase 075 §6 — Inventory client (REST transport + CSV parse)
// Canonical: apps/frontend/lib/inventory/inventory-client.ts
// - Proxied REST (auth passthrough); dependency-free CSV parser with
//   row-index errors (§2.2 ERROR modal + error-log download).
// - Zero-dep (fetch only).
import { CsvStockRowSchema } from '@repo/shared';

export type InventoryStatus = 'INVENTORY_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface StockRow {
  sku: string;
  title: string;
  stockQty: number;
  safetyStock: number;
  rackLocation: string | null;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`inventory ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function inventoryApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    stock: (warehouseId: string, q: string, page: number, limit = 20) =>
      json<{ rows: StockRow[]; total: number }>(
        `/api/v1/inventory/stock?${qs}&warehouseId=${encodeURIComponent(warehouseId)}&q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`,
      ),
    batch: (body: unknown) => post(`/api/v1/inventory/stock/batch?${qs}`, body),
    labels: (body: unknown) =>
      post(`/api/v1/inventory/labels/batch?${qs}`, body) as Promise<{ objectKey: string; downloadUrl: string; count: number }>,
    movements: (sku: string) =>
      json<Array<{ id: string; quantityDelta: number; newQty: number; adjustmentType: string; createdAt: string }>>(
        `/api/v1/inventory/movements?${qs}&sku=${encodeURIComponent(sku)}`,
      ),
  };
}

export interface CsvParseResult {
  rows: Array<{ sku: string; warehouseId: string; quantityDelta: number; adjustmentType: string; remark?: string }>;
  errors: Array<{ index: number; reason: string }>;
}

/** Parse `sku,warehouseId,delta,type[,remark]` CSV (header optional). */
export function parseStockCsv(text: string): CsvParseResult {
  const rows: CsvParseResult['rows'] = [];
  const errors: CsvParseResult['errors'] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const start = lines[0] && /^sku\b/i.test(lines[0] as string) ? 1 : 0;
  lines.slice(start).forEach((line, i) => {
    const [sku = '', warehouseId = '', delta = '', type = '', remark = ''] = line.split(',').map((c) => c.trim());
    const parsed = CsvStockRowSchema.safeParse({
      sku,
      warehouseId,
      quantityDelta: Number(delta),
      adjustmentType: type || 'MANUAL_AUDIT_ADJUST',
      ...(remark ? { remark } : {}),
    });
    if (!parsed.success) errors.push({ index: start + i + 1, reason: parsed.error.issues[0]?.message ?? 'invalid row' });
    else rows.push(parsed.data);
  });
  return { rows, errors };
}

/** Download rows as CSV (error-log export, §2.2). */
export function downloadCsv(filename: string, header: string, lines: string[]): void {
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
