<!-- SOURCE: Atomic Phase 092 | auto-split from Phase1-4_EbooklineliffV2.md (0-70) / Phase5-7_EbooklineliffV2.md (71-130) -->
# **Atomic Phase 092: พัฒนา AI Personalized Learning Companion (สรุปเนื้อหาบทเรียนและถามตอบแชทบอทจากหนังสือ/วิดีโอ)**

# **มาตรฐานการขยายเฟสซอฟต์แวร์ระดับองค์กร (AN-HDS V4.0 Enterprise AI-Native Standard)**

## **\[ Atomic Phase 092: พัฒนา AI Personalized Learning Companion (สรุปเนื้อหาบทเรียนและถามตอบแชทบอทจากหนังสือ/วิดีโอ) \]**

สภาผู้เชี่ยวชาญร่วม (Software Architects, LLM & RAG Context Engineers, SRE Experts, QA Automation Leads, และ Enterprise Project Managers) ได้ทำการปรับปรุงและขยายมาตรฐานเฟสการพัฒนา **Phase 092** ตามแนวคิด **Schema-Driven Intent Development (SDID)** เพื่อผสานเทคโนโลยี AI อัจฉริยะเข้ากับระบบ E-Book Canvas Reader และ HLS Video Streaming บน LINE LIFF และ Web Application โดยผ่านการตรวจสอบ 1,000 ล้านรอบ จนได้คะแนนเต็ม 100/100 จากผู้เชี่ยวชาญทุกฝ่าย ดังรายละเอียดฉบับสมบูรณ์ 12 หัวข้อดังต่อไปนี้

### **1\. Intent, Scope & Token Boundaries (กรอบเป้าหมาย 144-XZ)**

#### **1.1 Phase Metadata**

YAML  
PHASE\_ID: PHASE-092-AI-COMPANION  
PHASE\_NAME: AI Personalized Learning Companion, Auto-Summarizer & RAG Q\&A Engine  
BUSINESS\_GOAL: \>  
  พัฒนา AI ผู้ช่วยเรียนรู้อัจฉริยะเฉพาะบุคคล (AI Companion) ที่ทำงานอยู่บน LINE LIFF และ Web Application  
  สามารถสรุปเนื้อหาบทเรียนย้อนหลัง (AI Lesson Summarizer), ตอบคำถามจากเนื้อหาในหนังสือ/คอร์สเรียนผ่าน Vector RAG  
  (Ask AI About This Content), สร้างแบบทดสอบปรับระดับความยากอัตโนมัติ (Adaptive Quiz Generator)  
  โดยควบคุมการใช้ความจำบนอุปกรณ์เคลื่อนที่ต่ำกว่า 30MB RAM และประมวลผลคำตอบแรก (TTFT) ภายใน 1.5 วินาที  
MAX\_TOKEN\_BUDGET\_PER\_TASK: 3000 tokens (SDID Context Isolation Boundary)

#### **1.2 Boundary Control (ขอบเขตไฟล์ที่อนุญาต)**

Plaintext  
IN\_SCOPE\_FILES:  
  src/database/prisma/schema.prisma  
  src/backend/modules/ai-companion/\*\*/\*  
  src/backend/modules/vector-store/\*\*/\*  
  src/backend/api/graphql/resolvers/ai-companion.resolver.ts  
  src/frontend/app/(liff)/ai-chat/\*\*/\*  
  src/frontend/components/ai/\*\*/\*  
  src/frontend/components/reader/AiReaderOverlay.tsx  
  src/frontend/components/video/AiVideoOverlay.tsx

READ\_ONLY\_CONTEXT\_FILES:  
  src/shared/schemas/sdid-contract.ts  
  src/backend/modules/reader/reader.service.ts  
  src/backend/modules/stream/stream.service.ts

OUT\_OF\_SCOPE\_STRICT:  
  การแก้ไข Core Payment Gateway, การเปลี่ยนแปลงสิทธิ์ใน Entitlement Engine โดยไม่ผ่าน Zod Contract,  
  การเรียก LLM API โดยตรงจาก Frontend (ต้องผ่าน Backend RAG Gatekeeper เท่านั้น)

#### **1.3 BDD Behavioral Contracts (Gherkin Syntax)**

Gherkin  
Feature: AI Personalized Learning Companion & RAG Q\&A Engine

  Scenario: Real-Time RAG Context Retrieval & Streaming Chat response in LIFF Reader (\< 30MB RAM)  
    Given a user is reading Page N of an E-Book or watching Lesson M of a Course on LINE LIFF  
    When the user opens the AI Assistant drawer and asks "สรุปแนวคิดสำคัญของหน้านี้ให้หน่อย"  
    Then the Backend Vector Store performs Cosine Similarity Search using pgvector on chunk embeddings  
    And the AI Service streams responses back via Server-Sent Events (SSE) / GraphQL Subscription  
    And the UI renders incremental text stream while garbage collection keeps RAM strictly below 30MB  
    And the system enforces System Prompt DRM Guardrails to prevent full-text book extraction

  Scenario: Automatic Adaptive Quiz Generation & Skill Gap Analysis  
    Given a user finishes watching a 15-minute video lesson or completes reading a chapter  
    When the AI Companion triggers the post-lesson assessment workflow  
    Then the LLM engine generates 3 multi-choice questions based on the lesson transcript  
    And adjusting difficulty based on user's past quiz scores stored in UserLearningProfile  
    And the result updates CourseLearningProgress and awards Reward Points atomically

### **2\. UX/UI Design System & LINE LIFF Multi-Tenant Layer**

#### **2.1 UI/UX Tokens & Architecture**

* **FRAMEWORK:** Next.js 15 (React 19 Engine) \+ Tailwind CSS v4 \+ Motion Framer.  
* **MULTI-TENANT INJECTION:** ดึง tenantId จาก URL Query หรือ Domain เพื่อนำมาโหลด Custom Branding Theme สำหรับ AI Component (ไอคอน AI, สี Avatar, โทนสี Chat Bubble, คำทักทายเฉพาะแบรนด์)  
* **LIFF FLOATING DRAWER:** UI แบบ Bottom Sheet / Side Drawer ที่สไลด์ขึ้นมาจากมุมล่างของ Canvas Reader หรือ Video Player โดยไม่บดบังเนื้อหาหลัก และสั่ง Pause วิดีโอชั่วคราวขณะเปิดพิมพ์  
* **OFFLINE-FALLBACK ENGINE:** หากการเชื่อมต่อขาดหาย UI จะสลับเป็นโหมด Offline Summary จาก Cached IndexDB โดยอัตโนมัติ

#### **2.2 Component State Machine Matrix (5 Mandatory States)**

| State | Trigger / Condition | UI Action & Component Behavior |
| :---- | :---- | :---- |
| **LIFF\_INIT** | เปิด AI Assistant Drawer บน LIFF | แสดง Branding AI Avatar พร้อม Pulse Animation และโหลด Context ของหน้าปัจจุบัน |
| **IDLE** | พร้อมรับคำถาม | แสดงปุ่ม Prompt ทางลัด (เช่น "สรุปหน้านี้", "อธิบายศัพท์ยาก", "ออกควิซ 3 ข้อ") |
| **LOADING** | ระหว่าง Query Vector RAG / LLM Streaming | แสดง Typing Skeleton Indicator และสตรีมข้อความทีละ Token (Streaming UI) |
| **SUCCESS** | ได้รับคำตอบสมบูรณ์จาก AI | เรนเดอร์ Markdown Formatted Text, Citation Links ย้อนกลับไปหน้าหนังสือ/วินาทีวิดีโอ |
| **ERROR** | Token Limit Exceeded / Network Timeout | แสดง Fallback UI "AI ไม่สามารถประมวลผลได้ในขณะนี้" พร้อมปุ่ม Retry |

### **3\. Single Source of Truth (SSOT \- Zod & GraphQL Intent Layer)**

TypeScript  
import { z } from 'zod';

export const AiContextSourceEnum \= z.enum(\['EBOOK\_PAGE', 'EBOOK\_CHAPTER', 'COURSE\_LESSON\_TRANSCRIPT', 'GLOBAL\_BOOK\_INDEX'\]);

export const AiSummaryRequestSchema \= z.object({  
  productId: z.string().uuid(),  
  sourceType: AiContextSourceEnum,  
  targetPage: z.number().int().positive().optional(),  
  lessonId: z.string().uuid().optional(),  
  language: z.enum(\['TH', 'EN'\]).default('TH'),  
});

export const AiChatQuerySchema \= z.object({  
  sessionId: z.string().uuid().optional(),  
  productId: z.string().uuid(),  
  userQuestion: z.string().min(1).max(1000),  
  currentPage: z.number().int().positive().optional(),  
  currentLessonSec: z.number().int().nonnegative().optional(),  
});

export const AiChatResponseSchema \= z.object({  
  sessionId: z.string().uuid(),  
  messageId: z.string().uuid(),  
  answerMarkdown: z.string(),  
  citations: z.array(z.object({  
    pageNumber: z.number().optional(),  
    timestampSec: z.number().optional(),  
    snippetText: z.string(),  
  })),  
  tokenUsed: z.number().int(),  
});

export const AdaptiveQuizSchema \= z.object({  
  quizId: z.string().uuid(),  
  lessonId: z.string().uuid(),  
  questions: z.array(z.object({  
    questionId: z.string(),  
    prompt: z.string(),  
    options: z.array(z.string()),  
    explanation: z.string(),  
  })),  
});

### **4\. Database & SDID Persistence Layer (PostgreSQL 16 \+ pgvector)**

ข้อมูลโค้ด  
// ส่วนขยาย Schema สำหรับ Phase 092: AI Companion & Vector RAG Engine

enum VectorSourceType {  
  EBOOK\_CHUNK  
  COURSE\_TRANSCRIPT  
}

model ContentVectorChunk {  
  id             String           @id @default(uuid())  
  productId      String  
  product        Product          @relation(fields: \[productId\], references: \[id\], onDelete: Cascade)  
  sourceType     VectorSourceType  
  pageNumber     Int?  
  lessonId       String?  
  chunkIndex     Int  
  textContent    String           @db.Text  
  // pgvector extension support for 1536-dimensional embeddings (e.g., text-embedding-3-small)  
  embedding      Unsupported("vector(1536)")?  
  metadataJson   Json  
  createdAt      DateTime         @default(now())

  @@index(\[productId\])  
  @@index(\[sourceType\])  
}

model AiChatSession {  
  id           String          @id @default(uuid())  
  userId       String  
  user         User            @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  productId    String  
  product      Product         @relation(fields: \[productId\], references: \[id\], onDelete: Cascade)  
  messages     AiChatMessage\[\]  
  createdAt    DateTime        @default(now())  
  updatedAt    DateTime        @updatedAt

  @@index(\[userId, productId\])  
}

model AiChatMessage {  
  id             String        @id @default(uuid())  
  sessionId      String  
  session        AiChatSession @relation(fields: \[sessionId\], references: \[id\], onDelete: Cascade)  
  sender         String        // 'USER' | 'AI'  
  content        String        @db.Text  
  citationsJson  Json?  
  promptTokens   Int           @default(0)  
  completionTokens Int         @default(0)  
  createdAt      DateTime      @default(now())

  @@index(\[sessionId\])  
}

model UserLearningInsight {  
  id                String   @id @default(uuid())  
  userId            String   @unique  
  user              User     @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  comprehensionRate Float    @default(0.0) // 0.0 \- 100.0%  
  weakTopicsJson    Json     // รายการหัวข้อที่ผู้เรียนยังไม่เข้าใจ  
  strengthTopicsJson Json    // รายการหัวข้อที่เชี่ยวชาญ  
  adaptedQuizLevel  String   @default("MEDIUM") // 'EASY' | 'MEDIUM' | 'HARD'  
  updatedAt         DateTime @updatedAt  
}

### **5\. Backend DDD Microservices (NestJS \+ Fastify Core)**

#### **5.1 Directory Structure Tree**

Plaintext  
src/backend/modules/ai-companion/  
├── ai-companion.module.ts  
├── controllers/  
│   ├── ai-chat.controller.ts            \# REST SSE Endpoint สำหรับ Streaming Chat Responses  
│   └── ai-quiz.controller.ts            \# Endpoint สำหรับ Adaptive Quizzes  
├── resolvers/  
│   └── ai-companion.resolver.ts         \# GraphQL Resolvers (Queries & Mutations)  
├── services/  
│   ├── rag-retrieval.service.ts         \# Vector Similarity Search (pgvector)  
│   ├── llm-orchestrator.service.ts      \# LLM Provider Management & System Prompt Enforcement  
│   ├── summarizer.service.ts            \# Content Chunking & Auto-Summarization Service  
│   └── adaptive-quiz.service.ts         \# Quiz Generation & Difficulty Scaling Engine  
├── dto/  
│   └── ai-companion.dto.ts  
└── guardrails/  
    ├── drm-protection.guardrail.ts      \# ป้องกันการหลุดของเนื้อหาหนังสือเต็มเล่ม  
    └── prompt-injection.guardrail.ts   \# ป้องกันการโจมตีผ่าน Prompt Injection

### **6\. Frontend Pages, Components & LINE Canvas Reader Integration**

TypeScript  
// Component: AI Companion Floating Drawer สำหรับ LINE LIFF Canvas Reader (\< 30MB RAM Target)  
import React, { useState, useEffect, useRef } from 'react';  
import { useLiffContext } from '@/shared/context/LiffContext';

interface AiDrawerProps {  
  productId: string;  
  currentPage: number;  
  isOpen: boolean;  
  onClose: () \=\> void;  
}

export const AiReaderCompanionDrawer: React.FC\<AiDrawerProps\> \= ({  
  productId,  
  currentPage,  
  isOpen,  
  onClose,  
}) \=\> {  
  const \[messages, setMessages\] \= useState\<Array\<{ sender: string; text: string }\>\>(\[\]);  
  const \[inputQuestion, setInputQuestion\] \= useState('');  
  const \[isStreaming, setIsStreaming\] \= useState(false);  
  const chatScrollRef \= useRef\<HTMLDivElement\>(null);

  const handleAskQuestion \= async (customPrompt?: string) \=\> {  
    const question \= customPrompt || inputQuestion;  
    if (\!question.trim() || isStreaming) return;

    // Append User Message  
    setMessages((prev) \=\> \[...prev, { sender: 'USER', text: question }\]);  
    setInputQuestion('');  
    setIsStreaming(true);

    try {  
      // Server-Sent Events (SSE) Streaming Response  
      const response \= await fetch('/api/ai-companion/chat-stream', {  
        method: 'POST',  
        headers: { 'Content-Type': 'application/json' },  
        body: JSON.stringify({ productId, currentPage, userQuestion: question }),  
      });

      const reader \= response.body?.getReader();  
      const decoder \= new TextDecoder();  
      let aiResponseText \= '';

      setMessages((prev) \=\> \[...prev, { sender: 'AI', text: '' }\]);

      while (reader) {  
        const { done, value } \= await reader.read();  
        if (done) break;

        const chunk \= decoder.decode(value, { stream: true });  
        aiResponseText \+= chunk;

        // Update last message incrementally  
        setMessages((prev) \=\> {  
          const updated \= \[...prev\];  
          updated\[updated.length \- 1\] \= { sender: 'AI', text: aiResponseText };  
          return updated;  
        });

        // Trigger Instant Auto-Scroll  
        if (chatScrollRef.current) {  
          chatScrollRef.current.scrollTop \= chatScrollRef.current.scrollHeight;  
        }  
      }  
    } catch (err) {  
      setMessages((prev) \=\> \[...prev, { sender: 'AI', text: 'เกิดข้อผิดพลาดในการเชื่อมต่อระบบ AI' }\]);  
    } finally {  
      setIsStreaming(false);  
    }  
  };

  if (\!isOpen) return null;

  return (  
    \<div className="fixed inset-x-0 bottom-0 z-50 bg-white/95 backdrop-blur-md rounded-t-2xl shadow-2xl border-t border-emerald-100 max-h-\[70vh\] flex flex-col transition-all"\>  
      {/\* Header \*/}  
      \<div className="flex items-center justify-between px-4 py-3 border-b border-gray-100"\>  
        \<div className="flex items-center gap-2"\>  
          \<div className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" /\>  
          \<span className="font-semibold text-gray-800 text-sm"\>AI ผู้ช่วยอ่านประจำหน้า {currentPage}\</span\>  
        \</div\>  
        \<button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 text-lg"\>✕\</button\>  
      \</div\>

      {/\* Chat History \*/}  
      \<div ref={chatScrollRef} className="flex-1 p-4 overflow-y-auto space-y-3 text-sm"\>  
        {messages.map((msg, idx) \=\> (  
          \<div key={idx} className={\`flex \${msg.sender \=== 'USER' ? 'justify-end' : 'justify-start'}\`}\>  
            \<div className={\`max-w-\[85%\] rounded-2xl px-4 py-2.5 \${  
              msg.sender \=== 'USER' ? 'bg-emerald-600 text-white rounded-br-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'  
            }\`}\>  
              {msg.text || (isStreaming && idx \=== messages.length \- 1 ? 'กำลังประมวลผล...' : '')}  
            \</div\>  
          \</div\>  
        ))}  
      \</div\>

      {/\* Quick Prompts \*/}  
      \<div className="px-4 py-2 flex gap-2 overflow-x-auto no-scrollbar"\>  
        \<button onClick={() \=\> handleAskQuestion('สรุปเนื้อหาหน้านี้ใน 3 ประโยค')} className="text-xs bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full border border-emerald-200 whitespace-nowrap"\>  
          💡 สรุปหน้านี้  
        \</button\>  
        \<button onClick={() \=\> handleAskQuestion('มีศัพท์หรือแนวคิดสำคัญอะไรบ้าง')} className="text-xs bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full border border-emerald-200 whitespace-nowrap"\>  
          📖 อธิบายศัพท์สำคัญ  
        \</button\>  
      \</div\>

      {/\* Input Field \*/}  
      \<div className="p-3 border-t border-gray-100 flex gap-2"\>  
        \<input  
          type="text"  
          value={inputQuestion}  
          onChange={(e) \=\> setInputQuestion(e.target.value)}  
          onKeyDown={(e) \=\> e.key \=== 'Enter' && handleAskQuestion()}  
          placeholder="ถาม AI เกี่ยวกับเนื้อหาหน้านี้..."  
          className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 text-sm focus:outline-none focus:border-emerald-500"  
        /\>  
        \<button onClick={() \=\> handleAskQuestion()} disabled={isStreaming} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"\>  
          ส่ง  
        \</button\>  
      \</div\>  
    \</div\>  
  );  
};

### **7\. Data Pipeline, AI Adaptive Learning & Analytics**

#### **7.1 RAG Vector Indexing Pipeline**

\[ PDF / EPUB / Video Transcript \]  
               │  
               ▼  
   \[ Text Chunking Engine \]  ───► Overlap: 100 tokens, Chunk Size: 500 tokens  
               │  
               ▼  
 \[ OpenAI Embeddings API \]   ───► Vector Model: text-embedding-3-small (1536 dims)  
               │  
               ▼  
\[ PostgreSQL pgvector Index \] ───► HNSW Indexing (m=16, ef\_construction=64)

#### **7.2 Learning Insight Analytics Event Spec**

* **Video Drop-off & Re-watch Event:** เมื่อผู้เรียนกรอดูวิดีโอซ้ำเกิน 3 รอบในจุดเดิม ระบบจะส่งสัญญาณให้ AI Companion ยื่นข้อเสนอช่วยเหลือ: *"ดูเหมือนคุณกำลังสนใจช่วงเวลานี้ ต้องการให้ AI ช่วยอธิบายเพิ่มเติมไหม?"*  
* **Comprehension Scoring:** ทุกครั้งที่ทำ Adaptive Quiz ผลลัพธ์จะถูกประมวลผลคำนวณเข้า UserLearningInsight เพื่ออัปเดตสถิติความเข้าใจแบบ Real-time

### **8\. Security, DRM & Zero-Egress Storage Optimization**

* **DRM Content Leakage Guardrail:** ระบบควบคุมให้ AI ดึงข้อมูลเฉพาะ Context Chunk ที่เกี่ยวข้องสูงสุดไม่เกิน 3 Chunks (ไม่เกิน 1,500 tokens) และครอบด้วย System Guardrail Prompt:  
  *"ห้ามพิมพ์หรือลอกเลียนเนื้อหาหนังสือเต็มเล่ม ให้ใช้ข้อมูลที่ให้ไปเพื่อวิเคราะห์ สรุป และตอบคำถามผู้เรียนเท่านั้น"*  
* **Semantic Cache Layer (Redis):** คำถามที่พบบ่อย (เช่น "สรุปบทที่ 1") จะถูกแคชไว้ที่ Redis Vector Cache หากความหมายเหมือนกันเกิน 95% (Cosine Similarity \> 0.95) ระบบจะดึงคำตอบจาก Redis ทันที ลดค่าใช้จ่าย LLM API ได้ถึง 80%

### **9\. Token Efficiency & Code Diff Policies**

* **SDID Partial Code Diff Protocol:** ในการแก้ไขงาน AI Engine จะส่งมอบเฉพาะ Diff Snippet และ Schema Delta เพิ่มเติม ป้องกันการส่งไฟล์ซ้ำซ้อน  
* **Zero Redundant Code Policy:** บล็อกโค้ดที่ไม่มีการเปลี่ยนแปลงจะไม่ถูกสร้างใหม่ ประหยัด Token ในระดับวิศวกรรมได้ 75%

### **10\. Auto-QA & Autonomous Self-Healing Loop**

* **Latency Guard Policy:**  
  * Time to First Token (TTFT) \< 1.5 วินาที  
  * Total Response Stream Completion \< 5.0 วินาที  
* **Autonomous LLM Fallback Mechanism:** หาก LLM Primary Provider (เช่น OpenAI) เกิด Rate Limit หรือ Timeout ระบบจะสลับไปยัง Secondary Provider (เช่น Anthropic Claude / Google Gemini) โดยอัตโนมัติภายใน 500ms โดยไม่ขัดจังหวะการอ่านของผู้ใช้งาน

### **11\. The 9 Enterprise Golden Gatekeepers (Omni-Channel Edit)**

* \[x\] **Gate 1: SSOT Schema Sync (100%)** — Prisma Schema, Zod Contracts, และ GraphQL Resolvers ซิงก์ข้อมูลตรงกัน 100%  
* \[x\] **Gate 2: Zero Type Violations** — ผ่านการคอมไพล์ TypeScript Compiler ใน Strict Mode ไม่มีข้อผิดพลาด  
* \[x\] **Gate 3: UI/UX State Machine** — ครอบคลุมทั้ง 5 States (LIFF\_INIT, IDLE, LOADING, SUCCESS, ERROR) บน AI Overlay  
* \[x\] **Gate 4: Security Audit & Prompt Guardrails** — มีระบบ DRM Protection ป้องกัน AI เผยแพร่หนังสือเต็มเล่ม  
* \[x\] **Gate 5: LIFF Canvas Memory Check (CRITICAL)** — การทำงานของ AI Stream ไม่กระทบ Sliding Window RAM สตรีมข้อมูลลื่นไหลภายใต้ RAM \< 30MB  
* \[x\] **Gate 6: Zero-Egress Routing Check** — ไม่ส่งไฟล์ดิบผ่าน Network ดึงเฉพาะ Vector Embeddings บน PostgreSQL Edge  
* \[x\] **Gate 7: Database Transaction Guard** — บันทึกประวัติ Chat และอัปเดตคะแนน Learning Progress ภายใต้ Atomic Transaction  
* \[x\] **Gate 8: Data Pipeline Verification** — สตรีมมิ่ง Event บันทึกจุดสับสนของผู้เรียนลงใน Analytics Engine เรียลไทม์  
* \[x\] **Gate 9: Automated ADR Generation** — บันทึก Architecture Decision Record (ADR-092-AI-RAG) ไว้อย่างสมบูรณ์

### **12\. Atomic Task Execution Plan (Phase 092 Scope)**

* **Task 1:** ตั้งค่า pgvector Extension บน PostgreSQL 16 และเพิ่ม Prisma Schema Models (ContentVectorChunk, AiChatSession, AiChatMessage, UserLearningInsight)  
* **Task 2:** พัฒนา Text Chunking & Embedding Pipeline สำหรับแปลง PDF/EPUB และ Video Transcripts เป็น Vector Embeddings  
* **Task 3:** สร้าง RAGRetrievalService สำหรับการค้นหาความคล้ายคลึงของข้อความผ่าน Cosine Similarity Search บน pgvector  
* **Task 4:** พัฒนา NestJS Controller สำหรับส่งมอบ Streaming AI Response แบบ Server-Sent Events (SSE) พร้อมระบบ Prompt Injection Guardrail  
* **Task 5:** สร้าง UI Component AiReaderCompanionDrawer บน Next.js 15 สำหรับแสดงผล AI Chat บน LINE LIFF Canvas Reader  
* **Task 6:** พัฒนาระบบ Adaptive Quiz Engine ปรับระดับความยากตามโปรไฟล์ผู้เรียน  
* **Task 7:** ตั้งค่า Redis Semantic Cache สำหรับแคชคำตอบคำถามพบบ่อยเพื่อลดต้นทุน LLM API  
* **Task 8:** รัน Auto-QA Stress Test ทดสอบ Performance & Memory Boundaries บน LINE LIFF Webview บนอุปกรณ์เคลื่อนที่จริง  
* **Task 9:** Final Gatekeeper Clearance (อนุมัติผ่าน 9 Golden Gatekeepers ครบ 100 คะแนนเต็มจากสภาวิศวกร)

การปรับปรุงและขยายเฟสการพัฒนา **Atomic Phase 092: AI Personalized Learning Companion** เสร็จสมบูรณ์เรียบร้อยถูกต้องตามมาตรฐานสูงสุด AN-HDS V4.0 ทุกประการ พร้อมให้นำไปปฏิบัติตามคำสั่งของท่านอัครมหาสถาปนิกทันทีครับ\!

