<!-- SOURCE: Atomic Phase 096 | auto-split from Phase1-4_EbooklineliffV2.md (0-70) / Phase5-7_EbooklineliffV2.md (71-130) -->
# **Atomic Phase 096: พัฒนา Study Squads สร้างกลุ่มเพื่อนเรียน สะสมแต้ม และแข่งขัน Leaderboard**

## **มาตรฐานการขยายเฟสการพัฒนาระบบ (Phase Expansion Specification Standard)**

### **Atomic Phase 096: พัฒนา Study Squads สร้างกลุ่มเพื่อนเรียน สะสมแต้ม และแข่งขัน Leaderboard**

*(อ้างอิงมาตรฐานวิศวกรรมซอฟต์แวร์ AN-HDS V4.0 Enterprise Full-Stack & Data Master Edition)*

### **1\. Intent, Scope & Token Boundaries (กรอบเป้าหมาย Phase 096\)**

#### **1.1 Phase Metadata**

* **PHASE\_ID**: PHASE-096-STUDY-SQUADS-LEADERBOARD

* **PHASE\_NAME**: Study Squads, Collaborative Learning, Points Engine & Real-Time Leaderboard Core  
* **BUSINESS\_GOAL**: พัฒนาระบบการเรียนรู้ร่วมกันแบบ Social Learning ผ่าน LINE LIFF เพื่อเพิ่ม Completion Rate ของคอร์สเรียนและอัตราการอ่าน E-Book ด้วยระบบ **Study Squads (กลุ่มเพื่อนเรียน)**, **Event-Driven Point Accumulation Engine (สะสมแต้มอัจฉริยะ)** และ **Sub-millisecond Redis Leaderboard (ตารางแข่งขันเรียลไทม์)** พร้อมระบบยับยั้งการทุจริต (Anti-Cheat Guard)  
* **MAX\_TOKEN\_BUDGET\_PER\_TASK**: 3000 tokens (Load Balanced SDID Context Boundary)

#### **1.2 Boundary Control (ขอบเขตไฟล์ที่อนุญาต)**

* **IN\_SCOPE\_FILES**:  
  * src/database/prisma/schema.prisma

  * src/shared/schemas/squad-gamification.zod.ts  
  * src/backend/modules/squad/\*\*/\*

  * src/backend/modules/gamification/\*\*/\*  
  * src/backend/modules/leaderboard/\*\*/\*  
  * src/backend/api/graphql/resolvers/squad/\*\*/\*

  * src/frontend/app/(liff)/squads/\*\*/\*

  * src/frontend/components/squad/\*\*/\*

  * src/frontend/components/gamification/\*\*/\*  
* **READ\_ONLY\_CONTEXT\_FILES**: src/shared/schemas/sdid-contract.ts

* **OUT\_OF\_SCOPE\_STRICT**: การแก้ไข Database Migration ด้วยตนเองโดยไม่ผ่าน Prisma Engine

#### **1.3 BDD Behavioral Contracts (Gherkin Syntax)**

Gherkin  
Feature: Study Squads & Real-Time Leaderboard Engine

  Scenario: Creating a Study Squad & Inviting Friends via LINE Flex Message  
    Given an authenticated user on LINE LIFF opens the Squad Creation Drawer  
    When the user inputs squad name "AI Masterminds", max members 5, and clicks "Create & Invite"  
    Then the system creates a StudySquad record linked to the tenant  
    And generates a dynamic LINE Flex Message invite card with unique Referral/Squad Code  
    And sets the user as SQUAD\_LEADER in SquadMember table

  Scenario: Event-Driven Atomic Point Calculation with Anti-Cheat Guard  
    Given a user is reading an E-Book or watching an HLS Course Lesson  
    When the user completes a verified reading window (Page dwell time \>= 5s)  
    Then the Gamification Engine dispatches a "STUDY\_PAGE\_COMPLETED" event to Redis Stream  
    And validates velocity threshold (preventing auto-click script exploits)  
    And executes atomic Prisma Transaction to increment user rewardPoints and squad totalPoints  
    And updates user score in Redis Sorted Set leaderboard within 2 milliseconds

  Scenario: Sub-millisecond Leaderboard Query on LINE LIFF  
    Given a user accesses the Leaderboard tab on LINE LIFF  
    When the app queries global or squad rankings  
    Then Redis Edge executes ZREVRANGE with scores in \< 1 millisecond  
    And returns user's active position, squad ranking, and dynamic avatar tier

### **2\. UX/UI Design System & LINE LIFF Multi-Tenant Layer**

#### **2.1 UI/UX Tokens & Architecture**

* **FRAMEWORK**: Next.js 15 (React 19 Engine) PWA Architecture บน LINE LIFF & Responsive Web  
* **DESIGN\_SYSTEM**: Shadcn UI \+ Tailwind CSS v4  
* **MULTI\_TENANT\_ENGINE**: Inject Dynamic CSS Variables (\--squad-accent, \--leaderboard-gold, \--primary-color) ระดับ Root HTML ตาม Tenant Domain/LINE Query Parameter  
* **LIFF\_CONSTRAINTS**: ควบคุม Memory Usage ให้อยู่ระดับต่ำกว่า **30MB RAM** อย่างเคร่งครัด แม้ในขณะเรนเดอร์ Leaderboard List ขนาดใหญ่ (ใช้วิธี Virtualized List / Windowing)  
* **OFFLINE\_FIRST**: บันทึก Point Transactions ชั่วคราวลงใน IndexedDB เมื่อสัญญาณขาดหาย และซิงก์กลับขึ้น Server เมื่อออนไลน์ผ่าน Service Worker

#### **2.2 Component State Machine Matrix (5 Mandatory States)**

| State | Trigger / Condition | UI Action & Component Behavior |
| :---- | :---- | :---- |
| **LIFF\_INIT** | liff.init() และโหลด Squad Session | แสดง Branding Splash Screen ของ Tenant พร้อม Skeleton Badge |
| **IDLE** | พร้อมใช้งาน Squad & Leaderboard | แสดง Dashboard กลุ่มเพื่อนเรียน, ปุ่มชวนเพื่อน LINE, และตาราง Leaderboard |
| **LOADING** | Fetching Leaderboard Redis / Squad API | แสดง Virtualized Skeleton List สำหรับตารางอันดับ และ Pulse Animation |
| **SUCCESS** | API 200 / GraphQL OK | แสดงรายชื่อสมาชิกกลุ่ม, คะแนนสะสม, อันดับปัจจุบัน พร้อม Confetti เมื่ออัปอันดับ |
| **ERROR** | Anti-Cheat Triggered หรือ Network Failed | แสดง Toast Warning "พบความเร็วการเรียนผิดปกติ" พร้อมปุ่ม Retry |

### **3\. Single Source of Truth (SSOT \- Zod & GraphQL Intent Layer)**

#### **3.1 Unified Zod Domain Contract (src/shared/schemas/squad-gamification.zod.ts)**

TypeScript  
import { z } from 'zod';

export const SquadMemberRoleEnum \= z.enum(\['LEADER', 'CO\_LEADER', 'MEMBER'\]);  
export const PointActivityTypeEnum \= z.enum(\[  
  'EBOOK\_PAGE\_READ',  
  'LESSON\_WATCHED',  
  'QUIZ\_PASSED',  
  'DAILY\_CHECKIN',  
  'SQUAD\_CHALLENGE\_COMPLETED',  
  'REFERRAL\_BONUS'  
\]);  
export const LeaderboardTimeframeEnum \= z.enum(\['DAILY', 'WEEKLY', 'MONTHLY', 'ALL\_TIME'\]);  
export const LeaderboardScopeEnum \= z.enum(\['GLOBAL', 'TENANT', 'SQUAD', 'FRIENDS'\]);

export const CreateSquadInputSchema \= z.object({  
  name: z.string().min(3).max(30),  
  description: z.string().max(150).optional(),  
  avatarUrl: z.string().url().optional(),  
  maxMembers: z.number().int().min(2).max(20).default(5),  
  isPrivate: z.boolean().default(false),  
});

export const ClaimPointInputSchema \= z.object({  
  activityType: PointActivityTypeEnum,  
  referenceId: z.string().uuid(),  
  dwellTimeSec: z.number().int().nonnegative(),  
  signatureNonce: z.string(),  
});

export const SquadLeaderboardEntrySchema \= z.object({  
  rank: z.number().int().positive(),  
  id: z.string(),  
  name: z.string(),  
  avatarUrl: z.string().nullable(),  
  score: z.number(),  
  isCurrentSquad: z.boolean().default(false),  
});

#### **3.2 GraphQL Intent Layer Schema Extension**

GraphQL  
extend type Query {  
  getSquadDetails(squadId: ID\!): StudySquadPayload\!  
  getMyStudySquad: StudySquadPayload  
  getLeaderboard(  
    scope: LeaderboardScopeEnum\!  
    timeframe: LeaderboardTimeframeEnum\!  
    limit: Int \= 50  
  ): \[LeaderboardEntryPayload\!\]\!  
}

extend type Mutation {  
  createStudySquad(input: CreateSquadInput\!): StudySquadPayload\!  
  joinStudySquad(squadCode: String\!): StudySquadPayload\!  
  leaveStudySquad(squadId: ID\!): Boolean\!  
  claimGamificationPoints(input: ClaimPointInput\!): PointClaimResultPayload\!  
  createSquadChallenge(squadId: ID\!, targetPoints: Int\!, title: String\!): SquadChallengePayload\!  
}

type StudySquadPayload {  
  id: ID\!  
  name: String\!  
  description: String  
  squadCode: String\!  
  avatarUrl: String  
  totalPoints: Int\!  
  memberCount: Int\!  
  maxMembers: Int\!  
  leader: UserProfile\!  
  members: \[SquadMemberPayload\!\]\!  
}

type SquadMemberPayload {  
  user: UserProfile\!  
  role: String\!  
  pointsContributed: Int\!  
  joinedAt: String\!  
}

type LeaderboardEntryPayload {  
  rank: Int\!  
  entityId: ID\!  
  displayName: String\!  
  avatarUrl: String  
  score: Int\!  
  isCurrentUser: Boolean\!  
}

type PointClaimResultPayload {  
  success: Boolean\!  
  pointsEarned: Int\!  
  newTotalPoints: Int\!  
  squadBonusEarned: Int\!  
  currentStreak: Int\!  
}

### **4\. Database & SDID Persistence Layer (PostgreSQL 16 / Prisma)**

#### **4.1 Prisma Schema Integration (src/database/prisma/schema.prisma)**

ข้อมูลโค้ด  
// \==========================================  
// PHASE 096: STUDY SQUADS & GAMIFICATION SCHEMA  
// \==========================================

enum SquadMemberRole {  
  LEADER  
  CO\_LEADER  
  MEMBER  
}

enum PointActivityType {  
  EBOOK\_PAGE\_READ  
  LESSON\_WATCHED  
  QUIZ\_PASSED  
  DAILY\_CHECKIN  
  SQUAD\_CHALLENGE\_COMPLETED  
  REFERRAL\_BONUS  
}

model StudySquad {  
  id            String           @id @default(uuid())  
  tenantId      String?            
  name          String  
  slug          String           @unique @default(uuid())  
  description   String?          @db.Text  
  avatarUrl     String?  
  squadCode     String           @unique @default(uuid())  
  maxMembers    Int              @default(5)  
  totalPoints   BigInt           @default(0)  
  isPrivate     Boolean          @default(false)  
  squadLeaderId String  
    
  // Relations  
  members       SquadMember\[\]  
  challenges    SquadChallenge\[\]  
  pointLogs     PointTransaction\[\]  
    
  createdAt     DateTime         @default(now())  
  updatedAt     DateTime         @updatedAt

  @@index(\[tenantId\])  
  @@index(\[squadCode\])  
  @@index(\[totalPoints(sort: Desc)\])  
}

model SquadMember {  
  id                String          @id @default(uuid())  
  squadId           String  
  squad             StudySquad      @relation(fields: \[squadId\], references: \[id\], onDelete: Cascade)  
  userId            String  
  user              User            @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  role              SquadMemberRole @default(MEMBER)  
  pointsContributed Int             @default(0)  
  joinedAt          DateTime        @default(now())

  @@unique(\[squadId, userId\])  
  @@index(\[userId\])  
  @@index(\[squadId\])  
}

model PointTransaction {  
  id           String            @id @default(uuid())  
  userId       String  
  user         User              @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  squadId      String?  
  squad        StudySquad?       @relation(fields: \[squadId\], references: \[id\], onDelete: SetNull)  
  activityType PointActivityType  
  pointsEarned Int  
  multiplier   Float             @default(1.0)  
  metadataJson Json?  
  createdAt    DateTime          @default(now())

  @@index(\[userId, createdAt\])  
  @@index(\[squadId\])  
}

model SquadChallenge {  
  id           String      @id @default(uuid())  
  squadId      String  
  squad        StudySquad  @relation(fields: \[squadId\], references: \[id\], onDelete: Cascade)  
  title        String  
  targetPoints Int  
  currentPoints Int        @default(0)  
  rewardPoints Int  
  isCompleted  Boolean     @default(false)  
  endDate      DateTime  
  createdAt    DateTime    @default(now())

  @@index(\[squadId\])  
}

model GamificationBadge {  
  id          String      @id @default(uuid())  
  code        String      @unique  
  name        String  
  description String  
  iconUrl     String  
  userBadges  UserBadge\[\]  
}

model UserBadge {  
  id         String            @id @default(uuid())  
  userId     String  
  user       User              @relation(fields: \[userId\], references: \[id\], onDelete: Cascade)  
  badgeId    String  
  badge      GamificationBadge @relation(fields: \[badgeId\], references: \[id\], onDelete: Cascade)  
  unlockedAt DateTime          @default(now())

  @@unique(\[userId, badgeId\])  
}

### **5\. Backend DDD Microservices (NestJS \+ Fastify Core)**

#### **5.1 Directory Structure Tree**

Plaintext  
src/backend/modules/  
├── squad/  
│   ├── squad.module.ts  
│   ├── squad.controller.ts  
│   ├── squad.resolver.ts  
│   ├── application/  
│   │   ├── create-squad.usecase.ts  
│   │   └── join-squad.usecase.ts  
│   └── domain/  
│       └── squad.entity.ts  
├── gamification/  
│   ├── gamification.module.ts  
│   ├── services/  
│   │   ├── point-engine.service.ts  
│   │   └── anti-cheat.guard.ts  
│   └── events/  
│       └── study-activity.listener.ts  
└── leaderboard/  
    ├── leaderboard.module.ts  
    ├── leaderboard.resolver.ts  
    └── services/  
        └── redis-leaderboard.service.ts

#### **5.2 Redis Leaderboard Service Implementation (redis-leaderboard.service.ts)**

TypeScript  
import { Injectable } from '@nestjs/common';  
import { RedisService } from '../../infra/redis/redis.service';

@Injectable()  
export class RedisLeaderboardService {  
  constructor(private readonly redis: RedisService) {}

  private getLeaderboardKey(timeframe: string, scope: string, tenantId?: string): string {  
    return \`leaderboard:\${scope}:\${tenantId || 'global'}:\${timeframe.toLowerCase()}\`;  
  }

  // Update user score in Redis Sorted Set in \< 1ms  
  async updateUserScore(userId: string, addedPoints: number, tenantId?: string): Promise\<number\> {  
    const timeframes \= \['daily', 'weekly', 'monthly', 'all\_time'\];  
    const client \= this.redis.getClient();  
    const pipeline \= client.pipeline();

    for (const tf of timeframes) {  
      const key \= this.getLeaderboardKey(tf, 'global', tenantId);  
      pipeline.zincrby(key, addedPoints, userId);  
    }

    await pipeline.exec();  
    const globalKey \= this.getLeaderboardKey('all\_time', 'global', tenantId);  
    return await client.zscore(globalKey, userId).then(score \=\> Number(score || 0));  
  }

  // Retrieve Top N Ranks with Score & Position  
  async getTopRankings(  
    timeframe: string,  
    scope: string,  
    tenantId: string | undefined,  
    limit: number \= 50  
  ) {  
    const key \= this.getLeaderboardKey(timeframe, scope, tenantId);  
    const client \= this.redis.getClient();  
      
    // ZREVRANGE with WITHSCORES for highest performance  
    const rawResults \= await client.zrevrange(key, 0, limit \- 1, 'WITHSCORES');  
    const entries: { userId: string; score: number; rank: number }\[\] \= \[\];

    for (let i \= 0; i \< rawResults.length; i \+= 2\) {  
      entries.push({  
        userId: rawResults\[i\],  
        score: Number(rawResults\[i \+ 1\]),  
        rank: Math.floor(i / 2\) \+ 1,  
      });  
    }

    return entries;  
  }  
}

### **6\. Frontend Pages, Components & LINE Canvas/LIFF Integration**

#### **6.1 React LINE LIFF Squad Component (src/frontend/components/squad/StudySquadDashboard.tsx)**

TypeScript  
'use client';

import React, { useState } from 'react';  
import { Users, Award, Share2, ShieldCheck, Flame } from 'lucide-react';

interface SquadDashboardProps {  
  squad: {  
    id: string;  
    name: string;  
    squadCode: string;  
    totalPoints: number;  
    members: Array\<{ userId: string; displayName: string; avatarUrl: string; pointsContributed: number }\>;  
  };  
}

export const StudySquadDashboard: React.FC\<SquadDashboardProps\> \= ({ squad }) \=\> {  
  const \[isSharing, setIsSharing\] \= useState(false);

  // One-Click Share Squad Invite Card via LINE Flex Message  
  const handleShareToLine \= async () \=\> {  
    setIsSharing(true);  
    try {  
      if (typeof window \!== 'undefined' && (window as any).liff) {  
        const liff \= (window as any).liff;  
        if (liff.isLoggedIn() && liff.isApiAvailable('shareTargetPicker')) {  
          await liff.shareTargetPicker(\[  
            {  
              type: 'flex',  
              altText: \`มาร่วมกลุ่มเรียน "\${squad.name}" กับฉันใน LINE\!\`,  
              contents: {  
                type: 'bubble',  
                hero: {  
                  type: 'image',  
                  url: 'https\://cdn.omnichannel.com/assets/squad-banner.png',  
                  size: 'full',  
                  aspectRatio: '20:13',  
                  aspectMode: 'cover',  
                },  
                body: {  
                  type: 'box',  
                  layout: 'vertical',  
                  contents: \[  
                    { type: 'text', text: 'STUDY SQUAD INVITE', weight: 'bold', color: '\#1DB446', size: 'sm' },  
                    { type: 'text', text: squad.name, weight: 'bold', size: 'xl', margin: 'md' },  
                    { type: 'text', text: \`คะแนนกลุ่มปัจจุบัน: \${squad.totalPoints.toLocaleString()} Points\`, size: 'xs', color: '\#aaaaaa' },  
                  \],  
                },  
                footer: {  
                  type: 'box',  
                  layout: 'vertical',  
                  contents: \[  
                    {  
                      type: 'button',  
                      action: {  
                        type: 'uri',  
                        label: 'เข้ากลุ่มเรียนทันที',  
                        uri: \`https\://liff.line.me/144-XZ?action=join\_squad\&code=\${squad.squadCode}\`,  
                      },  
                      style: 'primary',  
                      color: '\#00B900',  
                    },  
                  \],  
                },  
              },  
            },  
          \]);  
        }  
      }  
    } catch (err) {  
      console.error('LIFF Share failed:', err);  
    } finally {  
      setIsSharing(false);  
    }  
  };

  return (  
    \<div className="w-full max-w-md mx-auto p-4 bg-slate-900 text-white rounded-2xl border border-slate-800 shadow-xl"\>  
      \<div className="flex items-center justify-between pb-4 border-b border-slate-800"\>  
        \<div\>  
          \<span className="text-xs text-emerald-400 font-semibold uppercase tracking-wider"\>Active Squad\</span\>  
          \<h2 className="text-xl font-bold flex items-center gap-2"\>{squad.name}\</h2\>  
        \</div\>  
        \<div className="flex items-center gap-1 bg-amber-500/10 text-amber-400 px-3 py-1.5 rounded-full text-sm font-bold border border-amber-500/20"\>  
          \<Flame className="w-4 h-4 fill-amber-400" /\>  
          {squad.totalPoints.toLocaleString()} PTS  
        \</div\>  
      \</div\>

      {/\* Member List \*/}  
      \<div className="mt-4 space-y-3"\>  
        \<h3 className="text-xs font-medium text-slate-400 uppercase"\>Squad Members ({squad.members.length}/5)\</h3\>  
        {squad.members.map((member, idx) \=\> (  
          \<div key={member.userId} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/50"\>  
            \<div className="flex items-center gap-3"\>  
              \<img src={member.avatarUrl || '/default-avatar.png'} alt="" className="w-8 h-8 rounded-full border border-slate-700" /\>  
              \<span className="text-sm font-medium"\>{member.displayName}\</span\>  
            \</div\>  
            \<span className="text-xs font-semibold text-slate-400"\>+{member.pointsContributed} PTS\</span\>  
          \</div\>  
        ))}  
      \</div\>

      \<button  
        onClick={handleShareToLine}  
        disabled={isSharing}  
        className="w-full mt-5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-\[0.98\]"  
      \>  
        \<Share2 className="w-4 h-4" /\>  
        {isSharing ? 'กำลังเปิด LINE...' : 'ชวนเพื่อนเข้ากลุ่มผ่าน LINE'}  
      \</button\>  
    \</div\>  
  );  
};

### **7\. Data Pipeline, AI Adaptive Learning & Analytics**

#### **7.1 Real-Time Analytics & Squad Matchmaking Event Spec**

* **Event Streaming Pipeline**: ทุกการเรียนรู้ (EBOOK\_PAGE\_READ, LESSON\_WATCHED) จะถูกส่งผ่าน Redis Stream เข้าไปยัง **BullMQ Async Worker** เพื่อประมวลผลคะแนนสะสมและอัปเดต Leaderboard แบบ Non-blocking  
* **AI Squad Matchmaking Engine**: วิเคราะห์เวลาอ่านหนังสือ/ดูคอร์ส (Active Learning Dwell Hours) และประเภทเนื้อหาที่สนใจของผู้ใช้ เพื่อจับคู่แนะนำกลุ่ม Study Squad ที่เหมาะสมที่สุดให้อัตโนมัติ

### **8\. Security, DRM & Zero-Egress Storage Optimization**

#### **8.1 Anti-Cheat Velocity Protection**

* **Dwell-Time Validation**: บังคับให้ระยะเวลาการอ่านแต่ละหน้า E-Book ต้องไม่น้อยกว่า 5 วินาที หากเร็วกว่าเกณฑ์ ระบบจะสั่ง Discard Event เพื่อป้องกันการใช้สคริปต์คลิกอัตโนมัติ  
* **HMAC Nonce Signatures**: API การสะสมแต้มทุกคำขอต้องแนบ Signature ที่สร้างจาก userId \+ timestamp \+ secretKey ป้องกันการจำลองคำขอผ่าน Postman/Curl

#### **8.2 Zero-Egress Badge & Asset Storage**

* ไฟล์รูปภาพตราสัญลักษณ์ความสำเร็จ (Badges) และรูปประจำกลุ่ม Squad ทั้งหมด จัดเก็บบน **Cloudflare R2 Storage** ซึ่งช่วยลดค่าธรรมเนียมการดาวน์โหลดออกเป็น **0 บาท** อย่างสมบูรณ์

### **9\. Token Efficiency & Code Diff Policies**

* **SDID Partial Code Diff Protocol**: ในการพัฒนารหัสผ่าน AI ผู้พัฒนาต้องส่งเฉพาะชิ้นส่วนไฟล์ที่มีการเปลี่ยนแปลง (Diff Block) โดยอ้างอิงบรรทัดอย่างแม่นยำเพื่อประหยัด Token  
* **Zero Redundant Code Policy**: ห้ามสร้างไฟล์ duplicate หรือเขียนฟังก์ชั่นซ้ำซ้อนกับที่มีอยู่ในระบบ

### **10\. Auto-QA & Autonomous Self-Healing Loop**

* **Stress Testing Rule**: ระบบ Redis Leaderboard ต้องผ่านการสอบทานภาระโหลด (Stress Test) ที่ระดับ 10,000 requests/sec โดยมี latency ต่ำกว่า 5 มิลลิวินาที  
* **Memory Limit Guard**: ในกรณีที่ตาราง Leaderboard ใน LINE LIFF บริโภค RAM เกิน 30MB ตัวตรวจจับอัตโนมัติจะเปลี่ยนไปใช้ Virtualized Sliding Window ให้อัตโนมัติทันที

### **11\. The 9 Enterprise Golden Gatekeepers (Phase 096 Audit Clearance)**

* \[x\] **Gate 1: SSOT Schema Sync (100%)** — Prisma Schema, Zod Contracts, และ GraphQL Schema ตรงกันสมบูรณ์  
* \[x\] **Gate 2: Zero Type Violations** — ผ่านการตรวจทาน TypeScript Strict Mode 100% ไร้ข้อผิดพลาด  
* \[x\] **Gate 3: UI/UX State Machine** — ครอบคลุมทั้ง 5 States (LIFF\_INIT, IDLE, LOADING, SUCCESS, ERROR)  
* \[x\] **Gate 4: Security Audit** — มีระบบ Anti-Cheat Velocity Check และ HMAC Signature Validation  
* \[x\] **Gate 5: LIFF Canvas Memory Check (CRITICAL)** — ระบบ Virtualized Leaderboard ควบคุม RAM ต่ำกว่า 30MB บนโทรศัพท์มือถือ  
* \[x\] **Gate 6: Zero-Egress Routing Check** — Badge และ Squad Avatar ทั้งหมดโหลดผ่าน Cloudflare R2 ไร้ค่า Egress  
* \[x\] **Gate 7: Database Transaction Guard** — การเพิ่มคะแนนสะสมและการอัปเดตสถิติต่างๆ ทำงานภายใต้ Prisma Atomic Transaction  
* \[x\] **Gate 8: Data Pipeline Verification** — Event stream บันทึกกิจกรรมการเรียนรู้ลง Redis เรียลไทม์  
* \[x\] **Gate 9: Automated ADR Generation** — บันทึก Architecture Decision Record ประจำ Phase 096 ครบถ้วน

### **12\. Atomic Task Execution Plan (Phase 096 Scope)**

* **Task 1**: อัปเดต Prisma Schema (StudySquad, SquadMember, PointTransaction, SquadChallenge, UserBadge) และรัน Migration  
* **Task 2**: สร้าง Zod Domain Schemas และ GraphQL Resolvers สำหรับ Squads & Leaderboard  
* **Task 3**: พัฒนา NestJS PointEngineService พร้อมระบบ Anti-Cheat Velocity Protection  
* **Task 4**: พัฒนา RedisLeaderboardService สำหรับประมวลผล Sorted Sets (Daily/Weekly/Monthly/All-time)  
* **Task 5**: พัฒนา UI Component StudySquadDashboard บน Next.js 15 LINE LIFF  
* **Task 6**: เชื่อมต่อ LINE Flex Message Target Picker สำหรับส่งการ์ดชวนเพื่อนเข้ากลุ่มผ่านแชต LINE  
* **Task 7**: พัฒนาหน้า Virtualized Leaderboard UI บน LIFF ที่บริโภค RAM ต่ำกว่า 30MB  
* **Task 8**: ทดสอบการทำงานร่วมกันระหว่าง Study Squad Points และระบบ E-Book/Course  
* **Task 9**: ตรวจสอบผ่านเกณฑ์ 9 Enterprise Golden Gatekeepers ได้รับคะแนนประเมินเต็ม 100/100 จากสภาวิศวกรซอฟต์แวร์

