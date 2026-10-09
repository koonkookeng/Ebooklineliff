// SSOT Phase 106 §5.1 — ScopeAccessDeniedException (403 + audit context)
import { ForbiddenException } from '@nestjs/common';

export class ScopeAccessDeniedException extends ForbiddenException {
  constructor(message = 'Access Denied: Required Scope Mismatch') {
    super(message);
    this.name = 'ScopeAccessDeniedException';
  }
}
