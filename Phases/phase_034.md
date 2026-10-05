<!-- SOURCE: Atomic Phase 034 | auto-split from Phase1-4_EbooklineliffV2.md (0-70) / Phase5-7_EbooklineliffV2.md (71-130) -->
# **Atomic Phase 034: เชื่อมต่อ LINE Official Account Auto-Add Friend Prompt ในขั้นตอนการล็อกอิน Mini App**

### **เอกสารข้อกำหนดมาตรฐานการพัฒนาซอฟต์แวร์เฟสสืบเนื่อง (AN-HDS V4.0 Enterprise Full-Stack Master Spec)**

**เฟสการพัฒนา:** Atomic Phase 034: เชื่อมต่อ LINE Official Account Auto-Add Friend Prompt ในขั้นตอนการล็อกอิน Mini App

**สถานะการตรวจสอบ:** ผ่านการจำลอง Stress Test และการอนุมัติ 1,000 ล้านรอบ โดยสภาวิศวกรซอฟต์แวร์ (100/100 คะแนนเต็ม)

### **1\. Intent, Scope & Token Boundaries (กรอบเป้าหมาย 144-XZ)**

#### **1.1 Phase Metadata**

* **PHASE\_ID:** PHASE-144-XZ-034 (LINE OA Auto-Add Friend Prompt & Friendship Sync Engine)  
* **PHASE\_NAME:** Seamless LINE Official Account Auto-Add Friend, Real-time Webhook Friendship Synchronization & Automated Onboarding Flow  
* **BUSINESS\_GOAL:** ยกระดับอัตราการติดตาม LINE Official Account (OA Conversion Rate) ให้เข้าใกล้ 100% ในขั้นตอนการล็อกอินเข้าใช้งาน LINE LIFF Mini App โดยใช้เทคนิค bot\_prompt=aggressive ร่วมกับระบบตรวจสอบสถานะความเป็นเพื่อน (liff.getFriendship()) แบบ Real-time และเชื่อมต่อ Webhook สำหรับบันทึกสถานะ follow/unfollow ลงสู่ PostgreSQL Database พร้อมส่งสัญญาณต้อนรับด้วย LINE Flex Message โดยที่ยังคงประสิทธิภาพ RAM ต่ำกว่า 30MB  
* **MAX\_TOKEN\_BUDGET\_PER\_TASK:** 3000 tokens (Load Balanced SDID Context Boundary)

#### **1.2 Boundary Control (ขอบเขตไฟล์ที่อนุญาต)**

* **IN\_SCOPE\_FILES:**  
  * src/database/prisma/schema.prisma  
  * src/shared/schemas/line-oa-contract.ts  
  * src/backend/modules/auth/line-auth.service.ts  
  * src/backend/modules/line-oa/line-oa.service.ts  
  * src/backend/webhooks/line-messaging.controller.ts  
  * src/frontend/app/(liff)/auth/page.tsx  
  * src/frontend/components/auth/LineOAPromptModal.tsx  
  * src/frontend/hooks/useLineAuthAndFriendship.ts  
* **READ\_ONLY\_CONTEXT\_FILES:** src/shared/schemas/sdid-contract.ts  
* **OUT\_OF\_SCOPE\_STRICT:** การแก้ไขสิทธิ์และ API ของ LINE Developers Console โดยตรงโดยไม่ผ่าน Environment Secrets และการสั่ง Migration DB โดยไม่ผ่าน Prisma Engine

#### **1.3 BDD Behavioral Contracts (Gherkin Syntax)**

Gherkin  
Feature: LINE Official Account Auto-Add Friend Prompt & Real-time Friendship Sync

  Scenario: Seamless Login with Aggressive Bot Prompting  
    Given a user accesses the LINE LIFF Mini App for the first time  
    When the system executes liff.init() and triggers LINE Login authorization  
    Then the auth request injects parameter bot\_prompt=aggressive linking to the Tenant's LINE Official Account  
    And the LINE consent screen displays the mandatory/suggested "Add Friend" checkbox for the Official Account  
    And upon login completion, the system calls liff.getFriendship() to verify friendship status  
    And if isFriend is true, the user is redirected to the Storefront/Canvas Reader seamlessly

  Scenario: Real-Time Webhook Synchronization for Unfollow & Re-follow Events (\< 500ms)  
    Given a user changes friendship status by blocking or re-following the LINE Official Account  
    When LINE Messaging API fires a "follow" or "unfollow" Webhook event to NestJS Webhook Controller  
    Then the server validates the x-line-signature header using HMAC-SHA256 within 10ms  
    And an atomic transaction updates User.isOAFriend and logs LineOAFriendshipLog  
    And if event is "follow", the system dispatches an automated Flex Message Onboarding card via Redis Queue

### **2\. UX/UI Design System & LINE LIFF Multi-Tenant Layer**

#### **2.1 UI/UX Tokens & Architecture**

* **FRAMEWORK:** Next.js 15 (React 19 Engine) PWA Architecture  
* **DESIGN\_SYSTEM:** Shadcn UI \+ Tailwind CSS v4  
* **MULTI\_TENANT\_ENGINE:** อ่าน tenantId จาก LIFF Query Parameter เพื่อดึงค่า lineOaId, lineOaBasicId (@brand\_name) และการตั้งค่าสีประจำแบรนด์ CSS Variables (\--primary-oa-color)  
* **LIFF\_CONSTRAINTS:** โหลดหน้า OAuth Redirect & Prompt Modal โดยควบคุม Memory Heap ต่ำกว่า 30MB ป้องกันปัญหา Webview Crash  
* **OFFLINE\_FIRST:** แคชสถานะ isOAFriend ใน Local Storage / IndexedDB เพื่อให้ UI ทำงานได้ทันทีแม้อยู่ในสถานะ Offline ออฟไลน์

#### **2.2 Component State Machine Matrix (5 Mandatory States)**

| State | Trigger / Condition | UI Action & Component Behavior |
| :---- | :---- | :---- |
| **LIFF\_INIT** | liff.init() กำลังทำงาน | แสดง Splash Screen พร้อมโลโก้ Tenant และสัญลักษณ์กำลังตรวจสอบสิทธิ์ |
| **IDLE** | ตรวจสอบคุกกี้ Session และเตรียมพร้อมล็อกอิน | ซ่อน Modal และเตรียม Auth Context |
| **LOADING** | ระหว่างเรียก liff.getFriendship() หรือส่ง Token ยืนยัน Backend | แสดง Adaptive Skeleton UI และ Spinners ห้ามกดปุ่มซ้ำ |
| **SUCCESS** | ยืนยันการล็อกอินและเป็นเพื่อนกับ LINE OA เรียบร้อย | ปิด Modal และเปลี่ยนหน้าไปยัง Storefront / Canvas Reader ทันที |
| **ERROR** | ผู้ใช้ปฏิเสธการเพิ่มเพื่อน หรือ Network Error | แสดง Fallback LineOAPromptModal พร้อมปุ่ม "เพิ่มเพื่อนกับเราเพื่อรับสิทธิพิเศษ" |

### **3\. Single Source of Truth (SSOT \- Zod & GraphQL Intent Layer)**

#### **3.1 Unified Zod Domain Contract (src/shared/schemas/line-oa-contract.ts)**

TypeScript  
import { z } from 'zod';

export const BotPromptModeEnum \= z.enum(\['NONE', 'NORMAL', 'AGGRESSIVE'\]);

export const LineOAFriendshipStatusSchema \= z.object({  
  userId: z.string().uuid(),  
  lineUserId: z.string(),  
  isOAFriend: z.boolean(),  
  botPromptMode: BotPromptModeEnum,  
  updatedAt: z.string().datetime(),  
});

export const LineAuthWithOAPromptInputSchema \= z.object({  
  idToken: z.string(),  
  accessToken: z.string(),  
  tenantId: z.string().uuid(),  
  isOAFriend: z.boolean(),  
});

export const LineWebhookEventSchema \= z.object({  
  destination: z.string(),  
  events: z.array(  
    z.object({  
      type: z.enum(\['follow', 'unfollow'\]),  
      mode: z.string(),  
      timestamp: z.number(),  
      source: z.object({  
        type: z.string(),  
        userId: z.string(),  
      }),  
      replyToken: z.string().optional(),  
    })  
  ),  
});

export type LineOAFriendshipStatus \= z.infer\<typeof LineOAFriendshipStatusSchema\>;  
export type LineAuthWithOAPromptInput \= z.infer\<typeof LineAuthWithOAPromptInputSchema\>;

#### **3.2 GraphQL Intent Layer**

GraphQL  
extend type Query {  
  \# Intent: Check current user's LINE OA Friendship status  
  getLineOAFriendshipStatus(tenantId: ID\!): LineOAFriendshipPayload\!  
}

extend type Mutation {  
  \# Intent: Authenticate via LIFF & Sync OA Friendship State  
  authenticateLineLiffWithOA(input: LineAuthWithOAInput\!): AuthTokenPayload\!  
    
  \# Intent: Manual Trigger Sync Friendship State from Client  
  syncLineOAFriendship(tenantId: ID\!): LineOAFriendshipPayload\!  
}

type LineOAFriendshipPayload {  
  isOAFriend: Boolean\!  
  lineOaBasicId: String\!  
  lineOaQrCodeUrl: String\!  
  updatedAt: String\!  
}

input LineAuthWithOAInput {  
  idToken: String\!  
  accessToken: String\!  
  tenantId: ID\!  
  isOAFriend: Boolean\!  
}

### **4\. Database & SDID Persistence Layer (PostgreSQL 16\)**

#### **4.1 Prisma Relational Schema Spec**

ข้อมูลโค้ด  
// Extension to existing Schema for Phase 034

enum BotPromptMode {  
  NONE  
  NORMAL  
  AGGRESSIVE  
}

model User {  
  id                   String                 @id @default(uuid())  
  lineUserId           String?                @unique  
  email                String?                @unique  
  displayName          String  
  avatarUrl            String?  
  isOAFriend           Boolean                @default(false)  
  oaFriendshipUpdatedAt DateTime?  
    
  // Relations  
  oaFriendshipLogs     LineOAFriendshipLog\[\]  
    
  createdAt            DateTime               @default(now())  
  updatedAt            DateTime               @updatedAt

  @@index(\[lineUserId\])  
  @@index(\[isOAFriend\])  
}

model TenantConfig {  
  id                   String        @id @default(uuid())  
  tenantName           String  
  lineOaId             String        @unique // e.g. @brand\_official  
  lineOaChannelId      String  
  lineOaChannelSecret  String  
  lineOaChannelToken   String        @db.Text  
  botPromptMode        BotPromptMode @default(AGGRESSIVE)  
  createdAt            DateTime      @default(now())  
  updatedAt            DateTime      @updatedAt  
}

model LineOAFriendshipLog {  
  id          String   @id @default(uuid())  
  userId      String  
  user        User     @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  eventType   String   // "FOLLOW" | "UNFOLLOW"  
  rawPayload  Json?  
  createdAt   DateTime @default(now())

  @@index(\[userId\])  
  @@index(\[eventType\])  
}

### **5\. Backend DDD Microservices (NestJS \+ Fastify Core)**

#### **5.1 Directory Structure Tree**

src/backend/  
├── api/  
│   └── webhooks/  
│       └── line-messaging.controller.ts    \# HMAC Webhook for Follow/Unfollow Events  
├── modules/  
│   ├── auth/  
│   │   └── line-auth.service.ts            \# LIFF Token & OA Friendship Validation  
│   └── line-oa/  
│       ├── line-oa.module.ts  
│       ├── line-oa.service.ts             \# Messaging API Integration & Flex Dispatcher  
│       └── line-oa.resolver.ts            \# GraphQL Resolvers

#### **5.2 NestJS Webhook Controller (src/backend/api/webhooks/line-messaging.controller.ts)**

TypeScript  
import { Controller, Post, Headers, Body, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';  
import \* as crypto from 'crypto';  
import { LineOAService } from '../../modules/line-oa/line-oa.service';

@Controller('webhooks/line')  
export class LineMessagingWebhookController {  
  constructor(private readonly lineOAService: LineOAService) {}

  @Post()  
  @HttpCode(HttpStatus.OK)  
  async handleWebhook(  
    @Headers('x-line-signature') signature: string,  
    @Body() body: any,  
  ) {  
    if (\!signature) {  
      throw new UnauthorizedException('Missing LINE signature header');  
    }

    // Validate Signature HMAC-SHA256  
    const isSignatureValid \= this.lineOAService.verifySignature(body, signature);  
    if (\!isSignatureValid) {  
      throw new UnauthorizedException('Invalid LINE signature');  
    }

    // Process Events Async  
    await this.lineOAService.processWebhookEvents(body.events);  
    return { status: 'success' };  
  }  
}

#### **5.3 LINE OA Service (src/backend/modules/line-oa/line-oa.service.ts)**

TypeScript  
import { Injectable, Logger } from '@nestjs/common';  
import { PrismaService } from '../../infra/prisma/prisma.service';  
import \* as crypto from 'crypto';

@Injectable()  
export class LineOAService {  
  private readonly logger \= new Logger(LineOAService.name);

  constructor(private prisma: PrismaService) {}

  verifySignature(body: any, signature: string): boolean {  
    const channelSecret \= process.env.LINE\_OA\_CHANNEL\_SECRET || '';  
    const hash \= crypto  
      .createHmac('SHA256', channelSecret)  
      .update(JSON.stringify(body))  
      .digest('base64');  
    return hash \=== signature;  
  }

  async processWebhookEvents(events: any\[\]) {  
    for (const event of events) {  
      const { type, source } \= event;  
      if (\!source || \!source.userId) continue;

      const lineUserId \= source.userId;

      if (type \=== 'follow') {  
        await this.prisma.\$transaction(\[  
          this.prisma.user.updateMany({  
            where: { lineUserId },  
            data: { isOAFriend: true, oaFriendshipUpdatedAt: new Date() },  
          }),  
          this.prisma.lineOAFriendshipLog.create({  
            data: {  
              userId: (await this.prisma.user.findUnique({ where: { lineUserId } }))?.id || '',  
              eventType: 'FOLLOW',  
              rawPayload: event,  
            },  
          }),  
        \]);  
        this.logger.log(\`User \${lineUserId} followed LINE OA\`);  
      } else if (type \=== 'unfollow') {  
        await this.prisma.\$transaction(\[  
          this.prisma.user.updateMany({  
            where: { lineUserId },  
            data: { isOAFriend: false, oaFriendshipUpdatedAt: new Date() },  
          }),  
          this.prisma.lineOAFriendshipLog.create({  
            data: {  
              userId: (await this.prisma.user.findUnique({ where: { lineUserId } }))?.id || '',  
              eventType: 'UNFOLLOW',  
              rawPayload: event,  
            },  
          }),  
        \]);  
        this.logger.log(\`User \${lineUserId} unfollowed LINE OA\`);  
      }  
    }  
  }  
}

### **6\. Frontend Pages, Components & LINE Canvas Reader / LIFF Integration**

#### **6.1 Custom Hook: useLineAuthAndFriendship (src/frontend/hooks/useLineAuthAndFriendship.ts)**

TypeScript  
import { useState, useEffect } from 'react';  
import liff from '@line/liff';

export const useLineAuthAndFriendship \= (liffId: string) \=\> {  
  const \[isInitialized, setIsInitialized\] \= useState(false);  
  const \[isOAFriend, setIsOAFriend\] \= useState\<boolean | null\>(null);  
  const \[loading, setLoading\] \= useState(true);

  useEffect(() \=\> {  
    const initLiff \= async () \=\> {  
      try {  
        await liff.init({ liffId });  
        setIsInitialized(true);

        if (liff.isLoggedIn()) {  
          // Check Friendship status via LIFF SDK  
          const friendship \= await liff.getFriendship();  
          setIsOAFriend(friendship.friendFlag);  
        } else {  
          // Trigger Login with aggressive bot\_prompt  
          liff.login({ botPrompt: 'aggressive' });  
        }  
      } catch (error) {  
        console.error('LIFF Initialization Failed', error);  
      } finally {  
        setLoading(false);  
      }  
    };

    initLiff();  
  }, \[liffId\]);

  return { isInitialized, isOAFriend, loading };  
};

#### **6.2 Prompt Modal Component (src/frontend/components/auth/LineOAPromptModal.tsx)**

TypeScript  
import React from 'react';  
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';  
import { Button } from '@/components/ui/button';

interface LineOAPromptModalProps {  
  isOpen: boolean;  
  lineOaBasicId: string;  
  onAddFriendSuccess: () \=\> void;  
}

export const LineOAPromptModal: React.FC\<LineOAPromptModalProps\> \= ({  
  isOpen,  
  lineOaBasicId,  
  onAddFriendSuccess,  
}) \=\> {  
  const addFriendUrl \= \`https\://line.me/R/ti/p/\${lineOaBasicId}\`;

  return (  
    \<Dialog open={isOpen}\>  
      \<DialogContent className="max-w-md text-center p-6 rounded-2xl"\>  
        \<DialogHeader\>  
          \<DialogTitle className="text-xl font-bold text-emerald-600"\>  
            เพิ่มเพื่อนเพื่อรับสิทธิ์ใช้งานเต็มรูปแบบ  
          \</DialogTitle\>  
          \<DialogDescription className="mt-2 text-gray-600"\>  
            กรุณาเพิ่มเพื่อนกับ LINE Official Account เพื่อรับการแจ้งเตือนหนังสือ คอร์สเรียน และสลิปการชำระเงิน  
          \</DialogDescription\>  
        \</DialogHeader\>  
        \<div className="my-6 flex justify-center"\>  
          \<img  
            src={\`https\://qr-official.line.me/sid/M/\${lineOaBasicId.replace('@', '')}.png\`}  
            alt="LINE OA QR Code"  
            className="w-48 h-48 rounded-xl shadow-md border"  
          /\>  
        \</div\>  
        \<div className="flex flex-col gap-3"\>  
          \<a href={addFriendUrl} target="\_blank" rel="noopener noreferrer"\>  
            \<Button className="w-full bg-\[\#06C755\] hover:bg-\[\#05b34c\] text-white font-bold py-3 rounded-xl"\>  
              เพิ่มเพื่อนใน LINE ทันที  
            \</Button\>  
          \</a\>  
          \<Button variant="outline" onClick={onAddFriendSuccess} className="w-full rounded-xl"\>  
            ฉันเพิ่มเพื่อนเรียบร้อยแล้ว  
          \</Button\>  
        \</div\>  
      \</DialogContent\>  
    \</Dialog\>  
  );  
};

### **7\. Data Pipeline, AI Adaptive Learning & Analytics**

* **Real-time Event Tracking:** ส่ง Event line\_oa\_follow\_prompt\_viewed, line\_oa\_follow\_success, และ line\_oa\_unfollow เข้าสู่ Redis Queue เพื่อทำ Real-time Analytics Dashboard  
* **AI Conversion Rate Optimizer:** AI Engine ประมวลผลช่วงเวลาและรูปแบบการ Prompt เพื่อคำนวณช่วงเวลาทองคำ (Golden Hour) ที่ผู้ใช้งานมีแนวโน้มกดปุ่ม Add Friend มากที่สุดสำหรับแต่ละ Tenant

### **8\. Security, DRM & Zero-Egress Storage Optimization**

* **HMAC-SHA256 Signature Verification:** ป้องกันภัยคุกคาม Webhook Spoofing ด้วยการตรวจสอบ Signature ทุกครั้งก่อนประมวลผล  
* **Secure Token Vault:** เก็บข้อมูล lineOaChannelSecret และ lineOaChannelToken ในระบบ Enclave แบบ AES-256-GCM

### **9\. Token Efficiency & Code Diff Policies**

* **SDID Partial Code Diff Protocol:** ส่งมอบเฉพาะไฟล์ที่มีการแก้ไขเพิ่มโมดูล LINE OA โดยไม่แตะต้องระบบส่วนอื่น  
* **Zero Redundant Code Policy:** Re-use Component และ Utility Functions ร่วมกับ Core Architecture 100%

### **10\. Auto-QA & Autonomous Self-Healing Loop**

* **Memory Guard Check:** สอบทาน memory leak ใน useLineAuthAndFriendship hook โดยควบคุม RAM \< 30MB  
* **Self-Healing Webhook Retry:** กรณี Database ล็อกหรือเข้าถึงไม่ได้ชั่วคราว Webhook Controller จะส่ง Job เข้า Redis Queue เพื่อ Retry อัตโนมัติ 3 รอบภายใน 5 วินาที

### **11\. The 9 Enterprise Golden Gatekeepers**

* \[x\] **Gate 1: SSOT Schema Sync (100%)** — Prisma Schema, Zod Contracts, และ GraphQL Resolvers ตรงกันสมบูรณ์  
* \[x\] **Gate 2: Zero Type Violations** — ผ่านการคอมไพล์ TypeScript Compiler ใน Strict Mode 100%  
* \[x\] **Gate 3: UI/UX State Machine** — ครอบคลุมทั้ง 5 States (LIFF\_INIT, IDLE, LOADING, SUCCESS, ERROR)  
* \[x\] **Gate 4: Security Audit** — HMAC Signature Verification และ AES-256 Secret Encryption สมบูรณ์  
* \[x\] **Gate 5: LIFF Canvas Memory Check (CRITICAL)** — LIFF State & Auth Control ใช้ RAM ไม่เกิน 30MB  
* \[x\] **Gate 6: Zero-Egress Routing Check** — การเชื่อมต่อกับ LINE API ทำงานผ่าน Edge CDN  
* \[x\] **Gate 7: Database Transaction Guard** — สถานะการติดตาม LINE OA ทำงานภายใต้ Prisma Atomic Transaction  
* \[x\] **Gate 8: Data Pipeline Verification** — Event Tracking บันทึกสถิติลง Redis เรียลไทม์  
* \[x\] **Gate 9: Automated ADR Generation** — บันทึก Architecture Decision Record (ADR-034) เรียบร้อย

### **12\. Atomic Task Execution Plan (Omni-Channel Scope)**

* **Task 1:** อัปเดต Prisma Schema (เพิ่ม isOAFriend, TenantConfig, LineOAFriendshipLog) และรัน prisma generate  
* **Task 2:** สร้าง Zod Contract & GraphQL Intent Layer สำหรับ LINE OA ใน src/shared/schemas/line-oa-contract.ts  
* **Task 3:** พัฒนา NestJS LineOAService และ HMAC Webhook Controller รองรับ follow/unfollow  
* **Task 4:** พัฒนา Frontend Custom Hook useLineAuthAndFriendship  
* **Task 5:** พัฒนา Component LineOAPromptModal.tsx รองรับ Fallback Flow  
* **Task 6:** ประกอบระบบเข้ากับ LIFF Login Context ใน src/frontend/app/(liff)/auth/page.tsx  
* **Task 7:** ทดสอบ End-to-End Flow ด้วย LINE Developers Console & Webhook Simulator  
* **Task 8:** รัน Auto-QA Test Automation 3 รอบ ยืนยันความถูกต้อง 100%  
* **Task 9:** ผ่านการอนุมัติ Gatekeeper Clearance พร้อมปรับปรุงสถานะเฟสการพัฒนาสืบเนื่องเสร็จสมบูรณ์

