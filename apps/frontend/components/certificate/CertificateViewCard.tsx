// SSOT Phase 048 — CertificateViewCard (Preview card for earned certificates)
// Canonical: apps/frontend/components/certificate/CertificateViewCard.tsx
// (legacy src/frontend/components/certificate/CertificateViewCard.tsx)
// - Displays certificate preview with QR code, download button, share.
// - Tenant theming via CSS variables.
// - Zero new deps (inline SVG glyphs; lucide-react is NOT a dependency).
'use client';

import type { CertificateItem } from '@repo/shared';

function glyphProps(className?: string) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    'aria-hidden': true,
  } as const;
}

function AwardGlyph({ className }: { className?: string }) {
  return (
    <svg {...glyphProps(className)}>
      <circle cx="12" cy="8" r="6" />
      <path d="M15.5 13 17 22l-5-3-5 3 1.5-9" />
    </svg>
  );
}

function DownloadGlyph({ className }: { className?: string }) {
  return (
    <svg {...glyphProps(className)}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ShareGlyph({ className }: { className?: string }) {
  return (
    <svg {...glyphProps(className)}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
    </svg>
  );
}

function ExternalGlyph({ className }: { className?: string }) {
  return (
    <svg {...glyphProps(className)}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

interface CertificateViewCardProps {
  cert: CertificateItem;
  onDownload?: (url: string) => void;
  onShare?: (cert: CertificateItem) => void;
}

export function CertificateViewCard({ cert, onDownload, onShare }: CertificateViewCardProps) {
  return (
    <div className="relative group rounded-2xl border border-emerald-500/30 bg-slate-900/50 p-4 shadow-xl transition-all hover:shadow-emerald-500/20 hover:border-emerald-500/50">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
          <AwardGlyph className="h-5 w-5 text-emerald-400" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Verified Certificate</p>
          <p className="text-[11px] text-slate-500">{cert.certificateNo}</p>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">หลักสูตร</span>
          <span className="font-medium text-white truncate max-w-[60%]">{cert.courseTitle}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">วันที่ออก</span>
          <span className="font-medium text-white">{new Date(cert.issuedAt).toLocaleDateString('th-TH')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">รหัส</span>
          <span className="font-mono text-xs text-slate-300">{cert.certificateNo}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-800">
        <img
          src={cert.qrCodeUrl}
          alt="Verification QR"
          className="h-16 w-16 rounded bg-white p-1"
        />
        <div className="flex-1 text-right space-y-1">
          <p className="text-[10px] text-slate-500">Scan to verify</p>
          <p className="font-mono text-[10px] text-emerald-400">Verified Authentic</p>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => (onDownload ? onDownload(cert.pdfUrl) : cert.pdfUrl && window.open(cert.pdfUrl, '_blank'))}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
        >
          <DownloadGlyph className="h-3.5 w-3.5" />
          <span>Download PDF</span>
        </button>
        <button
          onClick={() => onShare?.(cert)}
          className="rounded-full border border-white/20 p-2 text-white hover:bg-white/5 transition-colors"
          aria-label="Share certificate"
        >
          <ShareGlyph className="h-5 w-5" />
        </button>
        <a href={cert.pdfUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-white/20 p-2 text-white hover:bg-white/5 transition-colors" aria-label="Open in new tab">
          <ExternalGlyph className="h-5 w-5" />
        </a>
      </div>
    </div>
  );
}

export default CertificateViewCard;