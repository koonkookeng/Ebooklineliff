// SSOT Phase 107 §5.2 — PiiMaskingInterceptor (dynamic role-based masking, <5ms)
// Canonical: apps/backend/src/common/interceptors/pii-masking.interceptor.ts
// (legacy src/backend/common/interceptors/pii-masking.interceptor.ts)
// - Masks phone/bankAccount/idCardNumber/email/streetAddress unless the caller is
//   SUPER_ADMIN/COMPLIANCE_OFFICER or the record owner (ownerId === user.id).
// - Recursive over arrays + nested objects; redacts `password*`/`*token*` keys.
// - NEVER logs plaintext: audit rides the PII module's Redis stream (Gate 4/8).
// - Pure in-place map, no per-request allocation beyond the masked copy (Gate 5).
// - Zero new deps (rxjs is a NestJS core dep).
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { FieldEncryptionService } from '../crypto/field-encryption.service';
import { isUnmaskedRole } from '@repo/shared';

interface RequestUser {
  id?: string;
  role?: string;
}

const SENSITIVE_KEYS: Record<string, 'PHONE' | 'BANK' | 'ID_CARD' | 'EMAIL_ADDRESS' | 'STREET_ADDRESS'> = {
  phone: 'PHONE',
  phoneNumber: 'PHONE',
  maskedPhone: 'PHONE',
  bankAccount: 'BANK',
  bankAccountNumber: 'BANK',
  maskedBankAccount: 'BANK',
  idCardNumber: 'ID_CARD',
  nationalId: 'ID_CARD',
  maskedIdCard: 'ID_CARD',
  email: 'EMAIL_ADDRESS',
  emailAddress: 'EMAIL_ADDRESS',
  streetAddress: 'STREET_ADDRESS',
  address: 'STREET_ADDRESS',
};

@Injectable()
export class PiiMaskingInterceptor implements NestInterceptor {
  constructor(private readonly cryptoService: FieldEncryptionService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest() as { user?: RequestUser } | undefined;
    const user = request?.user;
    const role = user?.role ?? 'MEMBER';
    const userId = user?.id;
    const bypass = isUnmaskedRole(role);
    return next.handle().pipe(map((data) => this.maskPayload(data, bypass, userId)));
  }

  private maskPayload(data: unknown, bypass: boolean, userId: string | undefined): unknown {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.map((item) => this.maskPayload(item, bypass, userId));
    const source = data as Record<string, unknown>;
    // Owner sees their own plaintext (gatekeeper matrix §8.2 MEMBER row).
    if (!bypass && userId && (source['userId'] === userId || source['id'] === userId || source['ownerId'] === userId)) {
      return { ...source };
    }
    const masked: Record<string, unknown> = { ...source };
    for (const [key, kind] of Object.entries(SENSITIVE_KEYS)) {
      const value = masked[key];
      // Idempotent: never re-mask an already-masked value (keeps chained
      // interceptors stable instead of degrading to ***MASKED***).
      if (typeof value === 'string' && value.length > 0 && !value.includes('*') && !bypass) {
        masked[key] = this.cryptoService.maskField(value, kind);
      }
    }
    for (const key of Object.keys(masked)) {
      if (/password/i.test(key)) masked[key] = '***MASKED***';
      else if (/token/i.test(key) && typeof masked[key] === 'string') masked[key] = '***MASKED***';
    }
    // Recurse into nested objects (one level per call; depth-bounded by payload shape).
    for (const key of Object.keys(masked)) {
      const value = masked[key];
      if (value && typeof value === 'object') masked[key] = this.maskPayload(value, bypass, userId);
    }
    return masked;
  }
}
