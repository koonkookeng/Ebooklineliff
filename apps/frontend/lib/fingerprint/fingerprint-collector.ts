// SSOT Phase 119 Task 3 §6.1 — LIFF fingerprint collector engine
// Canonical: apps/frontend/lib/fingerprint/fingerprint-collector.ts
// (legacy src/frontend/lib/fingerprint/fingerprint-collector.ts)
// - Spec-verbatim collection: 200×50 canvasTag render → SHA-256,
//   WebGL vendor/renderer (or NO_WEBGL) → SHA-256, AudioContext triangle
//   10kHz fingerprint (or NO_AUDIO_CTX) → SHA-256, combined
//   canvas:webgl:audio:ua:resolution → SHA-256 via WebCrypto.
// - Budgets (§2.1/§10): <35ms CPU, single 200×50 canvas, immediate context
//   release, no retained bitmaps (Gate 5 <30MB).
// - Browser APIs only. Zero new deps.
export interface DeviceSignature {
  fingerprintHash: string;
  canvasHash: string;
  webglHash: string;
  audioHash: string;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Pure combine (mirrors the server canonical; testable without DOM). */
export function combineFingerprintHash(args: {
  canvasHash: string;
  webglHash: string;
  audioHash: string;
  userAgent: string;
  screenResolution: string;
  lineUserIdHash?: string;
}): Promise<string> {
  const combined = `${args.canvasHash}:${args.webglHash}:${args.audioHash}:${args.userAgent}:${args.screenResolution}:${args.lineUserIdHash ?? ''}`;
  return sha256Hex(combined);
}

export async function collectDeviceFingerprint(lineUserIdHash?: string): Promise<DeviceSignature> {
  // 1. Canvas fingerprinting (single small canvas, released immediately).
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 50;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('ZENE-DRM-SECURITY-119-#144XZ', 2, 15);
  }
  const canvasData = canvas.toDataURL();
  const canvasHash = await sha256Hex(canvasData);

  // 2. WebGL fingerprinting.
  let webglString = '';
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (gl && gl instanceof WebGLRenderingContext) {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      webglString = `${gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)}~${gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)}`;
    }
  }
  const webglHash = await sha256Hex(webglString || 'NO_WEBGL');

  // 3. AudioContext fingerprinting.
  let audioString = '';
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtx();
    const oscillator = audioCtx.createOscillator();
    const compressor = audioCtx.createDynamicsCompressor();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(10000, audioCtx.currentTime);
    oscillator.connect(compressor);
    compressor.connect(audioCtx.destination);
    audioString = `${audioCtx.sampleRate}_${(compressor.reduction as unknown as { value?: number })?.value ?? 0}`;
    await audioCtx.close();
  } catch {
    audioString = 'NO_AUDIO_CTX';
  }
  const audioHash = await sha256Hex(audioString);

  const userAgent = navigator.userAgent;
  const screenResolution = `${screen.width}x${screen.height}`;
  const fingerprintHash = await combineFingerprintHash({ canvasHash, webglHash, audioHash, userAgent, screenResolution, ...(lineUserIdHash ? { lineUserIdHash } : {}) });
  return { fingerprintHash, canvasHash, webglHash, audioHash };
}
