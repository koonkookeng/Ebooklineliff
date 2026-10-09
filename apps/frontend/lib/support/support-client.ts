// SSOT Phase 103 — Support client (REST + SSE transport)
// Canonical: apps/frontend/lib/support/support-client.ts
// - Zero-dep (fetch + EventSource only).
export type SupportStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface Ticket {
  id: string;
  ticketNo: string;
  subject: string;
  priority: string;
  status: string;
  createdAt: string;
}

export interface Message {
  id: string;
  ticketId: string;
  senderType: string;
  senderId: string | null;
  messageText: string;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`support ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function supportApi() {
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    // Tickets
    list: () => json<Ticket[]>(`/api/v1/support/tickets`),
    get: (id: string) => json<Ticket>(`/api/v1/support/tickets/${id}`),
    create: (body: { categoryId: string; subject: string; priority: string; message: string }) =>
      post('/api/v1/support/tickets', body) as Promise<{ ticketId: string; ticketNo: string; status: string; priority: string; slaMinutes: number }>,
    addMessage: (ticketId: string, text: string) =>
      post(`/api/v1/support/tickets/${encodeURIComponent(ticketId)}/messages`, { text }) as Promise<Message>,
    messages: (id: string) => json<Message[]>(`/api/v1/support/tickets/${encodeURIComponent(id)}/messages`),
    escalate: (id: string) => post(`/api/v1/support/tickets/${encodeURIComponent(id)}/escalate`, {}) as Promise<{ escalated: boolean }>,
    attach: (ticketId: string, messageId: string, fileType: string, fileSize: number) =>
      post(`/api/v1/support/tickets/${encodeURIComponent(ticketId)}/messages/${encodeURIComponent(messageId)}/attachments`, { fileType, fileSize }) as Promise<{
        attachmentId: string;
        fileUrl: string;
        uploadUrl: string;
        expiresInSeconds: number;
      }>,
    assign: (id: string) => post(`/api/v1/support/tickets/${encodeURIComponent(id)}/assign`, {}) as Promise<void>,
    resolve: (id: string, note: string) => post(`/api/v1/support/tickets/${encodeURIComponent(id)}/resolve`, { note }) as Promise<void>,
    // Categories
    categories: () => json<Category[]>(`/api/v1/support/categories`),
    // AI Bot
    botQuery: (query: string) =>
      post('/api/v1/support/bot/query', { query }) as Promise<{
        answerText: string;
        confidenceScore: number;
        suggestedActions: Array<{ label: string; actionUrl?: string; intentCode?: string }>;
        shouldEscalateToHuman: boolean;
      }>,
    // Agent
    openTickets: () => json<{ id: string; ticketNo: string; subject: string; priority: string }[]>(`/api/v1/support/agent/open-tickets`),
    agentRoom: (tenantId: string) =>
      new EventSource(`/api/v1/support/agent/room/stream?tenantId=${encodeURIComponent(tenantId)}`),
    // Ticket SSE
    ticketStream: (ticketId: string) =>
      new EventSource(`/api/v1/support/tickets/${encodeURIComponent(ticketId)}/stream`),
  };
}