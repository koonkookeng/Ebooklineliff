// SSOT Phase 085 §7 — KYC OCR + queue + notify services (stream transport)
// Canonical: apps/backend/src/modules/kyc/services/kyc-ocr.service.ts
// - Runs the OCR port and merges provider fields over user-declared data
//   (provider wins only above 0.98 confidence — BDD-1 accuracy bar).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { OcrEngineAdapter } from '../adapters/ocr-engine.adapter';

@Injectable()
export class KycOcrService {
  constructor(private readonly ocr: OcrEngineAdapter) {}

  async extractWithFallback(
    objectKey: string,
    declared: { idCardNumber: string; firstNameTh: string; lastNameTh: string; birthDate: string },
  ): Promise<{ idCardNumber: string; firstNameTh: string; lastNameTh: string; birthDate: string; ocrConfidence: number }> {
    const out = await this.ocr.extract(objectKey);
    if (!out.needsManualReview && out.ocrConfidence >= 0.98) {
      return {
        idCardNumber: out.idCardNumber ?? declared.idCardNumber,
        firstNameTh: out.firstNameTh ?? declared.firstNameTh,
        lastNameTh: out.lastNameTh ?? declared.lastNameTh,
        birthDate: out.birthDate ?? declared.birthDate,
        ocrConfidence: out.ocrConfidence,
      };
    }
    return { ...declared, ocrConfidence: out.ocrConfidence };
  }
}
