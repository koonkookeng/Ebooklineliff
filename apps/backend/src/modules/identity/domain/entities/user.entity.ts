// SSOT Phase 003 §5 — user domain entity (persistence-agnostic shape)
import type { UserRoleEnum, KYCStatusEnum } from '@repo/shared';
import type { z } from 'zod';

export type UserRole = z.infer<typeof UserRoleEnum>;
export type KYCStatus = z.infer<typeof KYCStatusEnum>;

export interface UserEntityProps {
  id: string;
  lineUserId: string | null;
  email: string | null;
  phone: string | null;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  kycStatus: KYCStatus;
  affiliateCode: string;
}

export class UserEntity {
  private constructor(private props: UserEntityProps) {}

  static reconstitute(props: UserEntityProps): UserEntity {
    return new UserEntity(props);
  }

  get id(): string {
    return this.props.id;
  }

  get kycStatus(): KYCStatus {
    return this.props.kycStatus;
  }

  canSubmitKYC(): boolean {
    return this.props.kycStatus !== 'VERIFIED';
  }
}
