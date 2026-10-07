// SSOT Phase 043 Task 2 — Video event router (R2 ObjectCreated → dispatch)
// Canonical: apps/backend/src/edge/cloudflare-workers/video-event-router.ts
// (spec src/workers/cloudflare/video-event-router.ts → repo edge-worker home,
// Phase 053 hls-auth-gatekeeper precedent)
// - Queue consumer over R2 event notifications: raw-videos/* PutObject →
//   signed VIDEO_RAW_UPLOADED webhook to the NestJS transcode intake
//   (<200ms dispatch budget, BDD-1).
// - Retry without loss: a failed POST is rethrown so the queue redelivers
//   (§10 KV-holdback is a platform binding, documented in ADR-043).
// - Zero deps, platform types structural (no @cloudflare/workers-types).
export interface VideoWorkerEnv {
  VIDEO_WEBHOOK_URL: string;
  WORKER_AUTH_SECRET: string;
}

interface R2EventBody {
  action?: string;
  object?: { key?: string; size?: number };
}

interface QueueMessage {
  body: R2EventBody;
}

interface MessageBatch {
  messages: QueueMessage[];
}

/** Pure predicate — unit-tested without the worker runtime. */
export function isRawVideoUpload(body: R2EventBody): string | null {
  if (body.action !== 'PutObject') return null;
  const key = body.object?.key;
  if (typeof key !== 'string' || !key.startsWith('raw-videos/')) return null;
  return key;
}

export function workerEventPayload(r2Key: string, size: number, timestamp: string): Record<string, unknown> {
  return { event: 'VIDEO_RAW_UPLOADED', r2Key, size, timestamp };
}

export default {
  async queue(batch: MessageBatch, env: VideoWorkerEnv): Promise<void> {
    for (const message of batch.messages) {
      const key = isRawVideoUpload(message.body);
      if (!key) continue;
      const size = typeof message.body.object?.size === 'number' ? message.body.object.size : 0;
      const res = await fetch(env.VIDEO_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': env.WORKER_AUTH_SECRET },
        body: JSON.stringify(workerEventPayload(key, size, new Date().toISOString())),
      });
      if (!res.ok) throw new Error(`dispatch failed (${res.status}) for ${key}`);
    }
  },
};
