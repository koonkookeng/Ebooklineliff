// SSOT Phase 003 §5 — Thai phone value object
import { BadRequestException } from '@nestjs/common';
import { thaiPhoneRegex } from '@repo/shared';

export class ThaiPhone {
  private constructor(readonly value: string) {}

  static create(phone: string): ThaiPhone {
    if (!thaiPhoneRegex.test(phone)) {
      throw new BadRequestException('หมายเลขโทรศัพท์ไม่ถูกต้อง');
    }
    return new ThaiPhone(phone);
  }
}
