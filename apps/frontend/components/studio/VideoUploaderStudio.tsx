// SSOT Phase 043 Task 6 — VideoUploaderStudio (creator ingest console, §2.1)
// Canonical: apps/frontend/components/studio/VideoUploaderStudio.tsx
// (legacy src/frontend/components/studio/VideoUploaderStudio.tsx)
// - Drag&drop + file picker (MP4/MOV/MKV, client-validated MIME) → initiate
//   (presigned 10MB parts) → direct-to-R2 PUTs with % + speed → complete →
//   stepper polls status (QUEUED → PROCESSING → READY preview / FAILED).
// - Stepper: UPLOADING → QUEUED → PROCESSING → READY (spec §2.1).
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VIDEO_UPLOAD_PART_BYTES } from '@repo/shared';

type StudioStep = 'IDLE' | 'UPLOADING' | 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';

interface PartTicket {
  partNumber: number;
  r2Key: string;
  url: string;
}

interface VideoUploaderStudioProps {
  lessonId: string;
  onReady?: (videoId: string) => void;
}

const ACCEPTED_MIME = ['video/mp4', 'video/quicktime', 'video/x-matroska'];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function VideoUploaderStudio({ lessonId, onReady }: VideoUploaderStudioProps) {
  const [step, setStep] = useState<StudioStep>('IDLE');
  const [fileName, setFileName] = useState('');
  const [pct, setPct] = useState(0);
  const [speed, setSpeed] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const pollStatus = useCallback(
    (id: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/v1/stream/upload/${encodeURIComponent(id)}/status`);
          if (!res.ok) return;
          const data = (await res.json()) as { status?: string };
          if (data.status === 'READY') {
            stopPolling();
            setStep('READY');
            onReady?.(id);
          } else if (data.status === 'TRANSCODING_QUEUED') {
            setStep('QUEUED');
          } else if (data.status === 'TRANSCODING_PROCESSING') {
            setStep('PROCESSING');
          } else if (data.status === 'FAILED') {
            stopPolling();
            setStep('FAILED');
            setError('การแปลงไฟล์ล้มเหลว — ระบบจะลองใหม่อัตโนมัติ');
          }
        } catch {
          // Polling is best-effort; the stepper keeps its last state.
        }
      }, 3000);
    },
    [onReady, stopPolling],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      if (!ACCEPTED_MIME.includes(file.type)) {
        setError('รองรับเฉพาะ MP4 / MOV / MKV');
        setStep('FAILED');
        return;
      }
      setError(null);
      setFileName(file.name);
      setStep('UPLOADING');
      setPct(0);
      try {
        const initRes = await fetch('/api/v1/stream/upload/initiate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lessonId, fileName: file.name, fileSizeBytes: file.size, mimeType: file.type }),
        });
        if (!initRes.ok) throw new Error(`initiate ${initRes.status}`);
        const init = (await initRes.json()) as { videoId: string; parts: PartTicket[] };
        setVideoId(init.videoId);
        const startedAt = Date.now();
        let uploaded = 0;
        for (const part of init.parts) {
          const start = (part.partNumber - 1) * VIDEO_UPLOAD_PART_BYTES;
          const blob = file.slice(start, start + VIDEO_UPLOAD_PART_BYTES);
          const put = await fetch(part.url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
          if (!put.ok) throw new Error(`part ${part.partNumber}: ${put.status}`);
          uploaded += blob.size;
          setPct(Math.round((uploaded / file.size) * 100));
          const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
          setSpeed(`${formatBytes(Math.round(uploaded / elapsedSec))}/s`);
        }
        const doneRes = await fetch('/api/v1/stream/upload/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ videoId: init.videoId }),
        });
        if (!doneRes.ok) throw new Error(`complete ${doneRes.status}`);
        setStep('QUEUED');
        pollStatus(init.videoId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
        setStep('FAILED');
      }
    },
    [lessonId, pollStatus],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void uploadFile(file);
    },
    [uploadFile],
  );

  return (
    <section aria-label="Video upload studio" className="w-full max-w-2xl space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') inputRef.current?.click();
        }}
        aria-label="Drop a video file or click to browse"
        className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragOver ? 'border-emerald-500 bg-emerald-500/10' : 'border-border bg-card'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_MIME.join(',')}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />
        <p className="text-sm font-medium">ลากไฟล์วิดีโอมาที่นี่ หรือคลิกเพื่อเลือกไฟล์</p>
        <p className="mt-1 text-xs text-muted-foreground">MP4 / MOV / MKV — อัปโหลดตรงสู่ R2 ทีละ 10MB</p>
      </div>

      {step !== 'IDLE' && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-xs">
            <span className="max-w-[60%] truncate font-medium">{fileName}</span>
            <span className="font-mono text-muted-foreground">
              {step} {step === 'UPLOADING' ? `${pct}% · ${speed}` : ''}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={step === 'READY' ? 100 : pct} aria-valuemin={0} aria-valuemax={100}>
            <div
              className={`h-full rounded-full transition-all ${step === 'FAILED' ? 'bg-red-500' : step === 'READY' ? 'bg-emerald-500' : 'bg-primary'}`}
              style={{ width: `${step === 'READY' ? 100 : step === 'UPLOADING' ? pct : step === 'QUEUED' ? 100 : 50}%` }}
            />
          </div>
          {step === 'READY' && videoId && <p className="text-xs text-emerald-600">พร้อมรับชม — video {videoId.slice(0, 8)}…</p>}
          {step === 'FAILED' && error && (
            <div role="alert" className="flex items-center justify-between text-xs text-red-500">
              <span>{error}</span>
              <button onClick={() => inputRef.current?.click()} className="font-bold underline">
                เลือกไฟล์ใหม่
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default VideoUploaderStudio;
