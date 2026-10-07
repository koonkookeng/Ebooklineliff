// SSOT Phase 043 §8.2 — Watermark burn-in filter builder (pure)
// Canonical: apps/backend/src/jobs/transcoder/watermark-injector.ts
// (legacy src/backend/jobs/transcoder/watermark-injector.ts)
// - Builds the FFmpeg drawtext filter that burns the viewer identity into
//   rendition frames (complements the client floating overlay for downloads).
//   Shell/FFmpeg-escaped, length-capped. The binary never runs in tests.
// - Pure + tsx-safe. Zero new deps.
export function buildWatermarkFilter(displayText: string): string {
  const safe = displayText
    .replace(/\\/g, '\\\\')
    .replace(/'/g, `\\'`)
    .replace(/:/g, '\\:')
    .slice(0, 80);
  return `drawtext=text='${safe}':fontsize=14:fontcolor=white@0.25:x=w*mod(t\\,60)/60:y=h*mod(t\\,45)/45`;
}
