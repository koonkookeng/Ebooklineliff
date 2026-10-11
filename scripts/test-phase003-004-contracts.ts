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
assert.deepEqual(KYCStatusEnum.options, ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED', 'ACTION_REQUIRED']);

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
  tenantId: '123e4567-e89b-12d3-a456-426614174000',
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

// ---- Phase 003 REVIEW: address-book service (default-flip + ownership) ----
import { IdentityService } from '../apps/backend/src/modules/identity/application/identity.service';

async function runAddressGroups(): Promise<void> {
const A_OLD = '123e4567-e89b-12d3-a456-426614174001';
const addressRows: Array<Record<string, unknown>> = [
  { id: A_OLD, userId: 'u1', recipient: 'Old', phoneNumber: '0812345678', addressLine1: '12345 Long street', subdistrict: 'Klong', district: 'Klong', province: 'Bangkok', postalCode: '10110', isDefault: true },
];
const addressDb = {
  userAddress: {
    async updateMany(a: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      let count = 0;
      for (const row of addressRows) {
        if (row['userId'] === a.where['userId'] && row['isDefault'] === true) {
          Object.assign(row, a.data);
          count += 1;
        }
      }
      return { count };
    },
    async update(a: { where: { id: string }; data: Record<string, unknown> }) {
      const row = addressRows.find((r) => r['id'] === a.where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, a.data);
      return row;
    },
    async create(a: { data: Record<string, unknown> }) {
      const row = { id: '123e4567-e89b-12d3-a456-426614174002', ...a.data };
      addressRows.push(row);
      return row;
    },
    async deleteMany(a: { where: Record<string, unknown> }) {
      const before = addressRows.length;
      for (let i = addressRows.length - 1; i >= 0; i--) {
        if (addressRows[i]['id'] === a.where['id'] && addressRows[i]['userId'] === a.where['userId']) {
          addressRows.splice(i, 1);
        }
      }
      return { count: before - addressRows.length };
    },
  },
};
const identitySvc = new IdentityService(addressDb as never);

const created = (await identitySvc.upsertAddress('u1', {
  recipient: 'สมชาย ใจดี',
  phoneNumber: '0812345678',
  addressLine1: '123/45 ถนนสุขุมวิท แขวงคลองเตย',
  subdistrict: 'คลองเตย',
  district: 'คลองเตย',
  province: 'กรุงเทพมหานคร',
  postalCode: '10110',
  isDefault: true,
})) as Record<string, unknown>;
// Default flip: the previous default row must be unset.
assert.equal(addressRows.find((r) => r['id'] === A_OLD)?.['isDefault'], false);
assert.equal(created['isDefault'], true);
assert.throws(() =>
  UserAddressSchema.parse({
    recipient: 'A',
    phoneNumber: '123',
    addressLine1: 'x',
    subdistrict: 'K',
    district: 'K',
    province: 'BKK',
    postalCode: '1011',
  }),
);
const updated = (await identitySvc.upsertAddress('u1', {
  id: created['id'] as string,
  recipient: 'สมชาย ใจดี',
  phoneNumber: '0812345678',
  addressLine1: '999/9 ถนนยาวกว่าห้าตัวอักษร',
  subdistrict: 'คลองเตย',
  district: 'คลองเตย',
  province: 'กรุงเทพมหานคร',
  postalCode: '10110',
  isDefault: false,
})) as Record<string, unknown>;
assert.equal(updated['addressLine1'], '999/9 ถนนยาวกว่าห้าตัวอักษร');
assert.deepEqual(await identitySvc.deleteAddress('u1', created['id'] as string), { count: 1 });
assert.deepEqual(await identitySvc.deleteAddress('u1', A_OLD), { count: 1 });
assert.deepEqual(await identitySvc.deleteAddress('intruder', A_OLD), { count: 0 });
}

runAddressGroups()
  .then(() => console.log('phase003+004 contract tests: all groups passed'))
  .catch((err) => {
    console.error('phase003+004 contract tests FAILED:', err);
    process.exit(1);
  });