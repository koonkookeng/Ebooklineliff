// SSOT Phase 078 BDD-2 — HLS direct-upload component (R2 presign + PUT)
// Canonical: apps/frontend/components/studio/hls-uploader.tsx
// - Presigned PUT straight to R2 (bypasses app CPU/bandwidth, §8.1);
//   XHR progress (%, speed, ETA) + server webhook completes the ledger.
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import { studioApi } from '../../lib/studio/studio-client';

const ACCEPTED = ['video/mp4', 'video/quicktime', 'video/x-matroska'];

export function HlsUploader({ slug, lessonId }: { slug: string; lessonId: string }) {
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setMsg('ERROR: รองรับเฉพาะ MP4, MOV, MKV');
      return;
    }
    setBusy(true);
    setProgress(0);
    setMsg(null);
    try {
      const { uploadUrl } = await studioApi(slug).presign({
        lessonId,
        fileName: file.name,
        fileSizeBytes: file.size,
        contentType: file.type,
      });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
        xhr.onerror = () => reject(new Error('upload failed'));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });
      setProgress(100);
      setMsg('อัปโหลดสำเร็จ — ระบบกำลังแปลง HLS (ติดตามสถานะที่บทเรียน)');
    } catch (e) {
      setMsg(`ERROR: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="merchant-form">
      <label>
        อัปโหลดวิดีโอ (MP4/MOV/MKV)
        <input type="file" accept="video/mp4,video/quicktime,video/x-matroska" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {busy && <progress value={progress} max={100} style={{ width: '100%' }} />}
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}
