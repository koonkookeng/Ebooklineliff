// SSOT Phase 098 Task 2 — B2B HR GraphQL intents (code-first)
// Canonical: apps/backend/src/api/graphql/b2b-hr.resolver.ts
// - Query getHrDashboard / Mutations allocateHrSeats + recordQuizAttempt.
// - Provided by B2bHrModule. Zero new deps.
import { Args, Field, Float, ID, InputType, Int, Mutation, ObjectType, Query, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException, Injectable } from '@nestjs/common';
import { B2bHrSeatService } from '../../modules/b2b-hr/services/b2b-seat.service';
import { B2bHrQuizTrackerService } from '../../modules/b2b-hr/services/b2b-quiz-tracker.service';
import { B2bHrAnalyticsService, type HrDashboardResult } from '../../modules/b2b-hr/services/b2b-analytics.service';

@ObjectType('HrDepartmentStat')
class HrDepartmentStatGql {
  @Field(() => ID, { nullable: true })
  departmentId?: string | null;

  @Field()
  departmentName!: string;

  @Field(() => Int)
  seats!: number;

  @Field(() => Int)
  active!: number;

  @Field(() => Float)
  averageScore!: number;
}

@ObjectType('HrEmployeeRow')
class HrEmployeeRowGql {
  @Field(() => ID)
  seatId!: string;

  @Field()
  employeeName!: string;

  @Field()
  department!: string;

  @Field()
  status!: string;

  @Field(() => Int)
  attempts!: number;

  @Field(() => Float)
  averageScore!: number;
}

@ObjectType('HrDashboard')
class HrDashboardGql {
  @Field(() => ID)
  organizationId!: string;

  @Field()
  companyName!: string;

  @Field(() => Int)
  totalSeats!: number;

  @Field(() => Int)
  usedSeats!: number;

  @Field(() => Float)
  utilization!: number;

  @Field(() => Float)
  completionRate!: number;

  @Field(() => Float)
  averageScore!: number;

  @Field(() => Int)
  passed!: number;

  @Field(() => Int)
  failed!: number;

  @Field(() => [HrDepartmentStatGql])
  departments!: HrDepartmentStatGql[];

  @Field(() => [HrEmployeeRowGql])
  employees!: HrEmployeeRowGql[];
}

@ObjectType('HrAllocatePayload')
class HrAllocatePayloadGql {
  @Field(() => Int)
  invited!: number;

  @Field(() => Int)
  usedSeats!: number;

  @Field(() => Int)
  totalSeats!: number;
}

@ObjectType('HrQuizAttemptPayload')
class HrQuizAttemptPayloadGql {
  @Field(() => ID)
  attemptId!: string;

  @Field(() => ID)
  seatId!: string;

  @Field(() => Float)
  score!: number;

  @Field()
  status!: string;

  @Field()
  completedAt!: string;
}

@InputType('AllocateHrSeatsInput')
class AllocateHrSeatsInputGql {
  @Field(() => ID)
  organizationId!: string;

  @Field(() => ID, { nullable: true })
  departmentId?: string;

  @Field(() => [String], { nullable: true })
  emails?: string[];

  @Field(() => [String], { nullable: true })
  lineUserIds?: string[];
}

@InputType('RecordQuizAttemptInput')
class RecordQuizAttemptInputGql {
  @Field(() => ID)
  seatId!: string;

  @Field(() => ID)
  courseId!: string;

  @Field(() => ID)
  quizId!: string;

  @Field(() => Float)
  scoreObtained!: number;

  @Field(() => Float)
  maxScore!: number;

  @Field(() => Float, { nullable: true })
  passingScore?: number;

  @Field(() => Int)
  timeTakenSec!: number;
}

type LooseCtx = Record<string, unknown>;

function requireHr(ctx: LooseCtx): void {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
}

function toGql(d: HrDashboardResult): HrDashboardGql {
  const out = new HrDashboardGql();
  out.organizationId = d.organizationId;
  out.companyName = d.companyName;
  out.totalSeats = d.totalSeats;
  out.usedSeats = d.usedSeats;
  out.utilization = d.utilization;
  out.completionRate = d.completionRate;
  out.averageScore = d.averageScore;
  out.passed = d.passed;
  out.failed = d.failed;
  out.departments = d.departments.map((x) => {
    const g = new HrDepartmentStatGql();
    g.departmentId = x.departmentId;
    g.departmentName = x.departmentName;
    g.seats = x.seats;
    g.active = x.active;
    g.averageScore = x.averageScore;
    return g;
  });
  out.employees = d.employees.map((e) => {
    const g = new HrEmployeeRowGql();
    g.seatId = e.seatId;
    g.employeeName = e.employeeName;
    g.department = e.department;
    g.status = e.status;
    g.attempts = e.attempts;
    g.averageScore = e.averageScore;
    return g;
  });
  return out;
}

@Injectable()
@Resolver('B2bHr')
export class B2bHrResolver {
  constructor(
    private readonly seats: B2bHrSeatService,
    private readonly quizzes: B2bHrQuizTrackerService,
    private readonly analytics: B2bHrAnalyticsService,
  ) {}

  @Query('getHrDashboard')
  async getHrDashboard(@Args('organizationId') organizationId: string, @Context() ctx: LooseCtx) {
    requireHr(ctx);
    return toGql(await this.analytics.dashboard(organizationId));
  }

  @Mutation('allocateHrSeats')
  async allocateHrSeats(@Args('input') input: AllocateHrSeatsInputGql, @Context() ctx: LooseCtx) {
    requireHr(ctx);
    const r = await this.seats.allocateSeats({
      organizationId: input.organizationId,
      departmentId: input.departmentId,
      emails: input.emails,
      lineUserIds: input.lineUserIds,
    });
    const out = new HrAllocatePayloadGql();
    out.invited = r.invited;
    out.usedSeats = r.usedSeats;
    out.totalSeats = r.totalSeats;
    return out;
  }

  @Mutation('recordQuizAttempt')
  async recordQuizAttempt(@Args('input') input: RecordQuizAttemptInputGql, @Context() ctx: LooseCtx) {
    requireHr(ctx);
    const r = await this.quizzes.recordAttempt({ ...input });
    const out = new HrQuizAttemptPayloadGql();
    out.attemptId = r.attemptId;
    out.seatId = r.seatId;
    out.score = r.score;
    out.status = r.status;
    out.completedAt = r.completedAt;
    return out;
  }
}

export { HrDashboardGql, HrAllocatePayloadGql, HrQuizAttemptPayloadGql };
