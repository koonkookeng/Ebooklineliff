// SSOT Phase 106 Task 3 — @RequireScopes decorator (Inherited Decorator Pattern, §9.1)
import { SetMetadata } from '@nestjs/common';

export const SCOPES_KEY = 'security:require-scopes';
export const RequireScopes = (...scopes: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(SCOPES_KEY, scopes);
