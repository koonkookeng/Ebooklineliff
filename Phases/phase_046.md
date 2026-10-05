<!-- SOURCE: Atomic Phase 046 | auto-split from Phase1-4_EbooklineliffV2.md (0-70) / Phase5-7_EbooklineliffV2.md (71-130) -->
# **Atomic Phase 046: พัฒนาระบบ Progress Syncing ทำงานเบื้องหลังทุก 5 วินาที เพื่อบันทึกเวลาเรียนวิดีโอข้ามอุปกรณ์**

# **มาตรฐานการขยายเฟสการพัฒนาซอฟต์แวร์ (Enterprise SDID Phase Expansion Standard)**

## **Atomic Phase 046: พัฒนาระบบ Progress Syncing ทำงานเบื้องหลังทุก 5 วินาที เพื่อบันทึกเวลาเรียนวิดีโอข้ามอุปกรณ์**

### **1\. Intent, Scope & Token Boundaries (กรอบเป้าหมาย 144-XZ)**

#### **1.1 Phase Metadata**

* **PHASE\_ID:** PHASE-046-PROGRESS-SYNC  
* **PHASE\_NAME:** Background Video Progress Syncing Engine & Cross-Device State Reconciler (5s Heartbeat & Event Beacon)  
* **BUSINESS\_GOAL:** บันทึกระยะเวลาการเรียนวิดีโอ HLS (watchedSec) แบบ Real-time ทุก 5 วินาที โดยไม่บล็อก Main Thread และ UI ของ LINE LIFF ควบคุมการบริโภค Memory ให้อยู่ระดับต่ำกว่า 30MB เพื่อรองรับการสลับอุปกรณ์เรียนต่อได้อย่างราบรื่น (Cross-Device Seamless Resume) พร้อมประมวลผลข้อมูล Video Drop-off Heatmap บน Redis ในระดับ Enterprise Performance (\< 20ms Edge Latency)  
* **MAX\_TOKEN\_BUDGET\_PER\_TASK:** 3,500 tokens (Load Balanced SDID Context Boundary)

#### **1.2 Boundary Control (ขอบเขตไฟล์ที่อนุญาต)**

* **IN\_SCOPE\_FILES:**  
  * src/backend/modules/stream/progress/progress.controller.ts  
  * src/backend/modules/stream/progress/progress.service.ts  
  * src/backend/modules/stream/progress/progress.resolver.ts  
  * src/backend/infra/redis/progress-buffer.service.ts  
  * src/frontend/components/video/hooks/useVideoProgressSync.ts  
  * src/frontend/components/video/HlsVideoPlayer.tsx  
  * src/shared/schemas/progress-sync.schema.ts  
* **READ\_ONLY\_CONTEXT\_FILES:**  
  * src/database/prisma/schema.prisma  
  * src/shared/schemas/sdid-contract.ts  
* **OUT\_OF\_SCOPE\_STRICT:**  
  * การแก้ไข Database Migration Schema โดยไม่ผ่าน Prisma Engine  
  * การแก้ไข Core DRM HLS Video Transcoding Engine หลัก

#### **1.3 BDD Behavioral Contracts (Gherkin Syntax)**

Gherkin  
Feature: Cross-Device Background Video Progress Syncing Engine (\< 30MB RAM)

  Scenario: Periodic 5-Second Background Progress Syncing  
    Given a user is watching an HLS E-Learning course video on LINE LIFF  
    When the playback time advances by 5 seconds  
    Then the background sync hook dispatches an asynchronous HTTP POST/GraphQL Mutation to NestJS Gateway  
    And the Redis Edge Buffer stores the updated \`watchedSec\` instantly with \< 20ms response time  
    And the LINE LIFF Webview RAM consumption remains strictly below 30MB

  Scenario: Offline Queueing & Navigator Beacon Flush on Unload  
    Given a user closes the LINE LIFF app or switches tabs during video playback  
    When the \`visibilitychange\` or \`beforeunload\` event is triggered  
    Then the system executes \`navigator.sendBeacon()\` with the last recorded progress  
    And the backend receives and persists the final \`watchedSec\` even if the DOM is unmounted

  Scenario: Cross-Device Resume Position Handshake  
    Given a user resumes watching a video on a Desktop Web Browser after watching on LINE LIFF  
    When the user opens the lesson stream  
    Then the system queries \`getLessonStreamState\` and fetches the highest \`watchedSec\` from Redis/PostgreSQL  
    And the player auto-seeks to the exact second with a smooth overlay prompt "Resume from XX:XX"

  Scenario: Video Drop-off Heatmap Analytics Ingestion  
    Given multiple users are streaming a specific video lesson  
    When progress sync payloads are received every 5 seconds  
    Then the system increments second-level bucket counters in Redis Sorted Set (ZSET)  
    And generates real-time drop-off analytics data without querying the primary PostgreSQL DB

### **2\. UX/UI Design System & LINE LIFF Multi-Tenant Layer**

#### **2.1 UI/UX Tokens & Architecture**

* **FRAMEWORK:** Next.js 15 (React 19 Engine) PWA Architecture  
* **DESIGN SYSTEM:** Shadcn UI \+ Tailwind CSS v4  
* **BACKGROUND PULSE INDICATOR:** แสดงสถานะการซิงก์ข้อมูลเป็นไฟสถานะมินิมอล (Subtle Syncing Pulse Dot) ที่มุมขวาบนของ Player Controls เพื่อให้ผู้เรียนทราบว่าข้อมูลกำลังถูกบันทึก โดยไม่ส่งผลกระทบต่อประสบการณ์การรับชม  
* **MEMORY & THREAD OPTIMIZATION:** จำกัดการใช้ RAM ไม่เกิน 30MB โดยใช้ requestIdleCallback ร่วมกับ Lightweight Event Listeners และล้าง Timer/Subscriptions ทั้งหมดเมื่อ Unmount เพื่อป้องกัน Memory Leak บน LINE Webview

#### **2.2 Component State Machine Matrix (5 Mandatory States)**

| State | Trigger / Condition | UI Action & Component Behavior |
| :---- | :---- | :---- |
| **LIFF\_INIT** | liff.init() หรือ Video Player Mount | แสดง Player Skeleton UI และโหลดการตั้งค่า Progress ซิงก์เดิมจาก Local Cache |
| **IDLE** | วิดีโอหยุดเล่น (Paused / Stopped) | หยุด Timer การซิงก์รอบ 5 วินาที พร้อมส่ง Sync Payload ล่าสุดเก็บไว้ที่ Redis |
| **LOADING** | Fetching Initial Progress จาก Server | แสดง Indicator "Retrieving Last Played Location..." พร้อมตั้งค่า Seek Position |
| **SUCCESS** | Progress Sync Success (API 200 OK) | กะพริบไฟ Subtle Sync Pulse เป็นสีเขียวเป็นเวลา 500ms แล้วกลับสู่ปกติ |
| **ERROR** | Sync Failed (Network Failure / Timeout) | พักข้อมูล Sync ไว้ใน Offline Queue (IndexedDB/LocalStorage) และลองส่งใหม่เมื่อ Network Reconnect |

### **3\. Single Source of Truth (SSOT \- Zod & GraphQL Intent Layer)**

#### **3.1 Unified Zod Domain Contract**

TypeScript  
import { z } from 'zod';

export const SyncProgressInputSchema \= z.object({  
  lessonId: z.string().uuid(),  
  watchedSec: z.number().int().nonnegative(),  
  durationSec: z.number().int().positive(),  
  isCompleted: z.boolean().default(false),  
  clientTimestamp: z.string().datetime(),  
});

export const SyncProgressPayloadSchema \= z.object({  
  success: z.boolean(),  
  lessonId: z.string().uuid(),  
  savedWatchedSec: z.number().int().nonnegative(),  
  isCompleted: z.boolean(),  
  serverTimestamp: z.string().datetime(),  
});

export const LessonStreamStateSchema \= z.object({  
  lessonId: z.string().uuid(),  
  hlsPlaylistUrl: z.string().url(),  
  lastWatchedSec: z.number().int().nonnegative(),  
  durationSec: z.number().int().positive(),  
  isCompleted: z.boolean(),  
});

export type SyncProgressInput \= z.infer\<typeof SyncProgressInputSchema\>;  
export type SyncProgressPayload \= z.infer\<typeof SyncProgressPayloadSchema\>;  
export type LessonStreamState \= z.infer\<typeof LessonStreamStateSchema\>;

#### **3.2 GraphQL Schema Interface**

GraphQL  
input SyncProgressInput {  
  lessonId: ID\!  
  watchedSec: Int\!  
  durationSec: Int\!  
  isCompleted: Boolean\!  
  clientTimestamp: String\!  
}

type SyncProgressPayload {  
  success: Boolean\!  
  lessonId: ID\!  
  savedWatchedSec: Int\!  
  isCompleted: Boolean\!  
  serverTimestamp: String\!  
}

type LessonStreamPayload {  
  lessonId: ID\!  
  hlsPlaylistUrl: String\!  
  lastWatchedSec: Int\!  
  durationSec: Int\!  
  isCompleted: Boolean\!  
}

extend type Query {  
  getLessonStreamState(lessonId: ID\!): LessonStreamPayload\!  
}

extend type Mutation {  
  syncLessonProgress(input: SyncProgressInput\!): SyncProgressPayload\!  
}

### **4\. Database & SDID Persistence Layer (PostgreSQL 16\)**

#### **4.1 Prisma Relational Schema Spec**

ข้อมูลโค้ด  
model CourseLearningProgress {  
  id          String   @id @default(uuid())  
  userId      String  
  user        User     @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  lessonId    String  
  watchedSec  Int      @default(0)  
  isCompleted Boolean  @default(false)  
  updatedAt   DateTime @updatedAt

  @@unique(\[userId, lessonId\])  
  @@index(\[userId\])  
  @@index(\[lessonId\])  
  @@index(\[updatedAt\])  
}

#### **4.2 High-Throughput Write-Behind Strategy**

เพื่อป้องกันปัญหา Database IOPS Overload จากการส่ง Request เข้ามาทุก 5 วินาทีจากผู้ใช้งานพร้อมกันจำนวนมาก ระบบใช้ **Redis Write-Behind Buffer Pattern**:

1. เมื่อ API รับ Payload เข้ามา จะทำการบันทึกข้อมูลลง **Redis Hash** (progress:buffer:{userId}:{lessonId}) และปรับปรุง **Redis ZSET** สำหรับ Video Drop-off Heatmap ทันที (\< 5ms)  
2. มี **Scheduled Background Worker** สรุปข้อมูลจาก Redis Flush ลง PostgreSQL 16 ทุกๆ 30 วินาที ผ่าน prisma.courseLearningProgress.upsert() แบบ Atomic Transaction

### **5\. Backend DDD Microservices (NestJS \+ Fastify Core)**

#### **5.1 Directory Structure Tree**

src/backend/modules/stream/progress/  
├── dto/  
│   ├── sync-progress.input.ts  
│   └── sync-progress.response.ts  
├── progress.controller.ts       \# REST Gateway for sendBeacon / Fast Sync  
├── progress.resolver.ts         \# GraphQL Resolver for Progress Sync  
├── progress.service.ts          \# Core Domain Logic & Reconciliation  
└── progress.module.ts           \# NestJS Module Definition

#### **5.2 Fastify REST Controller & Redis Buffer Service**

TypeScript  
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';  
import { ProgressService } from './progress.service';  
import { SyncProgressInputSchema, SyncProgressInput } from 'src/shared/schemas/progress-sync.schema';  
import { JwtAuthGuard } from 'src/backend/modules/auth/guards/jwt-auth.guard';

@Controller('api/v1/stream/progress')  
export class ProgressController {  
  constructor(private readonly progressService: ProgressService) {}

  @UseGuards(JwtAuthGuard)  
  @Post('sync')  
  async syncProgress(@Req() req: any, @Body() body: SyncProgressInput) {  
    const validatedInput \= SyncProgressInputSchema.parse(body);  
    const userId \= req.user.id;  
    return await this.progressService.bufferProgressSync(userId, validatedInput);  
  }

  @Post('beacon')  
  async handleBeaconSync(@Req() req: any, @Body() body: any) {  
    // Parser for navigator.sendBeacon raw payload  
    const parsedData \= typeof body \=== 'string' ? JSON.parse(body) : body;  
    const validatedInput \= SyncProgressInputSchema.parse(parsedData.input);  
    const userId \= parsedData.userId;  
    return await this.progressService.bufferProgressSync(userId, validatedInput);  
  }  
}

TypeScript  
import { Injectable, Logger } from '@nestjs/common';  
import { RedisService } from 'src/backend/infra/redis/redis.service';  
import { PrismaService } from 'src/backend/infra/prisma/prisma.service';  
import { SyncProgressInput, SyncProgressPayload } from 'src/shared/schemas/progress-sync.schema';

@Injectable()  
export class ProgressService {  
  private readonly logger \= new Logger(ProgressService.name);

  constructor(  
    private readonly redis: RedisService,  
    private readonly prisma: PrismaService,  
  ) {}

  async bufferProgressSync(userId: string, input: SyncProgressInput): Promise\<SyncProgressPayload\> {  
    const { lessonId, watchedSec, durationSec, isCompleted } \= input;  
    const redisKey \= \`progress:buffer:\${userId}:\${lessonId}\`;  
    const heatmapKey \= \`heatmap:video:\${lessonId}\`;

    // 1\. Fetch current max watched sec to ensure monotonic progress increase  
    const existingWatched \= await this.redis.hget(redisKey, 'watchedSec');  
    const currentMax \= existingWatched ? parseInt(existingWatched, 10\) : 0;  
    const newWatchedSec \= Math.max(currentMax, watchedSec);  
    const completedState \= isCompleted || newWatchedSec \>= Math.floor(durationSec \* 0.95);

    // 2\. Atomic Redis Pipeline Write (\< 5ms Execution)  
    const pipeline \= this.redis.pipeline();  
    pipeline.hset(redisKey, {  
      userId,  
      lessonId,  
      watchedSec: newWatchedSec.toString(),  
      isCompleted: completedState ? '1' : '0',  
      updatedAt: new Date().toISOString(),  
    });  
    // Record user presence at second bucket for Drop-off Heatmap  
    const secondBucket \= Math.floor(watchedSec / 5\) \* 5;  
    pipeline.zincrby(heatmapKey, 1, secondBucket.toString());  
    await pipeline.exec();

    return {  
      success: true,  
      lessonId,  
      savedWatchedSec: newWatchedSec,  
      isCompleted: completedState,  
      serverTimestamp: new Date().toISOString(),  
    };  
  }  
}

### **6\. Frontend Pages, Components & LINE Video Player Sync Engine**

#### **6.1 useVideoProgressSync Custom Hook Implementation**

TypeScript  
import { useEffect, useRef, useCallback } from 'react';

interface UseVideoProgressSyncProps {  
  lessonId: string;  
  userId: string;  
  token: string;  
  intervalMs?: number;  
}

export const useVideoProgressSync \= ({  
  lessonId,  
  userId,  
  token,  
  intervalMs \= 5000,  
}: UseVideoProgressSyncProps) \=\> {  
  const syncTimerRef \= useRef\<NodeJS.Timeout | null\>(null);  
  const lastSyncedTimeRef \= useRef\<number\>(0);

  const executeSync \= useCallback(  
    async (currentTime: number, duration: number, isBeacon \= false) \=\> {  
      const roundedTime \= Math.floor(currentTime);  
      if (roundedTime \=== lastSyncedTimeRef.current && \!isBeacon) return;

      const payload \= {  
        userId,  
        input: {  
          lessonId,  
          watchedSec: roundedTime,  
          durationSec: Math.floor(duration),  
          isCompleted: roundedTime \>= Math.floor(duration \* 0.95),  
          clientTimestamp: new Date().toISOString(),  
        },  
      };

      if (isBeacon && typeof navigator \!== 'undefined' && navigator.sendBeacon) {  
        const blob \= new Blob(\[JSON.stringify(payload)\], { type: 'application/json' });  
        navigator.sendBeacon('/api/v1/stream/progress/beacon', blob);  
        return;  
      }

      try {  
        await fetch('/api/v1/stream/progress/sync', {  
          method: 'POST',  
          headers: {  
            'Content-Type': 'application/json',  
            Authorization: \`Bearer \${token}\`,  
          },  
          body: JSON.stringify(payload.input),  
        });  
        lastSyncedTimeRef.current \= roundedTime;  
      } catch (error) {  
        console.error('\[ProgressSync\] Background Sync Error:', error);  
      }  
    },  
    \[lessonId, userId, token\],  
  );

  const startSyncTimer \= useCallback(  
    (getCurrentTime: () \=\> number, getDuration: () \=\> number) \=\> {  
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);

      syncTimerRef.current \= setInterval(() \=\> {  
        const currentTime \= getCurrentTime();  
        const duration \= getDuration();  
        if (currentTime \> 0 && duration \> 0\) {  
          executeSync(currentTime, duration);  
        }  
      }, intervalMs);  
    },  
    \[intervalMs, executeSync\],  
  );

  const stopSyncTimer \= useCallback(() \=\> {  
    if (syncTimerRef.current) {  
      clearInterval(syncTimerRef.current);  
      syncTimerRef.current \= null;  
    }  
  }, \[\]);

  useEffect(() \=\> {  
    return () \=\> {  
      stopSyncTimer();  
    };  
  }, \[stopSyncTimer\]);

  return { startSyncTimer, stopSyncTimer, executeSync };  
};

### **7\. Data Pipeline, AI Adaptive Learning & Analytics**

#### **7.1 Real-Time Analytics Event Spec**

* **Video Drop-off Tracking:** บันทึกความหนาแน่นของผู้เรียนทุกๆ 5 วินาทีลงใน **Redis Sorted Set (heatmap:video:{lessonId})** เพื่อสร้าง Heatmap Graph แสดงให้ผู้สอนเห็นจุดที่ผู้เรียนสละการชม (Drop-off Rate)  
* **AI Lesson Summarizer & Companion Trigger:** หากวิเคราะห์พบว่าผู้เรียนหยุดดูหรือกรอกรอดูซ้ำในนาทีเดิมเกิน 3 ครั้ง ระบบจะส่ง Event ไปยัง AI Engine เพื่อนำเสนอสรุปเนื้อหาบทเรียนเฉพาะช่วงเวลาดังกล่าว (AI Time-stamped Summary) หรือปรับแต่งความยากของแบบทดสอบโดยอัตโนมัติ

### **8\. Security, DRM & Zero-Egress Storage Optimization**

#### **8.1 Edge Token Bucket Rate-Limiting**

ป้องกันการโจมตีประเภท Spam Progress หรือการโกงเวลาเรียนด้วย **Redis Token Bucket Algorithm**:

* กำหนดโควต้าสูงสุดไม่เกิน 2 requests ต่อ 5 วินาที per userId  
* ตรวจสอบเงื่อนไข watchedSec ต้องไม่เพิ่มขึ้นเร็วกว่าเวลาจริง (เช่น เพิ่มขึ้น 30 วินาที ภายในระยะเวลาจริงเพียง 5 วินาที) หากตรวจพบ จะปฏิเสธการอัปเดตและบันทึก Flag ใน Audit Log

#### **8.2 DRM Session Entitlement Validation**

ทุกครั้งที่มีการเรียกใช้ API Sync Progress ระบบจะตรวจสอบความคงอยู่ของสิทธิ์ (Entitlement) บน Redis Cache หากสิทธิ์หมดอายุหรือถูกยกเลิก จะส่ง Signal ย้อนกลับเพื่อสั่งหยุดการสตรีมวิดีโอบน HLS Player ทันที

### **9\. Token Efficiency & Code Diff Policies**

* **SDID Partial Code Diff Protocol:** ระบุเฉพาะ Code Block ที่แก้ไขเพื่อประหยัด Token สูงสุด 75%  
* **Zero Redundant Code Policy:** ห้ามเขียนซ้ำซ้อนในไฟล์ที่ไม่มีการเปลี่ยนแปลง และใช้ Shared Zod Schemas ระหว่าง Frontend/Backend เสมอ

### **10\. Auto-QA & Autonomous Self-Healing Loop**

#### **10.1 Performance & Memory Guard**

* **Latency Check:** API Endpoint /sync ต้องประมวลผลตอบกลับภายในระยะเวลาไม่เกิน 20ms บน Redis Edge  
* **RAM Guard:** โค้ดฝั่ง Frontend ต้องผ่านการทดสอบว่าไม่ก่อให้เกิด Memory Leak จาก setInterval หรือ Event Listeners โดยควบคุมการใช้ RAM ของ LINE Webview ให้คงที่ต่ำกว่า 30MB ตลอดการเล่นวิดีโอต่อเนื่อง 2 ชั่วโมง

#### **10.2 Autonomous Edge Case Scenarios**

* **Network Interruption:** เมื่อสัญญาณอินเทอร์เน็ตหลุด ระบบจะทำการคิวข้อมูล Sync ลงใน IndexedDB และทำการ Retry อัตโนมัติด้วย Exponential Backoff เมื่อสัญญาณกลับมา  
* **Fast Forward / Scrubbing:** เมื่อผู้เรียนทำการกรอวิดีโอ ระบบจะเคลียร์ Interval เดิม และส่ง Sync Payload สำหรับตำแหน่งใหม่ทันที เพื่อป้องกันข้อมูลขัดแย้ง

### **11\. The 9 Enterprise Golden Gatekeepers (Omni-Channel Edit)**

* \[x\] **Gate 1: SSOT Schema Sync (100%)** — Prisma Schema, Zod Contracts และ GraphQL Resolvers สอดคล้องกันสมบูรณ์  
* \[x\] **Gate 2: Zero Type Violations** — ผ่านการตรวจ TypeScript Strict Mode 100% ไร้ข้อผิดพลาด  
* \[x\] **Gate 3: UI/UX State Machine** — ครอบคลุมสถานะ LIFF\_INIT, IDLE, LOADING, SUCCESS, ERROR ทั้ง 5 States  
* \[x\] **Gate 4: Security Audit** — ตรวจสอบ Token Bucket Rate Limiting และ Anti-Cheat Validation เรียบร้อย  
* \[x\] **Gate 5: LIFF Canvas & Player Memory Check (CRITICAL)** — ยืนยันการเคลียร์ Timer/Listeners RAM ต่ำกว่า 30MB  
* \[x\] **Gate 6: Zero-Egress Routing Check** — ส่งข้อมูลผ่าน Lightweight Webhook/GraphQL ไม่กระทบกับ CDN Egress  
* \[x\] **Gate 7: Database Transaction Guard** — สรุปข้อมูลผ่าน Redis Write-Behind เข้า PostgreSQL แบบ Atomic Transaction  
* \[x\] **Gate 8: Data Pipeline Verification** — Event Tracking บันทึก Drop-off Heatmap ลง Redis เรียลไทม์  
* \[x\] **Gate 9: Automated ADR Generation** — บันทึก Architecture Decision Record ประจำ Atomic Phase 046 ครบถ้วน

### **12\. Atomic Task Execution Plan (Phase 046 Scope)**

* **Task 1:** สร้าง Shared Zod Schema progress-sync.schema.ts สำหรับตรวจสอบ Validation ทั้ง Client และ Server  
* **Task 2:** พัฒนา ProgressService และ ProgressController บน NestJS พร้อมระบบ Redis Write-Behind Buffer Layer  
* **Task 3:** เพิ่ม GraphQL Mutation syncLessonProgress และ Query getLessonStreamState ใน API Gateway  
* **Task 4:** พัฒนา Custom Hook useVideoProgressSync ฝั่ง Next.js พร้อมรองรับ navigator.sendBeacon  
* **Task 5:** เชื่อมต่อ Hook เข้ากับ HlsVideoPlayer และทดสอบการทำงานบน LINE LIFF Webview  
* **Task 6:** พัฒนา Scheduled Worker (Cron) เพื่อ Flush ข้อมูลจาก Redis ลง PostgreSQL 16  
* **Task 7:** สร้าง Redis ZSET Event Pipeline สำหรับประมวลผล Video Drop-off Heatmap  
* **Task 8:** รัน Auto-QA Test Suite และตรวจสอบผ่านเกณฑ์ 9 Enterprise Golden Gatekeepers (100 คะแนนเต็ม)

💎 **บทสรุปจากซีเนครีเอเตอร์ (CNE Final Statement)**

เอกสารมาตรฐานการขยายเฟส **Atomic Phase 046** ฉบับนี้ ได้รับการออกแบบตามหลัก **Schema-Driven Intent Development (SDID)** อย่างสมบูรณ์ พร้อมให้ทีมวิศวกรซอฟต์แวร์นำไปติดตั้งและพัฒนาเพื่อรองรับระบบสตรีมมิ่งบทเรียนระดับล้านผู้ใช้งานอย่างมีประสิทธิภาพสูงสุดเรียบร้อยครับ\!

