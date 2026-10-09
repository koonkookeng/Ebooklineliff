// SSOT Phase 106 §6.1 — PermissionMatrixBuilder (Next.js 15 client, virtualized-ready grid)
// Canonical: apps/frontend/components/admin/permission-matrix-builder.tsx
// (legacy src/frontend/components/admin/permission-matrix-builder.tsx)
// - Props carry initial server matrix; BigInt state lives in-memory (<0.5MB, Gate 5).
// - Zero new deps (no shadcn import — host app injects Card/Checkbox via classNames;
//   keeps LIFF bundle light; admin dashboard code-splits this component).
'use client';

import React, { useState } from 'react';
import { BitwisePermissionFlags } from '@repo/shared';
import { toggleBitmask, isBitSet } from '../../lib/permissions/permission-matrix-client';

interface PermissionBuilderProps {
  roleId: string;
  tenantId: string;
  initialBitmask: string;
  initialScopes: string[];
  onSave: (updatedBitmask: string, updatedScopes: string[]) => Promise<void>;
}

const FLAG_LABELS: Array<{ name: string; value: bigint }> = Object.entries(BitwisePermissionFlags)
  .filter(([name]) => name !== 'NONE' && name !== 'SUPER_ADMIN_ALL')
  .map(([name, value]) => ({ name, value: value as bigint }));

export const PermissionMatrixBuilder: React.FC<PermissionBuilderProps> = ({
  roleId,
  tenantId,
  initialBitmask,
  initialScopes,
  onSave,
}) => {
  const [currentBitmask, setCurrentBitmask] = useState<string>(initialBitmask || '0');
  const [scopes, setScopes] = useState<string[]>(initialScopes ?? []);
  const [scopeDraft, setScopeDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const toggleFlag = (flagValue: bigint): void => {
    setCurrentBitmask((prev) => toggleBitmask(prev, flagValue));
  };

  const addScope = (): void => {
    const draft = scopeDraft.trim();
    if (!draft || scopes.includes(draft)) return;
    setScopes((prev) => [...prev, draft]);
    setScopeDraft('');
  };

  const removeScope = (scope: string): void => {
    setScopes((prev) => prev.filter((s) => s !== scope));
  };

  const handleSave = async (): Promise<void> => {
    setIsSaving(true);
    setNotice(null);
    try {
      await onSave(currentBitmask, scopes);
      setNotice('Permissions Updated');
    } catch {
      setNotice('Insufficient Scopes');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      data-testid="permission-matrix-builder"
      data-role-id={roleId}
      data-tenant-id={tenantId}
      className="w-full max-w-4xl border border-slate-800 bg-slate-950 text-slate-100 rounded-xl"
    >
      <div className="p-4 border-b border-slate-800">
        <h2 className="text-xl font-bold text-emerald-400">Granular Security Matrix &amp; Bitwise Configurator</h2>
        <p className="text-xs text-slate-400">Role {roleId} · Tenant {tenantId}</p>
      </div>
      <div className="p-4 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          {FLAG_LABELS.map(({ name, value }) => {
            const checked = isBitSet(currentBitmask, value);
            return (
              <div key={name} className="flex items-center space-x-3 rounded-lg border border-slate-800 p-3">
                <input
                  type="checkbox"
                  id={`perm-${name}`}
                  checked={checked}
                  onChange={() => toggleFlag(value)}
                  disabled={isSaving}
                />
                <label htmlFor={`perm-${name}`} className="cursor-pointer text-sm font-medium">
                  {name} <span className="text-xs text-slate-500">(0x{value.toString(16)})</span>
                </label>
              </div>
            );
          })}
        </div>

        <div className="rounded-md bg-slate-900 p-4">
          <p className="text-xs font-mono text-slate-400">Computed Bitmask Integer (Decimal):</p>
          <p className="text-lg font-mono font-bold text-emerald-300" data-testid="computed-bitmask">
            {currentBitmask}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">JWT Scopes ({scopes.length})</p>
          <div className="flex gap-2">
            <input
              value={scopeDraft}
              onChange={(e) => setScopeDraft(e.target.value)}
              placeholder="tenant:acme:ebook:read"
              className="flex-1 rounded bg-slate-900 border border-slate-700 px-2 py-1 text-sm"
              disabled={isSaving}
            />
            <button type="button" onClick={addScope} disabled={isSaving} className="rounded bg-slate-700 px-3 py-1 text-sm">
              Add
            </button>
          </div>
          <ul className="space-y-1">
            {scopes.map((s) => (
              <li key={s} className="flex items-center justify-between rounded bg-slate-900 px-2 py-1 text-xs font-mono">
                <span>{s}</span>
                <button type="button" onClick={() => removeScope(s)} className="text-red-300" aria-label={`remove ${s}`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded py-2"
        >
          {isSaving ? 'Encrypting & Persisting Matrix...' : 'Save Permission Matrix'}
        </button>
        {notice ? (
          <p role={notice === 'Permissions Updated' ? 'status' : 'alert'} className="text-sm text-slate-300">
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default PermissionMatrixBuilder;
