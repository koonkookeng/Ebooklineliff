// SSOT Phase 014 §2.1 — Client-side slip compression (≤300KB, RAM < 20MB)
// Canonical: apps/frontend/lib/slip-image.ts
// Downscales to maxDim then JPEG-steps quality until under budget (or floor).
// Releases every object URL / canvas synchronously — no LIFF webview leaks.
import { SLIP_CLIENT_MAX_KB } from '@repo/shared';

export interface CompressedSlip {
  /** Raw base64 (no data: prefix) ready for the upload API. */
  dataBase64: string;
  fileSizeKb: number;
  mimeType: string;
  width: number;
  height: number;
}

function loadBitmap(file: File): Promise<{ bmp: ImageBitmap | HTMLImageElement; w: number; h: number }> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).then((bmp) => ({ bmp, w: bmp.width, h: bmp.height }));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ bmp: img, w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unreadable image'));
    };
    img.src = url;
  });
}

/** Compresses a slip photo to JPEG ≤ maxKb (default 300). Throws on unreadable input. */
export async function compressSlipImage(file: File, maxKb = SLIP_CLIENT_MAX_KB, maxDim = 1280): Promise<CompressedSlip> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    throw new Error('กรุณาเลือกไฟล์ภาพ PNG, JPEG หรือ WebP');
  }
  const { bmp, w, h } = await loadBitmap(file).catch(() => {
    throw new Error('อ่านไฟล์ภาพไม่สำเร็จ');
  });
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    if (bmp instanceof ImageBitmap) bmp.close();
    throw new Error('Canvas ไม่พร้อมใช้งาน');
  }
  ctx.drawImage(bmp, 0, 0, width, height);
  if (bmp instanceof ImageBitmap) bmp.close();

  const shot = (quality: number): Promise<Blob | null> =>
    new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  let quality = 0.85;
  let blob = await shot(quality);
  while (blob && blob.size / 1024 > maxKb && quality > 0.35) {
    quality -= 0.1;
    blob = await shot(quality);
  }
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('บีบอัดภาพไม่สำเร็จ');
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  const fileSizeKb = Math.round((blob.size / 1024) * 100) / 100;
  return { dataBase64: btoa(binary), fileSizeKb, mimeType: 'image/jpeg', width, height };
}
