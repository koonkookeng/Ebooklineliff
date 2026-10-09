// SSOT Phase 085 §6.1 — Canvas KYC watermarker + <2MB compressor (dep-free)
// Canonical: apps/frontend/lib/kyc/kyc-watermark.ts
// - Draws the red purpose-bound watermark (§6.1 text), downscales to ≤1600px
//   and JPEG-compresses under 2MB (LIFF RAM <30MB, Gate 5). Pure canvas.
// - Zero-dep (browser APIs only).
export async function applyKycWatermark(
  file: File,
  tenantName: string,
  userIdHash: string,
): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.src = dataUrl;
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('unreadable image'));
  });
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(img.width * scale));
  canvas.height = Math.max(1, Math.floor(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get 2d context');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const watermarkText = `ใช้สำหรับยืนยันตัวตน CREATOR บน ${tenantName} เท่านั้น (${userIdHash}) ${new Date().toISOString().slice(0, 10)}`;
  ctx.font = `bold ${Math.max(12, Math.floor(canvas.width / 25))}px sans-serif`;
  ctx.fillStyle = 'rgba(239, 68, 68, 0.45)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((-25 * Math.PI) / 180);
  ctx.fillText(watermarkText, 0, 0);
  ctx.fillText(watermarkText, 0, -canvas.height / 4);
  ctx.fillText(watermarkText, 0, canvas.height / 4);
  ctx.restore();

  let quality = 0.85;
  for (let i = 0; i < 4; i++) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Blob creation failed');
    if (blob.size < 2 * 1024 * 1024 || quality <= 0.4) return blob;
    quality -= 0.15;
  }
  const fallback = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.4));
  if (!fallback) throw new Error('Blob creation failed');
  return fallback;
}

/** Short hash for the watermark tag (FNV-1a, non-crypto display tag). */
export function shortUserHash(userId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).toUpperCase();
}
