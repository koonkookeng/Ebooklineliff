// SSOT Phase 090 — Group-buying DTOs (legacy path re-exports SSOT schemas)
// Canonical: apps/backend/src/modules/group-buying/dto/group-buying.dto.ts
// - Single source stays in @repo/shared; this file only re-exports.
export {
  GroupBuyingStatusEnum,
  GroupTypeEnum,
  CreateGroupRoomInputSchema,
  JoinGroupRoomInputSchema,
  GroupRoomDetailsSchema,
} from '@repo/shared';
