// SSOT Phase 109 §3.2 — Admin user GraphQL resolver (code-first)
// Canonical: apps/backend/src/modules/admin/user-management/resolvers/admin-user.resolver.ts
// - Intent names match spec §3.2 verbatim (adminGetUsersAndMerchants /
//   adminGetUserDetail / adminGetKYCPendingList / adminExecuteUserAction /
//   adminApproveKYC / adminRejectKYC / adminGenerateImpersonationToken).
// - RISK_CALL: runtime TS twin enums mirror the Zod SSOT (registerEnumType
//   cannot consume Zod schemas; load-time drift guard below — Phase 108 twin
//   precedent). JwtAuthGuard + AdminRbacGuard via @UseGuards.
// - Zero new deps.
import { Resolver, Query, Mutation, Args, Int, Float, ID, ObjectType, Field, InputType, registerEnumType } from '@nestjs/graphql';
import { UseGuards, SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { AdminRbacGuard, ADMIN_ROLES_KEY } from '../guards/admin-rbac.guard';
import { AdminUserQueryService } from '../services/admin-user-query.service';
import { AdminUserCommandService } from '../services/admin-user-command.service';
import { AdminKycProcessorService } from '../services/admin-kyc-processor.service';
import { UserRoleEnum, KYCStatusEnum, AdminUserActionEnum } from '@repo/shared';

enum AdminUserRoleGql {
  SUPER_ADMIN = 'SUPER_ADMIN',
  FINANCE_ADMIN = 'FINANCE_ADMIN',
  CONTENT_MODERATOR = 'CONTENT_MODERATOR',
  SUPPORT_STAFF = 'SUPPORT_STAFF',
  INSTRUCTOR = 'INSTRUCTOR',
  SELLER = 'SELLER',
  MEMBER = 'MEMBER',
}
registerEnumType(AdminUserRoleGql, { name: 'AdminUserRole' });

enum AdminKycStatusGql {
  NOT_SUBMITTED = 'NOT_SUBMITTED',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  ACTION_REQUIRED = 'ACTION_REQUIRED',
}
registerEnumType(AdminKycStatusGql, { name: 'AdminKycStatus' });

enum AdminUserActionGql {
  UPDATE_ROLE = 'UPDATE_ROLE',
  FREEZE_ACCOUNT = 'FREEZE_ACCOUNT',
  UNFREEZE_ACCOUNT = 'UNFREEZE_ACCOUNT',
  ADJUST_WALLET = 'ADJUST_WALLET',
  APPROVE_KYC = 'APPROVE_KYC',
  REJECT_KYC = 'REJECT_KYC',
  GENERATE_IMPERSONATION_TOKEN = 'GENERATE_IMPERSONATION_TOKEN',
}
registerEnumType(AdminUserActionGql, { name: 'AdminUserAction' });

for (const v of UserRoleEnum.options) {
  if ((AdminUserRoleGql as Record<string, string>)[v] !== v) throw new Error(`AdminUserRoleGql drift: ${v}`);
}
for (const v of KYCStatusEnum.options) {
  if ((AdminKycStatusGql as Record<string, string>)[v] !== v) throw new Error(`AdminKycStatusGql drift: ${v}`);
}
for (const v of AdminUserActionEnum.options) {
  if ((AdminUserActionGql as Record<string, string>)[v] !== v) throw new Error(`AdminUserActionGql drift: ${v}`);
}

export const RequireGqlAdminRoles = (...roles: string[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

export const GqlAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const gql = GqlExecutionContext.create(ctx);
  const req = gql.getContext()?.req as { user?: { id?: string; sub?: string }; ip?: string } | undefined;
  return { adminId: req?.user?.id ?? req?.user?.sub ?? '', ip: req?.ip ?? 'unknown' };
});

@InputType()
class AdminUserFilterInput {
  @Field({ nullable: true }) tenantId?: string;
  @Field({ nullable: true }) searchKeyword?: string;
  @Field(() => [AdminUserRoleGql], { nullable: true }) roles?: AdminUserRoleGql[];
  @Field(() => [AdminKycStatusGql], { nullable: true }) kycStatuses?: AdminKycStatusGql[];
  @Field(() => Float, { nullable: true }) minWalletBalance?: number;
  @Field(() => Float, { nullable: true }) maxWalletBalance?: number;
  @Field(() => Int, { nullable: true }) page?: number;
  @Field(() => Int, { nullable: true }) pageSize?: number;
  @Field({ nullable: true }) sortBy?: string;
  @Field({ nullable: true }) sortOrder?: string;
}

@InputType()
class AdminUserActionInput {
  @Field(() => ID) userId!: string;
  @Field(() => AdminUserActionGql) action!: AdminUserActionGql;
  @Field(() => AdminUserRoleGql, { nullable: true }) newRole?: AdminUserRoleGql;
  @Field(() => Float, { nullable: true }) walletAdjustmentAmount?: number;
  @Field() reason!: string;
  @Field({ nullable: true }) rejectionReason?: string;
}

@ObjectType()
class AdminUserTableItem {
  @Field(() => ID) id!: string;
  @Field({ nullable: true }) email?: string;
  @Field({ nullable: true }) phone?: string;
  @Field() displayName!: string;
  @Field(() => AdminUserRoleGql) role!: AdminUserRoleGql;
  @Field(() => AdminKycStatusGql) kycStatus!: AdminKycStatusGql;
  @Field(() => Float) walletBalance!: number;
  @Field(() => Int) rewardPoints!: number;
  @Field(() => Int) totalOrdersCount!: number;
  @Field(() => Float) totalSpentAmount!: number;
  @Field() createdAt!: string;
}

@ObjectType()
class UserSummaryStats {
  @Field(() => Int) totalUsers!: number;
  @Field(() => Int) totalSellers!: number;
  @Field(() => Int) totalInstructors!: number;
  @Field(() => Int) pendingKYCCount!: number;
  @Field(() => Float) totalWalletCirculation!: number;
}

@ObjectType()
class AdminUserTableResponse {
  @Field(() => [AdminUserTableItem]) items!: AdminUserTableItem[];
  @Field(() => Int) totalCount!: number;
  @Field(() => Int) page!: number;
  @Field(() => Int) pageSize!: number;
  @Field(() => Int) totalPages!: number;
  @Field(() => UserSummaryStats) summaryStats!: UserSummaryStats;
}

@ObjectType()
class AdminUserDetailResponse {
  @Field(() => ID) id!: string;
  @Field() displayName!: string;
  @Field(() => AdminUserRoleGql) role!: AdminUserRoleGql;
  @Field(() => AdminKycStatusGql) kycStatus!: AdminKycStatusGql;
  @Field() isFrozen!: boolean;
  @Field(() => Float) walletBalance!: number;
  @Field(() => Int) totalOrdersCount!: number;
  @Field() totalSpentAmount!: string;
}

@ObjectType()
class AdminActionResultPayload {
  @Field() success!: boolean;
  @Field() message!: string;
  @Field(() => ID) userId!: string;
  @Field({ nullable: true }) impersonationToken?: string;
  @Field(() => Int, { nullable: true }) expiresIn?: number;
}

@ObjectType()
class KycOperationResultPayload {
  @Field() success!: boolean;
  @Field() message!: string;
  @Field(() => ID) userId!: string;
}

@ObjectType()
class ImpersonationTokenPayload {
  @Field() impersonationToken!: string;
  @Field(() => Int) expiresIn!: number;
  @Field(() => ID) targetUserId!: string;
}

@Resolver()
@UseGuards(JwtAuthGuard, AdminRbacGuard)
export class AdminUserResolver {
  constructor(
    private readonly queries: AdminUserQueryService,
    private readonly commands: AdminUserCommandService,
    private readonly kyc: AdminKycProcessorService,
  ) {}

  @Query(() => AdminUserTableResponse)
  async adminGetUsersAndMerchants(@Args('filter', { nullable: true }) filter?: AdminUserFilterInput) {
    const result = await this.queries.listUsersAndMerchants({
      searchKeyword: filter?.searchKeyword,
      tenantId: filter?.tenantId,
      role: filter?.roles as string[] | undefined,
      kycStatus: filter?.kycStatuses as string[] | undefined,
      minWalletBalance: filter?.minWalletBalance,
      maxWalletBalance: filter?.maxWalletBalance,
      page: filter?.page ?? 1,
      pageSize: filter?.pageSize ?? 20,
      sortBy: (filter?.sortBy as 'createdAt' | 'displayName' | 'walletBalance' | 'rewardPoints' | undefined) ?? 'createdAt',
      sortOrder: (filter?.sortOrder as 'asc' | 'desc' | undefined) ?? 'desc',
    });
    return {
      ...result,
      items: result.items.map((i) => ({
        id: i.id,
        email: i.email ?? undefined,
        phone: i.phone ?? undefined,
        displayName: i.displayName,
        role: i.role as AdminUserRoleGql,
        kycStatus: i.kycStatus as AdminKycStatusGql,
        walletBalance: i.walletBalance,
        rewardPoints: i.rewardPoints,
        totalOrdersCount: i.totalOrdersCount,
        totalSpentAmount: i.totalSpentAmount,
        createdAt: i.createdAt,
      })),
    };
  }

  @Query(() => AdminUserDetailResponse)
  async adminGetUserDetail(@Args('userId', { type: () => ID }) userId: string) {
    const d = (await this.queries.getUserDetail(userId)) as {
      id: string; displayName: string; role: string; kycStatus: string;
      isFrozen: boolean; walletBalance: string; totalOrdersCount: number; totalSpentAmount: string;
    };
    return {
      id: d.id, displayName: d.displayName,
      role: d.role as AdminUserRoleGql, kycStatus: d.kycStatus as AdminKycStatusGql,
      isFrozen: d.isFrozen, walletBalance: Number(d.walletBalance),
      totalOrdersCount: d.totalOrdersCount, totalSpentAmount: d.totalSpentAmount,
    };
  }

  @Query(() => AdminUserTableResponse)
  async adminGetKYCPendingList(
    @Args('page', { type: () => Int, nullable: true }) page = 1,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize = 20,
  ) {
    const pending = await this.kyc.getPendingList(page, pageSize);
    return {
      items: pending.items.map((i) => ({
        id: i.userId, email: i.email ?? undefined, phone: i.phone ?? undefined,
        displayName: i.displayName, role: AdminUserRoleGql.MEMBER,
        kycStatus: i.kycStatus as AdminKycStatusGql,
        walletBalance: 0, rewardPoints: 0, totalOrdersCount: 0, totalSpentAmount: 0,
        createdAt: i.submittedAt,
      })),
      totalCount: pending.total, page: pending.page, pageSize: pending.pageSize,
      totalPages: pending.totalPages,
      summaryStats: { totalUsers: pending.total, totalSellers: 0, totalInstructors: 0, pendingKYCCount: pending.total, totalWalletCirculation: 0 },
    };
  }

  @Mutation(() => AdminActionResultPayload)
  async adminExecuteUserAction(
    @Args('input') input: AdminUserActionInput,
    @GqlAdmin() admin: { adminId: string; ip: string },
  ) {
    const out = (await this.commands.executeAdminUserAction(admin.adminId, admin.ip, {
      userId: input.userId, action: input.action, newRole: input.newRole,
      walletAdjustmentAmount: input.walletAdjustmentAmount, reason: input.reason,
      rejectionReason: input.rejectionReason,
    })) as { success: boolean; message: string; userId: string; impersonationToken?: string; expiresIn?: number };
    return {
      success: out.success, message: out.message, userId: out.userId,
      impersonationToken: typeof out.impersonationToken === 'string' ? out.impersonationToken : undefined,
      expiresIn: typeof out.expiresIn === 'number' ? out.expiresIn : undefined,
    };
  }

  @Mutation(() => KycOperationResultPayload)
  @RequireGqlAdminRoles('SUPER_ADMIN', 'SUPPORT_STAFF')
  async adminApproveKYC(
    @Args('userId', { type: () => ID }) userId: string,
    @GqlAdmin() admin: { adminId: string; ip: string },
  ) {
    const out = (await this.kyc.approveKYC(admin.adminId, userId, admin.ip)) as { success: boolean; message: string };
    return { success: out.success, message: out.message, userId };
  }

  @Mutation(() => KycOperationResultPayload)
  @RequireGqlAdminRoles('SUPER_ADMIN', 'SUPPORT_STAFF')
  async adminRejectKYC(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('reason') reason: string,
    @GqlAdmin() admin: { adminId: string; ip: string },
  ) {
    const out = (await this.kyc.rejectKYC(admin.adminId, userId, admin.ip, reason)) as { success: boolean; message: string };
    return { success: out.success, message: out.message, userId };
  }

  @Mutation(() => ImpersonationTokenPayload)
  @RequireGqlAdminRoles('SUPER_ADMIN')
  async adminGenerateImpersonationToken(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('reason') reason: string,
    @GqlAdmin() admin: { adminId: string; ip: string },
  ) {
    const out = await this.commands.mintImpersonationToken(admin.adminId, userId, reason, admin.ip);
    return { impersonationToken: out.impersonationToken, expiresIn: out.expiresIn, targetUserId: userId };
  }
}
