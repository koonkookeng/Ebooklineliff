// SSOT Phase 085 — OCR vision seam (111 staging; default = staged review)
// Canonical: apps/backend/src/modules/kyc/infra/ocr-vision.adapter.ts
// - Re-uses the adapter-port contract; the vision-model implementation
//   lands with provider credentials (111). Until then: staged review.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { OcrEngineAdapter, type OcrExtraction } from '../adapters/ocr-engine.adapter';

@Injectable()
export class OcrVisionAdapter extends OcrEngineAdapter {
  override async extract(objectKey: string): Promise<OcrExtraction> {
    return super.extract(objectKey);
  }
}
