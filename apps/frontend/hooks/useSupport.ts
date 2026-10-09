// SSOT Phase 103 §2.2 — Support hook (5-state, SSE fan-out)
// Canonical: apps/frontend/hooks/useSupport.ts
// - LIFF_INIT → IDLE (bot ready) → LOADING (AI thinking) → SUCCESS (response)
//   / ERROR (fallback + retry). 20-message window cap (RAM < 28MB).
'use client';

import { useEffect, useRef, useState } from 'react';
import { supportApi, type Ticket, type Message, type Category, type SupportStatus } from '../lib/support/support-client';

export interface ChatMessage {
  id: string;
  sender: 'USER' | 'AI' | 'AGENT' | 'SYSTEM';
  text: string;
  timestamp: string;
}

const WINDOW = 20;

function cap<T>(prev: T[], next: T): T[] {
  return [...prev.slice(-(WINDOW - 1)), next];
}

export function useSupport() {
  const [status, setStatus] = useState<SupportStatus>('LIFF_INIT');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [botTyping, setBotTyping] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const alive = useRef(true);

  // Initial load
  useEffect(() => {
    alive.current = true;
    setStatus('LIFF_INIT');
    (async () => {
      try {
        const [ts, cats] = await Promise.all([supportApi().list(), supportApi().categories()]);
        if (!alive.current) return;
        setTickets(ts);
        setCategories(cats);
        setError(null);
        setStatus('IDLE');
      } catch (e) {
        if (!alive.current) return;
        setError((e as Error).message);
        setStatus('ERROR');
      }
    })();
    return () => { alive.current = false; };
  }, [retryTick]);

  // SSE message stream for active ticket
  useEffect(() => {
    if (!activeTicket) return;
    let live = true;
    const es = supportApi().ticketStream(activeTicket.id);
    es.addEventListener('bot_response', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { event: string; payload: { answer?: string; message?: string; timestamp?: string } };
        if (!live) return;
        if (data.event === 'bot_response') {
          setMessages((prev) => cap(prev, { id: `${Date.now()}`, sender: 'AI', text: data.payload.answer ?? '', timestamp: data.payload.timestamp ?? new Date().toISOString() }));
          setBotTyping(false);
        } else if (data.event === 'bot_escalated') {
          setMessages((prev) => cap(prev, { id: `${Date.now()}`, sender: 'SYSTEM', text: data.payload.message ?? '', timestamp: new Date().toISOString() }));
          setBotTyping(false);
        } else if (data.event === 'agent_message') {
          setMessages((prev) => cap(prev, { id: `${Date.now()}`, sender: 'AGENT', text: data.payload.message ?? '', timestamp: data.payload.timestamp ?? new Date().toISOString() }));
        }
      } catch { /* ignore malformed SSE frame */ }
    });
    es.addEventListener('error', () => { if (live) es.close(); });
    return () => { live = false; es.close(); };
  }, [activeTicket]);

  async function send(text: string) {
    if (!activeTicket || !text.trim() || botTyping) return;
    const content = text.trim();
    setInput('');
    setMessages((prev) => cap(prev, { id: `${Date.now()}`, sender: 'USER', text: content, timestamp: new Date().toISOString() }));
    setBotTyping(true);
    setStatus('LOADING');
    try {
      await supportApi().addMessage(activeTicket.id, content);
      const result = await supportApi().botQuery(content);
      if (!result.shouldEscalateToHuman) {
        setMessages((prev) => cap(prev, { id: `${Date.now()}`, sender: 'AI', text: result.answerText, timestamp: new Date().toISOString() }));
      } else {
        setMessages((prev) => cap(prev, { id: `${Date.now()}`, sender: 'SYSTEM', text: 'กำลังเชื่อมต่อกับเจ้าหน้าที่...', timestamp: new Date().toISOString() }));
      }
      setStatus('SUCCESS');
    } catch (e) {
      setError((e as Error).message);
      setStatus('ERROR');
    } finally {
      setBotTyping(false);
    }
  }

  async function openTicket(id: string) {
    const t = tickets.find((tk) => tk.id === id);
    if (!t) return;
    setActiveTicket(t);
    setMessages([]);
    setStatus('LOADING');
    try {
      const msgs: Message[] = await supportApi().messages(id);
      setMessages(
        msgs.map((m) => ({
          id: m.id,
          sender: m.senderType === 'USER' ? 'USER' : m.senderType === 'AI_BOT' ? 'AI' : m.senderType === 'HUMAN_AGENT' ? 'AGENT' : 'SYSTEM',
          text: m.messageText,
          timestamp: m.createdAt,
        } as ChatMessage)).slice(-WINDOW),
      );
      setStatus('SUCCESS');
    } catch (e) {
      setError((e as Error).message);
      setStatus('ERROR');
    }
  }

  async function newTicket() {
    setActiveTicket(null);
    setMessages([]);
    setStatus('IDLE');
  }

  async function createTicket(categoryId: string, subject: string, priority: string, message: string) {
    setStatus('LOADING');
    try {
      const r = await supportApi().create({ categoryId, subject, priority, message });
      setActiveTicket(null);
      setMessages([]);
      setTickets((prev) => [{ id: r.ticketId, ticketNo: r.ticketNo, subject, priority: r.priority, status: r.status, createdAt: new Date().toISOString() }, ...prev]);
      setError(null);
      setStatus('SUCCESS');
    } catch (e) {
      setError((e as Error).message);
      setStatus('ERROR');
      throw e;
    }
  }

  function retry() {
    setError(null);
    setRetryTick((n) => n + 1);
  }

  return {
    status,
    tickets,
    activeTicket,
    messages,
    input,
    setInput,
    categories,
    error,
    botTyping,
    openTicket,
    newTicket,
    createTicket,
    send,
    retry,
  };
}
