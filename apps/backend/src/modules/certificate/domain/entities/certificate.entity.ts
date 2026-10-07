// SSOT Phase 048 §5.1 — Certificate entity (DDD entity with invariants)
// Canonical: apps/backend/src/modules/certificate/domain/entities/certificate.entity.ts
// (legacy src/backend/modules/certificate/domain/entities/certificate.entity.ts)
// - Encapsulates certificate invariants: status transitions, signature verification.
// - Pure + tsx-safe. Zero new deps.
import { DigitalSignature, buildHmacPayload, timingSafeEquals } from '../value-objects/digital-signature.vo';

export type CertificateStatus = 'ISSUED' | 'REVOKED' | 'EXPIRED';

export interface CertificateProps {
  id: string;
  certificateNo: string;
  userId: string;
  courseId: string;
  tenantId?: string;
  issuedAt: Date;
  pdfStoragePathR2: string;
  qrCodeUrl: string;
  digitalSignatureHash: string;
  status: CertificateStatus;
  metadataJson?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class Certificate {
  private constructor(readonly props: CertificateProps) {}

  static create(props: Omit<CertificateProps, 'id' | 'createdAt' | 'updatedAt' | 'issuedAt' | 'status'> & Partial<Pick<CertificateProps, 'issuedAt' | 'status'>>): Certificate {
    if (!props.certificateNo) throw new Error('Certificate number is required');
    if (!props.userId) throw new Error('User ID is required');
    if (!props.courseId) throw new Error('Course ID is required');
    if (!props.pdfStoragePathR2) throw new Error('PDF storage path is required');
    if (!props.qrCodeUrl) throw new Error('QR code URL is required');
    if (!props.digitalSignatureHash) throw new Error('Digital signature hash is required');

    const now = new Date();
    return new Certificate({
      id: crypto.randomUUID(),
      ...props,
      issuedAt: props.issuedAt ?? now,
      status: props.status ?? 'ISSUED',
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(props: CertificateProps): Certificate {
    if (!['ISSUED', 'REVOKED', 'EXPIRED'].includes(props.status)) {
      throw new Error(`Invalid certificate status: ${props.status}`);
    }
    return new Certificate(props);
  }

  get id(): string { return this.props.id; }
  get certificateNo(): string { return this.props.certificateNo; }
  get userId(): string { return this.props.userId; }
  get courseId(): string { return this.props.courseId; }
  get tenantId(): string | undefined { return this.props.tenantId; }
  get issuedAt(): Date { return this.props.issuedAt; }
  get pdfStoragePathR2(): string { return this.props.pdfStoragePathR2; }
  get qrCodeUrl(): string { return this.props.qrCodeUrl; }
  get digitalSignatureHash(): string { return this.props.digitalSignatureHash; }
  get status(): CertificateStatus { return this.props.status; }
  get metadataJson(): Record<string, unknown> | undefined { return this.props.metadataJson; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  /** Verify the certificate's HMAC-SHA256 signature (timing-safe). */
  verifySignature(secret: string, userId: string, courseId: string, displayName: string): boolean {
    const payload = buildHmacPayload(this.props.certificateNo, userId, courseId, displayName);
    const expected = DigitalSignature.create(payload, secret).toString();
    return timingSafeEquals(this.props.digitalSignatureHash, expected);
  }

  /** Revoke the certificate (status → REVOKED). */
  revoke(): Certificate {
    if (this.props.status === 'REVOKED') throw new Error('Certificate already revoked');
    if (this.props.status === 'EXPIRED') throw new Error('Cannot revoke expired certificate');
    return new Certificate({ ...this.props, status: 'REVOKED', updatedAt: new Date() });
  }

  /** Expire the certificate (status → EXPIRED). */
  expire(): Certificate {
    if (this.props.status === 'EXPIRED') throw new Error('Certificate already expired');
    if (this.props.status === 'REVOKED') throw new Error('Cannot expire revoked certificate');
    return new Certificate({ ...this.props, status: 'EXPIRED', updatedAt: new Date() });
  }

  toObject(): CertificateProps {
    return { ...this.props };
  }
}