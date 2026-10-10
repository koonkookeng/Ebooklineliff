// SSOT Phase 110 §6 — inspector client (fetch wrappers + heat scale)
// Canonical: apps/frontend/lib/inspector.ts
// - Zero new deps.
export interface RFMScore {
  recencyScore: number;
  frequencyScore: number;
  monetaryScore: number;
  segmentLabel: string;
}

export interface InspectorProfile {
  userId: string;
  displayName: string;
  email: string | null;
  lineUserId: string | null;
  walletBalance: number;
  rewardPoints: number;
  lifetimeValueAmount: number;
  totalOrdersCount: number;
  rfmScore: RFMScore;
  riskLevel: string;
  recentReadingLogs: Array<{ ebookId: string; bookTitle: string; pageNumber: number; dwellTimeSeconds: number; timestamp: string }>;
  recentLearningLogs: Array<{ courseId: string; lessonId: string; lessonTitle: string; watchedDurationSec: number; completionPercentage: number; timestamp: string }>;
  recentSecurityLogs: Array<{ id: string; activityType: string; ipAddress: string; userAgent: string; deviceFingerprint: string | null; lineSessionId: string | null; riskLevel: string; createdAt: string }>;
  createdAt: string;
}

export interface HeatCell {
  pageNumber: number;
  totalDwellTimeSec: number;
  readCount: number;
  lastReadAt: string;
}

export interface VideoAnalytics {
  courseId: string;
  totalWatchedSeconds: number;
  overallCompletionPercentage: number;
  lessonBreakdown: Array<{ lessonId: string; lessonTitle: string; watchedSec: number; durationSec: number; isCompleted: boolean; completionPercentage?: number }>;
}

/** CSS heat intensity 0..1 (dwell-normalized, Phase 052 bar precedent). */
export function heatIntensity(dwellSec: number, peakSec: number): number {
  if (peakSec <= 0) return 0;
  return Math.min(1, dwellSec / peakSec);
}

export function heatColor(t: number): string {
  if (t >= 0.66) return 'bg-red-500';
  if (t >= 0.33) return 'bg-amber-400';
  return 'bg-emerald-500';
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `Inspector request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function fetchInspectorProfile(userId: string): Promise<InspectorProfile> {
  const res = await fetch(`/api/inspector/profile/${encodeURIComponent(userId)}`, { credentials: 'include' });
  return json(res);
}

export async function fetchReadingHeatmap(userId: string, ebookId: string): Promise<{ cells: HeatCell[]; bookTitle: string }> {
  const res = await fetch(`/api/inspector/heatmap/${encodeURIComponent(userId)}/${encodeURIComponent(ebookId)}`, { credentials: 'include' });
  return json(res);
}

export async function fetchVideoAnalytics(userId: string, courseId: string): Promise<VideoAnalytics> {
  const res = await fetch(`/api/inspector/video/${encodeURIComponent(userId)}/${encodeURIComponent(courseId)}`, { credentials: 'include' });
  return json(res);
}

export async function fetchSecurityLogs(userId: string, limit = 20, offset = 0): Promise<{ logs: InspectorProfile['recentSecurityLogs']; total: number }> {
  const res = await fetch(`/api/inspector/security/${encodeURIComponent(userId)}?limit=${limit}&offset=${offset}`, { credentials: 'include' });
  return json(res);
}

export async function revokeInspectorSessions(userId: string, reason: string): Promise<{ revokedSessionsCount: number }> {
  const res = await fetch(`/api/inspector/revoke/${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ reason }),
  });
  return json(res);
}

export async function recalculateInspectorRfm(userId: string): Promise<RFMScore> {
  const res = await fetch(`/api/inspector/rfm/${encodeURIComponent(userId)}`, { method: 'POST', credentials: 'include' });
  return json(res);
}

export async function flagInspectorRisk(userId: string, riskLevel: string, note: string): Promise<{ updatedRiskLevel: string }> {
  const res = await fetch(`/api/inspector/risk/${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ riskLevel, note }),
  });
  return json(res);
}

export async function fetchAnomaly(userId: string): Promise<{ anomalous: boolean; state: string | null; distinctIps: string[] }> {
  const res = await fetch(`/api/inspector/anomaly/${encodeURIComponent(userId)}`, { credentials: 'include' });
  return json(res);
}

export function formatTHB(n: number): string {
  return `฿${Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
