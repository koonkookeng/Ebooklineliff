// SSOT Phase 105 Task 5 — Public certificate GQL resolver (rich §3.1 payload)
// Canonical: apps/backend/src/modules/certificate/certificate.resolver.ts
// - Query.verifyCertificateDetails(certificateNo, hashSignature): public,
//   delegates PublicCertificateVerificationService. Named to avoid collision
//   with 048 presentation CertificateResolver.verifyCertificate. Zero new deps.
import { Args, Field, Float, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { PublicCertificateVerificationService } from './certificate-verification.service';

@ObjectType('CertificateIssuerPayload')
class CertificateIssuerGql {
  @Field()
  tenantId!: string;

  @Field()
  tenantName!: string;

  @Field()
  logoUrl!: string;

  @Field()
  verifiedDomain!: string;
}

@ObjectType('CertificateStudentPayload')
class CertificateStudentGql {
  @Field()
  studentName!: string;

  @Field({ nullable: true })
  avatarUrl?: string | null;

  @Field()
  completionDate!: string;
}

@ObjectType('CertificateDetailPayload')
class CertificateDetailGql {
  @Field()
  certificateNo!: string;

  @Field()
  courseTitle!: string;

  @Field()
  courseSlug!: string;

  @Field(() => Float)
  totalHours!: number;

  @Field()
  issuedAt!: string;

  @Field()
  pdfDownloadUrl!: string;

  @Field(() => CertificateStudentGql)
  student!: CertificateStudentGql;

  @Field(() => CertificateIssuerGql)
  issuer!: CertificateIssuerGql;
}

@ObjectType('CertificateVerificationPayloadGql')
class CertificateVerificationPayloadGql {
  @Field()
  success!: boolean;

  @Field()
  status!: string;

  @Field()
  message!: string;

  @Field(() => CertificateDetailGql, { nullable: true })
  data?: CertificateDetailGql | null;

  @Field()
  scannedAt!: string;
}

@Resolver()
export class PublicCertificateResolver {
  constructor(private readonly verifier: PublicCertificateVerificationService) {}

  @Query(() => CertificateVerificationPayloadGql)
  async verifyCertificateDetails(
    @Args('certificateNo') certificateNo: string,
    @Args('hashSignature', { nullable: true }) hashSignature?: string,
  ): Promise<CertificateVerificationPayloadGql> {
    return this.verifier.verifyPublicCertificate({
      certificateNo,
      hashSignature,
      ipAddress: 'graphql',
      userAgent: 'graphql',
    });
  }
}
