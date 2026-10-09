// SSOT Phase 097 Task 4 — B2B seat GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/b2b/resolvers/b2b-seat.resolver.ts
// - Queries getCorporateLicenseInfo / getCorporateDashboard.
//   Mutations claimCorporateSeat / allocateCorporateSeats / revokeCorporateSeat.
// - Zero new deps.
import { Args, Field, ID, InputType, Int, Mutation, ObjectType, Query, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { BulkSeatInviteInputSchema } from '@repo/shared';
import { B2bLicenseService } from '../services/b2b-license.service';
import { B2bSeatAllocationService } from '../services/b2b-seat-allocation.service';
import { B2bAnalyticsService } from '../services/b2b-analytics.service';
import type { B2bRepository } from '../repositories/b2b-prisma.repository';
import { PrismaB2bRepository } from '../repositories/b2b-prisma.repository';

@ObjectType('CorporateLicense')
class CorporateLicenseGql {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  corporateAccountId!: string;

  @Field(() => ID)
  productId!: string;

  @Field(() => Int)
  totalSeats!: number;

  @Field(() => Int)
  usedSeats!: number;

  @Field(() => Int)
  availableSeats!: number;

  @Field()
  licenseCode!: string;

  @Field()
  status!: string;

  @Field(() => String, { nullable: true })
  expiresAt?: string | null;
}

@ObjectType('ClaimCorporateSeatPayload')
class ClaimCorporateSeatPayloadGql {
  @Field()
  success!: boolean;

  @Field()
  message!: string;

  @Field(() => ID)
  licenseId!: string;

  @Field(() => ID)
  assignedSeatId!: string;

  @Field()
  entitlementGranted!: boolean;

  @Field(() => Int)
  remainingSeats!: number;
}

@ObjectType('CorporateDashboardLicense')
class CorporateDashboardLicenseGql {
  @Field(() => ID)
  licenseId!: string;

  @Field()
  productTitle!: string;

  @Field(() => Int)
  totalSeats!: number;

  @Field(() => Int)
  usedSeats!: number;

  @Field(() => Int)
  remainingSeats!: number;

  @Field()
  status!: string;

  @Field(() => Int)
  assigned!: number;

  @Field(() => Int)
  activeUsers!: number;
}

@InputType('BulkSeatInviteInput')
class BulkSeatInviteInputGql {
  @Field(() => ID)
  licenseId!: string;

  @Field(() => ID, { nullable: true })
  departmentId?: string;

  @Field(() => [String], { nullable: true })
  emails?: string[];

  @Field(() => [String], { nullable: true })
  lineUserIds?: string[];
}

type LooseCtx = Record<string, unknown>;

function actorOf(ctx: LooseCtx): { userId: string; lineUserId?: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; lineUserId?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { userId: user.id, lineUserId: user.lineUserId };
}

@Resolver('B2bSeat')
export class B2bSeatResolver {
  constructor(
    private readonly licenses: B2bLicenseService,
    private readonly seats: B2bSeatAllocationService,
    private readonly analytics: B2bAnalyticsService,
    private readonly repo: PrismaB2bRepository,
  ) {}

  @Query('getCorporateLicenseInfo')
  async getCorporateLicenseInfo(@Args('licenseCode') licenseCode: string) {
    const info = await this.licenses.licenseInfo(licenseCode);
    const out = new CorporateLicenseGql();
    out.id = info.licenseId;
    out.corporateAccountId = info.corporateAccountId;
    out.productId = info.productId;
    out.totalSeats = info.totalSeats;
    out.usedSeats = info.usedSeats;
    out.availableSeats = info.remainingSeats;
    out.licenseCode = licenseCode;
    out.status = info.status;
    return out;
  }

  @Query('getCorporateDashboard')
  async getCorporateDashboard(@Args('corporateAccountId') corporateAccountId: string) {
    const { licenses } = await this.analytics.dashboard(corporateAccountId);
    return licenses.map((l) => {
      const out = new CorporateDashboardLicenseGql();
      out.licenseId = l.licenseId;
      out.productTitle = l.productTitle;
      out.totalSeats = l.totalSeats;
      out.usedSeats = l.usedSeats;
      out.remainingSeats = l.remainingSeats;
      out.status = l.status;
      out.assigned = l.assigned;
      out.activeUsers = l.activeUsers;
      return out;
    });
  }

  @Mutation('claimCorporateSeat')
  async claimCorporateSeat(@Args('licenseCode') licenseCode: string, @Context() ctx: LooseCtx) {
    const { userId, lineUserId } = actorOf(ctx);
    const r = await this.seats.claimSeatForUser({ licenseCode, userId, lineUserId });
    const out = new ClaimCorporateSeatPayloadGql();
    out.success = r.success;
    out.message = r.message;
    out.licenseId = r.licenseId;
    out.assignedSeatId = r.assignedSeatId;
    out.entitlementGranted = r.entitlementGranted;
    out.remainingSeats = r.remainingSeats;
    return out;
  }

  @Mutation('allocateCorporateSeats')
  async allocateCorporateSeats(@Args('input') input: BulkSeatInviteInputGql, @Context() ctx: LooseCtx) {
    actorOf(ctx);
    const parsed = BulkSeatInviteInputSchema.safeParse({
      licenseId: input.licenseId,
      departmentId: input.departmentId,
      emails: input.emails,
      lineUserIds: input.lineUserIds,
    });
    if (!parsed.success) throw new BadRequestException('Invalid invite input');
    const repo: B2bRepository = this.repo;
    await repo.allocateInvites({
      licenseId: parsed.data.licenseId,
      departmentId: parsed.data.departmentId,
      emails: parsed.data.emails ?? [],
      lineUserIds: parsed.data.lineUserIds ?? [],
    });
    return true;
  }

  @Mutation('revokeCorporateSeat')
  revokeCorporateSeat(@Args('seatId') seatId: string, @Context() ctx: LooseCtx) {
    actorOf(ctx);
    return this.seats.revokeSeat({ seatId });
  }
}

export { CorporateLicenseGql, ClaimCorporateSeatPayloadGql };
