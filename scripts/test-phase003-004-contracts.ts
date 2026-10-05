// SSOT Phase 003+004 — contract tests (happy + edge + failure)
import assert from 'node:assert';
import {
  UserRoleEnum,
  KYCStatusEnum,
  thaiIdChecksum,
  UserAddressSchema,
  CreatorKYCSchema,
  UserProfileSchema,
  AuthenticateLineLiffInputSchema,
  GetEbookChunkInputSchema,
  CreateOrderInputSchema,
  EasySlipWebhookPayloadSchema,
} from '../packages/shared/src/index';

// ---- Phase 003: identity ----
assert.deepEqual(UserRoleEnum.options, [
  'SUPER_ADMIN',
  'FINANCE_ADMIN',
  'CONTENT_MODERATOR',
  'SUPPORT_STAFF',
  'INSTRUCTOR',
  'SELLER',
  'MEMBER',
]);
assert.deepEqual(KYCStatusEnum.options, ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED']);

// Thai ID checksum: valid fixture '1100400123450' (spec), invalid variants
assert.equal(thaiIdChecksum('1100400123450'), true);
assert.equal(thaiIdChecksum('1100400123451'), false);
assert.equal(thaiIdChecksum('123'), false);
assert.equal(thaiIdChecksum('abcdefghijklm'), false);

const address = {
  recipient: 'สมชาย ใจดี',
  phoneNumber: '0812345678',
  addressLine1: '123/45 ถนนสุขุมวิท แขวงคลองเตย',
  subdistrict: 'คลองเตย',
  district: 'คลองเตย',
  province: 'กรุงเทพมหานคร',
  postalCode: '10110',
};
const parsedAddress = UserAddressSchema.parse(address);
assert.equal(parsedAddress.isDefault, false);
assert.throws(() => UserAddressSchema.parse({ ...address, phoneNumber: '123' }));
assert.throws(() => UserAddressSchema.parse({ ...address, postalCode: '1011' }));

const kyc = {
  idCardNumber: '1100400123450',
  idCardImageUrl: 'https://r2.vault/kyc/test.png',
  bankName: 'Kasikorn Bank',
  bankAccountNumber: '1234567890',
  bankAccountName: 'Test User',
};
CreatorKYCSchema.parse(kyc);
assert.throws(() => CreatorKYCSchema.parse({ ...kyc, idCardNumber: '1100400123451' }));

UserProfileSchema.parse({
  id: '123e4567-e89b-12d3-a456-426614174000',
  lineUserId: 'U123',
  email: 'a@b.co',
  phone: '0812345678',
  displayName: 'Test',
  avatarUrl: null,
  role: 'MEMBER',
  kycStatus: 'NOT_SUBMITTED',
  walletBalance: 0,
  rewardPoints: 0,
  affiliateCode: 'AFF-1',
});

// ---- Phase 004: graphql + webhook ----
AuthenticateLineLiffInputSchema.parse({
  accessToken: 'line-access-token-123',
  tenantId: '123e4567-e89b-12d3-a456-426614174000',
});
assert.throws(() =>
  AuthenticateLineLiffInputSchema.parse({ accessToken: 'short', tenantId: 'not-uuid' }),
);
GetEbookChunkInputSchema.parse({
  productId: '123e4567-e89b-12d3-a456-426614174000',
  pageNumber: 3,
});
assert.throws(() =>
  GetEbookChunkInputSchema.parse({
    productId: '123e4567-e89b-12d3-a456-426614174000',
    pageNumber: 0,
  }),
);
CreateOrderInputSchema.parse({
  items: [{ productId: '123e4567-e89b-12d3-a456-426614174000', quantity: 2 }],
});
assert.throws(() => CreateOrderInputSchema.parse({ items: [] }));

const slip = {
  event: 'slip.verify',
  transRef: 'ORD-1',
  date: '2026-01-01',
  amount: { value: 199.5 },
  sender: { bank: { id: '004', name: 'KBANK' }, account: { name: 'A', value: '123' } },
  receiver: { bank: { id: '004', name: 'KBANK' }, account: { name: 'Shop', value: '456' } },
};
EasySlipWebhookPayloadSchema.parse(slip);
assert.throws(() => EasySlipWebhookPayloadSchema.parse({ ...slip, amount: { value: -5 } }));

console.log('phase003+004 contract tests: all groups passed');
