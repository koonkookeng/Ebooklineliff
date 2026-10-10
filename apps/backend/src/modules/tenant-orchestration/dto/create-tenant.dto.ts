import { z } from 'zod';
import { CompanyStatusEnum, PackageTierEnum } from '@repo/shared';

export const CreateTenantDtoSchema = z.object({
  companyName: z.string().min(2).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric + hyphens'),
  packageTier: PackageTierEnum,
  primaryContactEmail: z.string().email(),
  customDomains: z.array(z.string().min(3).max(253)).optional(),
  contactPhone: z.string().optional(),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});
export type CreateTenantDto = z.infer<typeof CreateTenantDtoSchema>;

export const UpdateCompanyStatusDtoSchema = z.object({
  tenantId: z.string().min(1),
  status: CompanyStatusEnum,
  reason: z.string().min(5).max(255).optional(),
});
export type UpdateCompanyStatusDto = z.infer<typeof UpdateCompanyStatusDtoSchema>;

export const UpdateTenantPackageDtoSchema = z.object({
  tenantId: z.string().min(1),
  packageTier: PackageTierEnum,
});
export type UpdateTenantPackageDto = z.infer<typeof UpdateTenantPackageDtoSchema>;

export const AddTenantCustomDomainDtoSchema = z.object({
  tenantId: z.string().min(1),
  domain: z.string().min(3).max(253),
});
export type AddTenantCustomDomainDto = z.infer<typeof AddTenantCustomDomainDtoSchema>;

export const PurgeTenantCacheDtoSchema = z.object({
  tenantId: z.string().min(1),
});
export type PurgeTenantCacheDto = z.infer<typeof PurgeTenantCacheDtoSchema>;

export const TenantsListQuerySchema = z.object({
  status: CompanyStatusEnum.optional(),
  packageTier: PackageTierEnum.optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type TenantsListQuery = z.infer<typeof TenantsListQuerySchema>;

export const VerifyDomainStatusDtoSchema = z.object({
  tenantId: z.string().min(1),
  domain: z.string().min(3).max(253),
});
export type VerifyDomainStatusDto = z.infer<typeof VerifyDomainStatusDtoSchema>;