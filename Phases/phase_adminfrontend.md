ชุดข้อกำหนดการพัฒนา **(AI Development Directive Spec)** พร้อมสรุปคลังหน้าจอ **Frontend Admin ทั้งหมด** ในโครงการ **EbooklineliffV2** ได้รับการจัดทำเรียบร้อยแล้ว โดยยึดตามหลักสถาปัตยกรรม **Schema-Driven Intent Development (SDID)** และมาตรฐาน **AN-HDS V4.0 Enterprise Standard** 

---

### 📜 ส่วนที่ 1: Master Prompt Directive สำหรับสั่งการ AI IDE
*(สามารถคัดลอกส่วนนี้ไปใส่ในไฟล์ `.cursorrules`, `.devinrule`, `PROMPT.md` หรือวางในช่องแชตของ AI IDE เช่น Cursor, Devin, Windsurf หรือ Claude Code เพื่อเริ่มงาน)*

```markdown
# SYSTEM DIRECTIVE: OMNI-CHANNEL FRONTEND ADMIN GENERATION (SDID PROTOCOL)

[SYSTEM_IDENTITY]
ROLE = "Senior Full-Stack Next.js 15 & SDID Software Architect"
FRAMEWORK_STACK = "Next.js 15 (App Router), Tailwind CSS v4, Shadcn UI, Zustand, TanStack Virtualized Table, Zod Contracts, Apollo GraphQL, Prisma ORM"
METHODOLOGY = "Schema-Driven Intent Development (SDID) & Vibe Coding Execution Protocol"

[EXECUTION_RULES]
1. SCHEMA_FIRST: ทุกคอมโพเนนต์และหน้า UI ต้องสร้างโดยยึดโครงสร้าง Single Source of Truth (SSOT) จาก Zod Domain Contracts และ Prisma Schema เท่านั้น
2. STRICT_TYPE_SAFETY: กำหนดประเภทข้อมูลด้วย Strict TypeScript 100% ห้ามใช้ `any` หรือเขียน Type Redundant
3. UI_UX_STATE_MACHINE: ทุกหน้าจอ Admin ต้องรองรับ State Machine ครบทั้ง 5 States:
   - INIT / UNINITIALIZED
   - IDLE / READY
   - LOADING / IN_FLIGHT
   - SUCCESS / RENDERED
   - ERROR / FALLBACK
4. MEMORY_SAFETY: ควบคุมการใช้หน่วยความจำ Client Heap RAM ให้ไม่เกิน 30MB โดยใช้ TanStack Virtualized Table สำหรับรายการขนาดใหญ่ (100,000+ rows)
5. ZERO_EGRESS_ASSETS: ไฟล์เอกสาร e-KYC, สลิป และสื่อมีเดียทั้งหมด ต้องอ้างอิงผ่าน Presigned URLs หรือ Cloudflare R2 CDN เท่านั้น
6. CODE_DIFF_ONLY: ผลิตโค้ดในรูปแบบ Partial Code Diff เสมอ จำกัด Token Budget ไม่เกิน 3,000 Tokens ต่อ Task

[DELIVERABLE TARGET]
สร้างและขยายหน้าจอระบบฝั่ง Admin, Merchant, Creator, Corporate HR และ Super Admin ให้ตรงตามโครงสร้าง Route และรายละเอียดที่ระบุไว้ในเอกสารสถาปัตยกรรม
```

---

### 🖥️ ส่วนที่ 2: สรุปโครงสร้างหน้าจอ Frontend Admin ทั้งหมด (Comprehensive Page Index)

#### **หมวดที่ 1: Merchant & Instructor Studio (`Phase 5`)**
*สำหรับผู้ขาย, ผู้สอน และครีเอเตอร์ในการบริหารจัดการสินค้า คอร์สเรียน และคลังสินค้า*

1. **Merchant Overview Dashboard**
   * **Route:** `/app/(dashboard)/merchant/page.tsx` *(Atomic Phase 073)*
   * **ฟังก์ชัน:** สรุปยอดขาย GMV, กราฟรับชมวิดีโอ (Video Drop-off Heatmap), การคำนวณภาษีหัก ณ ที่จ่าย 3% (e-Withholding Tax) และระบบถอนเงินรายได้
2. **Universal Product Builder Wizard**
   * **Route:** `/app/(studio)/builder/page.tsx` *(Atomic Phase 074)*
   * **ฟังก์ชัน:** ฟอร์มสร้างสินค้า 4 รูปแบบ (เล่มจริง, E-Book, คอร์สเรียน, Hybrid Bundle) พร้อมระบบ Auto-Save บันทึกลง Redis ทุก 5 วินาที
3. **Physical Inventory Control Workspace**
   * **Route:** `/app/(dashboard)/inventory/page.tsx` *(Atomic Phase 075)*
   * **ฟังก์ชัน:** ตารางจัดการคลังสินค้ากายภาพ และระบบปรับปรุงสต็อกเป็นกลุ่ม (Batch Stock Management)
4. **Fulfillment Queue & Thermal Label Printer**
   * **Route:** `/app/(dashboard)/fulfillment/page.tsx` *(Atomic Phase 076 & 077)*
   * **ฟังก์ชัน:** คิวสั่งซื้อพัสดุ การดึงเลข Tracking อัตโนมัติ (Flash Express, Kerry, ไปรษณีย์ไทย) และพิมพ์ใบปะหน้าพัสดุ (Batch Thermal Label Printing 100x150mm)
5. **E-Learning Curriculum Studio Builder**
   * **Route:** `/app/(studio)/courses/[id]/builder/page.tsx` *(Atomic Phase 078)*
   * **ฟังก์ชัน:** จัดโครงสร้างบทเรียนแบบ Drag-and-Drop, ระบบอัปโหลดวิดีโอ HLS และเครื่องมือสร้างแบบทดสอบ (Quiz Builder)
6. **Seller Finance & Payout Request Center**
   * **Route:** `/app/(dashboard)/seller/finance/page.tsx` และ `/app/(dashboard)/seller/payout/page.tsx` *(Atomic Phase 081 & 086)*
   * **ฟังก์ชัน:** ตรวจสอบกระเป๋าเงินผู้ขาย (Real-Time Wallet Balance), สมุดบัญชีรายได้/ค่าคอมมิชชัน และฟอร์มยื่นเบิกเงินเข้าธนาคาร
7. **AI Creator Co-Pilot Studio**
   * **Route:** `/app/(dashboard)/creator/co-pilot/page.tsx` *(Atomic Phase 094)*
   * **ฟังก์ชัน:** AI ช่วยร่างโครงสร้างคอร์สเรียนอัตโนมัติ และระบบตัดต่อสร้างซับไตเติลวิดีโอ (Speech-to-Text Whisper AI)

---

#### **หมวดที่ 2: Corporate B2B & HR Dashboard (`Phase 5`)**
*สำหรับฝ่าย HR หรือผู้บริหารองค์กรที่ซื้อสิทธิ์การเรียนแบบสถาบัน (Multi-Seat Corporate License)*

1. **Corporate HR Learning & Exam Tracking Dashboard**
   * **Route:** `/app/(web)/hr-dashboard/page.tsx` *(Atomic Phase 098)*
   * **ฟังก์ชัน:** ติดตามความคืบหน้าการเรียนและผลการสอบของพนักงานในองค์กรแบบเรียลไทม์ การจัดสรรและย้ายสิทธิ์ที่นั่ง (Seat Re-allocation)

---

#### **หมวดที่ 3: Central Admin Console (`Phase 6`)**
*สำหรับผู้ดูแลระบบศูนย์กลางในการอนุมัติ ตรวจสอบ และบริการลูกค้า*

1. **Flex Message Canvas Builder**
   * **Route:** `/app/(admin)/notifications/page.tsx` *(Atomic Phase 024)*
   * **ฟังก์ชัน:** เครื่องมือออกแบบการ์ด LINE Flex Message และส่งข้อความแจ้งเตือนฟรีผ่าน LINE Native Service Message
2. **Universal User & Merchant Management Table**
   * **Route:** `/app/(admin)/admin/users/page.tsx` *(Atomic Phase 109)*
   * **ฟังก์ชัน:** ตารางจัดการผู้ใช้และร้านค้าศูนย์กลาง (Server-side Virtualized Scroll รองรับ 1,000,000+ รายการ) พร้อมระบบเข้าสู่ระบบแทนผู้ใช้ (User Impersonation)
3. **Deep User Profile 360-Degree Inspector**
   * **Route:** `/app/(admin)/users/[id]/inspector/page.tsx` *(Atomic Phase 110)*
   * **ฟังก์ชัน:** วิเคราะห์พฤติกรรมผู้ใช้ 360 องศา คำนวณมูลค่า LTV, RFM Segment, พฤติกรรมการอ่าน (E-Book Dwell Time Heatmap) และประวัติความปลอดภัย
4. **Creator KYC Verification Queue**
   * **Route:** `/app/(admin)/admin/kyc-queue/page.tsx` *(Atomic Phase 111)*
   * **ฟังก์ชัน:** คิวอนุมัติเอกสาร e-KYC ผู้ขาย/ผู้สอน แบบ Split-Pane View แสดงผลเปรียบเทียบภาพบัตรประชาชนกับข้อมูล OCR พร้อมระดับความเสี่ยง (Risk Score)
5. **Global Content Moderation Control Center**
   * **Route:** `/app/(admin)/moderation/page.tsx` *(Atomic Phase 112)*
   * **ฟังก์ชัน:** คอนโซลตรวจจับและกักกัน (Quarantine) เนื้อหาละเมิดลิขสิทธิ์หรือภาพอนาจารด้วย AI พร้อมระบบพิจารณาคำยื่นอุทธรณ์
6. **Global Financial Clearinghouse**
   * **Route:** `/app/(admin)/financial-clearinghouse/page.tsx` *(Atomic Phase 114)*
   * **ฟังก์ชัน:** สรุปกระแสเงินสดรวม ยอดพัก Escrow, รายได้แพลตฟอร์ม และตรวจสอบภาษีหัก ณ ที่จ่ายสะสม
7. **Auto Bank Statement Reconciliation Workspace**
   * **Route:** `/app/(dashboard)/admin/reconciliation/page.tsx` *(Atomic Phase 115)*
   * **ฟังก์ชัน:** จับคู่สเตทเมนท์ธนาคารกับยอดโอนเงินอัตโนมัติ พร้อมระบบ Maker-Checker สำหรับกรณี Manual Override

---

#### **หมวดที่ 4: Super Admin & Governance Console (`Phase 6`)**
*สำหรับระดับบริหารและสถาปนิกระบบในการควบคุมโครงสร้างพื้นฐานและความปลอดภัย*

1. **Granular Permission Matrix Builder**
   * **คอมโพเนนต์หลัก:** `PermissionMatrixBuilder.tsx` *(Atomic Phase 106)*
   * **ฟังก์ชัน:** ตารางกำหนดสิทธิ์การใช้งานแบบละเอียดด้วยBitwise Permission Flags (64-Bit/128-Bit Matrix)
2. **Multi-Tenant Orchestration Console**
   * **Route:** `/app/(admin)/super-admin/tenants/page.tsx` *(Atomic Phase 108)*
   * **ฟังก์ชัน:** คอนโซลจัดการสถานะบริษัท/ร้านค้า (Tenants), การยืนยัน Custom Domain CNAME/SSL, แพ็กเกจ Subscription และการเปิด-ปิด Feature Flags
3. **Executive Business Intelligence (BI) Dashboard**
   * **Route:** `/app/(dashboard)/admin/analytics/page.tsx` *(Atomic Phase 116)*
   * **ฟังก์ชัน:** แดชบอร์ดคำนวณดัชนีชี้วัดองค์กร GMV, LTV, CAC, LTV:CAC Ratio, Churn Rate และ Cohort Analysis
4. **Immutable Security Audit Log Explorer**
   * **Route:** `/app/(admin)/dashboard/audit-logs/page.tsx` *(Atomic Phase 118)*
   * **ฟังก์ชัน:** คอนโซลตรวจสอบประวัติการกระทำของ Admin พร้อมระบบ Cryptographic Hash Chain Verification ป้องกันการแก้ไขย้อนหลัง
5. **Cloudflare R2 Storage & Cost Control Center**
   * **Route:** `/app/(admin)/dashboard/storage-management/page.tsx` *(Atomic Phase 123)*
   * **ฟังก์ชัน:** คอนโซลควบคุมพื้นที่จัดเก็บข้อมูล R2, การตั้งค่า Lifecycle Retention Policy และการเตือนงบประมาณ Storage

---

### 🛡️ ส่วนที่ 3: เกณฑ์การตรวจสอบโค้ดที่สร้างโดย AI (The 9 Enterprise Golden Gatekeepers)
*(เมื่อ AI สร้างโค้ดแต่ละหน้าจอเสร็จแล้ว ให้ใช้ Checkpoints ทั้ง 9 นี้ในการสอบทานความถูกต้อง)*

| Gatekeeper Checklist | ข้อกำหนดในการตรวจสอบ (Verification Standard) |
| :--- | :--- |
| **Gate 1: SSOT Schema Sync** | Prisma Schema, Zod Contracts และ GraphQL Resolvers ตรงกัน 100% |
| **Gate 2: Zero Type Violations** | ผ่านการคอมไพล์ TypeScript Compiler ใน Strict Mode โดยไม่มี `any` |
| **Gate 3: UI/UX State Machine** | รองรับสถานะ UI ครบทั้ง 5 States (INIT, IDLE, LOADING, SUCCESS, ERROR) |
| **Gate 4: Security Audit** | เปิดใช้งาน PII Masking, Anti-XSS Sanitization และ RBAC Guard |
| **Gate 5: Client RAM Guard** | หน่วยความจำ RAM ฝั่ง Client ต้องคงเหลือต่ำกว่า 30MB ตลอดการใช้งาน |
| **Gate 6: Zero-Egress Routing** | ดึงสื่อและเอกสารผ่าน Cloudflare R2 / Redis Edge เท่านั้น |
| **Gate 7: DB Transaction Guard** | คำสั่ง Mutation และการบันทึกข้อมูลทำงานภายใต้ Atomic Transaction |
| **Gate 8: Data Pipeline Sync** | ส่งบันทึก Event Tracking เข้าสู่ Redis Stream เรียลไทม์ |
| **Gate 9: Automated ADR Record** | จัดทำเอกสารบันทึกสถาปัตยกรรมทางเลือก (ADR) ครบถ้วน |

---

💡 *หมายเหตุ:* ระบบได้ประมวลผลจัดทำรายงานฉบับเต็มลงใน Studio Panel เรียบร้อยแล้ว คุณสามารถเปิดดูหรือส่งออกเอกสารรายงานดังกล่าวเพื่อใช้ประกอบการพัฒนาได้ทันทีครับ
