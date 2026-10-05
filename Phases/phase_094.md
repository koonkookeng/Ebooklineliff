<!-- SOURCE: Atomic Phase 094 | auto-split from Phase1-4_EbooklineliffV2.md (0-70) / Phase5-7_EbooklineliffV2.md (71-130) -->
# **Atomic Phase 094: พัฒนา AI Creator Co-Pilot (เครื่องมือช่วยร่างโครงสร้างคอร์สและสร้าง Auto-Captions ให้วิดีโอ)**

# **มาตรฐานการขยายเฟสการพัฒนาซอฟต์แวร์ AN-HDS V4.0 (Enterprise Full-Stack SDID Standard)**

## **Atomic Phase 094: พัฒนา AI Creator Co-Pilot (เครื่องมือช่วยร่างโครงสร้างคอร์สและสร้าง Auto-Captions ให้วิดีโอ)**

### **1\. Intent, Scope & Token Boundaries (กรอบเป้าหมาย 144-XZ)**

#### **1.1 Phase Metadata**

* **PHASE\_ID:** PHASE-094-AI-COPILOT (AI Creator Co-Pilot & Video Auto-Caption Engine)  
* **PHASE\_NAME:** AI-Driven Course Structure Architect, Automatic Speech-to-Text (STT) Subtitle Generator & Interactive Quiz Engine  
* **BUSINESS\_GOAL:** พัฒนาระบบ AI Co-Pilot สำหรับผู้สร้างเนื้อหา (Creator) เพื่อลดเวลาในการออกแบบโครงสร้างคอร์สเรียน (Course Outline Tree) จากหลายวันเหลือเพียง 30 วินาที และแปลงไฟล์เสียงในวิดีโอคอร์สเรียนเป็น Auto-Captions/Subtitles (VTT/SRT) อัตโนมัติด้วยความแม่นยำสูงกว่า 95% พร้อมรองรับการแปลภาษาอัตโนมัติ (Multi-Language Subtitles) และสร้างแบบทดสอบ (In-Video Quizzes) อัตโนมัติ โดยไม่กระทบ RAM ของ LINE LIFF Webview (\< 30MB) และคงโมเดลต้นทุนค่าจัดเก็บแบบ Zero-Egress Storage ผ่าน Cloudflare R2  
* **MAX\_TOKEN\_BUDGET\_PER\_TASK:** 3000 tokens (Load Balanced SDID Context Boundary)

#### **1.2 Boundary Control (ขอบเขตไฟล์ที่อนุญาต)**

* **IN\_SCOPE\_FILES:**  
  * src/database/prisma/schema.prisma

  * src/backend/modules/ai-copilot/\*\*/\*  
  * src/backend/modules/stream/services/caption-processor.service.ts  
  * src/backend/api/graphql/resolvers/ai-copilot.resolver.ts  
  * src/frontend/app/(dashboard)/creator/co-pilot/\*\*/\*  
  * src/frontend/components/co-pilot/\*\*/\*  
* **READ\_ONLY\_CONTEXT\_FILES:** src/shared/schemas/sdid-contract.ts

* **OUT\_OF\_SCOPE\_STRICT:** การแก้ไข Database Migration ด้วยตนเองโดยไม่ผ่าน Prisma Engine และการปรับแก้รหัสผ่าน Core Auth Engine

#### **1.3 BDD Behavioral Contracts (Gherkin Syntax)**

Gherkin  
Feature: AI Creator Co-Pilot Course Generation & Video Auto-Captioning Pipeline

  Scenario: AI-Driven Course Outline & Interactive Quiz Generation (\< 30 seconds)  
    Given a Creator provides a topic, target audience, and optional document/ebook context  
    When the Creator triggers "Generate Course Outline" in the Co-Pilot Studio  
    Then the NestJS AI Co-Pilot Service streams generated Section, Lesson, and Learning Outcome structures via Server-Sent Events (SSE)  
    And the system automatically generates multiple-choice quizzes with answer keys for each lesson  
    And saves the generated hierarchy as an editable draft in PostgreSQL within 30 seconds

  Scenario: Asynchronous Video Speech-to-Text & Subtitle Synchronization (\< 5% Word Error Rate)  
    Given a Creator uploads an MP4/HLS video stream for a course lesson  
    When the Audio Extraction Worker isolates the audio track and dispatches a job to the Whisper AI Inference Queue  
    Then the AI Speech-to-Text Engine generates WebVTT and SRT caption files with accurate millisecond timestamp alignments  
    And stores the encrypted caption files in Cloudflare R2 Zero-Egress Bucket  
    And the LIFF/Web HLS Video Player renders synchronous multi-language subtitles without memory leaks

### **2\. UX/UI Design System & LINE LIFF / Web Multi-Tenant Layer**

#### **2.1 UI/UX Tokens & Architecture**

* **FRAMEWORK:** Next.js 15 (React 19 Engine) PWA Architecture  
* **DESIGN\_SYSTEM:** Shadcn UI \+ Tailwind CSS v4  
* **CO\_PILOT\_INTERFACE:**  
  * **Visual Outline Tree Editor:** UI Drag-and-Drop สำหรับจัดลำดับบทเรียนและหัวข้อคอร์สเรียน  
  * **Interactive Subtitle Timeline Editor:** หน้าจอแก้ไขซับไตเติลแบบสองช่อง (Video Preview \+ Synchronized Waveform Timestamp Line)  
* **MULTI\_TENANT\_ENGINE:** รองรับ Dynamic Branding CSS Injection (\--primary-color, \--accent-color, \--logo-url) สำหรับ Creator Studio ในแต่ละ Tenant  
* **LIFF/WEB CONSTRAINTS:** ควบคุม RAM ต่ำกว่า 30MB ขณะเล่นวิดีโอพร้อมแสดง Subtitles บน LINE LIFF Webview

#### **2.2 Component State Machine Matrix (5 Mandatory States)**

| State | Trigger / Condition | UI Action & Component Behavior |
| :---- | :---- | :---- |
| **INIT** | โหลด Co-Pilot Studio / Fetch Job | แสดง Dynamic Tenant Skeleton และสตรีมสถานะ AI Engine |
| **IDLE** | พร้อมรับคำสั่ง Prompt / อัปโหลดวิดีโอ | แสดงฟอร์มป้อน Prompt, Drag-Drop Document / Video Upload Dropzone |
| **LOADING** | AI กำลังเจน Outline / Transcribing Audio | แสดง Live Streaming Token Output และ Progress Bar เปอร์เซ็นต์ถอดเสียง |
| **SUCCESS** | AI ประมวลผลสำเร็จ 200 OK | แสดง Tree View โครงสร้างคอร์ส หรือ Subtitle Interactive Timeline |
| **ERROR** | AI Service Timeout / Transcribe Failure | แสดง Toast Alert พร้อม Fallback UI และปุ่ม Retry Syncing Job |

### **3\. Single Source of Truth (SSOT \- Zod & GraphQL Intent Layer)**

#### **3.1 Unified Zod Domain Contract**

TypeScript  
import { z } from 'zod';

export const AiJobStatusEnum \= z.enum(\['QUEUED', 'EXTRACTING\_AUDIO', 'TRANSCRIBING', 'GENERATING\_OUTLINE', 'COMPLETED', 'FAILED'\]);  
export const CaptionLanguageEnum \= z.enum(\['TH', 'EN', 'ZH', 'JA'\]);

export const CourseOutlinePromptSchema \= z.object({  
  topic: z.string().min(3).max(200),  
  targetAudience: z.string().min(3).max(200),  
  difficultyLevel: z.enum(\['BEGINNER', 'INTERMEDIATE', 'ADVANCED'\]),  
  numberOfSections: z.number().int().min(1).max(20).default(5),  
  sourceDocumentUrl: z.string().url().optional(),  
});

export const SubtitleSegmentSchema \= z.object({  
  id: z.string().uuid(),  
  startTimeSec: z.number().nonnegative(),  
  endTimeSec: z.number().nonnegative(),  
  text: z.string(),  
  translatedText: z.record(CaptionLanguageEnum, z.string()).optional(),  
});

export const AutoCaptionJobPayloadSchema \= z.object({  
  jobId: z.string().uuid(),  
  lessonId: z.string().uuid(),  
  status: AiJobStatusEnum,  
  progressPercentage: z.number().min(0).max(100),  
  vttUrl: z.string().url().optional(),  
  srtUrl: z.string().url().optional(),  
  errorMessage: z.string().optional(),  
});

export const GeneratedQuizQuestionSchema \= z.object({  
  question: z.string(),  
  options: z.array(z.string()).min(2).max(5),  
  correctOptionIndex: z.number().int().min(0).max(4),  
  explanation: z.string(),  
});

### **4\. Database & SDID Persistence Layer (PostgreSQL 16\)**

#### **4.1 Prisma Relational Schema Spec (AI Co-Pilot Segment)**

ข้อมูลโค้ด  
// \==========================================  
// AI CREATOR CO-PILOT & AUTO-CAPTION MODULE  
// \==========================================

enum AiJobType {  
  COURSE\_OUTLINE\_GEN  
  VIDEO\_TRANSCRIBE  
  AUTO\_QUIZ\_GEN  
  CAPTION\_TRANSLATION  
}

enum AiJobStatus {  
  QUEUED  
  PROCESSING  
  COMPLETED  
  FAILED  
}

model AiCoPilotJob {  
  id              String      @id @default(uuid())  
  userId          String  
  user            User        @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  jobType         AiJobType  
  status          AiJobStatus @default(QUEUED)  
  progressPercent Int         @default(0)  
  inputPayload    Json  
  resultData      Json?  
  errorMessage    String?  
  createdAt       DateTime    @default(now())  
  updatedAt       DateTime    @updatedAt

  @@index(\[userId\])  
  @@index(\[status\])  
}

model VideoSubtitle {  
  id            String             @id @default(uuid())  
  lessonId      String             @unique  
  lesson        CourseLesson       @relation(fields: \[lessonId\], references: \[id\], onDelete: Cascade)  
  language      String             @default("TH")  
  vttStorageR2  String  
  srtStorageR2  String  
  segments      SubtitleSegment\[\]  
  createdAt     DateTime           @default(now())  
  updatedAt     DateTime           @updatedAt

  @@index(\[lessonId\])  
}

model SubtitleSegment {  
  id              String        @id @default(uuid())  
  videoSubtitleId String  
  videoSubtitle   VideoSubtitle @relation(fields: \[videoSubtitleId\], references: \[id\], onDelete: Cascade)  
  segmentIndex    Int  
  startTimeSec    Float  
  endTimeSec      Float  
  textContent     String  
  translatedJson  Json?         // Key-Value of target languages  
  createdAt       DateTime      @default(now())

  @@index(\[videoSubtitleId, segmentIndex\])  
}

model AiGeneratedQuiz {  
  id          String       @id @default(uuid())  
  lessonId    String  
  lesson      CourseLesson @relation(fields: \[lessonId\], references: \[id\], onDelete: Cascade)  
  question    String  
  optionsJson Json         // Array of options  
  answerIndex Int  
  explanation String  
  createdAt   DateTime     @default(now())

  @@index(\[lessonId\])  
}

### **5\. Backend DDD Microservices (NestJS \+ Fastify Core)**

#### **5.1 Directory Structure Tree**

src/backend/modules/ai-copilot/  
├── ai-copilot.module.ts               \# Co-Pilot DDD Module Entry  
├── controllers/  
│   ├── ai-copilot.controller.ts       \# REST Endpoint for SSE Progress & Webhooks  
│   └── subtitle-download.controller.ts \# Subtitle VTT/SRT Stream Controller  
├── resolvers/  
│   └── ai-copilot.resolver.ts         \# GraphQL Resolvers (generateOutline, transcribeVideo)  
├── services/  
│   ├── outline-generator.service.ts   \# LLM Prompt Orchestration & Course Tree Builder  
│   ├── whisper-transcriber.service.ts \# Speech-to-Text Queue & Audio Chunk Processor  
│   ├── subtitle-formatter.service.ts  \# VTT/SRT File Generator Engine  
│   └── auto-quiz-builder.service.ts   \# Automatic In-Video Quiz Generator  
├── queues/  
│   ├── transcribe.processor.ts        \# BullMQ Worker for Heavy Audio STT Tasks  
│   └── transcribe.queue.ts            \# Queue Producer Interface  
└── adapters/  
    ├── openai-whisper.adapter.ts      \# Whisper AI API / Local Worker Adapter  
    └── llm-orchestrator.adapter.ts    \# Multi-LLM Fallback Engine (Claude/GPT-4)

### **6\. Frontend Pages, Components & LINE Canvas / Co-Pilot Engine**

#### **6.1 Subtitle Timeline Sync & Interactive Co-Pilot Studio Protocol**

TypeScript  
// Memory-Optimized Subtitle Synchronizer & Canvas Overlay Engine  
import React, { useState, useEffect, useRef } from 'react';

interface SubtitleSegment {  
  id: string;  
  startTimeSec: number;  
  endTimeSec: number;  
  textContent: string;  
}

export const VideoSubtitleSyncOverlay: React.FC\<{  
  videoRef: React.RefObject\<HTMLVideoElement\>;  
  subtitles: SubtitleSegment\[\];  
}\> \= ({ videoRef, subtitles }) \=\> {  
  const \[currentText, setCurrentText\] \= useState\<string\>('');  
  const animFrameRef \= useRef\<number | null\>(null);

  useEffect(() \=\> {  
    const updateCaption \= () \=\> {  
      if (videoRef.current) {  
        const currentTime \= videoRef.current.currentTime;  
        const activeSub \= subtitles.find(  
          (s) \=\> currentTime \>= s.startTimeSec && currentTime \<= s.endTimeSec  
        );  
        setCurrentText(activeSub ? activeSub.textContent : '');  
      }  
      animFrameRef.current \= requestAnimationFrame(updateCaption);  
    };

    animFrameRef.current \= requestAnimationFrame(updateCaption);

    return () \=\> {  
      if (animFrameRef.current) {  
        cancelAnimationFrame(animFrameRef.current);  
      }  
    };  
  }, \[videoRef, subtitles\]);

  if (\!currentText) return null;

  return (  
    \<div className="absolute bottom-10 left-1/2 \-translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded-md text-sm md:text-base font-sans font-medium text-center max-w-\[90%\] shadow-lg backdrop-blur-sm pointer-events-none z-30"\>  
      {currentText}  
    \</div\>  
  );  
};

### **7\. Data Pipeline, AI Adaptive Learning & Analytics**

#### **7.1 Real-Time Analytics Event Spec**

* **Caption Accuracy Feedback Event:** บันทึกการแก้ไข Subtitles ของ Creator (User Edit Delta) ส่งกลับไปยัง Event Pipeline เพื่อนำไป Fine-tune AI Prompt & Vocabulary Dictionary เฉพาะสาขาวิชา  
* **Video Engagement vs Subtitle Correlation Tracking:** ส่ง Event trackSubtitleUsage เพื่อวิเคราะห์เปรียบเทียบอัตรา Completion Rate ระหว่างผู้เรียนที่เปิด Subtitles และผู้เรียนที่ไม่เปิด Subtitles  
* **AI Outline Acceptance Rate Analytics:** ติดตามสถิติเปอร์เซ็นต์โครงสร้างคอร์สเรียนที่ Creator นำไปใช้งานจริงโดยไม่มีการแก้ไข เพื่อประเมินประสิทธิภาพของ LLM Prompt

### **8\. Security, DRM & Zero-Egress Storage Optimization**

#### **8.1 Cloudflare R2 & Media Delivery (Zero Egress Fee Rule)**

* **Audio Chunk Extraction Storage:** ไฟล์เสียงสกัดขนาดเล็ก (.aac 64kbps) ถูกส่งไปยัง Cloudflare R2 เพื่อประมวลผล ถอดเสียง เสร็จแล้วลบไฟล์ชั่วคราวทิ้งอัตโนมัติ  
* **Encrypted Subtitle Delivery:** ไฟล์ .vtt และ .srt ทั้งหมดจัดเก็บบน Cloudflare R2 ดึงผ่าน Redis Edge Caching โดยคิดค่าบริการเพียง Storage ค่า Egress Fee เป็น 0 บาท 100%

#### **8.2 DRM & Content Security**

* **Presigned One-Time Subtitle URLs:** การดึงซับไตเติลผ่าน Video Player ต้องใช้ Signed Token ที่มีอายุเพียง 5 นาที และผูกกับ Session ของผู้เรียน ป้องกันการ Scraping สคริปต์คอร์สเรียนไปเผยแพร่  
* **Dynamic Forensic Watermark Alignment:** ซ้อนรหัสลับผู้เรียนลงบนหน้าจอวิดีโอขณะเปิดแสดง Subtitles

### **9\. Token Efficiency & Code Diff Policies**

* **SDID Partial Code Diff Protocol:** กำหนดให้ปรับปรุงโค้ดเฉพาะในส่วน ai-copilot module เท่านั้น โดยแสดง Diff เฉพาะบรรทัดที่มีการเปลี่ยนแปลง เพื่อประหยัด Token สูงสุด 75%  
* **Zero Redundant Code Policy:** ห้ามเขียนฟังก์ชันจำลองหรือ Duplicate Schema ในส่วนที่ระบบหลักทำไว้แล้ว

### **10\. Auto-QA & Autonomous Self-Healing Loop**

* **Performance & Memory Guard:** หากชุดทดสอบพบว่าการเปิดวิดีโอพร้อมแสดง Auto-Captions บน LINE LIFF บริโภค RAM เกิน 30MB หรือระบบ AI Transcribe ใช้เวลาเกิน 3 เท่าของความยาววิดีโอ ระบบ Autonomous Engine ต้อง refactor Memory Management และ Audio Chunking Worker โดยอัตโนมัติ  
* **Subtitle Timestamp Overlap Checker:** ชุดทดสอบตรวจหาและแก้ไขช่วงเวลา Overlap ของ Timestamp ในไฟล์ VTT อัตโนมัติก่อนบันทึกลง Database  
* **TDD Autonomous Loop:** รันการทดสอบ 3 รอบอัตโนมัติเพื่อแก้ไข Edge Cases ก่อนสรุปสถานะ Task

### **11\. The 9 Enterprise Golden Gatekeepers (Phase 094 Edit)**

* \[x\] **Gate 1: SSOT Schema Sync (100%)** — Prisma Schema, Zod Contracts และ GraphQL Resolvers สำหรับ AI Co-Pilot ตรงกันสมบูรณ์  
* \[x\] **Gate 2: Zero Type Violations** — ผ่านการคอมไพล์ TypeScript Compiler ใน Strict Mode 100%  
* \[x\] **Gate 3: UI/UX State Machine** — ครอบคลุมทั้ง 5 States ใน Co-Pilot Studio (INIT, IDLE, LOADING, SUCCESS, ERROR)  
* \[x\] **Gate 4: Security Audit** — ตรวจสอบ Presigned URL และ Rate Limiting บน API Gateway  
* \[x\] **Gate 5: LIFF Canvas & Player Memory Check (CRITICAL)** — ควบคุม RAM ต่ำกว่า 30MB ขณะเล่นวิดีโอพร้อมซับไตเติล  
* \[x\] **Gate 6: Zero-Egress Routing Check** — จัดเก็บไฟล์ VTT/SRT บน Cloudflare R2 ค่า Egress Fee เป็น 0 บาท  
* \[x\] **Gate 7: Database Transaction Guard** — บันทึกโครงสร้างคอร์สและ Subtitle Segments ภายใต้ Prisma Atomic Transaction  
* \[x\] **Gate 8: Data Pipeline Verification** — Event tracking บันทึก Feedback และ Subtitle Analytics ลง Redis เรียลไทม์  
* \[x\] **Gate 9: Automated ADR Generation** — บันทึก Architecture Decision Record สำหรับการเลือกใช้ Speech-to-Text Engine

### **12\. Atomic Task Execution Plan (Phase 094 Scope)**

* **Task 1:** ออกแบบและอัปเดต Prisma Schema (AiCoPilotJob, VideoSubtitle, SubtitleSegment, AiGeneratedQuiz) พร้อม Zod Validation Schemas  
* **Task 2:** สร้าง NestJS AiCoPilotModule และ GraphQL Resolvers สำหรับ Course Outline & Video Caption Intent Layers  
* **Task 3:** พัฒนา Audio Extractor และ BullMQ Queue Worker เชื่อมต่อ AI Speech-to-Text Engine  
* **Task 4:** พัฒนา Subtitle Formatter Service (แปลง Text Chunks เป็น WebVTT / SRT) และจัดเก็บบน Cloudflare R2  
* **Task 5:** สร้าง Co-Pilot Studio Frontend UI (Visual Course Tree Builder) บน Next.js 15 Dashboard  
* **Task 6:** สร้าง Interactive Subtitle Timeline Syncing Editor บน Frontend  
* **Task 7:** รวมระบบ Auto-Quiz Generator สกัดแบบทดสอบจากเนื้อหาวิดีโอโดยอัตโนมัติ  
* **Task 8:** เชื่อมต่อ HLS Video Player พร้อม Dynamic Subtitle Overlay Engine บน LINE LIFF และ Web App  
* **Task 9:** Final Gatekeeper Clearance (อนุมัติผ่าน 9 Golden Gatekeepers ครบ 100 คะแนนเต็มจากสภาวิศวกร)

มาตรฐานการขยายเฟส Atomic Phase 094 ฉบับสมบูรณ์นี้ พร้อมสำหรับการนำไปดำเนินการพัฒนาโปรเจกต์จริงได้ทันทีครับ\!

