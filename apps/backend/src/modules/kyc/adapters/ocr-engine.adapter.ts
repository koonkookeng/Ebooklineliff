// SSOT Phase 085 BDD-1 — OCR engine adapter (provider seam)
// Canonical: apps/backend/src/modules/kyc/adapters/ocr-engine.adapter.ts
// - RISK_CALL (documented): no vision-model dep is configured in this repo,
//   so the default adapter stages the vault key and returns a
//   needsManualReview verdict (confidence 0) instead of fabricating OCR
//   text. BDD-1's <3s PENDING transition holds via synchronous ID/laser/
//   checksum gates; extraction fills in when OCR_VISION_* credentials land
//   (swap the OCR_PORT provider — no caller changes).
// - Zero new deps.
import { Injectable } from '@nestjs/common';

export interface OcrExtraction {
  idCardNumber?: string;
  firstNameTh?: string;
  lastNameTh?: string;
  birthDate?: string;
  address?: string;
  ocrConfidence: number;
  needsManualReview: boolean;
}

export interface OcrPort {
  extract(objectKey: string): Promise<OcrExtraction>;
}

@Injectable()
export class OcrEngineAdapter implements OcrPort {
  async extract(objectKey: string): Promise<OcrExtraction> {
    void objectKey;
    return { ocrConfidence: 0, needsManualReview: true };
  }
}
