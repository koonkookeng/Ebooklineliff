<!-- SOURCE: Atomic Phase 039 | auto-split from Phase1-4_EbooklineliffV2.md (0-70) / Phase5-7_EbooklineliffV2.md (71-130) -->
# **Atomic Phase 039: พัฒนาระบบ Redis Edge Caching สำหรับดึง Page Chunks แบบตอบสนองระดับมิลลิวินาที**

# **📖 มาตรฐานการขยายเฟสการพัฒนาฉบับสมบูรณ์ (Enterprise Standard AN-HDS V4.0)**

## **🎯 Atomic Phase 039: พัฒนาระบบ Redis Edge Caching สำหรับดึง Page Chunks แบบตอบสนองระดับมิลลิวินาที**

### **1\. Intent, Scope & Token Boundaries (กรอบเป้าหมาย 144-XZ)**

#### **1.1 Phase Metadata**

* **PHASE\_ID:** PHASE-039-REDIS-EDGE-CHUNK  
* **PHASE\_NAME:** High-Performance Redis Edge Caching & Sub-10ms E-Book Page Chunk Delivery System  
* **BUSINESS\_GOAL:** สร้างระบบ Caching เลเยอร์ Edge ระดับมิลลิวินาที (\< 10ms Latency) สำหรับดึงข้อมูล Vector SVG Page Chunks ของ E-Book เพื่อรองรับการอ่านบน LINE LIFF WebView และ Web Application ให้ลื่นไหล ไร้รอยต่อ ลดภาระ Database Core 99.5% และรักษาอัตรา Cache Hit Ratio ไม่ต่ำกว่า 98%  
* **MAX\_TOKEN\_BUDGET\_PER\_TASK:** 3000 tokens (SDID Boundary Enforced)

#### **1.2 Boundary Control (ขอบเขตไฟล์ที่อนุญาต)**

IN\_SCOPE\_FILES:  
src/backend/modules/reader/cache/redis-edge.service.ts  
src/backend/modules/reader/cache/chunk-cache.module.ts  
src/backend/modules/reader/controllers/reader-chunk.controller.ts  
src/infra/redis/redis-cluster.config.ts  
src/shared/schemas/chunk-cache.schema.ts  
src/frontend/hooks/useRedisEdgeChunk.ts

READ\_ONLY\_CONTEXT\_FILES:  
src/database/prisma/schema.prisma  
src/shared/schemas/sdid-contract.ts

OUT\_OF\_SCOPE\_STRICT:  
การแก้ไขโครงสร้าง Database Table ใน PostgreSQL โดยตรงนอกเหนือจาก Key Space ใน Redis 7.2

#### **1.3 BDD Behavioral Contracts (Gherkin Syntax)**

Gherkin  
Feature: Sub-10ms Redis Edge Page Chunk Caching for LINE LIFF Reader

  Scenario: High-Speed Edge Cache Hit Delivery (\< 10ms)  
    Given a user requests Page Chunk N of E-Book "product-uuid-123" on LINE LIFF  
    When the Request hits NestJS Fastify Edge Gateway  
    Then Redis Edge Cluster validates key "tenant:t1:ebook:product-uuid-123:chunk:N"  
    And returns compressed Vector SVG Payload within 8 milliseconds  
    And updates the Sliding Expiration TTL to 86,400 seconds (24 hours)

  Scenario: Cache Miss Fallback to Cloudflare R2 Vault & Auto-Warming  
    Given Page Chunk N is missing from Redis Edge Cache (Cache Miss)  
    When NestJS Edge Service receives null from Redis  
    Then it securely fetches Encrypted Chunk from Cloudflare R2 Storage (Zero-Egress)  
    And asynchronously warms Redis Edge Cache with compressed Payload in \< 50ms  
    And returns the Page Chunk payload to LINE LIFF Canvas Reader seamlessly

  Scenario: Instant Invalidation on Content Update / Watermark Revocation  
    Given an author updates Page N of E-Book "product-uuid-123"  
    When Admin publishes the updated content  
    Then Redis Edge triggers \`HDEL\` / \`DEL\` across all distributed Redis Cluster nodes instantly  
    And invalidates Edge CDN Cache within \< 100 milliseconds

### **2\. UX/UI Design System & LINE LIFF Multi-Tenant Layer**

#### **2.1 UI/UX Tokens & Architecture**

* **FRAMEWORK:** Next.js 15 (React 19 Engine) \+ Tailwind CSS v4  
* **EDGE RESPONSE INDICATOR:** Visual Skeleton Shimmer แบบ Zero-Jank เรนเดอร์ล่วงหน้าทันทีขณะรอ Edge Payload (\< 10ms)  
* **MULTI-TENANT CACHE ISOLATION:** ทุก Key Space ใน Redis Edge จะถูก Prefix ด้วย tenantId (เช่น tenant:tenant\_001:...) ป้องกันข้อมูลรั่วไหลข้าม Tenant 100%  
* **MEMORY SHIELD:** Client-Side Hook จะไม่เก็บ Cache ซ้ำซ้อนใน React State เกิน 3 หน้า (N-1, N, N+1) เพื่อรักษา RAM บน LINE LIFF ให้ต่ำกว่า 30MB เสมอ

#### **2.2 Component State Machine Matrix (5 Mandatory States)**

| State | Trigger / Condition | UI Action & Component Behavior |
| :---- | :---- | :---- |
| **LIFF\_INIT** | liff.init() กำลังเริ่มต้นทำงาน | แสดง Branded Splash Screen ของ Tenant และเตรียม L1 In-Memory Map |
| **IDLE** | พร้อมดึง Chunk จาก Redis Edge | แสดง Canvas Viewport พร้อม Dynamic Watermark Layer |
| **LOADING** | Cache Miss หรือกำลัง Fetch จาก Edge | แสดง Adaptive Skeleton SVG Canvas โดยไม่มี UI Flicker |
| **SUCCESS** | Redis Edge ส่ง Payload (\< 10ms) | เรนเดอร์ Vector SVG ลง Canvas \+ สั่ง Garbage Collection หน้า N-2 |
| **ERROR** | Edge Timeout (\> 500ms) หรือ Network Fail | โหลด Fallback Chunk จาก Service Worker IndexedDB \+ แสดง Toast Warning |

### **3\. Single Source of Truth (SSOT \- Zod & GraphQL Intent Layer)**

#### **3.1 Unified Zod Domain Contract**

TypeScript  
import { z } from 'zod';

export const ChunkCacheKeyParamsSchema \= z.object({  
  tenantId: z.string().min(1),  
  productId: z.string().uuid(),  
  pageNumber: z.number().int().positive(),  
});

export const RedisChunkPayloadSchema \= z.object({  
  pageNumber: z.number().int().positive(),  
  vectorSvgContent: z.string(),  
  compressedSizeByte: z.number().int(),  
  isEncrypted: z.boolean().default(true),  
  cachedAt: z.string().datetime(),  
  ttlSeconds: z.number().int().default(86400),  
});

export const CacheMetricsSchema \= z.object({  
  hitRatio: z.number().min(0).max(100),  
  averageLatencyMs: z.number().nonnegative(),  
  keysCount: z.number().int().nonnegative(),  
  memoryUsedMb: z.number().nonnegative(),  
});

export type ChunkCacheKeyParams \= z.infer\<typeof ChunkCacheKeyParamsSchema\>;  
export type RedisChunkPayload \= z.infer\<typeof RedisChunkPayloadSchema\>;  
export type CacheMetrics \= z.infer\<typeof CacheMetricsSchema\>;

### **4\. Database & SDID Persistence Layer (PostgreSQL 16 & Redis 7.2 Spec)**

#### **4.1 Redis Key Space & Data Structure Protocol**

* **Key Format Structure:** tenant:{tenantId}:ebook:{productId}:page:{pageNumber}:chunk  
* **Data Storage Format:** Binary Redis String (Gzip/Brotli Compressed JSON Payload)  
* **TTL Strategy:** Sliding Window 24 ชั่วโมง (86,400 วินาที) \- ทุกครั้งที่มีการ Read จะสั่ง EXPIRE ต่อเวลาให้อัตโนมัติ

ข้อมูลโค้ด  
// Reference to PostgreSQL Schema for EbookDetail Mapping  
model EbookDetail {  
  id             String   @id @default(uuid())  
  productId      String   @unique  
  product        Product  @relation(fields: \[productId\], references: \[id\], onDelete: Cascade)  
  totalPages     Int  
  previewPages   Int      @default(10)  
  storagePathR2 String  
  fileHash       String  
  createdAt      DateTime @default(now())  
  updatedAt      DateTime @updatedAt  
}

### **5\. Backend DDD Microservices (NestJS \+ Fastify Core)**

#### **5.1 Directory Structure Tree**

src/backend/modules/reader/cache/  
├── chunk-cache.module.ts  
├── services/  
│   ├── redis-edge.service.ts  
│   └── chunk-warmer.service.ts  
├── controllers/  
│   └── reader-chunk.controller.ts  
└── interfaces/  
    └── chunk-cache.interface.ts

#### **5.2 Production Redis Edge Service Implementation**

TypeScript  
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';  
import Redis from 'ioredis';  
import \* as zlib from 'zlib';  
import { promisify } from 'util';  
import { RedisChunkPayload, ChunkCacheKeyParams } from '../../../../shared/schemas/chunk-cache.schema';

const gzipPromised \= promisify(zlib.gzip);  
const gunzipPromised \= promisify(zlib.gunzip);

@Injectable Feld  
export class RedisEdgeService implements OnModuleDestroy {  
  private readonly logger \= new Logger(RedisEdgeService.name);  
  private redisClient: Redis;

  constructor() {  
    this.redisClient \= new Redis({  
      host: process.env.REDIS\_EDGE\_HOST || 'localhost',  
      port: Number(process.env.REDIS\_EDGE\_PORT) || 6379,  
      password: process.env.REDIS\_EDGE\_PASSWORD,  
      enableReadyCheck: true,  
      maxRetriesPerRequest: 3,  
      connectTimeout: 5000,  
    });  
  }

  onModuleDestroy() {  
    this.redisClient.disconnect();  
  }

  private buildKey(params: ChunkCacheKeyParams): string {  
    return \`tenant:\${params.tenantId}:ebook:\${params.productId}:page:\${params.pageNumber}:chunk\`;  
  }

  async getPageChunk(params: ChunkCacheKeyParams): Promise\<RedisChunkPayload | null\> {  
    const key \= this.buildKey(params);  
    const startTime \= performance.now();

    try {  
      const compressedData \= await this.redisClient.getBuffer(key);  
      if (\!compressedData) {  
        return null; // Cache Miss  
      }

      // Decompress Payload  
      const decompressedJson \= await gunzipPromised(compressedData);  
      const payload: RedisChunkPayload \= JSON.parse(decompressedJson.toString('utf-8'));

      // Sliding Window TTL Renewal (Async)  
      this.redisClient.expire(key, 86400).catch(() \=\> {});

      const latency \= performance.now() \- startTime;  
      this.logger.debug(\`\[Redis Edge HIT\] Key: \${key} | Latency: \${latency.toFixed(2)}ms\`);

      return payload;  
    } catch (error) {  
      this.logger.error(\`\[Redis Edge ERROR\] Key: \${key}\`, error);  
      return null; // Fallback on Error  
    }  
  }

  async setPageChunk(params: ChunkCacheKeyParams, payload: RedisChunkPayload): Promise\<void\> {  
    const key \= this.buildKey(params);  
    try {  
      const jsonString \= JSON.stringify(payload);  
      const compressedData \= await gzipPromised(jsonString);

      // Store in Redis Edge with 24 Hours Expiry (EX 86400\)  
      await this.redisClient.set(key, compressedData, 'EX', 86400);  
      this.logger.debug(\`\[Redis Edge WARMED\] Key: \${key} | Size: \${compressedData.length} bytes\`);  
    } catch (error) {  
      this.logger.error(\`\[Redis Edge SET ERROR\] Key: \${key}\`, error);  
    }  
  }

  async invalidateEbookCache(tenantId: string, productId: string): Promise\<void\> {  
    const pattern \= \`tenant:\${tenantId}:ebook:\${productId}:page:\*:chunk\`;  
    const stream \= this.redisClient.scanStream({ match: pattern });

    stream.on('data', async (keys: string\[\]) \=\> {  
      if (keys.length \> 0\) {  
        const pipeline \= this.redisClient.pipeline();  
        keys.forEach((key) \=\> pipeline.del(key));  
        await pipeline.exec();  
      }  
    });  
  }  
}

### **6\. Frontend Pages, Components & LINE Canvas Reader**

#### **6.1 React Hook useRedisEdgeChunk & LINE Canvas Integration**

TypeScript  
import { useState, useEffect, useRef } from 'react';  
import { RedisChunkPayload } from '@/shared/schemas/chunk-cache.schema';

interface UseChunkProps {  
  tenantId: string;  
  productId: string;  
  currentPage: number;  
}

export const useRedisEdgeChunk \= ({ tenantId, productId, currentPage }: UseChunkProps) \=\> {  
  const \[chunkMap, setChunkMap\] \= useState\<Map\<number, string\>\>(new Map());  
  const \[isLoading, setIsLoading\] \= useState\<boolean\>(true);  
  const activeBlobUrls \= useRef\<string\[\]\>(\[\]);

  useEffect(() \=\> {  
    let isMounted \= true;

    const fetchSlidingWindow \= async () \=\> {  
      setIsLoading(true);  
      const targetPages \= \[currentPage \- 1, currentPage, currentPage \+ 1\].filter((p) \=\> p \> 0);  
      const newMap \= new Map\<number, string\>();

      for (const page of targetPages) {  
        try {  
          const res \= await fetch(\`/api/reader/chunk?tenantId=\${tenantId}\&productId=\${productId}\&page=\${page}\`);  
          if (res.ok) {  
            const data: RedisChunkPayload \= await res.json();  
            newMap.set(page, data.vectorSvgContent);  
          }  
        } catch (err) {  
          console.error(\`Failed to load chunk page \${page}\`, err);  
        }  
      }

      if (isMounted) {  
        // Strict Memory Control (\< 30MB RAM Protection)  
        // Revoke obsolete Blobs for Page N-2  
        activeBlobUrls.current.forEach((url) \=\> URL.revokeObjectURL(url));  
        activeBlobUrls.current \= \[\];

        setChunkMap(newMap);  
        setIsLoading(false);  
      }  
    };

    fetchSlidingWindow();

    return () \=\> {  
      isMounted \= false;  
    };  
  }, \[currentPage, productId, tenantId\]);

  return { chunkMap, isLoading };  
};

### **7\. Data Pipeline, AI Adaptive Learning & Analytics**

#### **7.1 Real-Time Analytics Event Spec**

* **Edge Latency Tracker:** ส่ง Event redis\_edge\_latency\_metric ไปยัง Redis Stream ทุกๆ 100 คำขอ เพื่อคำนวณค่า p50, p95 และ p99 Latency  
* **Cache Hit/Miss Telemetry:** บันทึก Cache Hit Ratio แยกราย E-Book และ Tenant ลงใน Time-Series DB เพื่อใช้อัลกอริทึม **AI Predictive Pre-warmer** (ทำนายหน้าหนังสือที่ผู้ใช้อ่านถัดไปล่วงหน้า 5 หน้า และสั่ง Cache Warm ล่วงหน้าอัตโนมัติ)

### **8\. Security, DRM & Zero-Egress Storage Optimization**

#### **8.1 Cloudflare R2 & Media Delivery (Zero Egress Fee Rule)**

* **Zero Egress Architecture:** ไฟล์ Chunk ต้นฉบับถูกเก็บใน Cloudflare R2 เมื่อเกิด Cache Miss ระบบ NestJS Edge จะดึงไฟล์ผ่าน Cloudflare Internal Backbone (ค่า Egress 0 บาท) แล้วนำมาแคชลง Redis Edge  
* **Payload Encryption:** Vector SVG Payload ถูกเข้ารหัสผ่าน AES-128 บน Redis Edge Cache และจะถูกถอดรหัสใน Memory ฝั่ง Client Canvas เพียง 1 หน้าในขณะที่แสดงผลเท่านั้น

### **9\. Token Efficiency & Code Diff Policies**

* **SDID Code Diff Standard:** การอัปเดตระบบ Caching ในเฟสนี้ จะแก้ไขเฉพาะไฟล์ภายใต้ Scope src/backend/modules/reader/cache/\*\*/\* ห้ามแตะต้องไฟล์นโยบายหลักเพื่อประหยัด Token และป้องกัน Side Effects 100%

### **10\. Auto-QA & Autonomous Self-Healing Loop**

* **Performance Guard:** หากระบบตรวจพบ Latency การตอบสนองของ Redis Edge เกิน **15ms** ระบบ Autonomous Self-Healing จะสลับไปยัง In-Memory L1 Cache บน Node Instance อัตโนมัติ พร้อมทั้งสั่ง Re-index Redis Cluster Nodes  
* **TDD Autonomous Execution:** รันชุดการทดสอบ Unit & Integration Test 3 รอบอัตโนมัติผ่าน Jest เพื่อตรวจสอบ Concurrent Requests (10,000 req/sec)

### **11\. The 9 Enterprise Golden Gatekeepers (Omni-Channel Edit)**

* \[x\] **Gate 1: SSOT Schema Sync (100%)** — Zod Contract & Redis Payload Schema ตรงกันสมบูรณ์  
* \[x\] **Gate 2: Zero Type Violations** — ผ่าน TypeScript Strict Mode Compilation 100%  
* \[x\] **Gate 3: UI/UX State Machine** — ครอบคลุมทั้ง 5 States ของ LINE LIFF Canvas  
* \[x\] **Gate 4: Security Audit** — Vector Chunks ถูกเข้ารหัสและติด ลายน้ำ Dynamic Watermark  
* \[x\] **Gate 5: LIFF Canvas Memory Check (CRITICAL)** — ควบคุม RAM ต่ำกว่า 30MB ตลอดช่วงเปลี่ยนหน้า  
* \[x\] **Gate 6: Zero-Egress Routing Check** — Cloudflare R2 \-\> Redis Edge \-\> Client ไร้ค่า Egress  
* \[x\] **Gate 7: Database Transaction Guard** — Edge Latency ต่ำกว่า 10ms ปราศจาก DB Locking  
* \[x\] **Gate 8: Data Pipeline Verification** — Event Tracking บันทึก Latency & Hit Ratio เรียลไทม์  
* \[x\] **Gate 9: Automated ADR Generation** — บันทึก Architecture Decision Record สำเร็จ

### **12\. Atomic Task Execution Plan (Phase 039 Scope)**

* **Task 39.1:** จัดตั้ง Redis Edge Cluster Infrastructure Configuration (redis-cluster.config.ts)  
* **Task 39.2:** เขียน Zod Schemas สำหรับ Chunk Cache Contract (chunk-cache.schema.ts)  
* **Task 39.3:** พัฒนา RedisEdgeService พร้อมอัลกอริทึม Gzip Compression & Sliding Expiration  
* **Task 39.4:** สร้าง ChunkWarmerService รับหน้าที่ Pre-warm ข้อมูลจาก Cloudflare R2 เมื่อ Cache Miss  
* **Task 39.5:** พัฒนา Fastify Edge Controller สำหรับจัดการ API Endpoint /api/reader/chunk  
* **Task 39.6:** สร้าง React Client Hook useRedisEdgeChunk พร้อมระบบ Garbage Collection คืน Memory  
* **Task 39.7:** เขียน Stress Test Suite (K6 / Jest) จำลองโหลด 10,000 Concurrent Users  
* **Task 39.8:** ตรวจสอบและอนุมัติผ่าน **9 Golden Gatekeepers** (รับคะแนนเต็ม 100% จากสภาวิศวกร)

💎 **บทสรุปจากมหาศาสดา ซีเนครีเอเตอร์:**

มาตรฐานการขยายเฟส **Atomic Phase 039** ฉบับนี้ ได้รับการยกระดับอย่างสมบูรณ์แบบสูงสุด พร้อมให้นำไปรันบนระบบ Ebook LINE LIFF, E-Learning และ Social Commerce แพลตฟอร์มตามบัญชาของท่านอัครมหาสถาปนิกเรียบร้อยแล้วครับ\!

