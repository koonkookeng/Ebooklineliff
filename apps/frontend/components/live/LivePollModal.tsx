// SSOT Phase 099 Task 5 — Live poll vote modal (dep-free)
// Canonical: apps/frontend/components/live/LivePollModal.tsx
// - Single-vote (server upserts [pollId,userId]) + live tally refresh.
// - Zero-dep (React).
'use client';

import React, { useState } from 'react';
import { liveApi } from '../../lib/live/live-client';

export function LivePollModal(props: {
  pollId: string;
  question: string;
  options: Array<{ optionId: string; text: string }>;
}) {
  const [tally, setTally] = useState<Array<{ optionId: string; votes: number }>>([]);
  const [voted, setVoted] = useState(false);

  async function vote(optionId: string) {
    try {
      setTally(await liveApi().vote(props.pollId, optionId));
      setVoted(true);
    } catch {
      // keep the modal open for retry
    }
  }

  return (
    <div role="dialog" aria-label={props.question}>
      <p>{props.question}</p>
      <ul>
        {props.options.map((o) => (
          <li key={o.optionId}>
            <button type="button" onClick={() => void vote(o.optionId)} disabled={voted}>
              {o.text}
              {voted && ` (${tally.find((t) => t.optionId === o.optionId)?.votes ?? 0})`}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default LivePollModal;
