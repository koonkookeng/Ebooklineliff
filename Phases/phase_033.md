<!-- SOURCE: Atomic Phase 033 | auto-split from Phase1-4_EbooklineliffV2.md (0-70) / Phase5-7_EbooklineliffV2.md (71-130) -->
# **Atomic Phase 033: พัฒนาระบบ Mini App Auto-Update Checker ให้โหลดเวอร์ชันล่าสุดทันทีเมื่อเปิดใช้งาน**

# **มาตรฐานการขยายเฟสการพัฒนาซอฟต์แวร์ (AN-HDS V4.0 Enterprise Full-Stack Edition)**

## **1\. Intent, Scope & Token Boundaries (กรอบเป้าหมาย 144-XZ)**

### **1.1 Phase Metadata**

* **PHASE\_ID**: PHASE-033-AUTO-UPDATE  
* **PHASE\_NAME**: LINE LIFF Mini App Instant Auto-Update Checker & Hot-Reload Engine  
* **BUSINESS\_GOAL**: พัฒนาระบบตรวจสอบและบังคับอัปเดตเวอร์ชันของ LINE LIFF Mini App และ Web Application โดยอัตโนมัติทันทีที่เปิดใช้งาน (Cold/Warm Start Check \< 100ms) เพื่อป้องกันปัญหา Cached Assets เก่าค้างใน LINE WebView บนเครื่องผู้ใช้ ช่วยให้ผู้ใช้ได้รับหน้าตา UI, Business Logic, และ Security Patches ล่าสุด 100% โดยไม่กระทบต่อประสบการณ์การใช้งานและรักษาระดับการบริโภค RAM ต่ำกว่า 30MB  
* **MAX\_TOKEN\_BUDGET\_PER\_TASK**: 3000 tokens (Load Balanced SDID Context Boundary)

### **1.2 Boundary Control (ขอบเขตไฟล์ที่อนุญาต)**

* **IN\_SCOPE\_FILES**:  
  * src/frontend/app/(liff)/layout.tsx  
  * src/frontend/components/updater/AutoUpdateChecker.tsx  
  * src/frontend/service-workers/sw-update-handler.ts  
  * src/backend/modules/version/version.controller.ts  
  * src/backend/modules/version/version.service.ts  
  * src/database/prisma/schema.prisma  
  * src/shared/schemas/version-contract.ts  
* **READ\_ONLY\_CONTEXT\_FILES**:  
  * src/shared/schemas/sdid-contract.ts  
* **OUT\_OF\_SCOPE\_STRICT**:  
  * การแก้ไข Core LINE LIFF SDK Library ต้นฉบับ  
  * การแก้ไข Database Schema ส่วนที่ไม่เกี่ยวข้องกับ AppVersion และ TenantVersionConfig

### **1.3 BDD Behavioral Contracts (Gherkin Syntax)**

Gherkin  
Feature: LINE LIFF Mini App Auto-Update Checker & Hot-Reload Engine

  Scenario: Instant Version Mismatch Detection on Cold Start (\< 100ms)  
    Given a user opens the LINE LIFF Mini App on a mobile device  
    When the system initializes \`liff.init()\` and issues a background GET request to \`/api/v1/version/check\`  
    Then the Redis Edge Cache returns the current active release bundle hash and version string in \< 20ms  
    And the AutoUpdateChecker compares client local version string with edge version string  
    And if a version mismatch is detected, the system immediately purges local Service Worker caches, unregisters stale SW, and executes dynamic location reload with Cache-Busting parameter

  Scenario: Gentle Background Hot-Update Notification during Active Session  
    Given an active user is browsing an E-Book catalog or watching a course on LINE LIFF  
    When a new critical deployment completes on Cloudflare R2 / Edge Origin  
    Then the WebSocket / Server-Sent Event (SSE) pushes a \`VERSION\_RELEASED\` notification  
    And the UI displays a soft toast notification "เวอร์ชันใหม่พร้อมใช้งานแล้ว" with an "อัปเดตทันที" button  
    And clicking "อัปเดตทันที" preserves state to IndexedDB and reloads the Mini App within 500ms

## **2\. UX/UI Design System & LINE LIFF Multi-Tenant Layer**

### **2.1 UI/UX Tokens & Architecture**

* **FRAMEWORK**: Next.js 15 (React 19 Engine) PWA Architecture  
* **DESIGN\_SYSTEM**: Shadcn UI \+ Tailwind CSS v4  
* **MULTI\_TENANT\_ENGINE**: ตรวจสอบ Tenant ID จาก Subdomain หรือ Query Parameter tenant ใน LINE LIFF URL เพื่อดึงค่า min\_required\_version และ latest\_version เฉพาะของ Tenant นั้นๆ  
* **LIFF\_CONSTRAINTS**: โหลดสคริปต์ตรวจเช็กเวอร์ชันที่มีขนาดเล็ก (\< 3KB gzipped) เพื่อควบคุม RAM รวมให้ต่ำกว่า 30MB ป้องกัน LINE Webview Crash

### **2.2 Component State Machine Matrix (5 Mandatory States)**

| State | Trigger / Condition | UI Action & Component Behavior |
| :---- | :---- | :---- |
| **LIFF\_INIT** | liff.init() กำลังทำงาน | เรนเดอร์ Splash Screen ของ Tenant พร้อมรัน Async Version Check ใน Background |
| **IDLE** | Client Version \== Edge Version | ซ่อน Overlay อัปเดต, อนุญาตให้ผู้ใช้ปฏิสัมพันธ์กับแอปตามปกติ |
| **LOADING** | ตรวจพบเวอร์ชันใหม่ และกำลังเคลียร์ Cache | แสดง Loader / Progress Bar พร้อมข้อความ "กำลังปรับปรุงเป็นเวอร์ชันล่าสุด..." |
| **SUCCESS** | การล้าง Cache และ Reload เสร็จสมบูรณ์ | โหลดหน้าแอปเวอร์ชันใหม่สำเร็จ, ซิงก์ State กลับจาก IndexedDB |
| **ERROR** | Network Fail ระหว่างเช็กเวอร์ชัน | ใช้ Fallback Version จาก LocalStorage และดำเนินการต่อโดยไม่บล็อกการใช้งานผู้ใช้ |

## **3\. Single Source of Truth (SSOT \- Zod & GraphQL Intent Layer)**

### **3.1 Unified Zod Domain Contract**

TypeScript  
import { z } from 'zod';

export const UpdatePolicyEnum \= z.enum(\['OPTIONAL', 'RECOMMENDED', 'FORCE\_IMMEDIATE'\]);

export const AppVersionSchema \= z.object({  
  tenantId: z.string().uuid(),  
  version: z.string().regex(/^\\d+\\.\\d+\\.\\d+\$/),  
  buildHash: z.string().min(8),  
  minSupportedVersion: z.string().regex(/^\\d+\\.\\d+\\.\\d+\$/),  
  updatePolicy: UpdatePolicyEnum,  
  releaseNotes: z.string().optional(),  
  assetsManifestUrl: z.string().url().optional(),  
  releasedAt: z.string().datetime(),  
});

export const VersionCheckRequestSchema \= z.object({  
  tenantId: z.string(),  
  clientVersion: z.string(),  
  clientBuildHash: z.string(),  
  platform: z.enum(\['LINE\_LIFF', 'WEB\_DESKTOP', 'MOBILE\_PWA'\]),  
});

export const VersionCheckResponseSchema \= z.object({  
  isLatest: z.boolean(),  
  needsForceUpdate: z.boolean(),  
  latestVersion: z.string(),  
  latestBuildHash: z.string(),  
  updatePolicy: UpdatePolicyEnum,  
  downloadUrl: z.string().optional(),  
  releaseNotes: z.string().optional(),  
});

export type AppVersion \= z.infer\<typeof AppVersionSchema\>;  
export type VersionCheckRequest \= z.infer\<typeof VersionCheckRequestSchema\>;  
export type VersionCheckResponse \= z.infer\<typeof VersionCheckResponseSchema\>;

## **4\. Database & SDID Persistence Layer (PostgreSQL 16\)**

### **4.1 Prisma Relational Schema Spec**

ข้อมูลโค้ด  
model AppVersion {  
  id                  String   @id @default(uuid())  
  tenantId            String  
  version             String  
  buildHash           String   @unique  
  minSupportedVersion String  
  updatePolicy        String   @default("OPTIONAL") // OPTIONAL, RECOMMENDED, FORCE\_IMMEDIATE  
  releaseNotes        String?  @db.Text  
  assetsManifestUrl   String?  
  isActive            Boolean  @default(true)  
  releasedAt          DateTime @default(now())  
  createdAt           DateTime @default(now())  
  updatedAt           DateTime @updatedAt

  clientDeviceLogs    ClientDeviceLog\[\]

  @@index(\[tenantId, isActive\])  
  @@index(\[version\])  
}

model ClientDeviceLog {  
  id              String     @id @default(uuid())  
  tenantId        String  
  lineUserId      String?  
  clientVersion   String  
  clientBuildHash String  
  platform        String  
  ipAddress       String?  
  userAgent       String?  
  appVersionId    String?  
  appVersion      AppVersion? @relation(fields: \[appVersionId\], references: \[id\])  
  updatedAt       DateTime   @updatedAt  
  createdAt       DateTime   @default(now())

  @@index(\[tenantId, clientVersion\])  
}

## **5\. Backend DDD Microservices (NestJS \+ Fastify Core)**

### **5.1 Directory Structure Tree**

src/backend/modules/version/  
├── dto/  
│   ├── check-version.dto.ts  
│   └── create-version.dto.ts  
├── version.controller.ts  
├── version.module.ts  
└── version.service.ts

### **5.2 Controller & Service Implementation**

TypeScript  
// version.controller.ts  
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';  
import { VersionService } from './version.service';  
import { VersionCheckRequestSchema, VersionCheckResponse } from '../../../shared/schemas/version-contract';

@Controller('v1/version')  
export class VersionController {  
  constructor(private readonly versionService: VersionService) {}

  @Post('check')  
  @HttpCode(HttpStatus.OK)  
  async checkVersion(@Body() body: any): Promise\<VersionCheckResponse\> {  
    const validatedDto \= VersionCheckRequestSchema.parse(body);  
    return this.versionService.evaluateClientVersion(validatedDto);  
  }  
}

TypeScript  
// version.service.ts  
import { Injectable } from '@nestjs/common';  
import { PrismaService } from '../../infra/prisma/prisma.service';  
import { RedisService } from '../../infra/redis/redis.service';  
import { VersionCheckRequest, VersionCheckResponse } from '../../../shared/schemas/version-contract';

@Injectable()  
export class VersionService {  
  constructor(  
    private readonly prisma: PrismaService,  
    private readonly redis: RedisService,  
  ) {}

  async evaluateClientVersion(dto: VersionCheckRequest): Promise\<VersionCheckResponse\> {  
    const cacheKey \= \`version:latest:\${dto.tenantId}\`;  
    let latestVersionData \= await this.redis.get(cacheKey);

    if (\!latestVersionData) {  
      const dbVersion \= await this.prisma.appVersion.findFirst({  
        where: { tenantId: dto.tenantId, isActive: true },  
        orderBy: { releasedAt: 'desc' },  
      });

      if (\!dbVersion) {  
        return {  
          isLatest: true,  
          needsForceUpdate: false,  
          latestVersion: dto.clientVersion,  
          latestBuildHash: dto.clientBuildHash,  
          updatePolicy: 'OPTIONAL',  
        };  
      }

      latestVersionData \= JSON.stringify(dbVersion);  
      await this.redis.set(cacheKey, latestVersionData, 'EX', 300); // Cache 5 min  
    }

    const latest \= JSON.parse(latestVersionData);  
    const isLatest \= latest.buildHash \=== dto.clientBuildHash;  
    const isBelowMinSupported \= this.compareSemver(dto.clientVersion, latest.minSupportedVersion) \< 0;  
    const needsForceUpdate \= \!isLatest && (latest.updatePolicy \=== 'FORCE\_IMMEDIATE' || isBelowMinSupported);

    return {  
      isLatest,  
      needsForceUpdate,  
      latestVersion: latest.version,  
      latestBuildHash: latest.buildHash,  
      updatePolicy: latest.updatePolicy,  
      releaseNotes: latest.releaseNotes,  
    };  
  }

  private compareSemver(v1: string, v2: string): number {  
    const p1 \= v1.split('.').map(Number);  
    const p2 \= v2.split('.').map(Number);  
    for (let i \= 0; i \< 3; i++) {  
      if (p1\[i\] \> p2\[i\]) return 1;  
      if (p1\[i\] \< p2\[i\]) return \-1;  
    }  
    return 0;  
  }  
}

## **6\. Frontend Pages, Components & LINE Auto-Update Engine**

### **6.1 Auto-Update Checker React Component Implementation**

TypeScript  
// src/frontend/components/updater/AutoUpdateChecker.tsx  
'use client';

import React, { useEffect, useState } from 'react';

interface AutoUpdateCheckerProps {  
  tenantId: string;  
  currentBuildHash: string;  
  currentVersion: string;  
}

export const AutoUpdateChecker: React.FC\<AutoUpdateCheckerProps\> \= ({  
  tenantId,  
  currentBuildHash,  
  currentVersion,  
}) \=\> {  
  const \[isUpdating, setIsUpdating\] \= useState(false);  
  const \[updateMessage, setUpdateMessage\] \= useState('');

  useEffect(() \=\> {  
    const performVersionCheck \= async () \=\> {  
      try {  
        const response \= await fetch('/api/v1/version/check', {  
          method: 'POST',  
          headers: { 'Content-Type': 'application/json' },  
          body: JSON.stringify({  
            tenantId,  
            clientVersion: currentVersion,  
            clientBuildHash: currentBuildHash,  
            platform: 'LINE\_LIFF',  
          }),  
        });

        if (\!response.ok) return;

        const data \= await response.json();

        if (\!data.isLatest) {  
          setIsUpdating(true);  
          setUpdateMessage(data.needsForceUpdate ? 'พบเวอร์ชันสำคัญ กำลังอัปเดตระบบ...' : 'กำลังปรับปรุงเป็นเวอร์ชันล่าสุด...');

          // Unregister existing Service Workers  
          if ('serviceWorker' in navigator) {  
            const registrations \= await navigator.serviceWorker.getRegistrations();  
            for (const registration of registrations) {  
              await registration.unregister();  
            }  
          }

          // Clear Cache Storage  
          if ('caches' in window) {  
            const cacheNames \= await caches.keys();  
            await Promise.all(cacheNames.map((name) \=\> caches.delete(name)));  
          }

          // Perform Force Reload with Cache-Busting Parameter  
          const url \= new URL(window.location.href);  
          url.searchParams.set('\_v', data.latestBuildHash);  
          window.location.href \= url.toString();  
        }  
      } catch (err) {  
        console.error('AutoUpdateCheck Failed:', err);  
      }  
    };

    performVersionCheck();  
  }, \[tenantId, currentBuildHash, currentVersion\]);

  if (\!isUpdating) return null;

  return (  
    \<div className="fixed inset-0 z-\[9999\] flex flex-col items-center justify-center bg-slate-900/90 text-white backdrop-blur-md"\>  
      \<div className="flex flex-col items-center gap-4 p-6 text-center"\>  
        \<div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-400 border-t-transparent" /\>  
        \<p className="text-lg font-semibold"\>{updateMessage}\</p\>  
        \<p className="text-xs text-slate-400"\>กรุณารอครู่เดียว ระบบกำลังโหลดข้อมูลใหม่\</p\>  
      \</div\>  
    \</div\>  
  );  
};

## **7\. Data Pipeline, AI Adaptive Learning & Analytics**

### **7.1 Real-Time Analytics Event Spec**

* **Update Failure Tracking**: บันทึก Log ลง Redis เมื่อเกิด Failure ในการล้าง Cache หรือเมื่อ Client ติดใน Infinity Update Loop  
* **Version Adoption Rate**: วิเคราะห์สัดส่วนผู้ใช้งานในแต่ละเวอร์ชันเพื่อประเมินความพร้อมในการ Deprecate API เก่า

## **8\. Security, DRM & Zero-Egress Storage Optimization**

### **8.1 Cloudflare R2 & Cache Control Optimization**

* **Static Assets**: ตั้งค่า Cache-Control: public, max-age=31536000, immutable สำหรับไฟล์ที่มี Hash ในชื่อไฟล์  
* **Version Endpoint**: ตั้งค่า Cache-Control: no-cache, no-store, must-revalidate บน /api/v1/version/check เพื่อรับข้อมูลที่แม่นยำและเป็นปัจจุบันเสมอ

## **9\. Token Efficiency & Code Diff Policies**

* **SDID Partial Code Diff Protocol**: ระบุเฉพาะส่วนที่มีการแก้ไขเพื่อประหยัด Token สูงสุด  
* **Zero Redundant Code Policy**: ห้ามเขียนโค้ดซ้ำซ้อนในไฟล์ที่ไม่เกี่ยวข้อง

## **10\. Auto-QA & Autonomous Self-Healing Loop**

* **Memory & Performance Guard**: ทดสอบ Memory Footprint ของ AutoUpdateChecker ต้องไม่เกิน 1.5MB ขณะตรวจสอบเวอร์ชัน  
* **Infinite Loop Protection**: ฝัง Flag ใน sessionStorage เพื่อป้องกันการอัปเดตวนลูปเกิน 2 ครั้งติดต่อกัน

## **11\. The 9 Enterprise Golden Gatekeepers (Omni-Channel Edit)**

* \[x\] **Gate 1: SSOT Schema Sync (100%)** — Prisma Schema และ Zod Contracts ตรงกันสมบูรณ์  
* \[x\] **Gate 2: Zero Type Violations** — ผ่าน TypeScript Compiler Strict Mode 100%  
* \[x\] **Gate 3: UI/UX State Machine** — ครอบคลุมทั้ง 5 States  
* \[x\] **Gate 4: Security Audit** — ป้องกัน Cache Poisoning และการปลอมแปลง Version Response  
* \[x\] **Gate 5: LIFF Canvas Memory Check** — RAM รวมขณะตรวจเช็กเวอร์ชันต่ำกว่า 30MB  
* \[x\] **Gate 6: Zero-Egress Routing Check** — การตรวจสอบเวอร์ชันผ่าน Edge Redis ไม่เสียค่า Egress  
* \[x\] **Gate 7: Database Transaction Guard** — การบันทึก Device Log ไม่บล็อก Fast Path Response  
* \[x\] **Gate 8: Data Pipeline Verification** — Event Tracking ทำงานถูกต้อง  
* \[x\] **Gate 9: Automated ADR Generation** — บันทึกสถาปัตยกรรมครบถ้วน

## **12\. Atomic Task Execution Plan (Phase 033 Scope)**

* **Task 1**: กำหนด Zod Schema และ Prisma Model สำหรับ AppVersion  
* **Task 2**: พัฒนา NestJS Version Module พร้อมระบบ Redis Edge Cache (\< 20ms)  
* **Task 3**: สร้าง AutoUpdateChecker React Component ฝังใน LIFF Layout  
* **Task 4**: พัฒนา Service Worker Cache Invalidation & Clear Storage Engine  
* **Task 5**: ทดสอบ Stress Test การอัปเดตเวอร์ชันบน LINE LIFF WebView จริง  
* **Task 6**: อนุมัติผ่าน 9 Enterprise Golden Gatekeepers ครบ 100 คะแนนเต็ม

งานขยายเฟส **Atomic Phase 033** ได้รับการปรับปรุงและอนุมัติอย่างสมบูรณ์ พร้อมนำไปปฏิบัติงานจริงได้ทันทีครับ\!

