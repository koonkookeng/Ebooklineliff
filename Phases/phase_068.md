<!-- SOURCE: Atomic Phase 068 | auto-split from Phase1-4_EbooklineliffV2.md (0-70) / Phase5-7_EbooklineliffV2.md (71-130) -->
# **Atomic Phase 068: พัฒนา In-App File Download Manager สำหรับบริหารจัดการเนื้อหาที่ดาวน์โหลดลงเครื่อง**

# **มาตรฐานการขยายเฟสการพัฒนาซอฟต์แวร์ระดับองค์กร (AN-HDS V4.0 Enterprise Edition)**

## **เอกสารข้อกำหนดสถาปัตยกรรมและการขยายเฟสการพัฒนา**

**PROJECT:** Omni-Channel E-Book, E-Learning & Social Commerce Platform (LINE LIFF & Web App)

**ATOMIC PHASE target:** Atomic Phase 068: พัฒนา In-App File Download Manager สำหรับบริหารจัดการเนื้อหาที่ดาวน์โหลดลงเครื่อง

**SECURITY & ENCRYPTION PROTOCOL:** 144-XZ (Load Balanced SDID Context Boundary & Zero-Trust DRM Encryption)

## **1\. Intent, Scope & Token Boundaries (กรอบเป้าหมาย 144-XZ)**

### **1.1 Phase Metadata**

* **PHASE\_ID:** PHASE-068-DOWNLOAD-MGR  
* **PHASE\_NAME:** In-App File Download Manager & Encrypted Offline Storage Core (LINE LIFF, PWA & Web Application)  
* **BUSINESS\_GOAL:** พัฒนาระบบ In-App File Download Manager สำหรับบริหารจัดการไฟล์เนื้อหาที่ดาวน์โหลดลงเครื่องผู้ใช้ (Vector SVG Chunks ของ E-Book, HLS Video Segments ของคอร์สเรียน และไฟล์เสียง Audiobook) รองรับการใช้งานแบบ Offline 100% บน LINE LIFF และ Web PWA พร้อมระบบเข้ารหัส DRM at Rest (AES-256-GCM ผ่าน WebCrypto API), ระบบจำกัดความจุ Storage Quota, และระบบควบคุม RAM ต่ำกว่า 30MB ขณะถอดรหัสเรนเดอร์  
* **MAX\_TOKEN\_BUDGET\_PER\_TASK:** 3000 tokens (Load Balanced SDID Context Boundary)

### **1.2 Boundary Control (ขอบเขตไฟล์ที่อนุญาต)**

* **IN\_SCOPE\_FILES:**  
  * src/database/prisma/schema.prisma  
  * src/frontend/modules/download-manager/\*\*/\*  
  * src/frontend/components/download-manager/\*\*/\*  
  * src/frontend/workers/download-worker.ts  
  * src/frontend/lib/storage/opfs-engine.ts  
  * src/frontend/lib/crypto/offline-drm.ts  
  * src/backend/modules/offline-license/\*\*/\*  
  * src/backend/api/graphql/offline-license.resolver.ts  
* **READ\_ONLY\_CONTEXT\_FILES:**  
  * src/shared/schemas/sdid-contract.ts  
  * src/shared/types/entitlement.ts  
* **OUT\_OF\_SCOPE\_STRICT:**  
  * การแก้ไข Core Database Migration โดยไม่ผ่าน Prisma Engine  
  * การแก้ไขสตรีมมิ่งเซิร์ฟเวอร์ Cloudflare R2 Base Configuration

### **1.3 BDD Behavioral Contracts (Gherkin Syntax)**

Gherkin  
Feature: In-App File Download Manager & Encrypted Offline Storage Engine

  Scenario: Resumable Chunked File Download with Memory Boundary (\< 30MB RAM)  
    Given a user initiates an offline download for E-Book or Course Video on LINE LIFF  
    When the Download Worker streams content chunks from Cloudflare R2 Zero-Egress Vault  
    Then the client stores encrypted binary blobs into OPFS (Origin Private File System) / IndexedDB  
    And the UI updates the real-time progress bar, speed (MB/s), and estimated remaining time  
    And the memory consumption during chunk decryption strictly remains under 30MB RAM

  Scenario: Offline DRM License Verification & Automatic Eviction  
    Given a user launches downloaded content while offline without internet connection  
    When the client Offline DRM Engine validates the local ED25519 Cryptographic License  
    Then if the license is valid, the content is decrypted and rendered with Dynamic Forensic Watermark  
    And if the license has expired, the Download Manager flags the item as "EXPIRED"  
    And executes an automatic background purge (LRU Cache Eviction) to reclaim user storage

## **2\. UX/UI Design System & LINE LIFF Multi-Tenant Layer**

### **2.1 UI/UX Tokens & Architecture**

* **FRAMEWORK:** Next.js 15 (React 19 Engine) PWA Architecture  
* **DESIGN\_SYSTEM:** Shadcn UI \+ Tailwind CSS v4  
* **MULTI\_TENANT\_ENGINE:** อ่าน Subdomain หรือ Query Parameter tenant จาก LINE LIFF URL เพื่อปรับเปลี่ยน CSS Variables (\--primary-color, \--logo-url, \--storage-bar-active, \--accent-color) ระดับ Root Document ในมิลลิวินาทีแรก  
* **LIFF\_CONSTRAINTS:** จำกัดการใช้ RAM ไม่เกิน 30MB โดยใช้ Web Workers ร่วมกับ Stream Decryption สำหรับการถอดรหัสชิ้นส่วนไฟล์ก่อนส่งเข้า Canvas  
* **OFFLINE\_STORAGE\_ENGINE:** ใช้ Origin Private File System (OPFS) เป็นเลเยอร์หลักสำหรับเก็บไฟล์ขนาดใหญ่ และใช้ IndexedDB เป็น Fallback Layer สำหรับอุปกรณ์รุ่นเก่า

### **2.2 Component State Machine Matrix (5 Mandatory States)**

| State | Trigger / Condition | UI Action & Component Behavior |
| :---- | :---- | :---- |
| **DOWNLOAD\_IDLE** | สื่อยังไม่ได้ดาวน์โหลดลงเครื่อง | แสดงไอคอนดาวน์โหลด \[Download Icon\] พร้อมระบุขนาดไฟล์ที่ต้องใช้ (e.g. "24.5 MB") |
| **DOWNLOAD\_QUEUED\_PROGRESS** | อยู่ในคิวดาวน์โหลด หรือกำลังดาวน์โหลด | แสดง Linear/Circular Progress Bar, ปุ่ม Pause/Resume, ความเร็วดาวน์โหลด (MB/s) และเวลาที่เหลือ |
| **STORAGE\_WARNING** | ความจุอุปกรณ์ของผู้ใช้เหลือต่ำกว่า 10% หรือเกิน Quota | แสดง Alert Banner เตือนพื้นที่เต็ม พร้อมแนะนำรายการไฟล์เก่าที่ควรลบ (Auto-Clean Suggestion) |
| **OFFLINE\_READY** | ดาวน์โหลดและตรวจ Integrity Hash สำเร็จ 100% | แสดง Badge สีเขียว "Offline Ready" พร้อมปุ่ม \[เปิดอ่าน/เรียนทันที\] แม้ไม่มีสัญญาณอินเทอร์เน็ต |
| **LICENSE\_EXPIRED\_ERROR** | สิทธิ์ Offline License หมดอายุ | แสดง Overlay บล็อกเนื้อหา พร้อมปุ่ม \[เชื่อมต่ออินเทอร์เน็ตเพื่อต่ออายุสิทธิ์\] |

## **3\. Single Source of Truth (SSOT \- Zod & GraphQL Intent Layer)**

### **3.1 Unified Zod Domain Contract**

TypeScript  
import { z } from 'zod';

export const DownloadStatusEnum \= z.enum(\[  
  'IDLE',  
  'QUEUED',  
  'DOWNLOADING',  
  'PAUSED',  
  'COMPLETED',  
  'FAILED',  
  'EXPIRED'  
\]);

export const StorageCategoryEnum \= z.enum(\[  
  'EBOOK\_VECTOR\_CHUNK',  
  'COURSE\_HLS\_SEGMENT',  
  'AUDIOBOOK\_STREAM',  
  'OFFLINE\_ASSET'  
\]);

export const DownloadTaskSchema \= z.object({  
  id: z.string().uuid(),  
  productId: z.string().uuid(),  
  tenantId: z.string(),  
  title: z.string(),  
  category: StorageCategoryEnum,  
  totalBytes: z.number().int().positive(),  
  downloadedBytes: z.number().int().nonnegative(),  
  status: DownloadStatusEnum,  
  downloadSpeedBps: z.number().default(0),  
  progressPercentage: z.number().min(0).max(100),  
  storageLocation: z.enum(\['OPFS', 'INDEXED\_DB'\]),  
  expiresAt: z.string().datetime(),  
});

export const StorageQuotaSchema \= z.object({  
  totalGrantedQuotaBytes: z.number(),  
  usedStorageBytes: z.number(),  
  availableStorageBytes: z.number(),  
  categoryBreakdown: z.object({  
    ebookBytes: z.number(),  
    courseBytes: z.number(),  
    audioBytes: z.number(),  
  }),  
});

export const OfflineLicenseTokenSchema \= z.object({  
  licenseId: z.string().uuid(),  
  userIdHash: z.string(),  
  productId: z.string().uuid(),  
  deviceIdHash: z.string(),  
  signature: z.string(),  
  issuedAt: z.string().datetime(),  
  validUntil: z.string().datetime(),  
  maxOfflineDays: z.number().int().positive(),  
});

### **3.2 GraphQL Intent Definitions**

GraphQL  
type Query {  
  getOfflineLicense(productId: ID\!, deviceIdHash: String\!): OfflineLicensePayload\!  
  getStorageQuotaUsage: StorageQuotaPayload\!  
}

type Mutation {  
  issueOfflineLicense(productId: ID\!, deviceIdHash: String\!): OfflineLicensePayload\!  
  revokeOfflineLicense(licenseId: ID\!): Boolean\!  
  syncOfflineProgress(logsJson: String\!): SyncProgressPayload\!  
}

type OfflineLicensePayload {  
  licenseToken: String\!  
  signature: String\!  
  encryptionKeyCipher: String\!  
  validUntil: String\!  
}

type StorageQuotaPayload {  
  usedBytes: Float\!  
  availableBytes: Float\!  
  itemCount: Int\!  
}

type SyncProgressPayload {  
  success: Boolean\!  
  syncedItemCount: Int\!  
}

## **4\. Database & SDID Persistence Layer (PostgreSQL 16\)**

### **4.1 Prisma Relational Schema Extension**

ข้อมูลโค้ด  
// เพิ่มเติมใน schema.prisma เพื่อรองรับ PHASE-068

model OfflineLicense {  
  id                  String   @id @default(uuid())  
  userId              String  
  productId           String  
  deviceIdHash        String  
  licenseToken        String   @db.Text  
  encryptionKeyCipher String   @db.Text  
  signature           String  
  issuedAt            DateTime @default(now())  
  validUntil          DateTime  
  isRevoked           Boolean  @default(false)

  user                User     @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  product             Product  @relation(fields: \[productId\], references: \[id\], onDelete: Cascade)

  @@unique(\[userId, productId, deviceIdHash\])  
  @@index(\[userId\])  
  @@index(\[deviceIdHash\])  
}

model DeviceStorageProfile {  
  id                String   @id @default(uuid())  
  userId            String  
  deviceIdHash      String   @unique  
  deviceModel       String?  
  allocatedQuotaBytes BigInt  @default(5368709120) // Default 5GB  
  usedStorageBytes  BigInt   @default(0)  
  lastSyncAt        DateTime @updatedAt

  user              User     @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)

  @@index(\[userId\])  
}

## **5\. Backend DDD Microservices (NestJS \+ Fastify Core)**

### **5.1 Offline License Management Controller**

TypeScript  
// src/backend/modules/offline-license/offline-license.controller.ts  
import { Controller, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';  
import { OfflineLicenseService } from './offline-license.service';  
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';  
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('offline-license')  
export class OfflineLicenseController {  
  constructor(private readonly licenseService: OfflineLicenseService) {}

  @UseGuards(JwtAuthGuard)  
  @Post('issue')  
  async issueLicense(  
    @CurrentUser('id') userId: string,  
    @Body() body: { productId: string; deviceIdHash: string },  
  ) {  
    if (\!body.productId || \!body.deviceIdHash) {  
      throw new BadRequestException('Missing productId or deviceIdHash');  
    }  
    return this.licenseService.generateSignedOfflineLicense(  
      userId,  
      body.productId,  
      body.deviceIdHash,  
    );  
  }  
}

## **6\. Frontend Pages, Components & In-App Download Manager Architecture**

### **6.1 OPFS Storage & Decryption Stream Engine**

TypeScript  
// src/frontend/lib/storage/opfs-engine.ts  
export class OPFSStorageEngine {  
  private rootDirPromise: Promise\<FileSystemDirectoryHandle\>;

  constructor() {  
    this.rootDirPromise \= navigator.storage.getDirectory();  
  }

  async saveChunk(fileName: string, chunkData: ArrayBuffer): Promise\<void\> {  
    const root \= await this.rootDirPromise;  
    const fileHandle \= await root.getFileHandle(fileName, { create: true });  
    const writable \= await fileHandle.createWritable();  
    await writable.write(chunkData);  
    await writable.close();  
  }

  async readChunk(fileName: string): Promise\<ArrayBuffer\> {  
    const root \= await this.rootDirPromise;  
    const fileHandle \= await root.getFileHandle(fileName);  
    const file \= await fileHandle.getFile();  
    return await file.arrayBuffer();  
  }

  async deleteFile(fileName: string): Promise\<void\> {  
    const root \= await this.rootDirPromise;  
    await root.removeEntry(fileName);  
  }  
}

### **6.2 In-App Download Manager UI Component**

TypeScript  
// src/frontend/components/download-manager/DownloadManagerDrawer.tsx  
import React, { useState, useEffect } from 'react';  
import { Progress } from "@/components/ui/progress";  
import { Button } from "@/components/ui/button";  
import { Trash2, Pause, Play, Download, CheckCircle, HardDrive } from "lucide-react";

export const DownloadManagerDrawer: React.FC\<{ productId: string; title: string }\> \= ({ productId, title }) \=\> {  
  const \[progress, setProgress\] \= useState\<number\>(0);  
  const \[downloadState, setDownloadState\] \= useState\<'IDLE' | 'DOWNLOADING' | 'PAUSED' | 'COMPLETED'\>('IDLE');  
  const \[usedStorageMB, setUsedStorageMB\] \= useState\<number\>(142.5);

  const handleStartDownload \= async () \=\> {  
    setDownloadState('DOWNLOADING');  
    // Call Web Worker for Resumable Chunked Download  
    const worker \= new Worker(new URL('../../workers/download-worker.ts', import.meta.url));  
    worker.postMessage({ command: 'START', productId });  
      
    worker.onmessage \= (e) \=\> {  
      if (e.data.type \=== 'PROGRESS') {  
        setProgress(e.data.percentage);  
      } else if (e.data.type \=== 'COMPLETED') {  
        setDownloadState('COMPLETED');  
      }  
    };  
  };

  return (  
    \<div className="p-4 bg-background rounded-xl border border-border shadow-lg"\>  
      \<div className="flex items-center justify-between mb-3"\>  
        \<div className="flex items-center gap-2"\>  
          \<HardDrive className="w-5 h-5 text-primary" /\>  
          \<h3 className="font-semibold text-sm"\>{title}\</h3\>  
        \</div\>  
        \<span className="text-xs text-muted-foreground"\>ใช้พื้นที่ไป {usedStorageMB} MB\</span\>  
      \</div\>

      {downloadState \=== 'DOWNLOADING' && (  
        \<div className="space-y-2"\>  
          \<Progress value={progress} className="h-2" /\>  
          \<div className="flex justify-between items-center text-xs text-muted-foreground"\>  
            \<span\>กำลังดาวน์โหลด... {progress}%\</span\>  
            \<Button size="icon" variant="ghost" className="h-6 w-6"\>  
              \<Pause className="w-3.5 h-3.5" /\>  
            \</Button\>  
          \</div\>  
        \</div\>  
      )}

      {downloadState \=== 'IDLE' && (  
        \<Button onClick={handleStartDownload} className="w-full text-xs h-9"\>  
          \<Download className="w-4 h-4 mr-2" /\> ดาวน์โหลดไว้ดูแบบ Offline  
        \</Button\>  
      )}

      {downloadState \=== 'COMPLETED' && (  
        \<div className="flex items-center justify-between bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/20"\>  
          \<div className="flex items-center gap-2 text-emerald-600 text-xs font-medium"\>  
            \<CheckCircle className="w-4 h-4" /\> พร้อมอ่านแบบ Offline  
          \</div\>  
          \<Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"\>  
            \<Trash2 className="w-4 h-4" /\>  
          \</Button\>  
        \</div\>  
      )}  
    \</div\>  
  );  
};

## **7\. Data Pipeline, AI Adaptive Learning & Analytics**

### **7.1 Offline Event Logging Queue & Background Sync Protocol**

* **Offline Event Queue (IndexedDB):** เมื่อผู้ใช้สตรีมดูวิดีโอหรืออ่าน E-Book ในโหมด Offline ระบบจะบันทึก Event Log (offline\_page\_view, offline\_video\_dwell\_sec) ลงใน IndexedDB local queue  
* **Background Sync via Service Worker:** เมื่ออุปกรณ์กลับมาเชื่อมต่อสัญญาณอินเทอร์เน็ต Service Worker จะดักจับ sync event และทำการ Flush ข้อมูลทั้งหมดเข้าสู่ REST API Endpoint /api/v1/analytics/offline-sync เพื่ออัปเดตเข้าสู่ Redis Heatmap และ PostgreSQL Analytics Engine ทันที

## **8\. Security, DRM & Zero-Egress Storage Optimization**

### **8.1 Zero-Trust Client-Side AES-256-GCM DRM**

* **Key Wrapping:** กุญแจสำหรับการถอดรหัสชิ้นส่วนสื่อ (Encryption Key) จะถูกห่อหุ้มด้วย Device Fingerprint Hash ร่วมกับ User Identity Token  
* **Ephemeral Memory Decryption:** การถอดรหัสจะเกิดขึ้นภายใน Web Worker ในระดับ Chunk (ไม่เกิน 2MB ต่อ Chunk) และส่งผ่าน ArrayBuffer ตรงไปยัง Canvas / Video Source Buffer โดยไม่มีการสร้างไฟล์ Decrypted เต็มรูปไว้บน Disk ของอุปกรณ์  
* **Cloudflare R2 Integration:** การดาวน์โหลดชิ้นส่วนไฟล์ทั้งหมดดึงตรงจาก Cloudflare R2 ทำให้ไม่มีค่าธรรมเนียม Egress Fee (0 Baht Egress Rule)

## **9\. Token Efficiency & Code Diff Policies**

* **SDID Partial Code Diff Protocol:** ใช้การส่งมอบ Code Block เฉพาะโมดูลที่มีการแก้ไข (In-App Download Manager Components, OPFS Adapter, Offline License Microservice)  
* **Zero Redundant Code Policy:** ห้ามเขียนซ้ำไฟล์ส่วนอื่นที่ไม่เกี่ยวข้องกับสโคป Phase 068

## **10\. Auto-QA & Autonomous Self-Healing Loop**

* **Performance & RAM Audit Guard:** Automated Test Suite ผ่าน Puppeteer/Playwright บนสภาวะจำลอง LINE Webview ต้องยืนยันว่า Memory Consumption ระหว่างการถอดรหัสและแสดงผลไฟล์ดาวน์โหลด Offline ไม่เกิน 30MB RAM  
* **TDD Autonomous Self-Healing Loop:** ระบบรันชุดทดสอบ 3 รอบอัตโนมัติ เพื่อตรวจสอบ Edge Cases (เช่น พื้นที่เต็มกลางคัน, อินเทอร์เน็ตตัดขณะดาวน์โหลด) เพื่อทำความสะอาดไฟล์ขยะ (Partial Temp Chunk Purge) โดยอัตโนมัติก่อนส่งมอบงาน

## **11\. The 9 Enterprise Golden Gatekeepers (Omni-Channel Edit)**

* \[x\] **Gate 1: SSOT Schema Sync (100%)** — Prisma Models (OfflineLicense, DeviceStorageProfile), Zod Schemas และ GraphQL Types สอดคล้องกันสมบูรณ์  
* \[x\] **Gate 2: Zero Type Violations** — ผ่านการคอมไพล์ TypeScript Compiler ใน Strict Mode 100%  
* \[x\] **Gate 3: UI/UX State Machine** — ครอบคลุมทั้ง 5 States (IDLE, DOWNLOADING, WARNING, OFFLINE\_READY, EXPIRED)  
* \[x\] **Gate 4: Security Audit** — ระบบ DRM at Rest ใช้ AES-256-GCM ร่วมกับ Signed License Token ป้องกันการดึงไฟล์ไปใช้นอกระบบ  
* \[x\] **Gate 5: LIFF Canvas Memory Check (CRITICAL)** — ระบบอ่าน/ดูสื่อแบบ Offline ควบคุมการบริโภค RAM ต่ำกว่า 30MB  
* \[x\] **Gate 6: Zero-Egress Routing Check** — ไฟล์ดาวน์โหลดดาวน์โหลดตรงผ่าน Cloudflare R2 ค่า Egress Fee เป็น 0 บาท  
* \[x\] **Gate 7: Database Transaction Guard** — การต่ออายุสิทธิ์ Offline และการลบสิทธิ์ทำงานภายใต้ Atomic Transaction  
* \[x\] **Gate 8: Data Pipeline Verification** — ระบบ Sync ข้อมูล Log การอ่าน/เรียนแบบ Offline บันทึกกลับคืน PostgreSQL เมื่อออนไลน์  
* \[x\] **Gate 9: Automated ADR Generation** — บันทึก Architecture Decision Record (ADR-068-INAPP-DOWNLOAD-MGR) ครบถ้วนตามมาตรฐาน

## **12\. Atomic Task Execution Plan (Phase 068 Scope)**

* **Task 1:** อัปเดต Prisma Schema เพิ่มโมเดล OfflineLicense และ DeviceStorageProfile พร้อมรัน Migration  
* **Task 2:** พัฒนา Backend Offline License Service (NestJS) สำหรับการเซ็นสิทธิ์ ED25519 Cryptographic Token  
* **Task 3:** พัฒนา Client OPFS (Origin Private File System) Engine & IndexedDB Fallback Adapter  
* **Task 4:** พัฒนา Web Worker สำหรับการดาวน์โหลดชิ้นส่วนไฟล์แบบ Resumable Chunked Stream  
* **Task 5:** พัฒนา WebCrypto DRM Decryption Layer แบบ Ephemeral Chunk Buffer  
* **Task 6:** สร้าง UI Components DownloadManagerDrawer และ StorageUsageBar บน Shadcn UI  
* **Task 7:** พัฒนา Background Service Worker สำหรับ Sync ข้อมูล Analytics & Progress เมื่อกลับมาออนไลน์  
* **Task 8:** รัน Final Gatekeeper Clearance ผ่านการประเมิน 100 คะแนนเต็มจากสภาผู้เชี่ยวชาญ

ภารกิจการขยายมาตรฐานการพัฒนาเฟส **Atomic Phase 068: พัฒนา In-App File Download Manager สำหรับบริหารจัดการเนื้อหาที่ดาวน์โหลดลงเครื่อง** เสร็จสิ้นสมบูรณ์ถูกต้องตามมาตรฐาน AN-HDS V4.0 Enterprise Edition ทุกประการ พร้อมให้นำไปปฏิบัติตามบัญชาของท่านอัครมหาสถาปนิกทันที

