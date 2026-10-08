'use client';

// SSOT Phase 073 Task 3/7 — HLS Studio upload (direct-to-R2 + progress)
// Canonical: apps/frontend/app/(dashboard)/merchant/studio/page.tsx
// - Presigned PUT direct from the browser (bytes never touch Next/Nest);
//   completion hands objectKey to the 043/044 transcode pipeline (handoff).
import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { merchantApi, putToR2 } from '../../../../lib/dashboard/dashboard-client';

function StudioInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [pct, setPct] = useState(0);
  const [mbps, setMbps] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setMsg(null);
    setPct(0);
    try {
      const { uploadUrl, objectKey } = await merchantApi(slug).presignedUpload({
        fileName: file.name, fileSize: file.size, contentType: file.type || 'video/mp4',
      });
      await putToR2(uploadUrl, file, (p, m) => {
        setPct(p);
        setMbps(Math.round(m * 10) / 10);
      });
      setMsg(`อัปโหลดสำเร็จ: ${objectKey} (ส่งต่อ transcode pipeline)`);
    } catch (err) {
      setMsg(`ERROR: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>สตูดิโอ HLS</h1>
      <input
        type="file"
        accept="video/mp4,video/*"
        disabled={busy}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {busy && <p>อัปโหลด {pct}% ({mbps} MB/s)</p>}
      <progress value={pct} max={100} style={{ width: '100%' }} />
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}

export default function MerchantStudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioInner />
    </Suspense>
  );
}
