// SSOT Phase 101 BDD-3 — Poll engine (atomic counters + percentages)
// Canonical: apps/backend/src/modules/live/services/live-poll.engine.ts
// - create: question/options gates + durationSec → expiresAt → PG row.
// - vote: exactly-once via voter key (get → set + zincrby delta, re-votes
//   move one count) → PG upsert → percentages → analytics bump.
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { LIVE_STREAM, livePollCounterKey, livePollVotersKey, pollPercentages } from '@repo/shared';
import type { LiveRepository } from '../infrastructure/persistence/live-session.repository';
import type { LiveInteractionRepository } from '../repositories/live-interaction.repository';
import type { ChatFanOut } from './live-chat.engine';

export interface PollCounter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  zincrby(key: string, increment: number, member: string): Promise<void>;
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

@Injectable()
export class LivePollEngine {
  constructor(
    private readonly sessions: LiveRepository,
    private readonly interaction: LiveInteractionRepository,
    private readonly counters: PollCounter,
    private readonly fanout: ChatFanOut,
  ) {}

  async create(args: { sessionId: string; question: string; options: string[]; durationSec: number }) {
    const question = (args.question ?? '').slice(0, 300);
    const options = (args.options ?? []).slice(0, 6).map((o) => String(o).slice(0, 200)).filter((o) => o.length > 0);
    if (!question || options.length < 2) throw new Error('Invalid poll input');
    if (!(args.durationSec > 0)) throw new Error('Invalid durationSec');
    const session = await this.sessions.findSessionById(args.sessionId).catch(() => null);
    if (!session) throw new Error('Live session not found');
    const poll = await this.sessions.createPoll({
      sessionId: args.sessionId,
      question,
      expiresAt: new Date(Date.now() + args.durationSec * 1000),
      options,
    });
    await this.fanout
      .xaddPipeline(LIVE_STREAM, [{ event: 'live.poll.created', pollId: poll.id, at: Date.now() }])
      .catch(() => undefined);
    return this.results(poll.id);
  }

  async vote(args: { pollId: string; optionId: string; userId: string }) {
    const detail = await this.interaction.pollDetail(args.pollId);
    if (!detail || !detail.isActive) throw new Error('Poll is not active');
    if (detail.expiresAt && detail.expiresAt.getTime() < Date.now()) throw new Error('Poll expired');
    if (!detail.options.some((o) => o.id === args.optionId)) throw new Error('Unknown option');

    const voterKey = livePollVotersKey(args.pollId);
    const prev = await this.counters.get(voterKey + ':' + args.userId).catch(() => null);
    if (prev !== args.optionId) {
      await this.counters.set(voterKey + ':' + args.userId, args.optionId, 'EX', 86400).catch(() => undefined);
      await this.counters.zincrby(livePollCounterKey(args.pollId), 1, args.optionId).catch(() => undefined);
      if (prev) await this.counters.zincrby(livePollCounterKey(args.pollId), -1, prev).catch(() => undefined);
      await this.sessions.votePoll({ pollId: args.pollId, optionId: args.optionId, userId: args.userId }).catch(() => undefined);
      await this.interaction.bumpAnalytics(detail.sessionId, 'totalPollVotes').catch(() => undefined);
    }
    const results = await this.results(args.pollId, args.userId);
    await this.fanout
      .xaddPipeline(LIVE_STREAM, [{ event: 'live.poll.vote', pollId: args.pollId, at: Date.now() }])
      .catch(() => undefined);
    return results;
  }

  async results(pollId: string, userId?: string) {
    const detail = await this.interaction.pollDetail(pollId);
    if (!detail) throw new Error('Poll not found');
    const counts = new Map<string, number>(detail.options.map((o) => [o.id, 0]));
    for (const v of detail.votes) counts.set(v.optionId, (counts.get(v.optionId) ?? 0) + 1);
    const options = pollPercentages([...counts.entries()].map(([optionId, votes]) => ({ optionId, votes }))).map((p) => ({
      ...p,
      text: detail.options.find((o) => o.id === p.optionId)?.text ?? '',
    }));
    const totalVotes = options.reduce((a, o) => a + o.votes, 0);
    const userVotedOptionId = userId ? (detail.votes.find((v) => v.userId === userId)?.optionId ?? null) : null;
    return {
      pollId: detail.id,
      sessionId: detail.sessionId,
      question: detail.question,
      options,
      isActive: detail.isActive,
      totalVotes,
      userVotedOptionId,
      expiresAt: detail.expiresAt ? detail.expiresAt.toISOString() : null,
    };
  }
}
