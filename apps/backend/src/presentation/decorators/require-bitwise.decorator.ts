// SSOT Phase 106 Task 3 — @RequireBitwise decorator (Inherited Decorator Pattern, §9.1)
import { SetMetadata } from '@nestjs/common';

export const BITWISE_KEY = 'security:require-bitwise';
export const RequireBitwise = (bitmask: string): MethodDecorator & ClassDecorator =>
  SetMetadata(BITWISE_KEY, bitmask);
