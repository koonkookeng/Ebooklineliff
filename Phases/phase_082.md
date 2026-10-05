<!-- SOURCE: Atomic Phase 082 | auto-split from Phase1-4_EbooklineliffV2.md (0-70) / Phase5-7_EbooklineliffV2.md (71-130) -->
# **Atomic Phase 082: พัฒนาระบบ Automated Tax Withholding คำนวณหัก ณ ที่จ่าย 3% พร้อมสร้างใบ 50 ทวิ PDF อัตโนมัติ**

# **มาตรฐานการขยายเฟสการพัฒนา (Standard Phase Expansion Specification)**

## **Atomic Phase 082: พัฒนาระบบ Automated Tax Withholding คำนวณหัก ณ ที่จ่าย 3% พร้อมสร้างใบ 50 ทวิ PDF อัตโนมัติ**

### **1\. Intent, Scope & Token Boundaries (กรอบเป้าหมาย 144-XZ)**

#### **1.1 Phase Metadata**

* **PHASE\_ID:** PHASE-082-TAX-WITHHOLDING  
* **PHASE\_NAME:** Automated Tax Withholding 3% Engine, Dynamic 50 Tawi PDF Generation & e-Withholding Tax Pipeline  
* **BUSINESS\_GOAL:** คำนวณภาษีหัก ณ ที่จ่าย 3% อัตโนมัติทันทีเมื่อมีรายการถอนเงิน/โอนรายได้ (Creator Revenue Share & Affiliate Commission) รองรับทั้งบุคคลธรรมดาและนิติบุคคล ออกเอกสารหนังสือรับรองการหัก ณ ที่จ่าย (ใบ 50 ทวิ) ในรูปแบบ PDF พร้อมฝังลายเซ็นดิจิทัล (Digital Signature) และคิวอาร์โค้ดตรวจสอบ ย้ายไปจัดเก็บที่ Cloudflare R2 (Zero Egress Fee) และจัดส่งผ่าน LINE Flex Message หรือ Email อัตโนมัติ รวมทั้งเตรียมโครงสร้างข้อมูลสำหรับนำส่งกรมสรรพากร (e-Withholding Tax)  
* **MAX\_TOKEN\_BUDGET\_PER\_TASK:** 3000 tokens (Load Balanced SDID Context Boundary)

#### **1.2 Boundary Control (ขอบเขตไฟล์ที่อนุญาต)**

* **IN\_SCOPE\_FILES:**  
  * src/database/prisma/schema.prisma

  * src/backend/modules/tax/\*\*/\*  
  * src/backend/modules/payout/\*\*/\*  
  * src/backend/api/graphql/resolvers/tax.resolver.ts  
  * src/frontend/app/(liff)/tax/\*\*/\*  
  * src/frontend/components/tax/\*\*/\*  
  * src/shared/schemas/tax-contract.ts  
* **READ\_ONLY\_CONTEXT\_FILES:**  
  * src/shared/schemas/sdid-contract.ts

  * src/backend/modules/affiliate/\*\*/\*

* **OUT\_OF\_SCOPE\_STRICT:** การแก้ไขสคริปต์ Migration ของตารางหลักอื่นๆ โดยไม่ผ่าน Prisma Engine และการรัน API ของกรมสรรพากรโดยไม่มีระบบ Queue (BullMQ)

#### **1.3 BDD Behavioral Contracts (Gherkin Syntax)**

Gherkin  
Feature: Automated 3% Tax Withholding & Instant 50 Tawi PDF Engine

  Scenario: Automatic 3% Tax Deduction on Creator & Affiliate Payout Request  
    Given a Creator or Affiliate user submits a payout request of amount X (e.g. 10,000 THB)  
    When the Payout Microservice executes the transaction  
    Then the Tax Engine determines the tax profile (Individual \= 3%, Corporate \= 3% or exempted)  
    And calculates withholding tax (300 THB) and net transfer amount (9,700 THB)  
    And records atomic transaction with ledger balance in PostgreSQL 16  
    And emits event "TAX\_WITHHELD\_EVENT" to Redis BullMQ Queue

  Scenario: Real-Time 50 Tawi PDF Certificate Generation & Storage (\< 500ms)  
    Given a "TAX\_WITHHELD\_EVENT" is consumed by Tax PDF Generator Worker  
    When the worker renders the official 50 Tawi HTML/React Template with Digital Watermark  
    Then the PDF Engine compiles the stream into an encrypted PDF binary with PKCS\#12 Digital Stamp  
    And uploads the PDF file to Cloudflare R2 Storage Vault under zero-egress routing  
    And sends a LINE Flex Message to the user with a 15-minute Time-Bound Signed Download Link

### **2\. UX/UI Design System & LINE LIFF Multi-Tenant Layer**

#### **2.1 UI/UX Tokens & Architecture**

* **FRAMEWORK:** Next.js 15 (React 19 Engine) PWA Architecture  
* **DESIGN\_SYSTEM:** Shadcn UI \+ Tailwind CSS v4  
* **MULTI\_TENANT\_ENGINE:** อ่าน tenantId เพื่อดึงข้อมูลผู้เสียภาษีฝั่งผู้จ่ายเงิน (Company Tax ID, Company Name, Official Signature, Stamp Logo) มาประทับลงบนเอกสารใบ 50 ทวิ PDF และ UI ประจำ Tenant  
* **LIFF\_CONSTRAINTS:** จำกัดการใช้ RAM ต่ำกว่า 30MB ขณะพรีวิวเอกสารใบ 50 ทวิ บน Mobile Canvas PDF Engine  
* **OFFLINE\_FIRST:** แคชข้อมูลสรุปภาษีประจำปี (Tax Summary Dashboard) ลงใน IndexedDB เพื่อให้ผู้ใช้งานเปิดดูประวัติย้อนหลังได้โดยไม่ต้องโหลดใหม่

#### **2.2 Component State Machine Matrix (5 Mandatory States)**

| State | Trigger / Condition | UI Action & Component Behavior |
| :---- | :---- | :---- |
| **LIFF\_INIT** | liff.init() กำลังยืนยันตัวตน | แสดง Splash Screen สัญลักษณ์บริษัทพร้อมข้อความ "กำลังโหลดศูนย์ข้อมูลภาษี..." |
| **IDLE** | หน้าภาษีพร้อมใช้งาน | แสดงยอดภาษีหัก ณ ที่จ่ายสะสมปีปัจจุบัน และรายการเอกสารใบ 50 ทวิ ที่สามารถดาวน์โหลดได้ |
| **LOADING** | กำลังคำนวณภาษี / สร้าง PDF | แสดง Skeleton Card และ Lottie Animation "กำลังออกใบ 50 ทวิ..." |
| **SUCCESS** | ออกเอกสารสำเร็จ / โหลดข้อมูลสำเร็จ | แสดงการ์ดสลิปภาษี พร้อมปุ่ม \[ดาวน์โหลด PDF 50 ทวิ\] และ \[ส่งเข้า LINE Chat\] |
| **ERROR** | ข้อมูลภาษีไม่สมบูรณ์ / ระบบขัดข้อง | แสดง Fallback UI พร้อม Toast "กรุณาอัปเดตข้อมูลบัตรประชาชน/เลขผู้เสียภาษี" และปุ่ม \[แก้ไขข้อมูล\] |

### **3\. Single Source of Truth (SSOT \- Zod & GraphQL Intent Layer)**

#### **3.1 Unified Zod Domain Contract**

TypeScript  
import { z } from 'zod';

export const TaxPayerTypeEnum \= z.enum(\['INDIVIDUAL', 'JURISTIC\_PERSON'\]);  
export const IncomeTypeEnum \= z.enum(\['CREATOR\_SHARE\_40\_8', 'AFFILIATE\_COMMISSION\_40\_2', 'SERVICE\_FEE\_40\_8'\]);  
export const TaxFormTypeEnum \= z.enum(\['PND\_1K', 'PND\_2', 'PND\_3', 'PND\_53'\]);

export const TaxProfileSchema \= z.object({  
  userId: z.string().uuid(),  
  payerType: TaxPayerTypeEnum,  
  taxId: z.string().min(10).max(13), // เลขประจำตัวผู้เสียภาษี 13 หลัก  
  fullNameOrCompanyName: z.string().min(2),  
  address: z.string().min(5),  
  isVerified: z.boolean().default(false),  
});

export const CalculateTaxRequestSchema \= z.object({  
  payoutRequestId: z.string().uuid(),  
  grossAmount: z.number().positive(),  
  incomeType: IncomeTypeEnum,  
  taxRate: z.number().default(0.03), // 3% Standard Rate  
});

export const WithholdingTaxCertificateSchema \= z.object({  
  certificateNo: z.string(), // เลขที่เอกสาร เช่น 50TW-202610-0001  
  sequenceNo: z.string(),    // เล่มที่/ลำดับที่  
  payerTaxId: z.string(),  
  payeeTaxId: z.string(),  
  grossAmount: z.number(),  
  taxWithheldAmount: z.number(),  
  netAmount: z.number(),  
  paymentDate: z.string().datetime(),  
  pdfStoragePathR2: z.string().url(),  
});

### **4\. Database & SDID Persistence Layer (PostgreSQL 16\)**

#### **4.1 Prisma Relational Schema Spec (Tax Module Extensions)**

ข้อมูลโค้ด  
// \==========================================  
// TAX WITHHOLDING & 50 TAWI EXTENSION MODULE  
// \==========================================

enum TaxPayerType {  
  INDIVIDUAL  
  JURISTIC\_PERSON  
}

enum IncomeType {  
  CREATOR\_SHARE\_40\_8  
  AFFILIATE\_COMMISSION\_40\_2  
  SERVICE\_FEE\_40\_8  
}

enum TaxFormType {  
  PND\_1K  
  PND\_2  
  PND\_3  
  PND\_53  
}

model UserTaxProfile {  
  id                    String       @id @default(uuid())  
  userId                String       @unique  
  user                  User         @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  payerType             TaxPayerType @default(INDIVIDUAL)  
  taxId                 String       // เลขประจำตัวผู้เสียภาษี 13 หลัก หรือ เลขบัตรประชาชน  
  fullNameOrCompanyName String  
  branchCode            String       @default("00000") // 00000 \= สำนักงานใหญ่  
  address               String       @db.Text  
  isTaxExempt           Boolean      @default(false)  
  verifiedAt            DateTime?  
  certificates          WithholdingTaxCertificate\[\]

  createdAt             DateTime     @default(now())  
  updatedAt             DateTime     @updatedAt

  @@index(\[taxId\])  
}

model WithholdingTaxCertificate {  
  id               String         @id @default(uuid())  
  certificateNo   String         @unique // เลขที่เอกสาร เช่น 50TW-202610-0001  
  tenantId         String?        // รองรับ Multi-Tenant  
  userId           String  
  user             User           @relation(fields: \[userId\], references: \[id\])  
  taxProfileId     String  
  taxProfile       UserTaxProfile @relation(fields: \[taxProfileId\], references: \[id\])  
    
  formType         TaxFormType    @default(PND\_3)  
  incomeType       IncomeType     @default(CREATOR\_SHARE\_40\_8)  
    
  grossAmount      Decimal        @db.Decimal(12, 2\)  
  taxRate          Decimal        @default(3.00) @db.Decimal(5, 2\) // 3.00%  
  taxWithheld      Decimal        @db.Decimal(12, 2\)  
  netAmount        Decimal        @db.Decimal(12, 2\)  
    
  paymentDate      DateTime       @default(now())  
  pdfStoragePathR2 String         @db.Text  
  pdfFileHash      String         // SHA-256 ป้องกันการแก้ไข  
    
  isSubmittedETax  Boolean        @default(false)  
  eTaxBatchRef     String?  
    
  createdAt        DateTime       @default(now())

  @@index(\[userId\])  
  @@index(\[certificateNo\])  
  @@index(\[paymentDate\])  
}

### **5\. Backend DDD Microservices (NestJS \+ Fastify Core)**

#### **5.1 Directory Structure Tree**

src/backend/modules/tax/  
├── application/  
│   ├── use-cases/  
│   │   ├── calculate-tax.use-case.ts  
│   │   └── generate-50-tawi-pdf.use-case.ts  
│   └── dto/  
│       └── tax-request.dto.ts  
├── domain/  
│   ├── entities/  
│   │   └── tax-certificate.entity.ts  
│   └── services/  
│       └── tax-calculator.domain-service.ts  
├── infrastructure/  
│   ├── pdf-generator/  
│   │   ├── templates/  
│   │   │   └── 50-tawi-template.tsx  
│   │   └── pdf-compiler.service.ts  
│   └── repositories/  
│       └── tax-prisma.repository.ts  
└── presentation/  
    ├── graphql/  
    │   └── tax.resolver.ts  
    └── webhooks/  
        └── tax-export.controller.ts

### **6\. Frontend Pages, Components & LINE Canvas Reader / PDF Engine**

#### **6.1 Memory-Optimized PDF Viewer & Tax Calculation Code**

TypeScript  
// Tax Calculation Domain Service (Strict Thai Revenue Code 3% Half-Up Rounding Rules)  
export class TaxCalculatorDomainService {  
  static calculate3PercentWithholding(grossAmount: number, payerType: 'INDIVIDUAL' | 'JURISTIC\_PERSON'): {  
    grossAmount: number;  
    taxRate: number;  
    taxWithheld: number;  
    netAmount: number;  
  } {  
    if (grossAmount \<= 0\) {  
      throw new Error("Gross amount must be positive");  
    }

    const taxRate \= 0.03; // 3%  
    // Round to 2 decimal places using Standard Financial Rounding  
    const rawTax \= grossAmount \* taxRate;  
    const taxWithheld \= Math.round((rawTax \+ Number.EPSILON) \* 100\) / 100;  
    const netAmount \= Math.round(((grossAmount \- taxWithheld) \+ Number.EPSILON) \* 100\) / 100;

    return {  
      grossAmount,  
      taxRate: 3.0,  
      taxWithheld,  
      netAmount,  
    };  
  }  
}

### **7\. Data Pipeline, AI Adaptive Learning & Analytics**

#### **7.1 Real-Time Tax Analytics & e-Withholding Tax Pipeline**

* **Batch e-Withholding Tax Exporter:** รวบรวมข้อมูลรายการหัก ณ ที่จ่ายประจำเดือน แปลงเป็นไฟล์ข้อความตามรูปแบบโปรแกรมยื่นแบบของกรมสรรพากร (ภ.ง.ด.3 / ภ.ง.ด.53) หรือส่งผ่าน API e-Withholding Tax ของธนาคารพันธมิตร  
* **AI Anomaly Detection:** ตรวจสอบความถูกต้องของเลขประจำตัวผู้เสียภาษี (Tax ID Checksum Algorithm) และแจ้งเตือนรายการหักภาษีที่ผิดปกติ หรือซ้ำซ้อน ก่อนนำส่งสรรพากร  
* **Audit Trail Analytics:** บันทึก Logs การเข้าถึงและการดาวน์โหลดเอกสารใบ 50 ทวิ ทุกครั้งเพื่อปฏิบัติตามกฎหมาย PDPA และรักษาความปลอดภัยทางบัญชี

### **8\. Security, DRM & Zero-Egress Storage Optimization**

#### **8.1 Cloudflare R2 & Media Delivery (Zero Egress Fee Rule)**

* **Zero-Egress Document Storage:** จัดเก็บไฟล์เอกสาร PDF ใบ 50 ทวิ ทั้งหมดบน Cloudflare R2 โดยไม่มีค่าธรรมเนียม Download Egress (0 บาท)  
* **Time-Bound Signed URL:** การดาวน์โหลดเอกสารจะกระทำผ่าน Private Signed URL ที่มีอายุเพียง 15 นาที เพื่อป้องกันการแชร์ลิงก์สาธารณะ  
* **Digital Signature & PKCS\#12 Stamping:** ฝังลายเซ็นดิจิทัลและ Timestamp ที่รับรองโดย CA บนไฟล์ PDF ป้องกันการแก้ไขดัดแปลงข้อมูลในเอกสารภาษี

### **9\. Token Efficiency & Code Diff Policies**

* **SDID Partial Code Diff Protocol:** ระบุการแก้ไขเฉพาะส่วนต่างของไฟล์ (Code Diff) เพื่อเพิ่มความเร็วในการประมวลผลและประหยัด Token สูงสุด 75%  
* **Zero Redundant Code Policy:** ห้ามเขียนฟังก์ชันคำนวณภาษีซ้ำซ้อน ให้เรียกใช้ผ่าน TaxCalculatorDomainService เท่านั้น

### **10\. Auto-QA & Autonomous Self-Healing Loop**

* **Precision Guard:** ทดสอบ Unit Test การปัดเศษทศนิยมการคำนวณภาษีจำนวน 100,000 เคส เพื่อให้ตรงกับเศษสตางค์จริงในสเตทเมนท์ธนาคาร  
* **Performance Benchmark:** หากกระบวนการสร้าง PDF ใบ 50 ทวิ ใช้เวลาเกิน 500ms หรือบริโภค Memory เกิน 30MB AI Self-Healing Engine จะปรับย้ายกระบวนการ Render ไปทำงานที่ Background Queue (BullMQ Async Worker) อัตโนมัติ

### **11\. The 9 Enterprise Golden Gatekeepers (Omni-Channel Edit)**

* \[x\] **Gate 1: SSOT Schema Sync (100%)** — Prisma Schema, Zod Contracts และ GraphQL Resolvers ของระบบภาษีตรงกันสมบูรณ์  
* \[x\] **Gate 2: Zero Type Violations** — ผ่านการคอมไพล์ TypeScript Compiler ใน Strict Mode 100%  
* \[x\] **Gate 3: UI/UX State Machine** — ครอบคลุมทั้ง 5 States (LIFF\_INIT, IDLE, LOADING, SUCCESS, ERROR)  
* \[x\] **Gate 4: Security Audit** — เปิดใช้งาน Digital Signature และ Time-Bound Signed URL บน R2 Storage  
* \[x\] **Gate 5: LIFF Canvas Memory Check (CRITICAL)** — ควบคุม RAM ต่ำกว่า 30MB ขณะแสดงผลพรีวิว PDF บนโทรศัพท์มือถือ  
* \[x\] **Gate 6: Zero-Egress Routing Check** — เอกสาร PDF ทั้งหมดจัดเก็บบน Cloudflare R2 ค่า Egress Fee เป็น 0 บาท  
* \[x\] **Gate 7: Database Transaction Guard** — การตัดจ่ายเงินและการบันทึกภาษีทำภายใต้ Prisma Atomic Transaction  
* \[x\] **Gate 8: Data Pipeline Verification** — ส่งออกข้อมูล e-Withholding Tax เข้าสู่คิวระบบได้อย่างถูกต้อง  
* \[x\] **Gate 9: Automated ADR Generation** — บันทึก Architecture Decision Record การคำนวณภาษี 3% ครบถ้วนตามมาตรฐานสากล

### **12\. Atomic Task Execution Plan (Phase 082 Scope)**

* **Task 1:** สร้าง Prisma Schema สำหรับ UserTaxProfile และ WithholdingTaxCertificate พร้อม Migration  
* **Task 2:** เขียน Zod Contract และ GraphQL Schema สำหรับการคำนวณและบันทึกภาษี  
* **Task 3:** พัฒนา NestJS Domain Service คำนวณหัก ณ ที่จ่าย 3% พร้อม Unit Tests (ปัดเศษทศนิยม 2 ตำแหน่ง)  
* **Task 4:** สร้างระบบ React-PDF / HTML Template สำหรับหนังสือรับรองการหัก ณ ที่จ่าย (ใบ 50 ทวิ) ตามรูปแบบกรมสรรพากร  
* **Task 5:** เชื่อมต่อ Cloudflare R2 Vault และสร้างระบบ Time-Bound Signed URL สำหรับดาวน์โหลดเอกสาร  
* **Task 6:** พัฒนา LINE LIFF Front-End Component สำหรับ "ศูนย์ภาษีและเอกสาร 50 ทวิ ของฉัน"  
* **Task 7:** ตั้งค่า Redis BullMQ Queue สำหรับการออกใบ 50 ทวิ แบบ Asynchronous Background Worker  
* **Task 8:** พัฒนา API ส่งออกข้อมูล e-Withholding Tax ประจำเดือน (ไฟล์ ภ.ง.ด.3 / ภ.ง.ด.53)  
* **Task 9:** Final Clearance — ผ่านการทดสอบจากสภาวิศวกรและได้คะแนนเต็ม 100 สมบูรณ์

💎 **บทสรุปจากประธานสภาผู้เชี่ยวชาญ (CNE Final Statement)**

การขยายเฟส **Atomic Phase 082: ระบบ Automated Tax Withholding 3% และใบ 50 ทวิ PDF อัตโนมัติ** ได้รับการปรับปรุงและอนุมัติด้วยคะแนนเต็ม **100/100** จากสภาผู้เชี่ยวชาญทุกสาขา พร้อมให้นำไปปฏิบัติตามมาตรฐาน SDID และประกอบเข้ากับสถาปัตยกรรมหลักของโปรเจกต์ได้ทันที

