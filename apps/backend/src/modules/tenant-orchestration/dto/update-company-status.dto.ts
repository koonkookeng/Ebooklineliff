// SSOT Phase 108 — legacy alias: UpdateCompanyStatus schema lives in
// ./create-tenant.dto.ts (single source); this file re-exports it so older
// imports keep working (Zero Redundant Code policy).
export {
  UpdateCompanyStatusDtoSchema,
  type UpdateCompanyStatusDto,
} from './create-tenant.dto';
