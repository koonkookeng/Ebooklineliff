// SSOT Phase 047 §5.1 — QuizSession entity (overlay state machine, pure)
// Canonical: apps/backend/src/modules/quiz/domain/entities/quiz-session.entity.ts
// (legacy src/backend/modules/quiz/domain/entities/quiz-session.entity.ts)
// - QUIZ_IDLE → QUIZ_TRIGGERED → QUIZ_EVALUATING → QUIZ_SUCCESS /
//   QUIZ_RETRY_LOCK (§2.2). Retry budget enforced here (maxRetries 0 =
//   unlimited); the client mirrors these transitions 1:1.
// - Pure + tsx-safe. Zero new deps.
export type QuizSessionState = 'QUIZ_IDLE' | 'QUIZ_TRIGGERED' | 'QUIZ_EVALUATING' | 'QUIZ_SUCCESS' | 'QUIZ_RETRY_LOCK';

export interface QuizSessionProps {
  quizId: string;
  maxRetries: number;
  attempts: number;
  passed: boolean;
}

export class QuizSession {
  private state: QuizSessionState = 'QUIZ_IDLE';

  private constructor(readonly props: QuizSessionProps) {}

  static start(quizId: string, maxRetries: number, attempts = 0, passed = false): QuizSession {
    if (!quizId) throw new Error('Missing quiz id');
    if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new Error('Invalid retry budget');
    const session = new QuizSession({ quizId, maxRetries, attempts, passed });
    if (passed) session.state = 'QUIZ_SUCCESS';
    return session;
  }

  current(): QuizSessionState {
    return this.state;
  }

  trigger(): void {
    if (this.state === 'QUIZ_SUCCESS') return;
    if (this.state !== 'QUIZ_IDLE' && this.state !== 'QUIZ_RETRY_LOCK') {
      throw new Error(`Illegal trigger from ${this.state}`);
    }
    this.state = 'QUIZ_TRIGGERED';
  }

  submit(): void {
    if (this.state !== 'QUIZ_TRIGGERED' && this.state !== 'QUIZ_RETRY_LOCK') {
      throw new Error(`Illegal submit from ${this.state}`);
    }
    this.state = 'QUIZ_EVALUATING';
  }

  resolve(correct: boolean): QuizSessionState {
    if (this.state !== 'QUIZ_EVALUATING') throw new Error(`Illegal resolve from ${this.state}`);
    if (correct) {
      this.state = 'QUIZ_SUCCESS';
      return this.state;
    }
    const nextAttempts = this.props.attempts + 1;
    if (this.props.maxRetries > 0 && nextAttempts >= this.props.maxRetries) {
      // Budget exhausted: stay visible but locked (client shows the answer path).
      this.state = 'QUIZ_RETRY_LOCK';
      return this.state;
    }
    this.props.attempts = nextAttempts;
    this.state = 'QUIZ_RETRY_LOCK';
    return this.state;
  }

  dismiss(): void {
    if (this.state !== 'QUIZ_SUCCESS') throw new Error('Only success dismisses the overlay');
    this.state = 'QUIZ_IDLE';
  }
}
