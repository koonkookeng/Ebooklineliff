// SSOT Phase 096 — Squad GraphQL intents (code-first, single file)
// Canonical: apps/backend/src/modules/squad/squad.resolver.ts
// - Mutations createStudySquad / joinStudySquad / leaveStudySquad.
//   Queries getSquadDetails / getMyStudySquad. Zero new deps.
import { Args, Field, ID, InputType, Int, Mutation, ObjectType, Query, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { CreateSquadUsecase } from './application/create-squad.usecase';
import { JoinSquadUsecase, LeaveSquadUsecase } from './application/join-squad.usecase';
import type { SquadRepository } from './domain/squad.repository.interface';
import { PrismaSquadRepository } from './infrastructure/persistence/prisma-squad.repository';

@ObjectType('SquadMemberPayload')
class SquadMemberPayloadGql {
  @Field()
  userId!: string;

  @Field()
  displayName!: string;

  @Field()
  role!: string;

  @Field(() => Int)
  pointsContributed!: number;

  @Field()
  joinedAt!: string;
}

@ObjectType('StudySquadPayload')
class StudySquadPayloadGql {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field()
  squadCode!: string;

  @Field(() => Int)
  totalPoints!: number;

  @Field(() => Int)
  memberCount!: number;

  @Field(() => Int)
  maxMembers!: number;

  @Field(() => [SquadMemberPayloadGql])
  members!: SquadMemberPayloadGql[];
}

@ObjectType('CreateSquadPayload')
class CreateSquadPayloadGql {
  @Field(() => ID)
  squadId!: string;

  @Field()
  squadCode!: string;

  @Field()
  flexMessageJson!: string;

  @Field()
  inviteUrl!: string;
}

@InputType('CreateSquadInput')
class CreateSquadInputGql {
  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => Int, { nullable: true })
  maxMembers?: number;

  @Field(() => Boolean, { nullable: true })
  isPrivate?: boolean;
}

type LooseCtx = Record<string, unknown>;

function actorOf(ctx: LooseCtx): { userId: string; tenantId: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = ((((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim() || 'default');
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { userId: user.id, tenantId };
}

function shapeOf(room: {
  id: string; name: string; description: string | null; squadCode: string;
  totalPoints: number; maxMembers: number;
  members: Array<{ userId: string; role: string; pointsContributed: number; joinedAt: Date; user: { displayName: string } }>;
}): StudySquadPayloadGql {
  const out = new StudySquadPayloadGql();
  out.id = room.id;
  out.name = room.name;
  out.description = room.description;
  out.squadCode = room.squadCode;
  out.totalPoints = room.totalPoints;
  out.memberCount = room.members.length;
  out.maxMembers = room.maxMembers;
  out.members = room.members.map((m) => ({
    userId: m.userId,
    displayName: m.user.displayName,
    role: m.role,
    pointsContributed: m.pointsContributed,
    joinedAt: new Date(m.joinedAt).toISOString(),
  }));
  return out;
}

@Resolver('Squad')
export class SquadResolver {
  constructor(
    private readonly create: CreateSquadUsecase,
    private readonly join: JoinSquadUsecase,
    private readonly leave: LeaveSquadUsecase,
    private readonly repo: PrismaSquadRepository,
  ) {}

  @Mutation('createStudySquad')
  async createStudySquad(@Args('input') input: CreateSquadInputGql, @Context() ctx: LooseCtx) {
    const { userId, tenantId } = actorOf(ctx);
    const r = await this.create.execute({ leaderId: userId, tenantId, input: { ...input } });
    const out = new CreateSquadPayloadGql();
    out.squadId = r.squadId;
    out.squadCode = r.squadCode;
    out.flexMessageJson = r.flexMessageJson;
    out.inviteUrl = r.inviteUrl;
    return out;
  }

  @Mutation('joinStudySquad')
  async joinStudySquad(@Args('squadCode') squadCode: string, @Context() ctx: LooseCtx) {
    const repo: SquadRepository = this.repo;
    const { squadId } = await this.join.execute({ userId: actorOf(ctx).userId, squadCode });
    const room = await repo.findById(squadId);
    if (!room) throw new BadRequestException('Squad not found');
    return shapeOf(room);
  }

  @Mutation('leaveStudySquad')
  leaveStudySquad(@Args('squadId') squadId: string, @Context() ctx: LooseCtx) {
    return this.leave.execute({ userId: actorOf(ctx).userId, squadId });
  }

  @Query('getSquadDetails')
  async getSquadDetails(@Args('squadId') squadId: string) {
    const repo: SquadRepository = this.repo;
    const room = await repo.findById(squadId);
    return room ? shapeOf(room) : null;
  }

  @Query('getMyStudySquad')
  async getMyStudySquad(@Context() ctx: LooseCtx) {
    const repo: SquadRepository = this.repo;
    const rows = await repo.userSquads(actorOf(ctx).userId);
    if (rows.length === 0) return null;
    const room = await repo.findById(rows[0]?.id as string);
    return room ? shapeOf(room) : null;
  }
}

export { StudySquadPayloadGql, CreateSquadPayloadGql };
