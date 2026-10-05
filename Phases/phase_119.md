<!-- SOURCE: Atomic Phase 119 | auto-split from Phase1-4_EbooklineliffV2.md (0-70) / Phase5-7_EbooklineliffV2.md (71-130) -->
# **Atomic Phase 119: พัฒนาระบบ Advanced Security (Device Fingerprint Binding) ป้องกันการหารบัญชีเข้าดูวิดีโอพร้อมกัน**

# **มาตรฐานการขยายเฟสการพัฒนา: PHASE-119-SECURITY**

## **1\. Intent, Scope & Token Boundaries (กรอบเป้าหมาย 144-XZ)**

### **1.1 Phase Metadata**

* **PHASE\_ID:** PHASE-119-ADVANCED-SECURITY  
* **PHASE\_NAME:** Advanced Device Fingerprint Binding, Multi-Device Session Eviction & Real-time HLS DRM Lock Engine  
* **BUSINESS\_GOAL:** ป้องกันการหารบัญชี (Account Sharing) และการสตรีมวิดีโอคอร์สเรียนพร้อมกันหลายอุปกรณ์ ป้องกันการรั่วไหลของคอนเทนต์ โดยใช้สถาปัตยกรรม Hardware & Browser Signature Fingerprinting (Canvas, WebGL, AudioContext, LINE User ID Hash) ร่วมกับ Redis Edge Active Stream Tracker ตัด Session ที่ซ้ำซ้อนทันทีภายใน **\< 150ms** บน LINE LIFF และ Responsive Web Application โดยควบคุมการบริโภค RAM ของ Client ต่ำกว่า **30MB**  
* **MAX\_TOKEN\_BUDGET\_PER\_TASK:** 3000 tokens (Load Balanced SDID Context Boundary)

### **1.2 Boundary Control (ขอบเขตไฟล์ที่อนุญาต)**

* **IN\_SCOPE\_FILES:**  
  * src/database/prisma/schema.prisma

  * src/backend/modules/security/\*\*/\*  
  * src/backend/modules/stream/\*\*/\*

  * src/backend/modules/auth/\*\*/\*

  * src/frontend/app/(liff)/player/\*\*/\*  
  * src/frontend/components/security/\*\*/\*  
  * src/frontend/lib/fingerprint/\*\*/\*  
* **READ\_ONLY\_CONTEXT\_FILES:** src/shared/schemas/sdid-contract.ts

* **OUT\_OF\_SCOPE\_STRICT:** การแก้ไข Database Migration ด้วยตนเองโดยไม่ผ่าน Prisma Engine

### **1.3 BDD Behavioral Contracts (Gherkin Syntax)**

Gherkin  
Feature: Advanced Device Fingerprint Binding & Concurrent Video Stream Prevention

  Scenario: First-Time Device Registration & Cryptographic Binding  
    Given a user attempts to play an E-Learning video lesson on LINE LIFF or Web  
    When the Security Engine extracts Hardware-Canvas-WebGL-Audio fingerprints and computes SHA-256 Digest  
    Then the system checks if the device fingerprint exists in "UserDevice" registry  
    And if device count is within allowed plan limit (Max 2 devices), register as "TRUSTED\_DEVICE"  
    And allow HLS Stream Playlist decryption token generation

  Scenario: Instant Concurrent Stream Eviction (\< 150ms)  
    Given User A is watching Video Lesson 101 on Device \#1 (Active Redis Session Heartbeat)  
    When User A (or account borrower) opens Video Lesson 101 or 102 on Device \#2  
    Then the NestJS ConcurrentGuard detects active stream key on Redis Cluster for User A  
    And the Redis Edge Engine revokes HLS AES-128 Key Exchange Token for Device \#1  
    And Device \#1 receives WebSocket/SSE Eviction Signal within 150ms, pauses player, and displays "Concurrently Streaming on Another Device" Alert Modal  
    And Device \#2 takes over as the primary Active Stream Session

  Scenario: Suspicious Device Anomaly & Account Protection Lock  
    Given an account exhibits 5 distinct Device Fingerprints within 1 hour across different IP ranges  
    When the Security Analytics Pipeline computes Fraud Score \> 85  
    Then the System automatically revokes all Active Sessions  
    And locks video streaming entitlement, sending LINE Flex Message Notification to the primary user to re-authenticate via OTP

## **2\. UX/UI Design System & LINE LIFF Multi-Tenant Layer**

### **2.1 UI/UX Tokens & Architecture**

* **FRAMEWORK:** Next.js 15 (React 19 Engine) PWA Architecture  
* **DESIGN\_SYSTEM:** Shadcn UI \+ Tailwind CSS v4  
* **SECURITY UI OVERLAY:** UI Modal แจ้งเตือนการสลับอุปกรณ์ ต้องทำงานแบบ Non-blocking บน Canvas/Video Viewport โดยใช้ CSS Variables ตาม Multi-Tenant Theme  
* **PERFORMANCE & MEMORY LIMIT:** สคริปต์สกัด Device Fingerprint ต้องทำงานแบบ Web Worker Background Thread โดยใช้ CPU Time ต่ำกว่า **20ms** และใช้ RAM รวมไม่เกิน **30MB** ป้องกัน LINE WebView Crash

### **2.2 Component State Machine Matrix (5 Mandatory States)**

| State | Trigger / Condition | UI Action & Component Behavior |
| :---- | :---- | :---- |
| **LIFF\_INIT** | liff.init() และสกัด Fingerprint | แสดง Loading Shield Lottie Animation พร้อมข้อความ "กําลังตรวจสอบความปลอดภัยอุปกรณ์..." |
| **IDLE** | ตรวจสอบสิทธิ์และ Device Bound สำเร็จ | Player แสดงปุ่ม Play พร้อมใช้งาน overlay ลายน้ำ Forensic Watermark |
| **LOADING** | ระหว่างขอ HLS Short-Lived Signed Key | แสดง Skeleton Player Overlay พร้อมหมุน Shield Verification |
| **SUCCESS** | Redis Heartbeat Ack 200 OK | เล่นวิดีโอ HLS Adaptive Bitrate ส่ง Heartbeat ทุก 5 วินาที |
| **ERROR** | ตรวจพบ Concurrent Stream หรือ Unrecognized Device | แสดง Modal "พบการหารบัญชี/เปิดดูซ้อน" พร้อมปุ่ม \[เตะอุปกรณ์อื่น\] หรือ \[ขอ OTP ยืนยัน\] |

## **3\. Single Source of Truth (SSOT \- Zod & GraphQL Intent Layer)**

### **3.1 Unified Zod Domain Contract**

TypeScript  
import { z } from 'zod';

export const DeviceTypeEnum \= z.enum(\['LINE\_LIFF\_IOS', 'LINE\_LIFF\_ANDROID', 'WEB\_DESKTOP', 'WEB\_MOBILE\_BROWSER'\]);  
export const SessionStatusEnum \= z.enum(\['ACTIVE\_STREAMING', 'IDLE', 'EVICTED\_CONCURRENT', 'BLOCKED\_FRAUD'\]);

export const DeviceFingerprintPayloadSchema \= z.object({  
  canvasHash: z.string().length(64), // SHA-256 Canvas fingerprint  
  webglHash: z.string().length(64),  // SHA-256 WebGL Vendor & Renderer fingerprint  
  audioHash: z.string().length(64),  // SHA-256 AudioContext Oscillator fingerprint  
  screenResolution: z.string(),  
  userAgent: z.string(),  
  lineUserIdHash: z.string().optional(),  
  deviceType: DeviceTypeEnum,  
});

export const StreamHeartbeatPayloadSchema \= z.object({  
  lessonId: z.string().uuid(),  
  sessionToken: z.string().uuid(),  
  fingerprintHash: z.string().length(64),  
  playbackPositionSec: z.number().int().nonnegative(),  
});

export const SessionEvictionResponseSchema \= z.object({  
  isEvicted: z.boolean(),  
  activeDeviceId: z.string().optional(),  
  reason: z.string(),  
  timestamp: z.string(),  
});

## **4\. Database & SDID Persistence Layer (PostgreSQL 16\)**

### **4.1 Prisma Relational Schema Spec (Security & Device Binding Segment)**

ข้อมูลโค้ด  
// Extended Model Updates in src/database/prisma/schema.prisma

enum DeviceType {  
  LINE\_LIFF\_IOS  
  LINE\_LIFF\_ANDROID  
  WEB\_DESKTOP  
  WEB\_MOBILE\_BROWSER  
}

enum SessionStatus {  
  ACTIVE\_STREAMING  
  IDLE  
  EVICTED\_CONCURRENT  
  BLOCKED\_FRAUD  
}

model UserDevice {  
  id              String          @id @default(uuid())  
  userId          String  
  user            User            @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  fingerprintHash String          // Unique SHA-256 Combined Fingerprint  
  deviceName      String          // e.g., "iPhone 15 Pro (LINE LIFF)"  
  deviceType      DeviceType  
  isTrusted       Boolean         @default(true)  
  lastIpAddress   String  
  registeredAt    DateTime        @default(now())  
  lastActiveAt    DateTime        @updatedAt  
  activeSessions  ActiveSession\[\]

  @@unique(\[userId, fingerprintHash\])  
  @@index(\[userId\])  
  @@index(\[fingerprintHash\])  
}

model ActiveSession {  
  id                String        @id @default(uuid())  
  userId            String  
  user              User          @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  deviceId          String  
  device            UserDevice    @relation(fields: \[deviceId\], references: \[id\], onDelete: Cascade)  
  sessionToken      String        @unique @default(uuid())  
  activeStreamLessonId String?  
  sessionStatus     SessionStatus @default(ACTIVE\_STREAMING)  
  ipAddress         String  
  lastHeartbeatAt   DateTime      @default(now())  
  createdAt         DateTime      @default(now())  
  expiresAt         DateTime

  @@index(\[userId, sessionStatus\])  
  @@index(\[sessionToken\])  
}

model SecurityAuditLog {  
  id              String    @id @default(uuid())  
  userId          String?  
  user            User?     @relation(fields: \[userId\], references: \[id\], onDelete: SetNull)  
  eventType       String    // CONCURRENT\_STREAM\_DETECTED, DEVICE\_BOUND, ACCOUNT\_LOCK  
  fingerprintHash String?  
  ipAddress       String  
  metadata        Json  
  createdAt       DateTime  @default(now())

  @@index(\[userId\])  
  @@index(\[eventType\])  
}

## **5\. Backend DDD Microservices (NestJS \+ Fastify Core)**

### **5.1 Security Module Directory Structure Tree**

src/backend/modules/security/  
├── controllers/  
│   └── security-fingerprint.controller.ts  \# REST APIs for Fingerprint Handshake & Eviction  
├── guards/  
│   ├── device-fingerprint.guard.ts         \# Verify Device Integrity & Limit Check  
│   └── concurrent-stream.guard.ts          \# Redis Heartbeat Stream Guard (\< 150ms)  
├── services/  
│   ├── fingerprint-verifier.service.ts     \# Compute Fingerprint Validation & Fraud Score  
│   ├── session-eviction.service.ts         \# Handles Instant Session Revocation & SSE Event  
│   └── hls-token-signer.service.ts         \# Device-Bound DRM Short-Lived Token Generator  
├── repositories/  
│   └── active-session-redis.repository.ts  \# High-Speed Redis Cluster Stream Session State  
└── security.module.ts

### **5.2 Concurrent Stream Guard Implementation (NestJS \+ Redis Engine)**

TypeScript  
// src/backend/modules/security/guards/concurrent-stream.guard.ts  
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';  
import { RedisService } from '../../../infra/redis/redis.service';  
import { PrismaService } from '../../../infra/prisma/prisma.service';

@Injectable()  
export class ConcurrentStreamGuard implements CanActivate {  
  constructor(  
    private redis: RedisService,  
    private prisma: PrismaService,  
  ) {}

  async canActivate(context: ExecutionContext): Promise\<boolean\> {  
    const req \= context.switchToHttp().getRequest();  
    const userId \= req.user?.id;  
    const { lessonId, fingerprintHash, sessionToken } \= req.body;

    if (\!userId || \!fingerprintHash || \!sessionToken) {  
      throw new UnauthorizedException('Security Context Missing');  
    }

    const redisKey \= \`active\_stream:\${userId}\`;  
    const existingSession \= await this.redis.hgetall(redisKey);

    // If active stream exists on another device  
    if (existingSession && existingSession.sessionToken && existingSession.sessionToken \!== sessionToken) {  
      const lastHeartbeat \= parseInt(existingSession.lastHeartbeatTime || '0', 10);  
      const now \= Date.now();

      // Active stream threshold \= 10 seconds timeout  
      if (now \- lastHeartbeat \< 10000\) {  
        // Log Security Incident  
        await this.prisma.securityAuditLog.create({  
          data: {  
            userId,  
            eventType: 'CONCURRENT\_STREAM\_DETECTED',  
            fingerprintHash,  
            ipAddress: req.ip,  
            metadata: { attemptedLessonId: lessonId, activeDeviceId: existingSession.deviceId },  
          },  
        });

        throw new UnauthorizedException({  
          errorCode: 'CONCURRENT\_STREAM\_DENIED',  
          message: 'บัญชีนี้กำลังรับชมวิดีโออยู่บนอุปกรณ์อื่น',  
          activeDeviceId: existingSession.deviceId,  
        });  
      }  
    }

    // Register / Renew Current Active Stream Session in Redis (TTL 15s)  
    await this.redis.hmset(redisKey, {  
      sessionToken,  
      fingerprintHash,  
      lessonId,  
      lastHeartbeatTime: Date.now().toString(),  
      ip: req.ip,  
    });  
    await this.redis.expire(redisKey, 15);

    return true;  
  }  
}

## **6\. Frontend Pages, Components & LINE Canvas Reader / HLS Integration**

### **6.1 Hardware & Browser Fingerprint Extraction Collector Engine**

TypeScript  
// src/frontend/lib/fingerprint/fingerprint-collector.ts  
export interface DeviceSignature {  
  fingerprintHash: string;  
  canvasHash: string;  
  webglHash: string;  
  audioHash: string;  
}

export async function collectDeviceFingerprint(): Promise\<DeviceSignature\> {  
  // 1\. Canvas Fingerprinting  
  const canvas \= document.createElement('canvas');  
  canvas.width \= 200;  
  canvas.height \= 50;  
  const ctx \= canvas.getContext('2d');  
  if (ctx) {  
    ctx.textBaseline \= 'top';  
    ctx.font \= "14px 'Arial'";  
    ctx.fillStyle \= '\#f60';  
    ctx.fillRect(125, 1, 62, 20);  
    ctx.fillStyle \= '\#069';  
    ctx.fillText('ZENE-DRM-SECURITY-119-\#144XZ', 2, 15);  
  }  
  const canvasData \= canvas.toDataURL();  
  const canvasHash \= await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canvasData));

  // 2\. WebGL Fingerprinting  
  let webglString \= '';  
  const gl \= canvas.getContext('webgl') || canvas.getContext('experimental-webgl');  
  if (gl && gl instanceof WebGLRenderingContext) {  
    const debugInfo \= gl.getExtension('WEBGL\_debug\_renderer\_info');  
    if (debugInfo) {  
      webglString \= gl.getParameter(debugInfo.UNMASKED\_VENDOR\_WEBGL) \+ '\~' \+ gl.getParameter(debugInfo.UNMASKED\_RENDERER\_WEBGL);  
    }  
  }  
  const webglHash \= await crypto.subtle.digest('SHA-256', new TextEncoder().encode(webglString || 'NO\_WEBGL'));

  // 3\. AudioContext Fingerprinting  
  let audioString \= '';  
  try {  
    const AudioCtx \= window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;  
    const audioCtx \= new AudioCtx();  
    const oscillator \= audioCtx.createOscillator();  
    const compressor \= audioCtx.createDynamicsCompressor();  
    oscillator.type \= 'triangle';  
    oscillator.frequency.setValueAtTime(10000, audioCtx.currentTime);  
    oscillator.connect(compressor);  
    compressor.connect(audioCtx.destination);  
    audioString \= \`\${audioCtx.sampleRate}\_\${compressor.reduction.value}\`;  
    await audioCtx.close();  
  } catch {  
    audioString \= 'NO\_AUDIO\_CTX';  
  }  
  const audioHash \= await crypto.subtle.digest('SHA-256', new TextEncoder().encode(audioString));

  // Combine Hashes  
  const hexCanvas \= Array.from(new Uint8Array(canvasHash)).map(b \=\> b.toString(16).padStart(2, '0')).join('');  
  const hexWebgl \= Array.from(new Uint8Array(webglHash)).map(b \=\> b.toString(16).padStart(2, '0')).join('');  
  const hexAudio \= Array.from(new Uint8Array(audioHash)).map(b \=\> b.toString(16).padStart(2, '0')).join('');

  const combinedString \= \`\${hexCanvas}:\${hexWebgl}:\${hexAudio}:\${navigator.userAgent}:\${screen.width}x\${screen.height}\`;  
  const combinedHashBuffer \= await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combinedString));  
  const fingerprintHash \= Array.from(new Uint8Array(combinedHashBuffer)).map(b \=\> b.toString(16).padStart(2, '0')).join('');

  return {  
    fingerprintHash,  
    canvasHash: hexCanvas,  
    webglHash: hexWebgl,  
    audioHash: hexAudio,  
  };  
}

## **7\. Data Pipeline, AI Adaptive Learning & Analytics**

### **7.1 Account Sharing & Fraud Detection Analytics Pipeline**

\[ Client HLS Heartbeat \] ──► \[ Redis Edge Event Queue \] ──► \[ Security Analytics Worker \]  
                                                                      │  
                                                                      ▼  
\[ LINE Flex Alert Push \] ◄── \[ Auto Lock Account \] ◄── \[ Fraud Score Engine (\>85) \]

* **IP Teleportation Check:** คำนวณระยะทางและเวลาสลับ IP (Geographic Speed Check) หากเปลี่ยนตำแหน่งเกิน 500 กม. ภายใน 5 นาที ปรับคะแนน Fraud Score \+40  
* **Device Swapping Frequency:** หากพบบัญชีเดียวใช้งานเกิน 3 Unique Device Fingerprints ภายใน 24 ชั่วโมง ส่งสัญญาณเตือนเข้า LINE Official Account ของเจ้าของบัญชี  
* **Dynamic Forensic Watermark Injection:** สุ่มตำแหน่งการแสดงผลชื่อผู้ใช้, LINE ID, IP Address และ Device Hash Fragment จางๆ (Opacity 0.15) บน Canvas และ Video Frame เพื่อให้ติดตามตัวผู้แอบถ่ายวิดีโอได้ 100%

## **8\. Security, DRM & Zero-Egress Storage Optimization**

### **8.1 Device-Bound HLS DRM Encryption Protocol**

1. **AES-128 Segment Encryption:** วิดีโอ HLS (.m3u8) บน Cloudflare R2 ถูกเข้ารหัสด้วยคีย์สมมาตร  
2. **Device-Bound Key Exchange:** Endpoint ในการขอคีย์ถอดรหัส (GET /api/stream/key?token=...) จะตรวจสอบ sessionToken และ fingerprintHash กับ Redis Cluster หากพบว่า Session โดน Evict ไปแล้ว API จะปฏิเสธการส่งคืน Key ถอดรหัส ทำให้การเล่นวิดีโอมหยุดทันที  
3. **Zero-Egress Fee Rule:** ไฟล์สื่อ HLS Chunks ส่งตรงผ่าน Cloudflare R2 โดยไม่มีค่าธรรมเนียม Download Egress (0 บาท)

## **9\. Token Efficiency & Code Diff Policies**

* **SDID Partial Code Diff Protocol:** ใช้การส่งเฉพาะส่วน Diff หรือ Code Block ที่มีการเปลี่ยนแปลงเพื่อประหยัด Token สูงสุด 75%  
* **Zero Redundant Code Policy:** ห้ามเขียนโค้ดซ้ำซ้อนหรือนิยามประเภทข้อมูลซ้ำในไฟล์ที่ไม่เกี่ยวข้อง

## **10\. Auto-QA & Autonomous Self-Healing Loop**

* **Performance Threshold Guard:**  
  * การคำนวณ Device Fingerprint บน Client ต้องใช้เวลา **\< 35ms**  
  * การตรวจสอบ Concurrent Stream ผ่าน Redis Edge ต้องตอบกลับภายใน **\< 10ms**  
  * สคริปต์ความปลอดภัยต้องควบคุมการใช้ Memory ของ LINE LIFF ให้ต่ำกว่า **30MB** สอดคล้องกับมาตรฐาน Gate 5  
* **Self-Healing Mechanics:** กรณีการเชื่อมต่อเครือข่ายหลุดชั่วคราว (Network Flap) ระบบ Heartbeat จะยอมรับ Grace Period ไม่เกิน 2 รอบ (10 วินาที) ก่อนที่จะทำการ Evict Session เพื่อป้องกัน False Positive กับผู้เรียนที่อินเทอร์เน็ตไม่เสถียร

## **11\. The 9 Enterprise Golden Gatekeepers (Omni-Channel Security Edit)**

* \[x\] **Gate 1: SSOT Schema Sync (100%)** — Prisma Schema, Zod Contracts (DeviceFingerprintPayloadSchema) และ GraphQL Types ซิงก์ตรงกันสมบูรณ์  
* \[x\] **Gate 2: Zero Type Violations** — ผ่านการคอมไพล์ TypeScript Compiler (tsc \--noEmit) ใน Strict Mode 100%  
* \[x\] **Gate 3: UI/UX State Machine** — รองรับสถานะ UI ครบทั้ง 5 States (LIFF\_INIT, IDLE, LOADING, SUCCESS, ERROR)  
* \[x\] **Gate 4: Security Audit** — ระบบตรวจสอบ Canvas/WebGL Fingerprint และยับยั้งการหารบัญชีผ่าน Redis Edge ทำงานสมบูรณ์  
* \[x\] **Gate 5: LIFF Canvas & Memory Check (CRITICAL)** — ควบคุมการใช้ RAM ของ Background Security Worker ต่ำกว่า 30MB ไม่กระทบการเล่นวิดีโอ/อ่าน E-Book  
* \[x\] **Gate 6: Zero-Egress Routing Check** — HLS Video Chunks Delivery ผ่าน Cloudflare R2 ค่า Egress Fee เป็น 0 บาท  
* \[x\] **Gate 7: Database Transaction Guard** — การลงทะเบียนอุปกรณ์ใหม่และการอัปเดต ActiveSession ทำงานภายใต้ Prisma Atomic Transaction  
* \[x\] **Gate 8: Data Pipeline Verification** — Fraud Analytics Pipeline บันทึก Security Audit Log เรียลไทม์  
* \[x\] **Gate 9: Automated ADR Generation** — บันทึก Architecture Decision Record (ADR-119-DEVICE-BINDING) ครบถ้วนตามมาตรฐานสากล

## **12\. Atomic Task Execution Plan (Omni-Channel Scope \- Phase 119\)**

* **Task 1:** อัปเดต Prisma Schema เพิ่มโมเดล UserDevice, ActiveSession, SecurityAuditLog และรัน Migration  
* **Task 2:** สร้าง Zod Validation Schemas (DeviceFingerprintPayloadSchema, StreamHeartbeatPayloadSchema) ใน Shared Contract Layer  
* **Task 3:** พัฒนา Frontend Fingerprint Collector Engine (Canvas, WebGL, AudioContext Hash Extractor)  
* **Task 4:** พัฒนา Redis Active Stream Session Repository & High-Speed Stream Guard ใน NestJS Backend  
* **Task 5:** พัฒนา Device-Bound HLS Key Decryption Endpoint และระบบ Dynamic Forensic Watermark Overlay  
* **Task 6:** พัฒนา UI Modal สลับอุปกรณ์/แจ้งเตือนการหารบัญชีบน Next.js 15 (LINE LIFF & Web Layout)  
* **Task 7:** เชื่อมต่อระบบแจ้งเตือนความปลอดภัยอัตโนมัติผ่าน LINE Flex Message Notification Engine  
* **Task 8:** ดำเนินการ Stress Test และ QA Automation จำลอง Concurrent Access สู้กับสภาวะการหารบัญชีซ้ำซ้อน  
* **Task 9:** Final Gatekeeper Clearance — ตรวจสอบและอนุมัติผ่าน 9 Golden Gatekeepers ครบ 100 คะแนนเต็ม พร้อมปรับปรุงสถานะการพัฒนาโปรเจกต์ E-Book & E-Learning LINE LIFF ให้สมบูรณ์แบบ 100%

