// SSOT Phase 068 Task 4 — Resumable chunked download worker (§BDD-1)
// Canonical: apps/frontend/workers/download-worker.ts
// (legacy src/frontend/workers/download-worker.ts)
// - Self-contained (no imports — worker bundle boundary): fetches ≤2MB
//   Range slices sequentially, AES-GCM encrypts in-worker, transfers the
//   ciphertext to the main thread (transferables, ≤2MB in flight, RAM safe).
// - PAUSE keeps the byte offset (resume via Range); CANCEL aborts.
// - Protocol in: { command, taskId, url, fromByte, chunkBytes, contentKeyB64 }
//   Protocol out: PROGRESS { downloadedBytes, speedBps } / CHUNK { iv,
//   buffer } / COMPLETE { downloadedBytes } / ERROR { message }.

const CHUNK = 2 * 1024 * 1024;

interface StartMessage {
  command: 'START' | 'RESUME';
  taskId: string;
  url: string;
  fromByte: number;
  totalBytes: number;
  chunkBytes?: number;
  contentKeyB64: string;
}

type InMessage = StartMessage | { command: 'PAUSE' | 'CANCEL'; taskId: string };

let paused = false;
let cancelled = false;
let activeTask: string | null = null;

async function importKey(b64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
}

async function run(msg: StartMessage): Promise<void> {
  const chunkBytes = Math.min(msg.chunkBytes ?? CHUNK, CHUNK);
  const key = await importKey(msg.contentKeyB64);
  let downloaded = Math.max(0, msg.fromByte);
  const startedAt = Date.now();
  activeTask = msg.taskId;

  while (downloaded < msg.totalBytes) {
    if (cancelled || paused || activeTask !== msg.taskId) return;
    const end = Math.min(downloaded + chunkBytes - 1, msg.totalBytes - 1);
    let res: Response;
    try {
      res = await fetch(msg.url, { headers: { Range: `bytes=${downloaded}-${end}` } });
    } catch (e) {
      postMessage({ type: 'ERROR', taskId: msg.taskId, message: e instanceof Error ? e.message : 'network failed' });
      return;
    }
    if (res.status !== 206 && res.status !== 200) {
      postMessage({ type: 'ERROR', taskId: msg.taskId, message: `unexpected status ${res.status}` });
      return;
    }
    const plainFull = await res.arrayBuffer();
    // Server ignored Range (200): only usable on a fresh start; otherwise
    // the offset cannot advance — fail fast so the UI can retry/fallback.
    if (res.status === 200 && downloaded > 0) {
      postMessage({ type: 'ERROR', taskId: msg.taskId, message: 'range requests unsupported' });
      return;
    }
    const plain = plainFull;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    let cipher: ArrayBuffer;
    try {
      cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    } catch (e) {
      postMessage({ type: 'ERROR', taskId: msg.taskId, message: e instanceof Error ? e.message : 'encrypt failed' });
      return;
    }
    downloaded += plain.byteLength;
    const elapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000);
    postMessage(
      {
        type: 'CHUNK',
        taskId: msg.taskId,
        iv: iv.buffer,
        buffer: cipher,
        downloadedBytes: downloaded,
        speedBps: Math.round(downloaded / elapsedSec),
      },
      { transfer: [iv.buffer, cipher] },
    );
  }
  activeTask = null;
  postMessage({ type: 'COMPLETE', taskId: msg.taskId, downloadedBytes: downloaded });
}

onmessage = (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  if (msg.command === 'PAUSE') {
    paused = true;
    activeTask = null;
    return;
  }
  if (msg.command === 'CANCEL') {
    cancelled = true;
    paused = false;
    activeTask = null;
    return;
  }
  paused = false;
  cancelled = false;
  if (msg.command !== 'START' && msg.command !== 'RESUME') return;
  void run(msg).catch((err: unknown) =>
    postMessage({ type: 'ERROR', taskId: msg.taskId, message: err instanceof Error ? err.message : 'worker failed' }),
  );
};

export {};
