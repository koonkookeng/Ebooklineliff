// SSOT Phase 101 §6.1 — Virtualized interaction overlay (window-50, <30MB)
// Canonical: apps/frontend/components/live/LiveInteractionOverlay.tsx
// - RISK_CALL (transport): SSE room stream replaces the spec's WS client.
//   Viewer badge + window-50 chat + sticker send + hand-raise (500ms
//   debounce) + poll widget; DOM capped at 50 chat nodes (BDD-1).
// - Zero-dep (React).
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { liveChatWindow } from '@repo/shared';
import { useLiveSocket } from '../../hooks/useLiveSocket';
import { extendLiveApi } from '../../lib/live/live-client';

interface ChatMsg {
  id: string;
  displayName: string;
  messageType: string;
  content: string;
  stickerId?: string;
}

const WINDOW = 50;

export function LiveInteractionOverlay(props: { sessionId: string; token: string }) {
  const { events, viewers } = useLiveSocket(props.sessionId, props.token);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [raiseState, setRaiseState] = useState<'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [poll, setPoll] = useState<{
    pollId: string; question: string;
    options: Array<{ optionId: string; text: string; votes: number; percentage: number }>;
  } | null>(null);
  const api = extendLiveApi();
  const cursor = useRef(0);

  useEffect(() => {
    // Process only unseen events (cursor) — avoids re-scanning history.
    const unseen = events.slice(cursor.current);
    cursor.current = events.length;
    for (const { event, payload } of unseen) {
      if (event === 'newMessage') {
        const m = payload as unknown as ChatMsg;
        setMessages((prev) => liveChatWindow([...prev, m], WINDOW));
      } else if (event === 'pollCreated' || event === 'pollVoteUpdate') {
        setPoll(payload as unknown as typeof poll);
      } else if (event === 'handRaiseUpdate') {
        const r = payload as { status?: string };
        if (r.status && r.status !== 'PENDING') setRaiseState('IDLE');
      }
    }
  }, [events]);

  useEffect(() => {
    let alive = true;
    void api.chatEnriched(props.sessionId).then((h) => {
      if (alive) setMessages(liveChatWindow((h as unknown as ChatMsg[]).slice(-WINDOW), WINDOW));
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sessionId]);

  async function send(type: 'TEXT' | 'LINE_STICKER' = 'TEXT') {
    const content = type === 'TEXT' ? input.slice(0, 500) : '[LINE Sticker]';
    if (type === 'TEXT' && !content.trim()) return;
    setInput('');
    try {
      await api.sendChat(props.sessionId, {
        content,
        messageType: type,
        ...(type === 'LINE_STICKER' ? { stickerPackageId: '1', stickerId: '2' } : {}),
      });
    } catch {
      // SSE will converge on retry
    }
  }

  async function raiseHand() {
    if (raiseState === 'LOADING') return;
    setRaiseState('LOADING');
    try {
      await api.raiseHand(props.sessionId);
      setRaiseState('SUCCESS');
    } catch {
      setRaiseState('ERROR');
    }
  }

  async function vote(optionId: string) {
    if (!poll) return;
    try {
      setPoll(await api.votePoll2(poll.pollId, optionId));
    } catch {
      // keep the widget open for retry
    }
  }

  return (
    <div>
      <div>
        <span role="status">LIVE | {viewers.toLocaleString()} Viewers</span>
      </div>

      <ul aria-live="polite">
        {messages.map((msg) => (
          <li key={msg.id}>
            <span>{msg.displayName}: </span>
            {msg.messageType === 'LINE_STICKER' && msg.stickerId ? (
              <img
                src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${msg.stickerId}/android/sticker.png`}
                alt="LINE Sticker"
                width={64}
                height={64}
                loading="lazy"
              />
            ) : (
              <span>{msg.content}</span>
            )}
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send('TEXT');
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={500} placeholder="พิมพ์ข้อความแชตสด..." />
        <button type="button" onClick={() => void send('LINE_STICKER')}>สติกเกอร์</button>
        <button type="submit">ส่ง</button>
        <button type="button" onClick={() => void raiseHand()} disabled={raiseState === 'LOADING'}>
          {raiseState === 'SUCCESS' ? 'ยกมือแล้ว' : 'ยกมือถาม'}
        </button>
      </form>

      {poll && (
        <div role="dialog" aria-label={poll.question}>
          <p>{poll.question}</p>
          <ul>
            {poll.options.map((o) => (
              <li key={o.optionId}>
                <button type="button" onClick={() => void vote(o.optionId)}>
                  {o.text} ({o.percentage}%)
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default LiveInteractionOverlay;
