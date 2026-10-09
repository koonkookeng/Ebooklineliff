// SSOT Phase 099 BDD-2 — Virtualized live chat overlay (50-item window)
// Canonical: apps/frontend/components/live/LiveChatOverlay.tsx
// - Newest-50 sliding window (BDD-2 RAM guard); SSE append + history seed;
//   EventSource torn down on unmount. Zero-dep (React).
'use client';

import React, { useEffect, useState } from 'react';
import { liveApi, type LiveChatItem } from '../../lib/live/live-client';
import { liveChatWindow } from '@repo/shared';

const WINDOW = 50;

export function LiveChatOverlay(props: { sessionId: string }) {
  const [items, setItems] = useState<LiveChatItem[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    let alive = true;
    void liveApi().chatHistory(props.sessionId).then((h) => {
      if (alive) setItems(liveChatWindow(h, WINDOW));
    }).catch(() => undefined);
    const es = liveApi().chatStream(props.sessionId);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse((ev as MessageEvent).data) as LiveChatItem;
        setItems((prev) => liveChatWindow([...prev, msg], WINDOW));
      } catch {
        // ignore malformed frames
      }
    };
    return () => {
      alive = false;
      es.close();
    };
  }, [props.sessionId]);

  async function send() {
    const content = draft.slice(0, 500);
    if (!content) return;
    setDraft('');
    try {
      await liveApi().postChat(props.sessionId, content);
    } catch {
      // stream will converge on retry; keep the window GC'd
    }
  }

  return (
    <div>
      <ul aria-live="polite">
        {items.map((m) => (
          <li key={m.messageId}>{m.content}</li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="Chat..." />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}

export default LiveChatOverlay;
