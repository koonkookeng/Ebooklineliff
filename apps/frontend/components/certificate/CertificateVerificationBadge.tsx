// SSOT Phase 048 — CertificateVerificationBadge (Inline verification status indicator)
// Canonical: apps/frontend/components/certificate/CertificateVerificationBadge.tsx
// (legacy src/frontend/components/certificate/CertificateVerificationBadge.tsx)
// - Small badge showing verification status (valid/invalid/pending/revoked/expired).
// - Used in certificate lists, course cards, profile pages.
// - Zero new deps (text glyphs only; lucide-react is NOT a dependency).
'use client';

export type CertificateBadgeStatus = 'valid' | 'invalid' | 'pending' | 'revoked' | 'expired';

interface CertificateVerificationBadgeProps {
  status: CertificateBadgeStatus;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
  /** Optional full verification payload flag (mirrors VerifyCertificateResponse.isValid). */
  isValid?: boolean;
}

const sizeClasses = {
  sm: 'h-4 w-4 text-[10px] px-1.5 py-0.5',
  md: 'h-5 w-5 text-xs px-2 py-1',
  lg: 'h-6 w-6 text-sm px-2.5 py-1',
};

const statusConfig = {
  valid: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: '✓', label: 'Valid' },
  invalid: { bg: 'bg-red-500/20', text: 'text-red-400', icon: '✕', label: 'Invalid' },
  pending: { bg: 'bg-amber-500/20', text: 'text-amber-400', icon: '⟳', label: 'Pending' },
  revoked: { bg: 'bg-red-500/20', text: 'text-red-400', icon: '✕', label: 'Revoked' },
  expired: { bg: 'bg-amber-500/20', text: 'text-amber-400', icon: '⏱', label: 'Expired' },
};

export function CertificateVerificationBadge({
  status,
  size = 'md',
  showLabel = true,
  className = '',
  isValid,
}: CertificateVerificationBadgeProps) {
  // isValid (VerifyCertificateResponse.isValid) takes precedence when provided.
  const resolved: CertificateBadgeStatus = isValid === true ? 'valid' : isValid === false ? 'invalid' : status;
  const config = statusConfig[resolved];
  const sizes = sizeClasses[size];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${config.bg} ${config.text} ${sizes} ${className}`}
      title={config.label}
    >
      <span className="flex h-full w-full items-center justify-center">{config.icon}</span>
      {showLabel && <span className="font-medium">{config.label}</span>}
    </span>
  );
}

export default CertificateVerificationBadge;