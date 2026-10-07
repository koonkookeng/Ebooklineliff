// SSOT Phase 044 Task 8 — VideoUploadProgress (studio stepper, §2.2)
// Canonical: apps/frontend/components/creator/video-upload-progress.tsx
// (legacy src/frontend/components/creator/video-upload-progress.tsx)
// - 5 states: INIT (dropzone brief) → IDLE (picked + validated, metadata +
//   start button) → UPLOADING_PROCESSING (phase bars: upload/transcode/R2
//   polled every 2s) → SUCCESS (COMPLETED + HLS preview + quality select) /
//   ERROR (reason + retry).
// - Complements VideoUploaderStudio (direct R2 parts): this component drives
//   the lesson transcode-job ledger end to end.
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TRANSCODE_POLL_MS, TRANSCODE_STAGE_WEIGHTS } from '@repo/shared';
import { HlsVideoPlayer } from '../stream/HlsVideoPlayer';

export type UploadProgressState = 'INIT' | 'IDLE' | 'UPLOADING_PROCESSING' | 'SUCCESS' | 'ERROR';

interface VideoUploadProgressProps {
  lessonId: string;
  rawR2Key: string;
  autoStart?: boolean;
}

interface JobStatus {
  jobId: string;
  status: string;
  progressPercentage: number;
  masterPlaylistUrl: string | null;
  errorMessage: string | null;
}

const ACCEPTED = ['video/mp4', 'video/quicktime', 'video/x-matroska'];
const MAX_BYTES = 10 * 1024 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function VideoUploadProgress({ lessonId, rawR2Key, autoStart = false }: VideoUploadProgressProps) {
  const [state, setState] = useState<UploadProgressState>('INIT');
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setState((prev) => (prev === 'INIT' ? 'IDLE' : prev));
    }, 0);
    return () => {
      clearTimeout(t);
      stopPolling();
    };
  }, [stopPolling]);

  const pickFile = useCallback((picked: File | null) => {
    setFile(picked);
    setValidation(null);
    if (!picked) return;
    if (!ACCEPTED.includes(picked.type)) {
      setValidation('รองรับเฉพาะ MP4 / MOV / MKV');
      return;
    }
    if (picked.size > MAX_BYTES) {
      setValidation(`ไฟล์ใหญ่เกิน 10GB (${formatBytes(picked.size)})`);
      return;
    }
    setState('IDLE');
  }, []);

  const pollJob = useCallback(
    (jobId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/v1/stream/transcode/${encodeURIComponent(jobId)}`);
          if (!res.ok) return;
          const row = (await res.json()) as JobStatus;
          setJob(row);
          if (row.status === 'COMPLETED') {
            stopPolling();
            setState('SUCCESS');
          } else if (row.status === 'FAILED') {
            stopPolling();
            setError(row.errorMessage ?? 'Transcode failed');
            setState('ERROR');
          }
        } catch {
          // Polling best-effort; stepper keeps last known progress.
        }
      }, TRANSCODE_POLL_MS);
    },
    [stopPolling],
  );

  const start = useCallback(async () => {
    if (!file) return;
    setError(null);
    setState('UPLOADING_PROCESSING');
    try {
      const res = await fetch('/api/v1/stream/transcode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          originalFileName: file.name,
          fileSizeBytes: file.size,
          durationSeconds: 0,
          rawR2Key,
        }),
      });
      if (!res.ok) throw new Error(`submit ${res.status}`);
      const data = (await res.json()) as { jobId: string };
      setJob({ jobId: data.jobId, status: 'QUEUED', progressPercentage: 0, masterPlaylistUrl: null, errorMessage: null });
      pollJob(data.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
      setState('ERROR');
    }
  }, [file, lessonId, rawR2Key, pollJob]);

  useEffect(() => {
    if (autoStart && state === 'IDLE' && file && !validation) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, state]);

  const uploadPct = TRANSCODE_STAGE_WEIGHTS.upload;
  const transcodePct = job ? Math.round((job.progressPercentage * TRANSCODE_STAGE_WEIGHTS.transcode) / 100) : 0;

  return (
    <section aria-label="Video transcode progress" className="w-full max-w-2xl space-y-4">
      {(state === 'INIT' || state === 'IDLE') && (
        <div
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') inputRef.current?.click();
          }}
          aria-label="Select an MP4 or MOV lesson video"
          className="cursor-pointer rounded-xl border-2 border-dashed border-border bg-card px-6 py-10 text-center"
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(',')}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-sm font-medium">เลือกไฟล์วิดีโอบทเรียน (MP4/MOV, สูงสุด 10GB)</p>
          {file && (
            <p className="mt-2 text-xs text-muted-foreground">
              {file.name} · {formatBytes(file.size)}
            </p>
          )}
          {validation && (
            <p role="alert" className="mt-2 text-xs text-red-500">
              {validation}
            </p>
          )}
          {file && !validation && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void start();
              }}
              className="mt-4 rounded-full bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              เริ่มอัปโหลดและประมวลผล
            </button>
          )}
        </div>
      )}

      {state === 'UPLOADING_PROCESSING' && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4" aria-busy>
          {[
            { label: 'Upload', pct: uploadPct },
            { label: 'Transcode 1080p/720p/480p/360p', pct: transcodePct },
            { label: 'R2 Sync', pct: job && job.progressPercentage >= 70 ? TRANSCODE_STAGE_WEIGHTS.r2sync : 0 },
          ].map((phase) => (
            <div key={phase.label} className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{phase.label}</span>
                <span className="font-mono">{phase.pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={phase.pct} aria-valuemin={0} aria-valuemax={100} aria-label={phase.label}>
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, phase.pct)}%` }} />
              </div>
            </div>
          ))}
          <p className="font-mono text-[11px] text-muted-foreground">job {job?.jobId.slice(0, 8)}… · {job?.status}</p>
        </div>
      )}

      {state === 'SUCCESS' && job?.masterPlaylistUrl && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-emerald-600">พร้อมรับชม — HLS multi-quality</p>
          <HlsVideoPlayer
            masterManifestUrl={job.masterPlaylistUrl}
            securityToken=""
            watermarkText="PREVIEW"
            onProgressSync={() => undefined}
          />
        </div>
      )}

      {state === 'ERROR' && (
        <div role="alert" className="flex items-center justify-between rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
          <span className="text-red-500">{error ?? 'ประมวลผลล้มเหลว'}</span>
          <button onClick={() => void start()} className="font-bold text-red-500 underline">
            ลองใหม่อีกครั้ง
          </button>
        </div>
      )}
    </section>
  );
}

export default VideoUploadProgress;
