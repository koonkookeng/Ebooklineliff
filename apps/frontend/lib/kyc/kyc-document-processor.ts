// SSOT Phase 111 §6.1 — LIFF KYC document image pipeline (dep-free)
// Canonical: apps/frontend/lib/kyc/kyc-document-processor.ts
// - Spec-verbatim: resize ≤1920x1080, dynamic diagonal watermark
//   ("ใช้เพื่อยืนยันตัวตนบนแพลตฟอร์มเท่านั้น"), WebP quality 0.85,
//   RAM <30MB (single canvas, immediate URL.revokeObjectURL).
// - 085 kyc-watermark.ts (JPEG ≤1600px presigned-PUT lane) stays untouched;
//   this module serves the 111 base64-submission lane (KycSubmissionInput).
// - Browser APIs only. Zero new deps.

/** 111 §6.1 budgets. */
export const KYC_DOC_MAX_WIDTH = 1920;
export const KYC_DOC_MAX_HEIGHT = 1080;
export const KYC_DOC_WEBP_QUALITY = 0.85;
export const KYC_DOC_WATERMARK = 'ใช้เพื่อยืนยันตัวตนบนแพลตฟอร์มเท่านั้น';

/**
 * Memory-optimized client-side image watermark + compressor for KYC.
 * Resolves a WebP Blob (<500KB typical); revokes the object URL on
 * every path so the LINE webview stays under the 30MB guard (Gate 5).
 */
export async function processKycDocumentImage(file: File, watermarkText: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = KYC_DOC_MAX_WIDTH;
        const MAX_HEIGHT = KYC_DOC_MAX_HEIGHT;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
          if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
        }

        canvas.width = Math.max(1, Math.floor(width));
        canvas.height = Math.max(1, Math.floor(height));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(img.src);
          reject(new Error('Canvas Context Unavailable'));
          return;
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Render Dynamic Security Watermark Overlay
        ctx.font = 'bold 24px Arial';
        ctx.fillStyle = 'rgba(255, 0, 0, 0.35)';
        ctx.textAlign = 'center';
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((-30 * Math.PI) / 180);
        ctx.fillText(watermarkText, 0, 0);

        canvas.toBlob((blob) => {
          URL.revokeObjectURL(img.src);
          // Release raster memory immediately (Gate 5).
          canvas.width = 1;
          canvas.height = 1;
          if (blob) resolve(blob);
          else reject(new Error('Blob Conversion Failed'));
        }, 'image/webp', KYC_DOC_WEBP_QUALITY);
      } catch (err) {
        URL.revokeObjectURL(img.src);
        reject(err);
      }
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(img.src);
      reject(err);
    };
  });
}

/** Blob → base64 data-URL for the 111 KycSubmissionInput image fields. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  // eslint-disable-next-line no-undef
  return `data:${blob.type || 'image/webp'};base64,${btoa(binary)}`;
}

/** Full 111 lane: watermark + compress + base64 in one call. */
export async function processKycDocumentToBase64(file: File, watermarkText: string = KYC_DOC_WATERMARK): Promise<string> {
  const blob = await processKycDocumentImage(file, `${watermarkText} [${new Date().toISOString().slice(0, 10)}]`);
  return blobToBase64(blob);
}
