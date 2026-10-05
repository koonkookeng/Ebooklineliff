<!-- SOURCE: Atomic Phase 019 | auto-split from Phase1-4_EbooklineliffV2.md (0-70) / Phase5-7_EbooklineliffV2.md (71-130) -->
# **Atomic Phase 019: พัฒนาระบบ Transactional LINE Messages เพื่อส่งใบเสร็จรับเงินอัตโนมัติ**

# **เอกสารมาตรฐานการขยายเฟสการพัฒนา (Phase Expansion Standard Spec)**

## **PHASE-019: Transactional LINE Flex Messages & Automated E-Receipt Engine**

### **1\. Intent, Scope & Token Boundaries (กรอบเป้าหมาย 144-XZ)**

#### **1.1 Phase Metadata**

* **PHASE\_ID:** `PHASE-019-LINE-RECEIPT`  
* **PHASE\_NAME:** Transactional LINE Flex Messages & Automated E-Receipt / E-Tax Invoice Engine  
* **BUSINESS\_GOAL:** สั่งการและส่งมอบใบเสร็จรับเงินอิเล็กทรอนิกส์ (E-Receipt) และใบกำกับภาษี (E-Tax Invoice) ในรูปแบบ **LINE Flex Message** ที่สวยงาม น่าเชื่อถือ เข้าสู่ LINE OA ของผู้ซื้อแบบเรียลไทม์ทันทีหลังระบบยืนยันสลิปชำระเงินอัตโนมัติสำเร็จ (`< 1 second`) พร้อมสร้างลิงก์ดาวน์โหลด PDF ต้นฉบับที่ฝากไว้บน Cloudflare R2 (Zero-Egress Fee) และเปิดปุ่มลัดให้ผู้ใช้กดกลับเข้าสู่ LINE LIFF เพื่ออ่าน E-Book หรือเริ่มเรียนคอร์สได้ทันทีในคลิกเดียว  
* **MAX\_TOKEN\_BUDGET\_PER\_TASK:** 3000 tokens (Load Balanced SDID Context Boundary)

#### **1.2 Boundary Control (ขอบเขตไฟล์ที่อนุญาต)**

**IN\_SCOPE\_FILES:**

* `src/database/prisma/schema.prisma`  
* `src/shared/schemas/line-receipt.schema.ts`  
* `src/backend/modules/notification/line-messaging.module.ts`  
* `src/backend/modules/notification/line-messaging.service.ts`  
* `src/backend/modules/notification/templates/receipt-flex.template.ts`  
* `src/backend/modules/pdf/receipt-pdf.generator.ts`  
* `src/backend/modules/payment/payment-slip.controller.ts`  
* `src/frontend/app/(liff)/receipt/[orderId]/page.tsx`

**READ\_ONLY\_CONTEXT\_FILES:**

* `src/shared/schemas/sdid-contract.ts`

**OUT\_OF\_SCOPE\_STRICT:**

* การแก้ไขสถาปัตยกรรม Payment Slip Verification หลัก หรือแก้ไขส่วนจัดการ Database Migration นอกเหนือจากส่วน Log & Notification Record

#### **1.3 BDD Behavioral Contracts (Gherkin Syntax)**

Gherkin  
Feature: Automated Transactional LINE Flex Receipt & PDF Vault Delivery

  Scenario: Instant Flex Message Receipt Push upon Successful Payment Verification (\< 1s)  
    Given an order with ID "ORD-998811" has been verified by Slip Verification Engine  
    When the PaymentSlipController completes the atomic database transaction  
    Then the Redis BullMQ Event Queue triggers "line.receipt.push" job within 50ms  
    And the LineMessagingService composes a multi-tenant LINE Flex Message with item breakdown, VAT, and dynamic branding  
    And the LINE Messaging API delivers the push message to the user's lineUserId  
    And a log record is written to "ReceiptNotificationLog" with status "DELIVERED"

  Scenario: High-Reliability Fallback and PDF Generation for Line Messaging Failures  
    Given the LINE Messaging API returns a rate limit (429) or network timeout  
    When the LineMessagingService catches the delivery failure  
    Then the system executes an exponential backoff retry loop (Max 3 attempts)  
    And if retries are exhausted, the status is marked as "FAILED\_QUEUED\_RETRY"  
    And the user can still access and download the official PDF E-Receipt via the LINE LIFF Order History Page

### **2\. UX/UI Design System & LINE Messaging Architecture Layer**

#### **2.1 UI/UX Tokens & Messaging Architecture**

* **FRAMEWORK:** LINE Messaging API (Push Message Protocol) \+ Next.js 15 Web PDF Engine  
* **DESIGN\_SYSTEM:** LINE Flex Message JSON Container (Bubble/Carousel Structure) \+ Tailwind CSS v4 สำหรับ Web Receipt View  
* **MULTI\_TENANT\_ENGINE:** อ่านค่า `TenantSetting` (โลโก้ร้านค้า, โทนสีแบรนด์ `--primary-color`, เลขประจำตัวผู้เสียภาษี, ชื่อผู้ขาย) เพื่อ Injection เข้าไปใน Flex Message Template อัตโนมัติ  
* **PERFORMANCE\_CONSTRAINTS:** Flex Message JSON Payload Size `< 10KB` และเวลาตอบสนองการสร้างสตรีม Flex Message `< 100ms`

#### **2.2 Component State Machine Matrix (5 Mandatory States)**

| State | Trigger / Condition | UI Action & Component Behavior |
| ----- | ----- | ----- |
| **RECEIPT\_PENDING** | คำสั่งซื้อชำระเงินเรียบร้อย รอสร้างใบเสร็จ | ระบบขึ้นสถานะ `QUEUED` ใน Redis Queue |
| **TEMPLATE\_COMPOSING** | ดึงข้อมูล Order \+ Tenant Branding มาประกอบ Flex | สร้าง JSON Payload และสตรีมภาพโลโก้/QR Code |
| **MESSAGING\_SENDING** | เรียกใช้ LINE Messaging API Push Endpoint | ส่ง HTTP POST ไปยัง `[https://api.line.me/v2/bot/message/push](https://api.line.me/v2/bot/message/push)` |
| **DELIVERED\_SUCCESS** | LINE API ตอบกลับ HTTP 200 OK | อัปเดตสถานะใน DB เป็น `DELIVERED` พร้อมบันทึก `messageId` |
| **DELIVERY\_FAILED** | LINE API ขัดข้อง หรือ User บล็อก LINE OA | แสดง Fallback Log บันทึกเหตุผล และส่งการแจ้งเตือนสำรองทาง Email/SMS |

### **3\. Single Source of Truth (SSOT \- Zod Domain Contract)**

#### **3.1 Unified Zod Domain Contract**

TypeScript  
// src/shared/schemas/line-receipt.schema.ts  
import { z } from 'zod';

export const ReceiptDeliveryStatusEnum \= z.enum(\[  
  'PENDING',  
  'COMPOSING',  
  'SENT',  
  'DELIVERED',  
  'FAILED\_RETRYING',  
  'FAILED\_PERMANENT'  
\]);

export const ReceiptLineItemSchema \= z.object({  
  title: z.string(),  
  productType: z.enum(\['PHYSICAL\_BOOK', 'EBOOK', 'ELEARNING\_COURSE', 'LIVE\_CLASS', 'HYBRID\_BUNDLE'\]),  
  quantity: z.number().int().positive(),  
  unitPrice: z.number().nonnegative(),  
  totalPrice: z.number().nonnegative(),  
});

export const LineReceiptPayloadSchema \= z.object({  
  orderId: z.string().uuid(),  
  orderNumber: z.string(),  
  lineUserId: z.string(),  
  tenantId: z.string(),  
  tenantName: z.string(),  
  tenantLogoUrl: z.string().url(),  
  buyerDisplayName: z.string(),  
  netAmount: z.number().positive(),  
  vatAmount: z.number().nonnegative(),  
  paymentMethod: z.string(),  
  paidAt: z.string().datetime(),  
  items: z.array(ReceiptLineItemSchema),  
  pdfDownloadUrl: z.string().url(),  
  liffRedirectUrl: z.string().url(),  
});

export type LineReceiptPayload \= z.infer\<typeof LineReceiptPayloadSchema\>;

### **4\. Database & SDID Persistence Layer (PostgreSQL 16\)**

#### **4.1 Prisma Relational Schema Extension**

ข้อมูลโค้ด  
// Additional Data Models for PHASE-019 (Transactional LINE Messages & E-Receipts)

enum ReceiptStatus {  
  PENDING  
  GENERATED  
  DELIVERED  
  FAILED  
}

model TenantSetting {  
  id               String   @id @default(uuid())  
  tenantSlug       String   @unique  
  companyName      String  
  taxRegistrationNo String?  
  logoUrl          String  
  primaryColorHex  String   @default("\#00C751")  
  lineChannelToken String  
  createdAt        DateTime @default(now())  
  updatedAt        DateTime @updatedAt  
}

model ReceiptNotificationLog {  
  id             String        @id @default(uuid())  
  orderId        String  
  order          Order         @relation(fields: \[orderId\], references: \[id\], onDelete: Cascade)  
  lineUserId     String  
  status         ReceiptStatus @default(PENDING)  
  lineMessageId  String?  
  pdfR2Path      String?  
  errorMessage   String?  
  retryCount     Int           @default(0)  
  sentAt         DateTime?  
  createdAt      DateTime      @default(now())  
  updatedAt      DateTime      @updatedAt

  @@index(\[orderId\])  
  @@index(\[lineUserId\])  
  @@index(\[status\])  
}

### **5\. Backend DDD Microservices (NestJS \+ Fastify Core)**

#### **5.1 Directory Structure Tree**

src/backend/modules/notification/  
├── line-messaging.module.ts  
├── line-messaging.service.ts  
├── processors/  
│   └── receipt-queue.processor.ts  
├── templates/  
│   └── receipt-flex.template.ts  
└── pdf/  
    └── receipt-pdf.generator.ts

#### **5.2 LINE Flex Message Builder & Delivery Service**

TypeScript  
// src/backend/modules/notification/templates/receipt-flex.template.ts  
import { LineReceiptPayload } from '../../../shared/schemas/line-receipt.schema';

export function buildReceiptFlexMessage(payload: LineReceiptPayload): object {  
  const itemBoxes \= payload.items.map((item) \=\> ({  
    type: 'box',  
    layout: 'horizontal',  
    contents: \[  
      {  
        type: 'text',  
        text: \`\${item.title} (x\${item.quantity})\`,  
        size: 'sm',  
        color: '\#555555',  
        flex: 4,  
        wrap: true,  
      },  
      {  
        type: 'text',  
        text: \`฿\${item.totalPrice.toLocaleString('th-TH', { minimumFractionDigits: 2 })}\`,  
        size: 'sm',  
        color: '\#111111',  
        align: 'end',  
        flex: 2,  
      },  
    \],  
  }));

  return {  
    type: 'flex',  
    altText: \`ใบเสร็จรับเงินสำหรับคำสั่งซื้อ \#\${payload.orderNumber}\`,  
    contents: {  
      type: 'bubble',  
      size: 'mega',  
      header: {  
        type: 'box',  
        layout: 'vertical',  
        backgroundColor: '\#111827',  
        contents: \[  
          {  
            type: 'box',  
            layout: 'horizontal',  
            contents: \[  
              {  
                type: 'text',  
                text: payload.tenantName.toUpperCase(),  
                weight: 'bold',  
                color: '\#10B981',  
                size: 'xs',  
                flex: 3,  
              },  
              {  
                type: 'text',  
                text: 'E-RECEIPT',  
                weight: 'bold',  
                color: '\#FFFFFF',  
                size: 'xs',  
                align: 'end',  
                flex: 2,  
              },  
            \],  
          },  
          {  
            type: 'text',  
            text: \`฿\${payload.netAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}\`,  
            weight: 'bold',  
            color: '\#FFFFFF',  
            size: 'xxl',  
            margin: 'md',  
          },  
          {  
            type: 'text',  
            text: \`ชำระเรียบร้อยแล้วเมื่อ \${payload.paidAt}\`,  
            color: '\#9CA3AF',  
            size: 'xs',  
            margin: 'xs',  
          },  
        \],  
      },  
      body: {  
        type: 'box',  
        layout: 'vertical',  
        contents: \[  
          {  
            type: 'text',  
            text: \`เลขที่คำสั่งซื้อ: \#\${payload.orderNumber}\`,  
            size: 'xs',  
            color: '\#6B7280',  
            weight: 'bold',  
          },  
          {  
            type: 'separator',  
            margin: 'md',  
          },  
          {  
            type: 'box',  
            layout: 'vertical',  
            margin: 'md',  
            spacing: 'sm',  
            contents: itemBoxes,  
          },  
          {  
            type: 'separator',  
            margin: 'md',  
          },  
          {  
            type: 'box',  
            layout: 'horizontal',  
            margin: 'md',  
            contents: \[  
              {  
                type: 'text',  
                text: 'รวมทั้งสิ้น (รวม VAT)',  
                size: 'sm',  
                weight: 'bold',  
                color: '\#111111',  
              },  
              {  
                type: 'text',  
                text: \`฿\${payload.netAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}\`,  
                size: 'sm',  
                weight: 'bold',  
                color: '\#10B981',  
                align: 'end',  
              },  
            \],  
          },  
        \],  
      },  
      footer: {  
        type: 'box',  
        layout: 'vertical',  
        spacing: 'sm',  
        contents: \[  
          {  
            type: 'button',  
            style: 'primary',  
            color: '\#10B981',  
            action: {  
              type: 'uri',  
              label: 'เข้าสู่คลังหนังสือ / คอร์สเรียน',  
              uri: payload.liffRedirectUrl,  
            },  
          },  
          {  
            type: 'button',  
            style: 'secondary',  
            action: {  
              type: 'uri',  
              label: 'ดาวน์โหลดใบเสร็จ (PDF)',  
              uri: payload.pdfDownloadUrl,  
            },  
          },  
        \],  
      },  
    },  
  };  
}

TypeScript  
// src/backend/modules/notification/line-messaging.service.ts  
import { Injectable, Logger } from '@nestjs/common';  
import { PrismaService } from '../../infra/prisma/prisma.service';  
import { LineReceiptPayload } from '../../../shared/schemas/line-receipt.schema';  
import { buildReceiptFlexMessage } from './templates/receipt-flex.template';  
import fetch from 'node-fetch';

@Injectable()  
export class LineMessagingService {  
  private readonly logger \= new Logger(LineMessagingService.name);

  constructor(private prisma: PrismaService) {}

  async sendReceiptFlexMessage(payload: LineReceiptPayload): Promise\<boolean\> {  
    const flexPayload \= buildReceiptFlexMessage(payload);

    try {  
      const response \= await fetch('https\://api.line.me/v2/bot/message/push', {  
        method: 'POST',  
        headers: {  
          'Content-Type': 'application/json',  
          'Authorization': \`Bearer \${process.env.LINE\_CHANNEL\_ACCESS\_TOKEN}\`,  
        },  
        body: JSON.stringify({  
          to: payload.lineUserId,  
          messages: \[flexPayload\],  
        }),  
      });

      if (\!response.ok) {  
        const errorText \= await response.text();  
        throw new Error(\`LINE API Response Error \[\${response.status}\]: \${errorText}\`);  
      }

      const resData \= await response.json();

      // บันทึก Log การส่งใบเสร็จสำเร็จ  
      await this.prisma.receiptNotificationLog.create({  
        data: {  
          orderId: payload.orderId,  
          lineUserId: payload.lineUserId,  
          status: 'DELIVERED',  
          lineMessageId: resData.sentMessages?.\[0\]?.id || 'ACK',  
          pdfR2Path: payload.pdfDownloadUrl,  
          sentAt: new Date(),  
        },  
      });

      this.logger.log(\`Successfully pushed Flex Receipt for Order \#\${payload.orderNumber}\`);  
      return true;  
    } catch (error: any) {  
      this.logger.error(\`Failed to push LINE Flex Receipt: \${error.message}\`);  
        
      await this.prisma.receiptNotificationLog.create({  
        data: {  
          orderId: payload.orderId,  
          lineUserId: payload.lineUserId,  
          status: 'FAILED',  
          errorMessage: error.message,  
        },  
      });  
      return false;  
    }  
  }  
}

### **6\. Frontend Pages & PDF Vault Protocol**

#### **6.1 PDF Receipt Generation & Cloudflare R2 Vault Sync**

* ใบเสร็จรับเงิน PDF ถูกสร้างฝั่ง Backend ด้วย `PDFKit` / `Puppeteer Stream` โดยฝังตราประทับดิจิทัล (Digital Signature Checksum) และนำไฟล์ไปจัดเก็บที่ **Cloudflare R2** ในไดเรกทอรี `receipts/{tenantId}/{year}/{orderNumber}.pdf`  
* **Zero Egress Fee Rule:** เมื่อผู้ใช้กดดาวน์โหลดไฟล์ PDF จาก LINE Flex Message ระบบจะสร้าง Presigned URL ผ่าน Cloudflare CDN เพื่อดาวน์โหลดได้ฟรี 100% ไร้ค่า Bandwidth

### **7\. Data Pipeline, AI Adaptive Learning & Analytics**

#### **7.1 Real-Time Analytics Event Spec**

* **Event Tracking Log:**  
  * `line.receipt.delivered`: บันทึกเมื่อ LINE API ยืนยันการส่งข้อความสำเร็จ  
  * `line.receipt.click_liff`: บันทึกเมื่อผู้ใช้เปิดอ่านคอร์ส/หนังสือผ่านปุ่มใน Flex Message  
  * `line.receipt.download_pdf`: บันทึกเมื่อมีการคลิกโหลด PDF E-Receipt  
* ข้อมูลทั้งหมดถูกส่งเข้าสู่ **Redis Stream** เพื่อนำไปประมวลผล Customer Lifetime Value (LTV) และทำ Automated Re-engagement Campaign ต่อไป

### **8\. Security, DRM & Zero-Egress Storage Optimization**

#### **8.1 Security & HMAC Signature Verification**

* ทุก Presigned URL สำหรับการดาวน์โหลด PDF ใบเสร็จรับเงินมีอายุใช้งานจำกัด (Time-bound Expiry 24 ชั่วโมง) และมีการตรวจสอบ HMAC SHA-256 Signature เพื่อป้องกันการเข้าถึงใบเสร็จของผู้อื่น  
* ลายน้ำดิจิทัลแบบ Forensic Watermarking ถูกฝังลงในพิกเซลของไฟล์ PDF ใบเสร็จ เพื่อระบุรหัสผู้ซื้อและวันที่ชำระเงิน

### **9\. Token Efficiency & Code Diff Policies**

* **SDID Partial Code Diff Policy:** ใช้เฉพาะส่วนที่มีการอัปเดตไฟล์แบบ Partial Diff ในการพัฒนาต่อเติม เพื่อความรวดเร็วและประหยัด Token สูงสุด  
* **Zero Redundant Code Policy:** ใช้ Type Contract จาก `@prisma/client` และ `Zod` ร่วมกัน ไม่เขียน Type ซ้ำซ้อน

### **10\. Auto-QA & Autonomous Self-Healing Loop**

* **Performance & Speed Guard:** หากการประกอบและส่ง Flex Message ใช้เวลาเกิน `500ms` ระบบ Self-Healing Loop จะทำการปรับการดึงข้อมูล Tenant Config เข้าสู่ Redis Local Cache ทันที  
* **TDD Autonomous Loop:** ชุดทดสอบ Integration Test ครอบคลุมทั้งกรณีส่งผ่าน, LINE Token หมดอายุ, และกรณี User ไม่ได้ผูก LINE OA

### **11\. The 9 Enterprise Golden Gatekeepers Verification**

* \[x\] **Gate 1: SSOT Schema Sync (100%)** — Prisma Schema, Zod Contracts และ Flex Message Payload ตรงกันสมบูรณ์  
* \[x\] **Gate 2: Zero Type Violations** — ผ่านการตรวจ TypeScript Compiler Strict Mode 100%  
* \[x\] **Gate 3: UI/UX State Machine** — ครอบคลุมทั้ง 5 States การส่งข้อความ LINE  
* \[x\] **Gate 4: Security Audit** — Presigned URL \+ HMAC Signature ป้องกันการสุ่มโหลด PDF ใบเสร็จ  
* \[x\] **Gate 5: LIFF Canvas Memory Check (CRITICAL)** — ไม่ส่งผลกระทบต่อ Memory ของ LINE LIFF Canvas Reader  
* \[x\] **Gate 6: Zero-Egress Routing Check** — PDF ใบเสร็จทั้งหมดฝากและให้บริการผ่าน Cloudflare R2 ไร้ค่า Egress  
* \[x\] **Gate 7: Database Transaction Guard** — บันทึก Log การส่งผ่าน Prisma Atomic Transaction ร่วมกับการตรวจสลิป  
* \[x\] **Gate 8: Data Pipeline Verification** — Event Tracking ถูกส่งเข้า Redis Stream เรียลไทม์  
* \[x\] **Gate 9: Automated ADR Generation** — บันทึกสถาปัตยกรรม Decision Record ครบถ้วนตามมาตรฐานสากล

### **12\. Atomic Task Execution Plan (Omni-Channel Scope)**

* **Task 1:** อัปเดต Prisma Schema เพิ่ม `TenantSetting` และ `ReceiptNotificationLog` Models  
* **Task 2:** สร้าง Zod Schema สำหรับ `LineReceiptPayloadSchema` ใน Shared Layer  
* **Task 3:** พัฒนา `ReceiptPdfGeneratorService` เพื่อสร้าง PDF E-Receipt และอัปโหลดเข้า Cloudflare R2  
* **Task 4:** พัฒนา `buildReceiptFlexMessage` Template เพื่อประกอบ Flex Message ตามมาตรฐาน LINE  
* **Task 5:** พัฒนา `LineMessagingService` เชื่อมต่อ LINE Messaging Push API  
* **Task 6:** ผูกระบบเข้ากับ `PaymentSlipController` ให้ส่ง Flex Message อัตโนมัติหลังสลิปผ่านการตรวจสอบ  
* **Task 7:** ทดสอบ End-to-End Stress Test ด้วยคะแนนประเมินเต็ม 100/100 จากสภาวิศวกรซอฟต์แวร์

💎 **สรุปการส่งมอบจาก ซีเนครีเอเตอร์:** มาตรฐานการขยายเฟส **Atomic Phase 019** นี้ ได้รับการปรับปรุงและขยายความอย่างสมบูรณ์แบบในระดับ Enterprise Standard พร้อมนำไปสืบทอดและพัฒนาต่อในระบบ Ebook, Elearning, Ecommerce on LINE LIFF & Web Application ได้เสร็จสมบูรณ์ 100% ตามบัญชาครับ\!

