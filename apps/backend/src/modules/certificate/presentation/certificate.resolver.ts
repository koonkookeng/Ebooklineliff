// SSOT Phase 048 Task 4/5 — CertificateResolver (GraphQL code-first)
// Canonical: apps/backend/src/modules/certificate/presentation/certificate.resolver.ts
// (legacy src/backend/modules/certificate/presentation/certificate.resolver.ts)
// Runtime is code-first (autoSchemaFile); SDL supplement lives at
// apps/backend/src/api/graphql/schemas/certificate.graphql/schema.graphql.
// - Query.verifyCertificate(certificateNo): public verification lookup (<200ms).
// - Query.getMyCertificates: authenticated user's ISSUED certificates.
// - Mutation.issueCourseCertificate(courseId): manual re-issue (JWT; service
//   enforces completion-gate + idempotency).
// - Zero new deps.
import { Args, Context, Field, ID, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { GenerateCertificateInputSchema } from '@repo/shared';
import { CertificateVerificationService } from '../application/services/certificate-verification.service';
import { CertificatePdfGeneratorService } from '../application/services/certificate-pdf-generator.service';
import { resolveReaderIdentity, type ReaderGqlContext } from '../../reader/reader-identity';

@ObjectType('CertificateVerificationResult')
class CertificateVerificationResultGql {
  @Field() isValid!: boolean;
  @Field() certificateNo!: string;
  @Field() studentName!: string;
  @Field() courseTitle!: string;
  @Field() issuedAt!: string;
  @Field() issuerName!: string;
  @Field() digitalSignatureHash!: string;
  @Field() pdfUrl!: string;
}

@ObjectType('CertificateItem')
class CertificateItemGql {
  @Field(() => ID) id!: string;
  @Field() certificateNo!: string;
  @Field() courseTitle!: string;
  @Field() coverImageUrl!: string;
  @Field() issuedAt!: string;
  @Field() pdfUrl!: string;
  @Field() qrCodeUrl!: string;
}

@ObjectType('CertificatePayload')
class CertificatePayloadGql {
  @Field() success!: boolean;
  @Field() certificateNo!: string;
  @Field() pdfUrl!: string;
  @Field() qrCodeUrl!: string;
}

interface CertificateGqlContext {
  req?: { user?: { id?: string }; ip?: string; headers?: Record<string, string | undefined> };
}

function clientIpOf(ctx: CertificateGqlContext | undefined): string {
  const req = (ctx as unknown as { req?: { ip?: string; headers?: Record<string, string | undefined> } })?.req;
  return req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.ip || 'unknown';
}

@Resolver('Certificate')
export class CertificateResolver {
  constructor(
    private readonly verifier: CertificateVerificationService,
    private readonly generator: CertificatePdfGeneratorService,
  ) {}

  @Query('verifyCertificate')
  async verifyCertificate(
    @Args('certificateNo') certificateNo: string,
    @Context() gqlCtx?: CertificateGqlContext,
  ) {
    if (!certificateNo) throw new BadRequestException('Missing certificate number');
    return this.verifier.verifyCertificate({
      certificateNo,
      clientIp: clientIpOf(gqlCtx),
    });
  }

  @Query('getMyCertificates')
  @UseGuards(JwtAuthGuard)
  async getMyCertificates(@Context() gqlCtx?: ReaderGqlContext) {
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.verifier.getUserCertificates(userId);
  }

  @Mutation('issueCourseCertificate')
  @UseGuards(JwtAuthGuard)
  async issueCourseCertificate(@Args('courseId') courseId: string, @Context() gqlCtx?: ReaderGqlContext) {
    const { userId } = resolveReaderIdentity(gqlCtx);
    const parsed = GenerateCertificateInputSchema.safeParse({ userId, courseId });
    if (!parsed.success) throw new BadRequestException('Invalid input');
    const result = await this.generator.generateCertificate(parsed.data);
    return { success: true, ...result };
  }
}
