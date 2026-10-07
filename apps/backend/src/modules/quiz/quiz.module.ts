// SSOT Phase 047 §5.1 — QuizModule (in-video quiz wiring)
// Canonical: apps/backend/src/modules/quiz/quiz.module.ts
// - useFactory wiring keeps application services tsx-importable.
//   PrismaService arrives via global InfraModule (single pool).
// - Registered into StreamModule? No — top-level AppModule (quiz is a
//   first-class domain; stream stays delivery-only).
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { AiHintGeneratorService } from './application/services/ai-hint-generator.service';
import { QuizEvaluatorService } from './application/services/quiz-evaluator.service';
import { PrismaQuizRepository } from './infrastructure/persistence/prisma-quiz.repository';
import { QuizController } from './presentation/quiz.controller';
import { QuizResolver } from './presentation/quiz.resolver';

@Module({
  controllers: [QuizController],
  providers: [
    AiHintGeneratorService,
    {
      provide: PrismaQuizRepository,
      useFactory: (prisma: PrismaService): PrismaQuizRepository => new PrismaQuizRepository(prisma as never),
      inject: [PrismaService],
    },
    {
      provide: QuizEvaluatorService,
      useFactory: (repo: PrismaQuizRepository, hints: AiHintGeneratorService): QuizEvaluatorService =>
        new QuizEvaluatorService(repo, hints),
      inject: [PrismaQuizRepository, AiHintGeneratorService],
    },
    QuizResolver,
  ],
  exports: [QuizEvaluatorService, PrismaQuizRepository],
})
export class QuizModule {}
