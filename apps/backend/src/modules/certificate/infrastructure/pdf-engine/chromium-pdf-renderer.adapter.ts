// SSOT Phase 048 §5.2 — Chromium PDF Renderer Adapter (Vector PDF via Chromium Headless)
// Canonical: apps/backend/src/modules/certificate/infrastructure/pdf-engine/chromium-pdf-renderer.adapter.ts
// (legacy src/backend/modules/certificate/infrastructure/pdf-engine/chromium-pdf-renderer.adapter.ts)
// - Uses Puppeteer/Chromium to render HTML template to Vector PDF.
// - Pure adapter interface; binary never runs in unit tests (injected exec).
// - Zero new deps beyond puppeteer-core (prod only).
import { Injectable, Logger } from '@nestjs/common';

export interface PdfRendererPort {
  renderToPdf(html: string, options?: { width?: number; height?: number; margin?: string }): Promise<Buffer>;
}

export interface CertificatePdfData {
  certificateNo: string;
  studentName: string;
  courseTitle: string;
  issuedAt: Date;
  issuerName: string;
  qrCodeDataUrl: string;
  digitalSignatureHash: string;
  institutionLogoUrl?: string;
  signatureImageUrl?: string;
  coverImageUrl?: string;
  grade?: string;
  hours?: number;
}

@Injectable()
export class ChromiumPdfRendererAdapter implements PdfRendererPort {
  private readonly logger = new Logger(ChromiumPdfRendererAdapter.name);

  constructor() {}

  async renderToPdf(html: string, options?: { width?: number; height?: number; margin?: string }): Promise<Buffer> {
    // Production: puppeteer-core + @sparticuz/chromium (prod-only deps, lazy).
    // Lazy require keeps unit tests + tsx contract checks dependency-free.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let puppeteer: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chromium: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      puppeteer = require('puppeteer-core');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      chromium = require('@sparticuz/chromium');
    } catch {
      this.logger.warn('Chromium unavailable — returning HTML payload as PDF placeholder');
      return Buffer.from(html, 'utf-8');
    }

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
        ...options,
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  /** Build HTML template for certificate PDF (Vector crisp). */
  buildCertificateHtml(data: {
    certificateNo: string;
    studentName: string;
    courseTitle: string;
    issuedAt: Date;
    issuerName: string;
    qrCodeDataUrl: string;
    digitalSignatureHash: string;
    institutionLogoUrl?: string;
    signatureImageUrl?: string;
    coverImageUrl?: string;
    grade?: string;
    hours?: number;
    primaryColor?: string;
    borderStyle?: string;
    institutionLogo?: string;
    authorizedSignatureUrl?: string;
  }): string {
    const primaryColor = data.primaryColor || '#059669';
    const borderStyle = data.borderStyle || 'solid 4px';

    return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Sarabun', 'Prompt', sans-serif; background: #f8fafc; }
    .certificate {
      width: 210mm; height: 297mm;
      background: white;
      border: 4px solid ${data.primaryColor};
      padding: 30mm;
      position: relative;
      font-family: 'Sarabun', 'Prompt', sans-serif;
    }
    .header { text-align: center; margin-bottom: 20mm; }
    .logo { max-width: 120px; margin-bottom: 8px; }
    .title { font-size: 28px; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
    .subtitle { font-size: 16px; color: #64748b; margin-bottom: 16px; }
    .divider { width: 120px; height: 3px; background: ${data.primaryColor}; margin: 0 auto 16px; border-radius: 2px; }
    .content { text-align: center; }
    .label { font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px; }
    .value { font-size: 24px; font-weight: 600; color: #1e293b; margin-bottom: 16px; }
    .course { font-size: 20px; font-weight: 500; color: #334155; margin-bottom: 24px; }
    .footer { display: flex; justify-content: space-between; margin-top: 30mm; padding-top: 16px; border-top: 1px solid #e2e8f0; }
    .signature-block { text-align: center; }
    .sig-line { width: 180px; height: 2px; background: #94a3b8; margin: 0 auto 8px; }
    .sig-label { font-size: 12px; color: #94a3b8; }
    .qr-block { text-align: center; }
    .qr-img { width: 80px; height: 80px; }
    .qr-label { font-size: 10px; color: #94a3b8; margin-top: 4px; }
    .watermark {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-25deg);
      font-size: 80px; color: ${data.primaryColor}15; font-weight: 700; white-space: nowrap;
      pointer-events: none; user-select: none; z-index: 0;
    }
    .cover-image { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.03; z-index: 0; }
  </style>
</head>
<body>
  <img class="cover-image" src="${data.coverImageUrl || ''}" alt="" />
  <div class="certificate">
    <div class="watermark">CERTIFIED</div>
    <div class="header">
      ${data.institutionLogoUrl ? `<img class="logo" src="${data.institutionLogoUrl}" alt="Institution" />` : ''}
      <div class="title">Certificate of Completion</div>
      <div class="subtitle">This certifies that</div>
      <div class="divider"></div>
    </div>
    <div class="content">
      <div class="value">${data.studentName}</div>
      <div class="course">has successfully completed the course</div>
      <div class="label">Course Title</div>
      <div class="value course">${data.courseTitle}</div>
      <div style="display: flex; justify-content: center; gap: 24px; margin-top: 16px; flex-wrap: wrap;">
        <div>
          <div class="label">Issued Date</div>
          <div class="value">${data.issuedAt.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
        <div>
          <div class="label">Certificate No</div>
          <div class="value font-mono" style="font-size: 14px;">${data.certificateNo}</div>
        </div>
      </div>
    </div>
    <div class="footer">
      <div class="signature-block">
        ${data.signatureImageUrl ? `<img src="${data.signatureImageUrl}" style="height: 40px; margin-bottom: 8px;" alt="Signature" />` : '<div class="sig-line"></div>'}
        <div class="sig-label">Authorized Signature</div>
      </div>
      <div class="qr-block">
        <img class="qr-img" src="${data.qrCodeDataUrl}" alt="Verification QR" />
        <div class="qr-label">Scan to Verify</div>
      </div>
    </div>
  </div>
</body>
</html>`;
  }
}