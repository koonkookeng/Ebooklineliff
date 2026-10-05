// SSOT Phase 003 §3.1 — Identity Zod domain contract
import { z } from 'zod';

export const UserRoleEnum = z.enum([
  'SUPER_ADMIN',
  'FINANCE_ADMIN',
  'CONTENT_MODERATOR',
  'SUPPORT_STAFF',
  'INSTRUCTOR',
  'SELLER',
  'MEMBER',
]);

export const KYCStatusEnum = z.enum(['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED']);

// Thai national ID checksum (13 digits)
export const thaiIdChecksum = (id: string): boolean => {
  if (!/^[0-9]{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(id.charAt(i), 10) * (13 - i);
  }
  return (11 - (sum % 11)) % 10 === parseInt(id.charAt(12), 10);
};

export const thaiPhoneRegex = /^0[0-9]{9}$/;

export const UserAddressSchema = z.object({
  id: z.string().uuid().optional(),
  recipient: z.string().min(2, 'ชื่อผู้รับต้องมีอย่างน้อย 2 ตัวอักษร'),
  phoneNumber: z.string().regex(thaiPhoneRegex, 'หมายเลขโทรศัพท์ไม่ถูกต้อง'),
  addressLine1: z.string().min(5, 'กรุณากรอกที่อยู่'),
  addressLine2: z.string().optional(),
  subdistrict: z.string().min(2, 'กรุณากรอกแขวง/ตำบล'),
  district: z.string().min(2, 'กรุณากรอกเขต/อำเภอ'),
  province: z.string().min(2, 'กรุณากรอกจังหวัด'),
  postalCode: z.string().regex(/^[0-9]{5}$/, 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก'),
  isDefault: z.boolean().default(false),
});

export const CreatorKYCSchema = z.object({
  idCardNumber: z.string().refine(thaiIdChecksum, 'เลขประจำตัวประชาชน 13 หลักไม่ถูกต้อง'),
  idCardImageUrl: z.string().url('URL รูปภาพบัตรประชาชนไม่ถูกต้อง'),
  bankName: z.string().min(2, 'กรุณาระบุธนาคาร'),
  bankAccountNumber: z.string().min(8, 'เลขที่บัญชีธนาคารไม่ถูกต้อง'),
  bankAccountName: z.string().min(2, 'ชื่อบัญชีธนาคารไม่ถูกต้อง'),
  taxId: z.string().optional(),
});

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  lineUserId: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  displayName: z.string().min(1),
  avatarUrl: z.string().url().nullable(),
  role: UserRoleEnum,
  kycStatus: KYCStatusEnum,
  walletBalance: z.number(),
  rewardPoints: z.number().int(),
  affiliateCode: z.string(),
});

export type UserAddressInput = z.infer<typeof UserAddressSchema>;
export type CreatorKYCInput = z.infer<typeof CreatorKYCSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
