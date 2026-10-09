// SSOT Phase 106 §5.1 — InvalidBitmaskException (fail-fast Zod/domain boundary)
import { BadRequestException } from '@nestjs/common';

export class InvalidBitmaskException extends BadRequestException {
  constructor(message = 'Invalid permission bitmask') {
    super(message);
    this.name = 'InvalidBitmaskException';
  }
}
