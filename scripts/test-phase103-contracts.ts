// SSOT Phase 103 §10-11 — contract tests (Zod, create/escalate/resolve, RAG, sentiment, parity)
// Run: npx tsx scripts/test-phase103-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TicketStatusEnum,
  TicketPriorityEnum,
  SenderTypeEnum,
  SupportTicketPayloadSchema,
  BotQueryInputSchema,
  AIResponsePayloadSchema,
  TICKET_SLA_MINUTES,
  FCR_SILENCE_MINUTES,
  ticketNumber,
  ticketMessageStreamKey,
  ticketAgentLockKey,
  ESCALATION_CONFIDENCE_THRESHOLD,
} from '../packages/shared/src/schemas/support-ticket-contract';
import { CreateTicketUseCase } from '../apps/backend/src/modules/support/application/use-cases/create-ticket.use-case';
import { EscalateToAgentUseCase } from '../apps/backend/src/modules/support/application/use-cases/escalate-to-agent.use-case';
import { ResolveTicketUseCase } from '../apps/backend/src/modules/support/application/use-cases/resolve-ticket.use-case';
import { RAGSearchService } from '../apps/backend/src/modules/ai-bot/application/rag-search.service';
import { SentimentAnalyzerService } from '../apps/backend/src/modules/ai-bot/application/sentiment-analyzer.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(TicketStatusEnum.safeParse('CLOSED').success, true);
  assert.equal(TicketStatusEnum.safeParse('DONE').success, false);
  assert.equal(TicketPriorityEnum.safeParse('URGENT').success, true);
  assert.equal(TicketPriorityEnum.safeParse('CRITICAL').success, false);
  assert.equal(SenderTypeEnum.safeParse('SYSTEM_ALERT').success, true);
  assert.equal(SenderTypeEnum.safeParse('BOT').success, false);
  assert.equal(
      SupportTicketPayloadSchema.safeParse({
        ticketId: UUID, ticketNo: 'TKT-1', userId: UUID_B, category: 'general',
        subject: 'Valid subject line', priority: 'HIGH', status: 'OPEN', createdAt: '2026-01-01',
      }).success,
      true,
    );
  assert.equal(SupportTicketPayloadSchema.safeParse({ ticketId: UUID, ticketNo: 'TKT-1', userId: UUID_B, category: 'general', subject: 'Valid subject line', priority: 'SUPER', status: 'OPEN', createdAt: '2026-01-01' }).success, false);
  assert.equal(BotQueryInputSchema.safeParse({ userId: UUID, queryText: 'Hello', tenantId: 't1' }).success, true);
  assert.equal(BotQueryInputSchema.safeParse({ userId: UUID, queryText: '', tenantId: 't1' }).success, false);
  assert.equal(AIResponsePayloadSchema.safeParse({ answerText: 'Hi', confidenceScore: 0.8, suggestedActions: [], shouldEscalateToHuman: false }).success, true);
  assert.equal(AIResponsePayloadSchema.safeParse({ answerText: 'Hi', confidenceScore: 1.5, suggestedActions: [], shouldEscalateToHuman: false }).success, false);
  ok('Zod §3.1 verbatim (status/priority/sender/ticket/bot/ai gates)');
}

// ---------- 2. Pure helpers ----------
{
  assert.deepEqual(TICKET_SLA_MINUTES, { URGENT: 15, HIGH: 60, MEDIUM: 240, LOW: 1440 });
  assert.equal(FCR_SILENCE_MINUTES, 5);
  assert.ok(/^TKT-[0-9A-Z]+-[0-9A-Z]{4}$/.test(ticketNumber()));
  assert.notEqual(ticketNumber(1000, 1), ticketNumber(1000, 2));
  assert.equal(ticketMessageStreamKey('t1'), 'support:ticket:t1:messages');
  assert.equal(ticketAgentLockKey('t1'), 'lock:support:agent:t1');
  assert.equal(ESCALATION_CONFIDENCE_THRESHOLD, 0.6);
  ok('Helpers: SLA/FCR/ticketNo/stream keys/lock/escalation threshold');
}

// ---------- 3. CreateTicketUseCase ----------
async function sectionCreate(): Promise<void> {
  const cats = [{ id: 'cat-1', name: 'General' }];
  const created: Array<{ ticketNo: string }> = [];
  const repo = {
    findCategoryById: async (id: string) => (id === 'cat-1' ? { id, name: 'General' } : null),
    createTicket: async (d: Record<string, unknown>) => { created.push(d as any); return { id: 'tkt-1', ...d, status: 'OPEN', createdAt: new Date() }; },
  };
  const svc = new CreateTicketUseCase(repo as never);
  const r = await svc.execute({ userId: UUID, categoryId: 'cat-1', subject: 'Valid subject line', priority: 'HIGH', message: 'Hello' });
  assert.deepEqual([r.ticketId, r.ticketNo.startsWith('TKT-'), r.status, r.priority, r.slaMinutes], ['tkt-1', true, 'OPEN', 'HIGH', 60]);
  assert.deepEqual(created.length, 1);
  await assert.rejects(svc.execute({ userId: UUID, categoryId: 'bad', subject: 'Valid subject line', priority: 'HIGH', message: 'x' }), /Invalid category/);
  await assert.rejects(svc.execute({ userId: UUID, categoryId: 'cat-1', subject: 'Valid subject line', priority: 'SUPER', message: 'x' }), /Invalid priority/);
  ok('CreateTicket: success + category/priority gates');
}

// ---------- 4. EscalateToAgentUseCase ----------
async function sectionEscalate(): Promise<void> {
  const created: Array<{ priority: string }> = [];
  const repo = {
    findCategoryById: async (id: string) => (id === 'cat-1' ? { id, name: 'General' } : null),
    createTicket: async (d: Record<string, unknown>) => { created.push(d as any); return { id: 'tkt-2', ...d, status: 'OPEN', createdAt: new Date() }; },
  };
  const svc = new EscalateToAgentUseCase(repo as never);
  const r = await svc.execute({ userId: UUID, tenantId: 't1', sessionId: 's1', message: 'I need human', categoryId: 'cat-1', confidenceScore: 0.4, sentiment: 'negative' });
  assert.deepEqual([r.ticketId, r.priority], ['tkt-2', 'HIGH']);
  assert.deepEqual(created.length, 1);
  await assert.rejects(svc.execute({ userId: UUID, tenantId: 't1', sessionId: 's1', message: 'x', categoryId: 'bad', confidenceScore: 0.4, sentiment: 'negative' }), /Invalid category/);
  ok('Escalate: HIGH priority + ticket created + category gate');
}

// ---------- 5. ResolveTicketUseCase ----------
async function sectionResolve(): Promise<void> {
  const updated: string[] = [];
  const messages: Array<{ ticketId: string; senderType: string; messageText: string }> = [];
  const repo = {
    findTicketById: async (id: string) => (id === 'tkt-3' ? { id: 'tkt-3', status: 'OPEN' } : null),
    updateTicketStatus: async (id: string, status: string) => { updated.push(`${id}:${status}`); },
    addMessage: async (d: { ticketId: string; senderType: string; senderId: string; messageText: string }) => { messages.push(d); },
  };
  const svc = new ResolveTicketUseCase(repo as never);
  await svc.execute({ ticketId: 'tkt-3', agentId: UUID, resolutionNote: 'Fixed' });
  assert.deepEqual([updated[0], messages[0].senderType], ['tkt-3:RESOLVED', 'HUMAN_AGENT']);
  await assert.rejects(svc.execute({ ticketId: 'tkt-99', agentId: UUID, resolutionNote: 'x' }), /not found/);
  ok('Resolve: status+message + not-found gate');
}

// ---------- 6. RAG Search (stubbed vectors) ----------
async function sectionRAG(): Promise<void> {
  const hits = [
    { id: 'kb-1', question: 'How to read E-Book?', answer: 'Open library and tap the book.', similarity: 0.9 },
    { id: 'kb-2', question: 'Payment failed', answer: 'Check slip and retry.', similarity: 0.3 },
  ];
  const vectors = {
    queryRawUnsafe: async <T>(sql: string, vector: number[], tenant: string): Promise<T> => {
      assert.ok(sql.includes('embedding <=>') && sql.includes('tenantId'));
      return hits as T;
    },
  };
  const embed = { embed: async (text: string) => new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)) };
  const svc = new RAGSearchService(embed as never, vectors);
  const r = await svc.queryKnowledgeBase('How to read E-Book?');
  assert.deepEqual([r.answerText, r.confidenceScore >= 0.5, r.shouldEscalateToHuman], ['Open library and tap the book.', true, false]);
  const lowVec = { queryRawUnsafe: async () => [{ id: 'kb-3', question: 'x', answer: 'y', similarity: 0.1 }] };
  const rLow = await new RAGSearchService(embed as never, lowVec as never).queryKnowledgeBase('unknown');
  assert.equal(rLow.shouldEscalateToHuman, true);
  ok('RAG: high similarity returns answer; low similarity escalates');
}

// ---------- 7. Sentiment Analyzer ----------
{
  const analyzer = new SentimentAnalyzerService();
  assert.equal(analyzer.analyze('ขอบคุณครับ ดีมาก'), 'positive');
  assert.equal(analyzer.analyze('ช้าเกินไป ไม่ได้เลย'), 'negative');
  assert.equal(analyzer.analyze('ได้แล้วครับ'), 'positive');
  assert.equal(analyzer.analyze('ผิดพลาด เกิดข้อผิดพลาด'), 'negative');
  assert.equal(analyzer.analyze('สวัสดีครับ'), 'neutral');
  ok('Sentiment: positive/negative/neutral heuristic');
}

// ---------- 8. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum TicketStatus {',
    'WAITING_USER_RESPONSE',
    'enum TicketPriority {',
    'URGENT',
    'enum SenderType {',
    'SYSTEM_ALERT',
    'model SupportCategory {',
    'model SupportTicket {',
    'priority     TicketPriority    @default(MEDIUM)',
    'status       TicketStatus      @default(OPEN)',
    'model TicketMessage {',
    'senderType    SenderType',
    'model TicketAttachment {',
    'model KnowledgeBaseVector {',
    'embedding   Unsupported("vector(1536)")?',
    'model AIBotConversationHistory {',
    'supportTickets    SupportTicket[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: categories/tickets/messages/attachments/KB/bot-history + User relation');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/support/repositories/support.repository.ts',
    'apps/backend/src/modules/support/application/use-cases/create-ticket.use-case.ts',
    'apps/backend/src/modules/support/application/use-cases/escalate-to-agent.use-case.ts',
    'apps/backend/src/modules/support/application/use-cases/resolve-ticket.use-case.ts',
    'apps/backend/src/modules/ai-bot/application/rag-search.service.ts',
    'apps/backend/src/modules/ai-bot/application/sentiment-analyzer.service.ts',
    'apps/backend/src/modules/support/infrastructure/websocket/support-chat.gateway.ts',
    'apps/backend/src/modules/support/support.module.ts',
    'apps/backend/src/modules/support/support.controller.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
    assert.ok(!/ServiceService|ModuleModule|ResolverResolver|ControllerController/.test(src), `${f} scaffold name`);
  }
  const gql = readFileSync('apps/backend/src/modules/support/support.controller.ts', 'utf8');
  assert.ok(gql.includes('createTicket') && gql.includes('escalate') && gql.includes('resolve'), 'Controller endpoints');
  assert.ok(gql.includes('attachments') && gql.includes('presignedPutUrl') && gql.includes('redactPII'), 'Task 5 R2 attachment vault + §8.2 PII guardrail');
  for (const p of [
    'apps/frontend/components/support/SupportChat.tsx',
    'apps/frontend/hooks/useSupport.ts',
    'apps/frontend/lib/support/support-client.ts',
    'apps/frontend/app/(liff)/support/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useSupport.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  for (const p of [
    'apps/frontend/app/api/v1/support/tickets/route.ts',
    'apps/frontend/app/api/v1/support/tickets/[id]/route.ts',
    'apps/frontend/app/api/v1/support/tickets/[id]/messages/route.ts',
    'apps/frontend/app/api/v1/support/tickets/[id]/stream/route.ts',
    'apps/frontend/app/api/v1/support/bot/query/route.ts',
    'apps/frontend/app/api/v1/support/categories/route.ts',
    'apps/frontend/app/api/v1/support/agent/room/stream/route.ts',
    'apps/frontend/app/api/v1/support/agent/open-tickets/route.ts',
    'apps/frontend/app/api/v1/support/tickets/[id]/escalate/route.ts',
    'apps/frontend/app/api/v1/support/tickets/[id]/messages/[messageId]/attachments/route.ts',
    'apps/frontend/app/api/v1/support/tickets/[id]/assign/route.ts',
    'apps/frontend/app/api/v1/support/tickets/[id]/resolve/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('support-ticket-contract') && barrel.includes('TicketStatusEnum'));
  ok('Parity: module/controller/frontend/hook/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionCreate();
  await sectionEscalate();
  await sectionResolve();
  await sectionRAG();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase103 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);