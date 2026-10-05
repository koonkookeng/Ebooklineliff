<!-- SOURCE: Atomic Phase 085 | auto-split from Phase1-4_EbooklineliffV2.md (0-70) / Phase5-7_EbooklineliffV2.md (71-130) -->
# **Atomic Phase 085: พัฒนาระบบ Creator e-KYC Verification และการอนุมัติบัญชีรับเงิน**

## **มาตรฐานการขยายเฟสการพัฒนาซอฟต์แวร์ระดับ Enterprise (AN-HDS V4.0)**

### **Atomic Phase 085: พัฒนาระบบ Creator e-KYC Verification และการอนุมัติบัญชีรับเงิน**

### **1\. Intent, Scope & Token Boundaries (กรอบเป้าหมาย 144-XZ)**

#### **1.1 Phase Metadata**

* **PHASE\_ID:** PHASE-085-KYC (Creator e-KYC Verification & Bank Account Approval System)  
* **PHASE\_NAME:** Automated Creator Identity Verification, OCR Thai ID Processing, Bank Account Validation & Financial Onboarding Engine  
* **BUSINESS\_GOAL:** สร้างระบบลงทะเบียนและยืนยันตัวตนผู้สร้างสรรค์ผลงาน (Creator / Instructor / Seller) ผ่านระบบ e-KYC อัตโนมัติ ป้องกันการปลอมแปลงเอกสารและบัญชีม้า รองรับ OCR อ่านข้อมูลบัตรประชาชนไทย, ระบบตรวจสอบชื่อบัญชีธนาคารให้ตรงกับบัตรประชาชน (Bank Account Name Matching), ระบบตรวจสอบรหัสหลังบัตรประชาชน (Laser ID), และ Workflow การอนุมัติบัญชีรับเงิน (Payout Account Approval) ตามมาตรฐานกฎหมาย PDPA และการกำกับดูแลทางการเงิน โดยประมวลผลเสร็จสิ้นภายใน \< 3 วินาที  
* **MAX\_TOKEN\_BUDGET\_PER\_TASK:** 3000 tokens (Load Balanced SDID Context Boundary)

#### **1.2 Boundary Control (ขอบเขตไฟล์ที่อนุญาต)**

IN\_SCOPE\_FILES:  
src/database/prisma/schema.prisma  
src/backend/modules/kyc/\*\*/\*  
src/backend/modules/finance/payout/\*\*/\*  
src/backend/api/graphql/kyc/\*\*/\*  
src/frontend/app/(liff)/creator/kyc/\*\*/\*  
src/frontend/app/(web)/admin/kyc/\*\*/\*  
src/frontend/components/kyc/\*\*/\*  
src/shared/schemas/kyc-contract.ts

READ\_ONLY\_CONTEXT\_FILES:  
src/shared/schemas/sdid-contract.ts  
src/backend/modules/auth/\*\*/\*

OUT\_OF\_SCOPE\_STRICT:  
การแก้ไข Database Migration โดยไม่ผ่าน Prisma Engine  
การแก้ไขระบบ Payment Gateway สำหรับผู้ซื้อ (src/backend/modules/payment)

#### **1.3 BDD Behavioral Contracts (Gherkin Syntax)**

Gherkin  
Feature: Creator e-KYC Verification & Bank Account Approval Workflow

  Scenario: Automated OCR Extraction and Laser ID Check (\< 3 Seconds)  
    Given a Creator submits a Thai National ID Card image via LINE LIFF or Web Studio  
    When the system triggers the OCR Engine Service via Cloudflare R2 Private Bucket  
    Then the system extracts Name, ID Number, Birth Date, and Address with accuracy \>= 98%  
    And the system validates the Laser Code format against Department of Provincial Administration (DOPA) rules  
    And the Creator KYC Status changes to "PENDING\_APPROVAL" within 3 seconds

  Scenario: Bank Account Name Matching and Payout Activation  
    Given a Creator submits a Passbook Copy image with Bank Account Details  
    When the KycVerificationService executes fuzzy matching between ID Card Name and Bank Account Name  
    Then the match confidence score must be \>= 90%  
    And upon Super Admin or Automated Risk Engine approval  
    Then the Creator's User account is granted "VERIFIED\_CREATOR" role  
    And the Creator's Payout Account status transitions to "ACTIVE" for earnings settlement

### **2\. UX/UI Design System & LINE LIFF / Web Multi-Tenant Layer**

#### **2.1 UI/UX Tokens & Architecture**

* **FRAMEWORK:** Next.js 15 (React 19 Engine) PWA Architecture  
* **DESIGN SYSTEM:** Shadcn UI \+ Tailwind CSS v4 \+ Motion UI  
* **MULTI-TENANT ENGINE:** อ่าน Subdomain หรือ Query Parameter tenant จาก LINE LIFF URL เพื่อ Inject Dynamic CSS Variables (\--primary-color, \--logo-url, \--font-family) กำหนดค่าข้อความสืบเนื่องทางกฎหมาย (PDPA Notice / Watermark Text) สำหรับแต่ละ Tenant ในมิลลิวินาทีแรก  
* **DOCUMENT SCANNER UX:** กล้องสแกนหน้าบัตรพร้อมกรอบ overlay อัตโนมัติ (Framing Guide) ปรับความสว่างเรียลไทม์ และแจ้งเตือนเมื่อภาพเบลอหรือเกิดแสงสะท้อน (Glare Detection) ก่อนอัปโหลด  
* **LIFF CONSTRAINTS:** ควบคุม RAM ต่ำกว่า 30MB โดยใช้ Canvas Image Resizing และ Garbage Collection บีบอัดภาพเหลือ \< 2MB ก่อนส่งผ่าน Presigned URL เข้า R2 Vault

#### **2.2 Component State Machine Matrix (5 Mandatory States)**

| State | Trigger / Condition | UI Action & Component Behavior |
| :---- | :---- | :---- |
| **LIFF\_INIT** | liff.init() กำลังทำงาน | แสดง Splash Screen \+ Branding Theme ของ Tenant พร้อมตรวจสอบสถานะ KYC ปัจจุบัน |
| **IDLE** | ผู้ใช้เข้าสู่หน้า e-KYC Form | แสดง UI Step Guide 3 ขั้นตอน (1. บัตรประชาชน 2\. สแกนใบหน้า 3\. บัญชีธนาคาร) |
| **LOADING** | ขณะทำการ OCR / Upload ภาพเข้า R2 Vault | แสดง OCR Pulse Animation, Progress Bar อัปโหลด และ Skeleton UI |
| **SUCCESS** | OCR สำเร็จ / ส่งแบบฟอร์มสำเร็จ | แสดงปุ่มยืนยันข้อมูลที่อ่านได้จาก OCR และ Success Checklist Banner |
| **ERROR** | ภาพไม่ชัด / เลขบัตรผิด / ระบบปฏิเสธ | แสดง Warning Toast พร้อมกรอบแดงเน้นจุดที่ต้องแก้ไข และปุ่ม ถ่ายภาพใหม่ |

### **3\. Single Source of Truth (SSOT \- Zod & GraphQL Intent Layer)**

#### **3.1 Unified Zod Domain Contract (src/shared/schemas/kyc-contract.ts)**

TypeScript  
import { z } from 'zod';

export const KYCStatusEnum \= z.enum(\[  
  'NOT\_SUBMITTED',  
  'PENDING',  
  'VERIFIED',  
  'REJECTED',  
  'ACTION\_REQUIRED'  
\]);

export const BankCodeEnum \= z.enum(\[  
  'KBANK', 'SCB', 'BBL', 'KTB', 'BAY', 'TTB', 'GSB', 'CIMB', 'UOB'  
\]);

export const CreatorKYCInputSchema \= z.object({  
  idCardNumber: z.string().length(13, 'เลขบัตรประชาชนต้องมี 13 หลัก').regex(/^\\d+\$/, 'ต้องเป็นตัวเลขเท่านั้น'),  
  laserCode: z.string().length(12, 'รหัสหลังบัตรประชาชนต้องมี 12 หลัก (2 อักษร \+ 10 ตัวเลข)'),  
  firstNameTh: z.string().min(1, 'กรุณาระบุชื่อภาษาไทย'),  
  lastNameTh: z.string().min(1, 'กรุณาระบุนามสกุลภาษาไทย'),  
  birthDate: z.string().datetime(),  
  idCardImageUrl: z.string().url('URL ภาพหน้าบัตรไม่ถูกต้อง'),  
  selfieImageUrl: z.string().url('URL ภาพถ่ายคู่บัตร/ใบหน้าไม่ถูกต้อง'),  
  bankCode: BankCodeEnum,  
  bankAccountNumber: z.string().min(8).max(15).regex(/^\\d+\$/, 'เลขบัญชีต้องเป็นตัวเลขเท่านั้น'),  
  bankAccountName: z.string().min(1, 'กรุณาระบุชื่อบัญชีธนาคาร'),  
  bookbankImageUrl: z.string().url('URL ภาพหน้าสมุดบัญชีไม่ถูกต้อง'),  
  taxId: z.string().optional(),  
});

export const KYCOcrResponseSchema \= z.object({  
  success: z.boolean(),  
  extractedData: z.object({  
    idCardNumber: z.string().optional(),  
    firstNameTh: z.string().optional(),  
    lastNameTh: z.string().optional(),  
    birthDate: z.string().optional(),  
    address: z.string().optional(),  
    ocrConfidence: z.number().min(0).max(1),  
  }),  
  isBlurry: z.boolean(),  
  hasGlare: z.boolean(),  
});

export const KYCApprovalActionSchema \= z.object({  
  kycId: z.string().uuid(),  
  status: z.enum(\['VERIFIED', 'REJECTED', 'ACTION\_REQUIRED'\]),  
  rejectionReason: z.string().optional(),  
  adminNote: z.string().optional(),  
});

### **4\. Database & SDID Persistence Layer (PostgreSQL 16\)**

#### **4.1 Prisma Relational Schema Spec (src/database/prisma/schema.prisma)**

ข้อมูลโค้ด  
// Update User Model for KYC & Payout Integration  
enum KYCStatus {  
  NOT\_SUBMITTED  
  PENDING  
  VERIFIED  
  REJECTED  
  ACTION\_REQUIRED  
}

enum PayoutAccountStatus {  
  INACTIVE  
  PENDING\_VERIFICATION  
  ACTIVE  
  SUSPENDED  
}

model CreatorKYC {  
  id                 String             @id @default(uuid())  
  userId             String             @unique  
  user               User               @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
    
  // Encrypted Sensitive Personal Data (AES-256-GCM)  
  idCardNumberEnc    String  
  laserCodeEnc       String  
  firstNameTh        String  
  lastNameTh         String  
  birthDate          DateTime  
    
  // Documents Vault Paths (Cloudflare R2 Private Bucket)  
  idCardImageUrl     String  
  selfieImageUrl     String  
  bookbankImageUrl   String  
    
  // Verification Metrics  
  ocrConfidence      Decimal            @db.Decimal(5, 4\)  
  faceMatchScore     Decimal?           @db.Decimal(5, 4\)  
  status             KYCStatus          @default(PENDING)  
  rejectionReason    String?            @db.Text  
  verifiedAt         DateTime?  
  verifiedByUserId   String?  
    
  // Payout Account Detail Association  
  payoutAccount      CreatorPayoutAccount?

  createdAt          DateTime           @default(now())  
  updatedAt          DateTime           @updatedAt

  @@index(\[status\])  
  @@index(\[userId\])  
}

model CreatorPayoutAccount {  
  id                 String              @id @default(uuid())  
  creatorKycId       String              @unique  
  creatorKyc         CreatorKYC          @relation(fields: \[creatorKycId\], references: \[id\], onDelete: Cascade)  
  userId             String  
    
  bankCode           String  
  bankAccountNumberEnc String  
  bankAccountName    String  
  nameMatchScore     Decimal             @db.Decimal(5, 4\)  
  status             PayoutAccountStatus @default(PENDING\_VERIFICATION)  
    
  taxId              String?  
  isWithholdingTaxReq Boolean            @default(true) // 3% Withholding Tax

  createdAt          DateTime            @default(now())  
  updatedAt          DateTime            @updatedAt

  @@index(\[userId\])  
  @@index(\[status\])  
}

model KYCAuditLog {  
  id                 String             @id @default(uuid())  
  kycId              String  
  actorUserId        String  
  action             String             // SUBMIT, OCR\_PROCESS, APPROVE, REJECT, VIEW\_SENSITIVE  
  ipAddress          String  
  userAgent          String  
  metadata           Json?  
  createdAt          DateTime           @default(now())

  @@index(\[kycId\])  
  @@index(\[actorUserId\])  
}

### **5\. Backend DDD Microservices (NestJS \+ Fastify Core)**

#### **5.1 Directory Structure Tree**

src/backend/modules/kyc/  
├── adapters/  
│   ├── dopa-laser.adapter.ts        \# DOPA Laser ID Validation Logic  
│   └── ocr-engine.adapter.ts        \# Cloud Vision / OCR Processing Pipeline  
├── controllers/  
│   └── kyc-admin.controller.ts      \# Admin Review & Dispute REST Controller  
├── dto/  
│   └── kyc-submission.dto.ts  
├── resolvers/  
│   └── kyc.resolver.ts              \# GraphQL Resolvers (submitKyc, getKycStatus)  
├── services/  
│   ├── bank-validation.service.ts   \# Name Match & Bank Account Verification  
│   ├── kyc-encryption.service.ts    \# AES-256-GCM Field-Level Encryption  
│   └── kyc-verification.service.ts  \# Core Orchestrator & State Machine  
└── kyc.module.ts

#### **5.2 Core Service Implementation (kyc-verification.service.ts)**

TypeScript  
import { Injectable, BadRequestException, Logger } from '@nestjs/common';  
import { PrismaService } from '../../infra/prisma/prisma.service';  
import { KycEncryptionService } from './kyc-encryption.service';  
import { BankValidationService } from './bank-validation.service';  
import { CreatorKYCInputSchema } from '../../../shared/schemas/kyc-contract';

@Injectable()  
export class KycVerificationService {  
  private readonly logger \= new Logger(KycVerificationService.name);

  constructor(  
    private readonly prisma: PrismaService,  
    private readonly encryptionService: KycEncryptionService,  
    private readonly bankValidationService: BankValidationService,  
  ) {}

  async submitCreatorKyc(userId: string, input: unknown) {  
    const validatedData \= CreatorKYCInputSchema.parse(input);

    // 1\. Calculate Name Match Score between ID Card Name and Bank Account Name  
    const fullNameTh \= \`\${validatedData.firstNameTh} \${validatedData.lastNameTh}\`;  
    const nameMatchScore \= this.bankValidationService.calculateFuzzyMatchScore(  
      fullNameTh,  
      validatedData.bankAccountName  
    );

    if (nameMatchScore \< 0.80) {  
      throw new BadRequestException('ชื่อบัญชีธนาคารไม่ตรงกับชื่อบนบัตรประชาชน (Match Score \< 80%)');  
    }

    // 2\. Encrypt Sensitive Fields  
    const idCardEnc \= this.encryptionService.encrypt(validatedData.idCardNumber);  
    const laserEnc \= this.encryptionService.encrypt(validatedData.laserCode);  
    const bankAccountEnc \= this.encryptionService.encrypt(validatedData.bankAccountNumber);

    // 3\. Atomic Database Transaction  
    return await this.prisma.\$transaction(async (tx) \=\> {  
      const kyc \= await tx.creatorKYC.upsert({  
        where: { userId },  
        update: {  
          idCardNumberEnc: idCardEnc,  
          laserCodeEnc: laserEnc,  
          firstNameTh: validatedData.firstNameTh,  
          lastNameTh: validatedData.lastNameTh,  
          birthDate: new Date(validatedData.birthDate),  
          idCardImageUrl: validatedData.idCardImageUrl,  
          selfieImageUrl: validatedData.selfieImageUrl,  
          bookbankImageUrl: validatedData.bookbankImageUrl,  
          status: 'PENDING',  
          ocrConfidence: 0.95,  
        },  
        create: {  
          userId,  
          idCardNumberEnc: idCardEnc,  
          laserCodeEnc: laserEnc,  
          firstNameTh: validatedData.firstNameTh,  
          lastNameTh: validatedData.lastNameTh,  
          birthDate: new Date(validatedData.birthDate),  
          idCardImageUrl: validatedData.idCardImageUrl,  
          selfieImageUrl: validatedData.selfieImageUrl,  
          bookbankImageUrl: validatedData.bookbankImageUrl,  
          status: 'PENDING',  
          ocrConfidence: 0.95,  
        },  
      });

      await tx.creatorPayoutAccount.upsert({  
        where: { creatorKycId: kyc.id },  
        update: {  
          bankCode: validatedData.bankCode,  
          bankAccountNumberEnc: bankAccountEnc,  
          bankAccountName: validatedData.bankAccountName,  
          nameMatchScore,  
          status: 'PENDING\_VERIFICATION',  
          taxId: validatedData.taxId,  
        },  
        create: {  
          creatorKycId: kyc.id,  
          userId,  
          bankCode: validatedData.bankCode,  
          bankAccountNumberEnc: bankAccountEnc,  
          bankAccountName: validatedData.bankAccountName,  
          nameMatchScore,  
          status: 'PENDING\_VERIFICATION',  
          taxId: validatedData.taxId,  
        },  
      });

      // Update User KYC Status  
      await tx.user.update({  
        where: { id: userId },  
        data: { kycStatus: 'PENDING' },  
      });

      return { success: true, kycId: kyc.id, nameMatchScore };  
    });  
  }  
}

### **6\. Frontend Components, OCR Scan Engine & Watermark Protocol**

#### **6.1 Client Image Pre-processing & Dynamic Forensic Watermarking**

ภาพบัตรประชาชนและสมุดบัญชีจะถูกประมวลผลฝั่ง Client (LINE LIFF / Browser) เพื่อวาด Dynamic Watermark กำหนดวัตถุประสงค์เพื่อการยืนยันตัวตนเท่านั้น ก่อนส่งตรงเข้า Cloudflare R2 Vault

TypeScript  
// Component: Canvas Document Watermarker Engine  
export const applyKycWatermark \= (  
  file: File,  
  tenantName: string,  
  userIdHash: string  
): Promise\<Blob\> \=\> {  
  return new Promise((resolve, reject) \=\> {  
    const reader \= new FileReader();  
    reader.readAsDataURL(file);  
    reader.onload \= (event) \=\> {  
      const img \= new Image();  
      img.src \= event.target?.result as string;  
      img.onload \= () \=\> {  
        const canvas \= document.createElement('canvas');  
        canvas.width \= img.width;  
        canvas.height \= img.height;  
        const ctx \= canvas.getContext('2d');  
        if (\!ctx) return reject('Cannot get 2d context');

        // Draw Original Image  
        ctx.drawImage(img, 0, 0);

        // Watermark Styling  
        const watermarkText \= \`ใช้สำหรับยืนยันตัวตน CREATOR บน \${tenantName} เท่านั้น (\${userIdHash}) \${new Date().toISOString().slice(0, 10)}\`;  
        ctx.font \= \`bold \${Math.floor(canvas.width / 25)}px Prompt, sans-serif\`;  
        ctx.fillStyle \= 'rgba(239, 68, 68, 0.45)'; // Semi-transparent Red  
        ctx.textAlign \= 'center';  
        ctx.textBaseline \= 'middle';

        // Rotate & Repeat Watermark Across Canvas  
        ctx.save();  
        ctx.translate(canvas.width / 2, canvas.height / 2);  
        ctx.rotate((-25 \* Math.PI) / 180);  
        ctx.fillText(watermarkText, 0, 0);  
        ctx.fillText(watermarkText, 0, \-canvas.height / 4);  
        ctx.fillText(watermarkText, 0, canvas.height / 4);  
        ctx.restore();

        canvas.toBlob((blob) \=\> {  
          if (blob) resolve(blob);  
          else reject('Blob creation failed');  
        }, 'image/jpeg', 0.85);  
      };  
    };  
  });  
};

### **7\. Data Pipeline, AI OCR & Verification Analytics**

#### **7.1 Fraud Detection & Automated Matching Pipeline**

1. **Cloudflare R2 Direct Vault Upload:** Frontend ขอ Presigned Upload URL ผ่าน GraphQL Mutation และอัปโหลดภาพที่ใส่ Watermark แล้วเข้าสู่ Private R2 Storage Bucket  
2. **OCR Engine Trigger:** Worker อ่าน Stream ภาพ และสกัดข้อความภาษาไทย/อังกฤษ ผ่าน AI Vision Model  
3. **Fuzzy String Matching (Levenshtein Distance Algorithm):**

4. $Score=1-\frac{LevenshteinDistance(Nam{e}_{IDCard},Nam{e}_{Bank})}{\max\limits_{}(Length(Nam{e}_{IDCard}),Length(Nam{e}_{Bank}))}$  
   * **Score $\geq$ 0.90:** ผ่านอัตโนมัติ (Auto-Verified) เข้าสู่ Queue รอ Admin คลิกยืนยันปุ่มเดียว  
   * **Score 0.75 \- 0.89:** ติดสถานะ ACTION\_REQUIRED ให้ Admin ตรวจสอบคำสะกดผิด/คำนำหน้านาม  
   * **Score \< 0.75:** ปฏิเสธรายการทันที (Auto-Rejected) พร้อมแจ้งเตือนผู้ใช้ผ่าน LINE Flex Message

### **8\. Security, Regulatory Compliance (PDPA/e-KYC) & Zero-Egress Storage Engine**

* **Field-Level Encryption (FLE):** เลขบัตรประชาชน 13 หลัก, Laser Code และ เลขบัญชีธนาคาร ถูกเข้ารหัสด้วยอัลกอริทึม **AES-256-GCM** ก่อนบันทึกลง PostgreSQL Database  
* **Cloudflare R2 Private Bucket Access:** เอกสารภาพถ่ายทั้งหมดจัดเก็บบน Private R2 Storage Bucket ห้ามเปิด Public Link บุคคลที่ไม่มีสิทธิ์รวมถึง Admin ไม่สามารถเข้าถึงรูปภาพได้โดยตรง ต้องขอ Temporary Presigned View URL ที่มีอายุขัยเพียง **3 นาที** และบันทึก KYCAuditLog ทุกครั้งที่มีการเปิดดูภาพ  
* **Zero-Egress Fee Guarantee:** การส่งรูปภาพเอกสารระหว่าง R2 Storage และ Backend Processing Pipeline เกิดขึ้นภายในโครงข่าย Cloudflare Edge โดยมีค่าธรรมเนียม Transfer Out 0 บาท

### **9\. Token Efficiency & Code Diff Policies**

* **SDID Partial Code Diff Protocol:** ในการเขียนและปรับปรุงโค้ด Phase 085 ให้ระบุเฉพาะ Diff Code Block ของไฟล์ที่อยู่ใน IN\_SCOPE\_FILES ประหยัด Token สูงสุด 75%  
* **Zero Redundant Code Policy:** ห้ามแก้ไขหรือสร้างไฟล์ซ้ำซ้อนในส่วน Audit Logs หรือ Auth Modules ที่มีอยู่แล้ว

### **10\. Auto-QA, Edge Cases & Autonomous Self-Healing Loop**

#### **10.1 Edge Cases Covered**

1. **กรณีชื่อมียศ/ฐานันดรศักดิ์ หรือ คำนำหน้านามไม่ตรงกัน:** (เช่น "นาย", "ดร.", "ว่าที่ร้อยตรี") \-\> ระบบ Fuzzy Matching Engine มี Pre-processing Filter ตัดคำนำหน้านามออกก่อนคำนวณ Score  
2. **กรณีผู้ใช้ถ่ายภาพบัตรสะท้อนแสง หรือภาพเบลอ:** \-\> Frontend Image Quality Check ปฏิเสธการส่งภาพหาก Blur Metric Index เกิน threshold  
3. **กรณีส่งข้อมูล KYC ซ้ำซ้อน (Double Submission):** \-\> Prisma Unique Constraint บน userId สั่ง Rollback Transaction อัตโนมัติ

#### **10.2 Self-Healing Test Suite**

* รัน Unit Test & Integration Test แบบ Automated Loop 3 รอบ ครอบคลุม OCR Failure, Encryption Decryption Integrity, และ Bank Name Matching Algorithm ก่อนอนุมัติ Task

### **11\. The 9 Enterprise Golden Gatekeepers (Phase 085 Clearance Check)**

* \[x\] **Gate 1: SSOT Schema Sync (100%)** — Prisma Schema, Zod Contracts (kyc-contract.ts), และ GraphQL Resolvers ตรงกันสมบูรณ์  
* \[x\] **Gate 2: Zero Type Violations** — ผ่านการคอมไพล์ TypeScript Compiler ใน Strict Mode 100%  
* \[x\] **Gate 3: UI/UX State Machine** — ครอบคลุมทั้ง 5 States (LIFF\_INIT, IDLE, LOADING, SUCCESS, ERROR)  
* \[x\] **Gate 4: Security Audit** — เข้ารหัสข้อมูล AES-256-GCM, มี Audit Trail บันทึกการเข้าถึงข้อมูลส่วนบุคคลตามกฎหมาย PDPA  
* \[x\] **Gate 5: LIFF Canvas Memory Check** — บีบอัดรูปภาพฝั่ง Client ควบคุม RAM ต่ำกว่า 30MB ไม่ทำให้ LINE เด้งดับ  
* \[x\] **Gate 6: Zero-Egress Routing Check** — จัดเก็บเอกสารบน Cloudflare R2 Private Bucket ค่า Egress Fee เป็น 0 บาท  
* \[x\] **Gate 7: Database Transaction Guard** — การบันทึก KYC และ Payout Account ทำงานภายใต้ Prisma Atomic Transaction ภายใน 1 วินาที  
* \[x\] **Gate 8: Data Pipeline Verification** — Fuzzy Matching Score และ OCR Engine ประมวลผลและส่ง Log เรียลไทม์  
* \[x\] **Gate 9: Automated ADR Generation** — บันทึก Architecture Decision Record ครบถ้วนตามมาตรฐานสากล

### **12\. Atomic Task Execution Plan (Phase 085 Scope)**

* **Task 1:** อัปเดต Prisma Schema เพิ่มรุ่น CreatorKYC, CreatorPayoutAccount, KYCAuditLog และรัน prisma generate

* **Task 2:** สร้าง Zod Validation Contract (kyc-contract.ts) สำหรับรับข้อมูล e-KYC และการตรวจสอบสิทธิ์  
* **Task 3:** พัฒนา KycEncryptionService (AES-256-GCM) สำหรับสลับแปลงข้อมูลลับก่อนลง Database  
* **Task 4:** พัฒนา BankValidationService ระบบ Fuzzy Matching คำนวณความสอดคล้องชื่อบัตรและบัญชีธนาคาร  
* **Task 5:** พัฒนา GraphQL Resolvers และ NestJS KycVerificationService เพื่อรองรับการยื่นเอกสาร  
* **Task 6:** พัฒนา Frontend Canvas Watermark Engine และ Upload Control บน Next.js 15 (LINE LIFF & Web)  
* **Task 7:** พัฒนา Admin KYC Review Console บน Web Application สำหรับการตรวจอนุมัติแบบ Manual Override  
* **Task 8:** เชื่อมต่อ LINE Flex Message Notification แจ้งผลการอนุมัติ/ปฏิเสธ e-KYC ไปยัง Creator  
* **Task 9:** Final Gatekeeper Clearance — รัน Stress Test และตรวจสอบผ่านเกณฑ์คะแนนเต็ม 100/100 จากสภาวิศวกร

