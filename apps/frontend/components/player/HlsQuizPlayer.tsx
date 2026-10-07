// SSOT Phase 047 Task 5 — HlsQuizPlayer (pause-lock quiz player, §6.1)
// Canonical: apps/frontend/components/player/HlsQuizPlayer.tsx
// (legacy src/frontend/components/player/HlsQuizPlayer.tsx)
// - Native <video> HLS (zero-dep; hls.js follow-up documented): quiz
//   checkpoints pause the element, scrubbing past maxAllowedTime snaps back
//   within a frame (<100ms, §10.2), success resumes at T+0.1s.
// - Overlay states mirror the backend QuizSession machine 1:1.
// - Zero new deps (react only).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { InVideoQuizOverlay } from '../quiz/InVideoQuizOverlay';
import type { QuizCheckpoint, QuizEvaluationResult } from '@repo/shared';

export interface QuizCheckpointProp {
  id: string;
  timestampSec: number;
  question: string;
  quizType: string;
  options: Array<{ id: string; optionText: string; optionOrder: number }>;
  maxRetries?: number;
}

interface HlsQuizPlayerProps {
  hlsStreamUrl: string;
  lessonId: string;
  quizzes: QuizCheckpointProp[];
  posterUrl?: string;
}

export function HlsQuizPlayer({ hlsStreamUrl, lessonId, quizzes, posterUrl }: HlsQuizPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeQuiz, setActiveQuiz] = useState<QuizCheckpointProp | null>(null);
  const [passedIds, setPassedIds] = useState<Set<string>>(new Set());
  const [maxAllowed, setMaxAllowed] = useState(0);
  const passedRef = useRef(passedIds);
  passedRef.current = passedIds;
  const activeRef = useRef(activeQuiz);
  activeRef.current = activeQuiz;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsStreamUrl) return;
    if (!video.canPlayType('application/vnd.apple.mpegurl')) return;
    video.src = hlsStreamUrl;
    return () => {
      video.removeAttribute('src');
      video.load();
    };
  }, [hlsStreamUrl]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const currentTime = video.currentTime;
    if (!activeRef.current) {
      for (const quiz of quizzes) {
        if (Math.floor(currentTime) >= quiz.timestampSec && !passedRef.current.has(quiz.id)) {
          video.pause();
          setActiveQuiz(quiz);
          break;
        }
      }
    }
    // Scrub lock: never rest past maxAllowed + 2s without an active quiz.
    if (!activeRef.current) {
      if (currentTime > maxAllowed + 2) {
        try {
          video.currentTime = maxAllowed;
        } catch {
          // Ignore pre-metadata seeks.
        }
      } else if (currentTime > maxAllowed) {
        setMaxAllowed(currentTime);
      }
    }
  }, [quizzes, maxAllowed]);

  const handleQuizSuccess = useCallback(
    (quizId: string, _result: QuizEvaluationResult) => {
      void _result;
      setPassedIds((prev) => new Set(prev).add(quizId));
      setActiveQuiz(null);
      const video = videoRef.current;
      if (video) {
        const resumeAt = video.currentTime + 0.1;
        setMaxAllowed(resumeAt);
        try {
          video.currentTime = resumeAt;
        } catch {
          // Ignore pre-metadata seeks.
        }
        void video.play().catch(() => undefined);
      }
    },
    [],
  );

  const toCheckpoint = (q: QuizCheckpointProp): QuizCheckpoint => ({
    id: q.id,
    lessonId,
    timestampSec: q.timestampSec,
    question: q.question,
    quizType: q.quizType as QuizCheckpoint['quizType'],
    options: q.options,
  });

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-lg">
      <video
        ref={videoRef}
        onTimeUpdate={handleTimeUpdate}
        controls={!activeQuiz}
        className="h-full w-full object-contain"
        playsInline
        poster={posterUrl}
        aria-label="Lesson video with quizzes"
      />
      {activeQuiz && (
        <InVideoQuizOverlay
          quiz={toCheckpoint(activeQuiz)}
          lessonId={lessonId}
          playbackTime={videoRef.current?.currentTime ?? activeQuiz.timestampSec}
          onSuccess={(result) => handleQuizSuccess(activeQuiz.id, result)}
        />
      )}
    </div>
  );
}

export default HlsQuizPlayer;
