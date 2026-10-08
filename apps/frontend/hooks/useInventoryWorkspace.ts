// SSOT Phase 075 §2.2 — Inventory workspace hook (5-state machine)
// Canonical: apps/frontend/hooks/useInventoryWorkspace.ts
// - INVENTORY_INIT on mount -> IDLE/SUCCESS -> ERROR with retry.
// - Zero-dep beyond the inventory client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { inventoryApi, type InventoryStatus, type StockRow } from '../lib/inventory/inventory-client';

export function useInventoryWorkspace(slug: string, warehouseId: string) {
  const [status, setStatus] = useState<InventoryStatus>('INVENTORY_INIT');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    if (!warehouseId) {
      setStatus('IDLE');
      return;
    }
    setStatus((s) => (s === 'INVENTORY_INIT' ? s : 'LOADING'));
    setError(null);
    try {
      const data = await inventoryApi(slug).stock(warehouseId, query, page);
      setRows(data.rows);
      setTotal(data.total);
      setStatus('SUCCESS');
    } catch (e) {
      setError((e as Error).message);
      setStatus('ERROR');
    }
  }, [slug, warehouseId, query, page, nonce]);

  useEffect(() => {
    void load();
  }, [load]);

  return { status, error, rows, total, query, setQuery, page, setPage, retry: () => setNonce((n) => n + 1), reload: load };
}
