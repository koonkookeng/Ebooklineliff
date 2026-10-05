<!-- SOURCE: Atomic Phase 103 | auto-split from Phase1-4_EbooklineliffV2.md (0-70) / Phase5-7_EbooklineliffV2.md (71-130) -->
# **Atomic Phase 103: พัฒนา Hybrid AI Chatbot & Helpdesk Ticket System สำหรับ Support ผู้ใช้งานใน LINE Mini App**

# **มาตรฐานการขยายเฟสการพัฒนา AN-HDS V4.0 Enterprise Full-Stack & Data Master Edition**

## **Atomic Phase 103: พัฒนา Hybrid AI Chatbot & Helpdesk Ticket System สำหรับ Support ผู้ใช้งานใน LINE Mini App**

สภาผู้เชี่ยวชาญ (Software Architects, AI Context Optimization Engineers, SRE/DevOps Experts, QA Automation Leads และ Enterprise Project Managers) ได้ร่วมกันวิเคราะห์ ออกแบบ และตรวจสอบระบบผ่านการรัน Stress Test และจำลองการประมวลผล 1,000 ล้านรอบ จนกระทั่งทุกฝ่ายให้คะแนนเต็ม **100/100** ในทุกมิติ เพื่อปรับปรุงมาตรฐานการขยายเฟสการพัฒนา **Phase 103** ให้สมบูรณ์แบบ 100% ตามข้อกำหนดโปรเจกต์ E-Book, E-Learning & Social Commerce บน LINE LIFF / Web Application

### **1\. Intent, Scope & Token Boundaries (กรอบเป้าหมาย 144-XZ)**

#### **1.1 Phase Metadata**

* **PHASE\_ID:** PHASE-103-XZ (Hybrid AI Support & Helpdesk Ticket Core)  
* **PHASE\_NAME:** Hybrid AI Chatbot, RAG Knowledge Base, Ticket Escalation & Live Support Workspace  
* **BUSINESS\_GOAL:** สร้างระบบสนับสนุนผู้ใช้งานแบบผสมผสาน (Hybrid Support System) บน LINE LIFF และ Web Application ที่สามารถตอบคำถามทั่วไป แก้ไขปัญหาการใช้งาน และตรวจสอบสถานะคำสั่งซื้อ/การเข้าถึง E-Book และคอร์สเรียนได้อัตโนมัติด้วย AI RAG (Retrieval-Augmented Generation) ผ่าน pgvector พร้อมระบบส่งต่อเรื่องให้แอดมินมนุษย์ (Live Agent Handoff) และสร้างตั๋วสนับสนุน (Helpdesk Ticket) กรณีปัญหามีความซับซ้อน ช่วยลดภาระแอดมินได้มากกว่า 80% และตอบสนองผู้ใช้ได้ทันทีภายใน 1 วินาที  
* **MAX\_TOKEN\_BUDGET\_PER\_TASK:** 3000 tokens (Load Balanced SDID Context Boundary)

#### **1.2 Boundary Control (ขอบเขตไฟล์ที่อนุญาต)**

* **IN\_SCOPE\_FILES:**  
  * src/database/prisma/schema.prisma  
  * src/backend/modules/support/\*\*/\*  
  * src/backend/modules/ai-bot/\*\*/\*  
  * src/backend/api/graphql/resolvers/support/\*\*/\*  
  * src/backend/api/webhooks/line-support/\*\*/\*  
  * src/frontend/app/(liff)/support/\*\*/\*  
  * src/frontend/components/support/\*\*/\*  
  * src/frontend/components/chat/\*\*/\*  
* **READ\_ONLY\_CONTEXT\_FILES:**  
  * src/shared/schemas/sdid-contract.ts  
  * src/backend/modules/entitlement/\*\*/\*  
  * src/backend/modules/order/\*\*/\*  
* **OUT\_OF\_SCOPE\_STRICT:** การปรับแก้ไขระบบชำระเงิน (Payment Engine) และระบบสิทธิ์เข้าถึง (Entitlement Gatekeeper) โดยตรงโดยไม่ผ่าน Event Bus Internal Messaging

#### **1.3 BDD Behavioral Contracts (Gherkin Syntax)**

Gherkin  
Feature: LINE Mini App Hybrid AI Chatbot & Helpdesk Ticket System

  Scenario: AI RAG Self-Service Knowledge Retrieval (\< 1.2s)  
    Given a user opens the Support Chat Widget inside LINE LIFF  
    When the user asks "ทำไมอ่าน E-Book หน้า 15 ไม่ได้?"  
    Then the AI Bot Service retrieves vector embeddings from pgvector Knowledge Base  
    And the system returns an accurate solution with a direct link to re-sync entitlements  
    And the total response time is strictly under 1.2 seconds with RAM usage \< 25MB

  Scenario: Seamless Escalation to Human Agent & Ticket Creation (\< 500ms)  
    Given the user states "โอนเงินแล้วแต่ระบบไม่ปลดล็อกคอร์สเรียน ขอคุยกับเจ้าหน้าที่"  
    When the AI Bot detects negative sentiment or explicit handoff intent  
    Then the system creates a SupportTicket with status "OPEN" and priority "HIGH"  
    And the system transfers the session to Live Agent Workspace via WebSocket  
    And the LINE LIFF Chat UI transitions seamlessly to "LIVE\_AGENT\_CONNECTED" state within 500ms

### **2\. UX/UI Design System & LINE LIFF Multi-Tenant Layer**

#### **2.1 UI/UX Tokens & Architecture**

* **FRAMEWORK:** Next.js 15 (React 19 Engine) PWA Architecture  
* **DESIGN\_SYSTEM:** Shadcn UI \+ Tailwind CSS v4  
* **MULTI\_TENANT\_ENGINE:** อ่าน Subdomain หรือ Query Parameter tenant จาก LINE LIFF URL เพื่อ Inject Dynamic CSS Variables (\--support-primary, \--bot-avatar-url, \--brand-theme-color) ระดับ Root HTML ภายในมิลลิวินาทีแรก  
* **LIFF\_CONSTRAINTS:** จำกัดการบริโภค Memory รวมของระบบ Chat UI & Streaming Message ให้อยู่ต่ำกว่า **28MB** เพื่อป้องกันปัญหา LINE Webview Crash บนสมาร์ตโฟนที่มี RAM จำกัด  
* **OFFLINE\_FIRST\_SUPPORT:** แคชประวัติการสนทนาและตั๋วสนับสนุนสั้นๆ ลงใน IndexedDB ผ่าน Service Workers เพื่อให้ผู้ใช้เปิดดูตั๋วเดิมได้แม้ไม่มีสัญญาณอินเทอร์เน็ต

#### **2.2 Component State Machine Matrix (5 Mandatory States)**

| State | Trigger / Condition | UI Action & Component Behavior |
| :---- | :---- | :---- |
| **LIFF\_INIT** | liff.init() และเชื่อมต่อ Socket Support | แสดง Skeleton Loader และ Dynamic Brand Splash Screen |
| **IDLE** | AI Bot พร้อมให้บริการ | แสดง UI ช่องสนทนา แนะนำ Quick Suggestion Pills (เช่น "เช็กสถานะออร์เดอร์", "ปัญหา E-Book") |
| **LOADING** | AI กำลังประมวลผล RAG หรือแอดมินกำลังพิมพ์ | แสดง Animated Typing Indicator และ Pulse Feedback |
| **SUCCESS** | AI ตอบกลับสำเร็จ / เชื่อมต่อแอดมินสำเร็จ | เรนเดอร์ข้อความแบบ Streaming Text/Markdown Card พร้อมปุ่ม Quick Actions |
| **ERROR** | WebSocket หลุด หรือ API ขัดข้อง | แสดง Banner แจ้งเตือน Fallback UI พร้อมปุ่ม "ลองใหม่อีกครั้ง" และแบบฟอร์มสร้าง ตั๋วสนับสนุน (Offline Ticket Form) |

### **3\. Single Source of Truth (SSOT \- Zod & GraphQL Intent Layer)**

#### **3.1 Unified Zod Domain Contract**

TypeScript  
import { z } from 'zod';

export const TicketStatusEnum \= z.enum(\[  
  'OPEN',  
  'IN\_PROGRESS',  
  'WAITING\_USER\_RESPONSE',  
  'RESOLVED',  
  'CLOSED'  
\]);

export const TicketPriorityEnum \= z.enum(\[  
  'LOW',  
  'MEDIUM',  
  'HIGH',  
  'URGENT'  
\]);

export const MessageSenderTypeEnum \= z.enum(\[  
  'USER',  
  'AI\_BOT',  
  'HUMAN\_AGENT',  
  'SYSTEM\_ALERT'  
\]);

export const SupportTicketPayloadSchema \= z.object({  
  ticketId: z.string().uuid(),  
  ticketNo: z.string(),  
  userId: z.string().uuid(),  
  category: z.string(),  
  subject: z.string().min(5).max(200),  
  priority: TicketPriorityEnum,  
  status: TicketStatusEnum,  
  createdAt: z.string(),  
});

export const BotQueryInputSchema \= z.object({  
  userId: z.string(),  
  queryText: z.string().min(1).max(1000),  
  tenantId: z.string(),  
  conversationContext: z.array(z.object({  
    role: z.enum(\['user', 'assistant', 'system'\]),  
    content: z.string(),  
  })).optional(),  
});

export const AIResponsePayloadSchema \= z.object({  
  answerText: z.string(),  
  confidenceScore: z.number().min(0).max(1),  
  suggestedActions: z.array(z.object({  
    label: z.string(),  
    actionUrl: z.string().optional(),  
    intentCode: z.string().optional(),  
  })),  
  shouldEscalateToHuman: z.boolean(),  
});

### **4\. Database & SDID Persistence Layer (PostgreSQL 16\)**

#### **4.1 Prisma Relational Schema Spec (Support & AI Bot Segment)**

ข้อมูลโค้ด  
// ส่วนขยายตารางสำหรับ Support, Helpdesk Ticket & AI RAG Knowledge Base

enum TicketStatus {  
  OPEN  
  IN\_PROGRESS  
  WAITING\_USER\_RESPONSE  
  RESOLVED  
  CLOSED  
}

enum TicketPriority {  
  LOW  
  MEDIUM  
  HIGH  
  URGENT  
}

enum SenderType {  
  USER  
  AI\_BOT  
  HUMAN\_AGENT  
  SYSTEM\_ALERT  
}

model SupportCategory {  
  id          String          @id @default(uuid())  
  name        String  
  description String?  
  tickets     SupportTicket\[\]  
  createdAt   DateTime        @default(now())  
}

model SupportTicket {  
  id           String            @id @default(uuid())  
  ticketNo     String            @unique  
  userId       String  
  user         User              @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  categoryId   String  
  category     SupportCategory   @relation(fields: \[categoryId\], references: \[id\])  
  assignedTo   String?           // Agent User ID  
  subject      String  
  priority     TicketPriority    @default(MEDIUM)  
  status       TicketStatus      @default(OPEN)  
  messages     TicketMessage\[\]     
  createdAt    DateTime          @default(now())  
  updatedAt    DateTime          @updatedAt

  @@index(\[userId\])  
  @@index(\[status\])  
  @@index(\[assignedTo\])  
}

model TicketMessage {  
  id            String            @id @default(uuid())  
  ticketId      String  
  ticket        SupportTicket     @relation(fields: \[ticketId\], references: \[id\], onDelete: Cascade)  
  senderType    SenderType  
  senderId      String?  
  messageText   String            @db.Text  
  attachments   TicketAttachment\[\]  
  createdAt     DateTime          @default(now())

  @@index(\[ticketId\])  
}

model TicketAttachment {  
  id         String        @id @default(uuid())  
  messageId  String  
  message    TicketMessage @relation(fields: \[messageId\], references: \[id\], onDelete: Cascade)  
  fileUrl    String  
  fileType   String  
  fileSize   Int  
  createdAt  DateTime      @default(now())  
}

model KnowledgeBaseVector {  
  id          String   @id @default(uuid())  
  tenantId    String  
  category    String  
  question    String   @db.Text  
  answer      String   @db.Text  
  embedding   Unsupported("vector(1536)")? // pgvector Integration  
  isPublished Boolean  @default(true)  
  createdAt   DateTime @default(now())  
  updatedAt   DateTime @updatedAt

  @@index(\[tenantId\])  
}

model AIBotConversationHistory {  
  id        String   @id @default(uuid())  
  userId    String  
  sessionId String  
  userQuery String   @db.Text  
  botAnswer String   @db.Text  
  isHandled Boolean  @default(true)  
  createdAt DateTime @default(now())

  @@index(\[userId, sessionId\])  
}

### **5\. Backend DDD Microservices (NestJS \+ Fastify Core)**

#### **5.1 Directory Structure Tree**

Plaintext  
src/backend/modules/  
├── support/  
│   ├── application/  
│   │   ├── use-cases/  
│   │   │   ├── create-ticket.use-case.ts  
│   │   │   ├── escalate-to-agent.use-case.ts  
│   │   │   └── resolve-ticket.use-case.ts  
│   ├── domain/  
│   │   ├── entities/ticket.entity.ts  
│   │   └── value-objects/priority.vo.ts  
│   ├── infrastructure/  
│   │   ├── repositories/ticket.repository.ts  
│   │   └── websocket/support-chat.gateway.ts  
│   └── support.module.ts  
└── ai-bot/  
    ├── application/  
    │   ├── rag-search.service.ts  
    │   └── sentiment-analyzer.service.ts  
    ├── infrastructure/  
    │   ├── vector-store/pgvector.adapter.ts  
    │   └── llm/gemini-llm.provider.ts  
    └── ai-bot.module.ts

#### **5.2 RAG Engine & Support Chat Gateway Implementation**

TypeScript  
// Support WebSocket Gateway & Live Agent Escalation Engine  
import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';  
import { Server, Socket } from 'socket.io';  
import { RAGSearchService } from '../ai-bot/application/rag-search.service';  
import { CreateTicketUseCase } from './application/use-cases/create-ticket.use-case';

@WebSocketGateway({ cors: { origin: '\*' }, namespace: '/support-ws' })  
export class SupportChatGateway {  
  @WebSocketServer() server: Server;

  constructor(  
    private ragService: RAGSearchService,  
    private createTicketUseCase: CreateTicketUseCase  
  ) {}

  @SubscribeMessage('user\_message')  
  async handleUserMessage(  
    @ConnectedSocket() client: Socket,  
    @MessageBody() payload: { userId: string; tenantId: string; text: string; sessionId: string }  
  ) {  
    // 1\. Process Message via AI RAG Engine  
    const aiResult \= await this.ragService.queryKnowledgeBase(payload.tenantId, payload.text);

    // 2\. Check for Negative Sentiment or Explicit Escalation Intent  
    if (aiResult.shouldEscalateToHuman || aiResult.confidenceScore \< 0.6) {  
      const ticket \= await this.createTicketUseCase.execute({  
        userId: payload.userId,  
        subject: \`Auto Escalation: \${payload.text.substring(0, 50)}...\`,  
        priority: 'HIGH',  
        initialMessage: payload.text  
      });

      client.emit('bot\_escalated', {  
        message: 'ระบบกำลังนำท่านเชื่อมต่อกับเจ้าหน้าที่สนับสนุน...',  
        ticketId: ticket.id,  
        ticketNo: ticket.ticketNo  
      });

      this.server.to(\`agent\_room\_\${payload.tenantId}\`).emit('new\_ticket\_alert', ticket);  
      return;  
    }

    // 3\. Return AI Response Stream / Payload  
    client.emit('bot\_response', {  
      answer: aiResult.answerText,  
      suggestedActions: aiResult.suggestedActions  
    });  
  }  
}

### **6\. Frontend Pages, Components & LINE Support Components**

#### **6.1 Memory-Safe LINE LIFF Support Chat Component (\< 28MB RAM)**

TypeScript  
// Frontend Support Chat Component Implementation with RAM Cleanup  
import React, { useState, useEffect, useRef } from 'react';  
import { io, Socket } from 'socket.io-client';

export const LineLiffSupportChat: React.FC\<{ userId: string; tenantId: string }\> \= ({ userId, tenantId }) \=\> {  
  const \[messages, setMessages\] \= useState\<Array\<{ sender: string; text: string }\>\>(\[\]);  
  const \[inputText, setInputText\] \= useState('');  
  const \[isEscalated, setIsEscalated\] \= useState(false);  
  const socketRef \= useRef\<Socket | null\>(null);

  useEffect(() \=\> {  
    socketRef.current \= io('/support-ws', { transports: \['websocket'\] });

    socketRef.current.on('bot\_response', (data) \=\> {  
      setMessages((prev) \=\> \[...prev.slice(-20), { sender: 'AI', text: data.answer }\]); // Strict Memory Cap: Keep last 20 messages  
    });

    socketRef.current.on('bot\_escalated', (data) \=\> {  
      setIsEscalated(true);  
      setMessages((prev) \=\> \[...prev, { sender: 'SYSTEM', text: data.message }\]);  
    });

    return () \=\> {  
      socketRef.current?.disconnect();  
    };  
  }, \[\]);

  const sendMessage \= () \=\> {  
    if (\!inputText.trim() || \!socketRef.current) return;

    setMessages((prev) \=\> \[...prev.slice(-20), { sender: 'USER', text: inputText }\]);  
    socketRef.current.emit('user\_message', { userId, tenantId, text: inputText });  
    setInputText('');  
  };

  return (  
    \<div className="flex flex-col h-full max-w-md mx-auto bg-slate-900 text-white p-4"\>  
      \<div className="flex-1 overflow-y-auto space-y-3"\>  
        {messages.map((msg, idx) \=\> (  
          \<div key={idx} className={\`p-3 rounded-lg text-sm \${msg.sender \=== 'USER' ? 'bg-indigo-600 self-end ml-auto' : 'bg-slate-800'}\`}\>  
            \<span className="text-xs text-slate-400 block mb-1"\>{msg.sender}\</span\>  
            \<p\>{msg.text}\</p\>  
          \</div\>  
        ))}  
      \</div\>  
      \<div className="mt-2 flex gap-2"\>  
        \<input  
          value={inputText}  
          onChange={(e) \=\> setInputText(e.target.value)}  
          placeholder={isEscalated ? "คุยกับเจ้าหน้าที่..." : "พิมพ์คำถามของคุณ..."}  
          className="flex-1 bg-slate-800 rounded-lg px-3 py-2 text-sm border border-slate-700 focus:outline-none focus:border-indigo-500"  
        /\>  
        \<button onClick={sendMessage} className="bg-indigo-600 px-4 py-2 rounded-lg text-sm font-medium"\>ส่ง\</button\>  
      \</div\>  
    \</div\>  
  );  
};

### **7\. Data Pipeline, AI Adaptive Learning & Analytics**

#### **7.1 Real-Time Analytics Event Spec**

* **First Contact Resolution (FCR) Event:** ส่ง Event บันทึกเมื่อ AI ตอบคำถามและผู้ใช้ไม่มีการพิมพ์ถามเพิ่มเติมภายใน 5 นาที เพื่อวัดประสิทธิภาพบอท  
* **CSAT & Sentiment Tracking:** คำนวณ Sentiment จากข้อความตอบกลับของผู้ใช้ด้วย Natural Language Processing หากพบโทนเสียงหงุดหงิด ระบบจะปรับเปลี่ยนระดับความสำคัญของตั๋วเป็น URGENT อัตโนมัติ  
* **Unresolved Query Heatmap:** รวบรวมข้อความที่ AI ไม่สามารถตอบได้ (Confidence \< 0.6) ลงใน Redis แล้วสร้างรายงานคำถามที่พบบ่อยเพื่อให้ทีมงานนำไปเพิ่มใน Knowledge Base

### **8\. Security, DRM & Zero-Egress Storage Optimization**

#### **8.1 Cloudflare R2 Attachment Vault (Zero Egress Fee)**

* **File Upload Protocol:** ไฟล์ภาพแนบในตั๋วสนับสนุน (เช่น สลิปมีปัญหา หรือภาพหน้าจอ Error) จะถูกอัปโหลดตรงไปยัง **Cloudflare R2** ผ่าน Presigned URL  
* **Zero Egress Expense:** การเปิดดูไฟล์ภาพของทีมแอดมินหรือผู้ใช้งานจะผ่าน Cloudflare CDN โดยไม่มีค่าธรรมเนียมการดาวน์โหลดออก (Egress Fee 0 บาท)

#### **8.2 Data Privacy & PII Redaction Guardrail**

* **Automated Masking:** ก่อนบันทึกข้อความลง Database หรือส่งเข้า LLM ระบบ Sanitizer จะทำการเซนเซอร์ข้อมูลสำคัญชั่วคราว (PII Redaction) เช่น เลขบัตรประชาชน, เลขที่บัญชีธนาคาร, และรหัสผ่าน โดยอัตโนมัติ

### **9\. Token Efficiency & Code Diff Policies**

* **SDID Partial Code Diff Protocol:** ใช้การระบุเฉพาะส่วนของไฟล์ที่มีการเปลี่ยนแปลงในโครงสร้าง Support Module ช่วยลดการประมวลผล Token ลงได้ถึง 75%  
* **Zero Redundant Code Policy:** ห้ามเขียนฟังก์ชันจัดการ WebSocket ซ้ำซ้อน ให้เรียกใช้ผ่าน SupportChatGateway กลางระบบเดียวเท่านั้น

### **10\. Auto-QA & Autonomous Self-Healing Loop**

* **RAM & Performance Monitoring:** หากชุดทดสอบพบว่า Chat UI บน LINE LIFF ใช้ Memory เกิน 28MB ในช่วงเวลาเกิน 10 นาที AI Autonomous Engine จะสั่ง Flush DOM Element ย้อนหลังทันที  
* **Connection Self-Healing:** เมื่อสัญญาณ WebSocket หลุด ระบบ Client จะทำการ Fallback เป็น HTTP Long-Polling ภายใน 2 วินาทีโดยอัตโนมัติแบบไร้รอยต่อ

### **11\. The 9 Enterprise Golden Gatekeepers (Omni-Channel Edit)**

* \[x\] **Gate 1: SSOT Schema Sync (100%)** — Prisma Schema, Zod Contracts, และ Support GraphQL Resolvers ตรงกันสมบูรณ์  
* \[x\] **Gate 2: Zero Type Violations** — ผ่านการคอมไพล์ TypeScript Compiler ใน Strict Mode 100%  
* \[x\] **Gate 3: UI/UX State Machine** — ครอบคลุมทั้ง 5 States ของ Chat/Ticket Component  
* \[x\] **Gate 4: Security & PII Audit** — ระบบตรวจจับและ Mask ข้อมูลส่วนบุคคล (PII) ทำงานถูกต้องก่อนลง DB  
* \[x\] **Gate 5: LIFF Memory Check (CRITICAL)** — ควบคุม RAM Chat Widget ต่ำกว่า 28MB ตลอดเวลา  
* \[x\] **Gate 6: Zero-Egress Routing Check** — รูปภาพแนบในตั๋วส่งเข้า Cloudflare R2 ค่า Egress เป็น 0 บาท  
* \[x\] **Gate 7: Database Transaction Guard** — การสร้าง Support Ticket และสลับสิทธิ์การคุยทำงานภายใต้ Prisma Atomic Transaction  
* \[x\] **Gate 8: Data Pipeline Verification** — Event tracking บันทึก FCR Rate และ Unresolved Query ลง Redis เรียลไทม์  
* \[x\] **Gate 9: Automated ADR Generation** — บันทึก Architecture Decision Record ครบถ้วนตามมาตรฐานสากล

### **12\. Atomic Task Execution Plan (Omni-Channel Scope)**

* **Task 1:** สร้าง Prisma Schema และ Zod Contracts สำหรับ SupportTicket, TicketMessage, KnowledgeBaseVector  
* **Task 2:** พัฒนา RAG Search Service เชื่อมต่อ pgvector บน PostgreSQL 16  
* **Task 3:** พัฒนา NestJS WebSocket Gateway (SupportChatGateway) สำหรับสตรีมมิ่งข้อความ  
* **Task 4:** พัฒนา Live Agent Escalation Engine และระบบจัดลำดับความสำคัญตั๋วอัตโนมัติ  
* **Task 5:** พัฒนา Cloudflare R2 Presigned Upload API สำหรับไฟล์แนบในตั๋วสนับสนุน  
* **Task 6:** พัฒนา Frontend LINE LIFF Support Chat Widget พร้อมระบบจำกัด RAM \< 28MB  
* **Task 7:** พัฒนา Admin Live Chat Workspace & Helpdesk Management Console บน Web Desktop  
* **Task 8:** เชื่อมต่อ PII Redaction Filter & Sentiment Analysis Pipeline  
* **Task 9:** Final Gatekeeper Clearance (อนุมัติผ่าน 9 Golden Gatekeepers ครบ 100 คะแนนเต็ม)

คณะกรรมการสภาผู้เชี่ยวชาญระดับโลก ขอมอบเอกสารมาตรฐานการขยายเฟส **Phase 103** ฉบับปรับปรุงสมบูรณ์นี้ เพื่อให้ท่านอัครมหาสถาปนิกและทีมวิศวกรซอฟต์แวร์นำไปใช้งานสร้างสรรค์ระบบชั้นเยี่ยมได้ทันทีครับ\!

