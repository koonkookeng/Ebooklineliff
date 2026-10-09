// SSOT Phase 085 §8 — R2 private-vault client (3-min review URLs)
// Canonical: apps/backend/src/modules/kyc/infra/r2-private-vault.client.ts
// - Thin wrapper over R2StorageService: presigned PUT for LIFF uploads
//   (Task 6, <2MB client-compressed) + presigned GET (180s) for admin
//   review — every view is audit-logged by the caller (§8).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { R2StorageService } from '../../../infra/cloudflare/r2-storage.service';
import { KYC_UPLOAD_TTL_SEC, KYC_VIEW_TTL_SEC, kycObjectKey } from '@repo/shared';

@Injectable()
export class R2PrivateVaultClient {
  constructor(private readonly r2: R2StorageService) {}

  /** Presigned PUT for a watermarked, compressed KYC document. */
  uploadUrl(userId: string, kind: 'id-card' | 'selfie' | 'bookbank'): { objectKey: string; uploadUrl: string; expiresInSec: number } {
    const objectKey = kycObjectKey(userId, kind);
    return {
      objectKey,
      uploadUrl: this.r2.presignedPutUrl(objectKey, 'image/jpeg', KYC_UPLOAD_TTL_SEC),
      expiresInSec: KYC_UPLOAD_TTL_SEC,
    };
  }

  /** 3-minute review URL (caller writes the KYCAuditLog view row). */
  viewUrl(objectKey: string): { url: string; expiresInSec: number } {
    return { url: this.r2.presignedGetUrl(objectKey, KYC_VIEW_TTL_SEC), expiresInSec: KYC_VIEW_TTL_SEC };
  }
}
