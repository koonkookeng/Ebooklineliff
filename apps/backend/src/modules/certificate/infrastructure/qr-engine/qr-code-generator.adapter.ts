// SSOT Phase 048 §5.2 — QR Code Generator Adapter (lazy qrcode dep + fallback)
// Canonical: apps/backend/src/modules/certificate/infrastructure/qr-engine/qr-code-generator.adapter.ts
// (legacy src/backend/modules/certificate/infrastructure/qr-engine/qr-code-generator.adapter.ts)
// - Generates QR code Data URL / SVG for the verification URL.
// - 'qrcode' is a prod-only dep: lazy-required at call time so unit tests and
//   tsx contract checks stay dependency-free. When unavailable, returns a
//   deterministic SVG placeholder data URL (never throws at import time).
// - Zero new deps.
import { Injectable } from '@nestjs/common';

export interface QrCodeGeneratorPort {
  toDataUrl(
    text: string,
    options?: { width?: number; margin?: number; color?: { dark: string; light: string } },
  ): Promise<string>;
  toSvg(
    text: string,
    options?: { width?: number; margin?: number; color?: { dark: string; light: string } },
  ): Promise<string>;
}

@Injectable()
export class QrCodeGeneratorAdapter implements QrCodeGeneratorPort {
  async toDataUrl(
    text: string,
    options?: { width?: number; margin?: number; color?: { dark: string; light: string } },
  ): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const qrcode = require('qrcode');
      return await qrcode.toDataURL(text, {
        width: options?.width || 256,
        margin: options?.margin ?? 1,
        color: {
          dark: options?.color?.dark || '#000000',
          light: options?.color?.light || '#ffffff',
        },
        errorCorrectionLevel: 'M',
      });
    } catch {
      return `data:image/svg+xml;base64,${Buffer.from(this.placeholderSvg(text)).toString('base64')}`;
    }
  }

  async toSvg(
    text: string,
    options?: { width?: number; margin?: number; color?: { dark: string; light: string } },
  ): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const qrcode = require('qrcode');
      return await qrcode.toString(text, {
        type: 'svg',
        width: options?.width || 256,
        margin: options?.margin ?? 1,
        color: {
          dark: options?.color?.dark || '#000000',
          light: options?.color?.light || '#ffffff',
        },
        errorCorrectionLevel: 'M',
      });
    } catch {
      return this.placeholderSvg(text);
    }
  }

  private placeholderSvg(text: string): string {
    const label = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#fff"/><text x="128" y="128" font-size="10" text-anchor="middle" fill="#000">${label}</text></svg>`;
  }
}
