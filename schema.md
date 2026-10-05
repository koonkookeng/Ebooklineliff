# Ebook LINE LIFF V2 — Consolidated Prisma Schema (All Phases)

สกัดจาก 2 ไฟล์:

- `Phase1-4_EbooklineliffV2.md` (Atomic Phase 000 – ~070, Core MVP / Auth / Catalog / Cart / Order / Payment / Reader / Stream / DRM)
- `Phase5-7_EbooklineliffV2.md` (Atomic Phase 071 – 129, Multi-Tenant / Merchant / Logistics / Course Studio / Affiliate / Finance / Gamification / AI / Live / Support / Security / BI)

- จำนวนตาราง (model) ที่ไม่ซ้ำ: **279**
- จำนวน enum ที่ไม่ซ้ำ: **117**
- วิธีรวม: ตัด GraphQL `enum`/`type`/`input` ออก (ตรวจ context ย้อนหลัง 40 บรรทัด), ล้าง markdown escape (`\_` → `_`, `\[` → `[` ฯลฯ), model ชื่อซ้ำเก็บนิยามที่ยาวที่สุดเป็น canonical + รวมทุก phase ที่พบใน comment, enum ชื่อซ้ำทำ union ของทุกค่า
- หมายเหตุ: schema นี้คือ **Single Source of Truth ฉบับรวมเพื่ออ้างอิง** — บาง relation เขียนไว้ต่าง phase กัน (เช่น `User` ถูกขยายหลายรอบ) จึงอาจต้องปรับ opposite relation / `tenantId` / index เพิ่มก่อน `prisma validate`

```prisma
datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgvector(map: "vector")]
}

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}
```

---

## ENUMS (117)

### `AbandonedStatus` — Atomic Phase 084 (Phase5-7_EbooklineliffV2.md:7034)

```prisma
enum AbandonedStatus {
  ACTIVE
  ABANDONED
  RECOVERED
  EXPIRED
}
```

### `ActivityType` — Atomic Phase 110 (Phase5-7_EbooklineliffV2.md:20370)

```prisma
enum ActivityType {
  LOGIN_LIFF
  LOGIN_WEB
  PURCHASE_COMPLETED
  EBOOK_PAGE_READ
  COURSE_VIDEO_WATCH
  SLIP_UPLOADED
  AFFILIATE_CLICK
  SESSION_REVOKED
}
```

### `AffiliateTierLevel` — Atomic Phase 079 (Phase5-7_EbooklineliffV2.md:4277)

```prisma
enum AffiliateTierLevel {
  TIER_1_DIRECT
  TIER_2_INDIRECT
  TIER_3_COMMUNITY
}
```

### `AiJobStatus` — Atomic Phase 094 (Phase5-7_EbooklineliffV2.md:11986)

```prisma
enum AiJobStatus {
  QUEUED
  PROCESSING
  COMPLETED
  FAILED
}
```

### `AiJobType` — Atomic Phase 094 (Phase5-7_EbooklineliffV2.md:11979)

```prisma
enum AiJobType {
  COURSE_OUTLINE_GEN
  VIDEO_TRANSCRIBE
  AUTO_QUIZ_GEN
  CAPTION_TRANSLATION
}
```

### `AlertSeverity` — Atomic Phase 123 (Phase5-7_EbooklineliffV2.md:26794)

```prisma
enum AlertSeverity {
  INFO
  WARNING
  CRITICAL
}
```

### `AuditActionCategory` — Atomic Phase 118 (Phase5-7_EbooklineliffV2.md:24709)

```prisma
enum AuditActionCategory {
  AUTHENTICATION
  USER_MANAGEMENT
  FINANCIAL_TRANSACTION
  CONTENT_MUTATION
  SYSTEM_CONFIGURATION
  ENTITLEMENT_GRANT
}
```

### `AuditAdminRole` — Atomic Phase 118 (Phase5-7_EbooklineliffV2.md:24700)

```prisma
enum AuditAdminRole {
  SUPER_ADMIN
  FINANCE_ADMIN
  CONTENT_MODERATOR
  SUPPORT_STAFF
  INSTRUCTOR
  SELLER
}
```

### `AuditIntegrityStatus` — Atomic Phase 118 (Phase5-7_EbooklineliffV2.md:24718)

```prisma
enum AuditIntegrityStatus {
  VERIFIED_VALID
  PENDING_VAULT_SYNC
  TAMPER_DETECTED
  CORRUPTED_CHAIN
}
```

### `BadgeCategory` — Atomic Phase 083 (Phase5-7_EbooklineliffV2.md:6329)

```prisma
enum BadgeCategory {
  READING_MILESTONE
  LEARNING_STREAK
  PURCHASE_COMMUNITY
  SOCIAL_AFFILIATE
  SPECIAL_EVENT
}
```

### `BookJobStatus` — Atomic Phase 038 (Phase1-4_EbooklineliffV2.md:20231)

```prisma
enum BookJobStatus {
  QUEUED
  PARSING_STRUCTURE
  GENERATING_VECTOR_CHUNKS
  ENCRYPTING_ASSETS
  UPLOADING_R2
  COMPLETED
  FAILED
}
```

### `BotPromptMode` — Atomic Phase 034 (Phase1-4_EbooklineliffV2.md:18311)

```prisma
enum BotPromptMode {
  NONE
  NORMAL
  AGGRESSIVE
}
```

### `ChaosFaultType` — Atomic Phase 124 (Phase5-7_EbooklineliffV2.md:27351)

```prisma
enum ChaosFaultType {
  REDIS_DOWN
  EASYSLIP_TIMEOUT
  EASYSLIP_500_ERROR
  DB_POOL_EXHAUSTION
  R2_STORAGE_LATENCY
}
```

### `CircuitState` — Atomic Phase 124 (Phase5-7_EbooklineliffV2.md:27359)

```prisma
enum CircuitState {
  CLOSED
  OPEN
  HALF_OPEN
}
```

### `CommissionStatus` — Atomic Phase 079 (Phase5-7_EbooklineliffV2.md:4283)

```prisma
enum CommissionStatus {
  PENDING
  APPROVED
  PAID
  CANCELLED
  BLOCKED_FRAUD
}
```

### `CompanyStatus` — Atomic Phase 108 (Phase5-7_EbooklineliffV2.md:19048)

```prisma
enum CompanyStatus {
  PENDING_KYC
  TRIAL_ACTIVE
  TRIAL_EXPIRED
  ACTIVE
  SUSPENDED_PAYMENT_OVERDUE
  SUSPENDED_POLICY_VIOLATION
  MAINTENANCE
}
```

### `ConsentPurpose` — Atomic Phase 129 (Phase5-7_EbooklineliffV2.md:29660)

```prisma
enum ConsentPurpose {
  NECESSARY_TERMS
  MARKETING_PROMOTION
  ANALYTICS_BEHAVIOR
  THIRD_PARTY_TRANSFER
}
```

### `ContentAccessType` — Atomic Phase 000, Atomic Phase 008, Atomic Phase 012, Atomic Phase 093, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:156)

```prisma
enum ContentAccessType {
  FULL_PURCHASE
  SUBSCRIPTION
  CORPORATE_LICENSE
  TIME_LIMITED_RENTAL
}
```

### `ContentSourceType` — Atomic Phase 091 (Phase5-7_EbooklineliffV2.md:10544)

```prisma
enum ContentSourceType {
  EBOOK_CHUNK
  COURSE_TRANSCRIPT
  PRODUCT_DESCRIPTION
}
```

### `CorporateLicenseStatus` — Atomic Phase 097 (Phase5-7_EbooklineliffV2.md:13291)

```prisma
enum CorporateLicenseStatus {
  ACTIVE
  EXPIRED
  SUSPENDED
  EXHAUSTED
}
```

### `CouponScope` — Atomic Phase 088, Atomic Phase 117 (Phase5-7_EbooklineliffV2.md:8941)

```prisma
enum CouponScope {
  GLOBAL
  TENANT_SPECIFIC
  PRODUCT_SPECIFIC
  CATEGORY_SPECIFIC
  GLOBAL_PLATFORM
  TENANT_STORE
  CREATOR_SPECIFIC
}
```

### `CouponType` — Atomic Phase 088, Atomic Phase 117 (Phase5-7_EbooklineliffV2.md:8935)

```prisma
enum CouponType {
  FIXED_AMOUNT
  PERCENTAGE
  FREE_SHIPPING
  PLATFORM_FIXED
  PLATFORM_PERCENTAGE
  STORE_FIXED
  STORE_PERCENTAGE
  CATEGORY_SPECIFIC
  PRODUCT_SPECIFIC
  AFFILIATE_BOOST
}
```

### `CourierProvider` — Atomic Phase 076 (Phase5-7_EbooklineliffV2.md:2500)

```prisma
enum CourierProvider {
  FLASH_EXPRESS
  KEX_EXPRESS
  JT_EXPRESS
  THAILAND_POST
  CUSTOM_FLEET
}
```

### `DRState` — Atomic Phase 127 (Phase5-7_EbooklineliffV2.md:28537)

```prisma
enum DRState {
  NORMAL
  FAILOVER_IN_PROGRESS
  FAILOVER_COMPLETED
  FAILBACK_IN_PROGRESS
}
```

### `DSRStatus` — Atomic Phase 129 (Phase5-7_EbooklineliffV2.md:29675)

```prisma
enum DSRStatus {
  PENDING
  PROCESSING
  COMPLETED
  REJECTED
}
```

### `DSRType` — Atomic Phase 129 (Phase5-7_EbooklineliffV2.md:29667)

```prisma
enum DSRType {
  RIGHT_TO_ACCESS
  RIGHT_TO_ERASURE
  RIGHT_TO_RECTIFY
  RIGHT_TO_PORTABILITY
  RIGHT_TO_OBJECT
}
```

### `DataScopeRole` — Atomic Phase 107 (Phase5-7_EbooklineliffV2.md:18538)

```prisma
enum DataScopeRole {
  SUPER_ADMIN
  TENANT_ADMIN
  COMPLIANCE_OFFICER
  SUPPORT_STAFF
  FULFILLMENT_OPERATOR
  MEMBER
}
```

### `DeviceType` — Atomic Phase 070, Atomic Phase 119 (Phase1-4_EbooklineliffV2.md:36072)

```prisma
enum DeviceType {
  LINE_LIFF_MOBILE
  WEB_DESKTOP
  TABLET_PWA
  NATIVE_APP
  LINE_LIFF_IOS
  LINE_LIFF_ANDROID
  WEB_MOBILE_BROWSER
}
```

### `DispatchStatus` — Atomic Phase 024 (Phase1-4_EbooklineliffV2.md:13898)

```prisma
enum DispatchStatus {
  QUEUED
  PROCESSING
  DELIVERED
  FAILED
  FALLBACK_SENT
}
```

### `DisputeReason` — Atomic Phase 113 (Phase5-7_EbooklineliffV2.md:22077)

```prisma
enum DisputeReason {
  PHYSICAL_ITEM_DAMAGED
  PHYSICAL_ITEM_NOT_RECEIVED
  WRONG_ITEM_SENT
  EBOOK_FILE_CORRUPTED
  COURSE_CONTENT_MISMATCH
  DUPLICATE_PAYMENT
  OTHER
}
```

### `DisputeStatus` — Atomic Phase 113 (Phase5-7_EbooklineliffV2.md:22087)

```prisma
enum DisputeStatus {
  SUBMITTED
  AWAITING_SELLER_RESPONSE
  UNDER_ADMIN_ARBITRATION
  APPROVED_REFUND_BUYER
  REJECTED_RELEASE_SELLER
  CANCELLED_BY_BUYER
}
```

### `DomainStatus` — Atomic Phase 108 (Phase5-7_EbooklineliffV2.md:19058)

```prisma
enum DomainStatus {
  PENDING_DNS
  PROVISIONING_SSL
  ACTIVE
  FAILED_DNS_NOT_FOUND
  EXPIRED
}
```

### `DrmAlgorithm` — Atomic Phase 061 (Phase1-4_EbooklineliffV2.md:31647)

```prisma
enum DrmAlgorithm {
  TILE_GRID_PERMUTATION
  PIXEL_BYTE_XOR_SHUFFLE
  HYBRID_WEBGL_MATRIX
}
```

### `DrmViolationType` — Atomic Phase 049 (Phase1-4_EbooklineliffV2.md:25615)

```prisma
enum DrmViolationType {
  SCREENSHOT_ATTEMPT
  DEVTOOLS_CANVAS_DUMP
  UNAUTHORIZED_DOM_INJECTION
  SESSION_HIJACK_ATTEMPT
}
```

### `EntryType` — Atomic Phase 081 (Phase5-7_EbooklineliffV2.md:5335)

```prisma
enum EntryType {
  DEBIT
  CREDIT
}
```

### `EnvironmentType` — Atomic Phase 022 (Phase1-4_EbooklineliffV2.md:12960)

```prisma
enum EnvironmentType {
  LINE_LIFF_IOS
  LINE_LIFF_ANDROID
  STANDALONE_PWA
  MOBILE_SAFARI
  MOBILE_CHROME
  IN_APP_WEBVIEW
  DESKTOP_BROWSER
}
```

### `EscrowStatus` — Atomic Phase 113 (Phase5-7_EbooklineliffV2.md:22069)

```prisma
enum EscrowStatus {
  HELD
  DISPUTED_HOLD
  RELEASED_TO_SELLER
  REFUNDED_TO_BUYER
  PARTIALLY_REFUNDED
}
```

### `FlagCategory` — Atomic Phase 112 (Phase5-7_EbooklineliffV2.md:21487)

```prisma
enum FlagCategory {
  COPYRIGHT_VIOLATION
  NUDITY_EXPLICIT
  VIOLENCE_GORE
  HATE_SPEECH_PROFANITY
  SCAM_FRAUD
  OTHER
}
```

### `FlashSaleStatus` — Atomic Phase 087 (Phase5-7_EbooklineliffV2.md:8426)

```prisma
enum FlashSaleStatus {
  UPCOMING
  ACTIVE
  PAUSED
  ENDED
  SOLD_OUT
}
```

### `FulfillmentStatus` — Atomic Phase 073, Atomic Phase 076 (Phase5-7_EbooklineliffV2.md:972)

```prisma
enum FulfillmentStatus {
  UNFULFILLED
  PACKED
  SHIPPED
  DELIVERED
  RETURNED
  QUEUED_FOR_BOOKING
  BOOKED
  LABEL_GENERATED
  PRINTED
  IN_TRANSIT
  DELIVERY_FAILED
  CANCELLED
}
```

### `GiftStatus` — Atomic Phase 089 (Phase5-7_EbooklineliffV2.md:9468)

```prisma
enum GiftStatus {
  PENDING_PAYMENT
  READY_TO_CLAIM
  CLAIMED
  EXPIRED_REVERTED
  CANCELLED_REFUNDED
}
```

### `GreetingTheme` — Atomic Phase 089 (Phase5-7_EbooklineliffV2.md:9476)

```prisma
enum GreetingTheme {
  BIRTHDAY_CELEBRATION
  NEW_YEAR_GOALS
  CONGRATULATIONS
  THANK_YOU
  CUSTOM_BRANDED
}
```

### `GroupBuyingStatus` — Atomic Phase 090 (Phase5-7_EbooklineliffV2.md:9969)

```prisma
enum GroupBuyingStatus {
  WAITING_FOR_MEMBERS
  COMPLETED
  EXPIRED
  CANCELLED
}
```

### `GroupType` — Atomic Phase 090 (Phase5-7_EbooklineliffV2.md:9962)

```prisma
enum GroupType {
  BUDDY_PASS_2P
  GROUP_BUY_3P
  GROUP_BUY_5P
  CORPORATE_TEAM
}
```

### `HandRaiseStatus` — Atomic Phase 101 (Phase5-7_EbooklineliffV2.md:15415)

```prisma
enum HandRaiseStatus {
  PENDING
  APPROVED
  REJECTED
  COMPLETED
  CANCELLED
}
```

### `HlsTranscodeStatus` — Atomic Phase 078 (Phase5-7_EbooklineliffV2.md:3693)

```prisma
enum HlsTranscodeStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}
```

### `IncomeType` — Atomic Phase 082 (Phase5-7_EbooklineliffV2.md:5917)

```prisma
enum IncomeType {
  CREATOR_SHARE_40_8
  AFFILIATE_COMMISSION_40_2
  SERVICE_FEE_40_8
}
```

### `InteractionType` — Atomic Phase 104 (Phase5-7_EbooklineliffV2.md:16866)

```prisma
enum InteractionType {
  ITEM_VIEW
  READING_DWELL_TIME
  VIDEO_WATCH_PROGRESS
  ADD_TO_CART
  PURCHASE_COMPLETED
  FLEX_SHARE_CLICK
}
```

### `IpAnomalyType` — Atomic Phase 120 (Phase5-7_EbooklineliffV2.md:25521)

```prisma
enum IpAnomalyType {
  NORMAL
  NEW_IP_LOCATION
  NEW_COUNTRY
  IMPOSSIBLE_TRAVEL
  KNOWN_VPN_PROXY
  HIGH_VELOCITY_ROTATION
  DEVICE_FINGERPRINT_MISMATCH
}
```

### `KYCDocType` — Atomic Phase 111 (Phase5-7_EbooklineliffV2.md:20995)

```prisma
enum KYCDocType {
  THAI_NATIONAL_ID
  PASSPORT
  COMPANY_REGISTRATION
  BANK_BOOK
}
```

### `KYCRiskLevel` — Atomic Phase 111 (Phase5-7_EbooklineliffV2.md:21002)

```prisma
enum KYCRiskLevel {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}
```

### `KYCStatus` — Atomic Phase 003, Atomic Phase 085, Atomic Phase 109, Atomic Phase 111 (Phase1-4_EbooklineliffV2.md:1650)

```prisma
enum KYCStatus {
  NOT_SUBMITTED
  PENDING
  VERIFIED
  REJECTED
  ACTION_REQUIRED
}
```

### `LedgerAccountType` — Atomic Phase 081, Atomic Phase 114 (Phase5-7_EbooklineliffV2.md:5326)

```prisma
enum LedgerAccountType {
  CASH_EQUIVALENT
  SELLER_PAYABLE
  AFFILIATE_PAYABLE
  PLATFORM_REVENUE_FEE
  WITHHOLDING_TAX_PAYABLE
  ESCROW_HOLD
  CASH_ASSET
  ESCROW_LIABILITY
  PLATFORM_REVENUE
  CREATOR_PAYABLE
  TAX_WITHHOLDING_PAYABLE
  REFUND_RESERVE
}
```

### `LedgerType` — Atomic Phase 017 (Phase1-4_EbooklineliffV2.md:10291)

```prisma
enum LedgerType {
  TOPUP_CREDIT
  BONUS_CREDIT
  PURCHASE_DEBIT
  REFUND_CREDIT
  AFFILIATE_REWARD_CREDIT
  CASHBACK_CREDIT
  ADMIN_ADJUSTMENT
}
```

### `LineReviewCategory` — Atomic Phase 035 (Phase1-4_EbooklineliffV2.md:18720)

```prisma
enum LineReviewCategory {
  AUTHENTICATION_SECURITY
  MEMORY_PERFORMANCE
  PRIVACY_CONSENT
  UI_NAVIGATION_COMPLIANCE
  PAYMENT_EXTERNAL_POLICY
  MEDIA_STREAMING_DRM
}
```

### `LiveAccessRole` — Atomic Phase 100 (Phase5-7_EbooklineliffV2.md:14680)

```prisma
enum LiveAccessRole {
  HOST
  CO_HOST
  VIP_VIEWER
  STANDARD_VIEWER
}
```

### `LiveMessageType` — Atomic Phase 101 (Phase5-7_EbooklineliffV2.md:15423)

```prisma
enum LiveMessageType {
  TEXT
  LINE_STICKER
  ANNOUNCEMENT
  PRODUCT_PIN
  SYSTEM_EVENT
}
```

### `LiveSessionStatus` — Atomic Phase 099 (Phase5-7_EbooklineliffV2.md:14166)

```prisma
enum LiveSessionStatus {
  SCHEDULED
  STARTING
  LIVE
  PAUSED
  ENDED
  ARCHIVED
}
```

### `LiveStreamStatus` — Atomic Phase 100, Atomic Phase 102 (Phase5-7_EbooklineliffV2.md:14673)

```prisma
enum LiveStreamStatus {
  SCHEDULED
  LIVE_NOW
  ENDED
  ARCHIVED
  PROCESSING_VOD
  VOD_AVAILABLE
  FAILED
}
```

### `LiveStreamVendor` — Atomic Phase 099 (Phase5-7_EbooklineliffV2.md:14159)

```prisma
enum LiveStreamVendor {
  WEBRTC_NATIVE
  AMAZON_IVS
  CLOUDFLARE_STREAM_LIVE
  HLS_LOW_LATENCY
}
```

### `LogLevel` — Atomic Phase 121 (Phase5-7_EbooklineliffV2.md:25993)

```prisma
enum LogLevel {
  TRACE
  DEBUG
  INFO
  WARN
  ERROR
  FATAL
}
```

### `LogisticsCarrier` — Atomic Phase 077 (Phase5-7_EbooklineliffV2.md:3023)

```prisma
enum LogisticsCarrier {
  FLASH_EXPRESS
  KERRY_EXPRESS
  THAILAND_POST
}
```

### `MessageType` — Atomic Phase 024 (Phase1-4_EbooklineliffV2.md:13889)

```prisma
enum MessageType {
  ORDER_CONFIRMATION
  PAYMENT_RECEIPT
  EBOOK_GRANT_ACCESS
  COURSE_ENROLLMENT
  SHIPPING_TRACKING
  AUTHENTICATION_OTP
}
```

### `MetricType` — Atomic Phase 029 (Phase1-4_EbooklineliffV2.md:16116)

```prisma
enum MetricType {
  INITIAL_BUNDLE_SIZE
  LCP_MS
  FID_MS
  CLS_SCORE
  PREFETCH_HIT
  PREFETCH_MISS
}
```

### `ModerationSeverity` — Atomic Phase 112 (Phase5-7_EbooklineliffV2.md:21496)

```prisma
enum ModerationSeverity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}
```

### `ModerationStatus` — Atomic Phase 112 (Phase5-7_EbooklineliffV2.md:21474)

```prisma
enum ModerationStatus {
  PENDING_SCAN
  SCANNING
  PASSED
  FLAGGED_NSFW
  FLAGGED_COPYRIGHT
  FLAGGED_PROFANITY
  QUARANTINED
  APPEAL_PENDING
  REJECTED
  MANUALLY_APPROVED
}
```

### `NoteType` — Atomic Phase 095 (Phase5-7_EbooklineliffV2.md:12314)

```prisma
enum NoteType {
  MARGIN_TEXT
  TEXT_HIGHLIGHT
  VOICE_SNIPPET
  QUESTION_THREAD
}
```

### `NoteVisibility` — Atomic Phase 065, Atomic Phase 095 (Phase1-4_EbooklineliffV2.md:33669)

```prisma
enum NoteVisibility {
  PRIVATE
  STUDY_GROUP
  PUBLIC
  FRIENDS
  AUTHOR_OFFICIAL
}
```

### `NotificationStep` — Atomic Phase 084 (Phase5-7_EbooklineliffV2.md:7041)

```prisma
enum NotificationStep {
  STEP_1_15_MIN
  STEP_2_3_HOURS
}
```

### `OrderStatus` — Atomic Phase 012, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:6827)

```prisma
enum OrderStatus {
  PENDING_PAYMENT
  PAYMENT_VERIFYING
  PROCESSING
  SHIPPED
  DELIVERED
  COMPLETED
  CANCELLED
  REFUNDED
}
```

### `OutboxStatus` — Atomic Phase 124 (Phase5-7_EbooklineliffV2.md:27365)

```prisma
enum OutboxStatus {
  PENDING
  PROCESSING
  FAILED
  RESOLVED
}
```

### `PackageTier` — Atomic Phase 108 (Phase5-7_EbooklineliffV2.md:19066)

```prisma
enum PackageTier {
  STARTER_FREE
  PRO_CREATOR
  ENTERPRISE_ACADEMY
  CUSTOM_WHITE_LABEL
}
```

### `PaymentStatus` — Atomic Phase 012, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:6838)

```prisma
enum PaymentStatus {
  UNPAID
  PENDING_SLIP
  VERIFIED
  FAILED
  REFUNDED
}
```

### `PayoutAccountStatus` — Atomic Phase 085 (Phase5-7_EbooklineliffV2.md:7474)

```prisma
enum PayoutAccountStatus {
  INACTIVE
  PENDING_VERIFICATION
  ACTIVE
  SUSPENDED
}
```

### `PayoutStatus` — Atomic Phase 073, Atomic Phase 079, Atomic Phase 081, Atomic Phase 086, Atomic Phase 114 (Phase5-7_EbooklineliffV2.md:980)

```prisma
enum PayoutStatus {
  PENDING
  PROCESSING
  COMPLETED
  REJECTED
  REQUESTED
  PROCESSING_BANK
  SUCCESS
  FAILED
  DRAFT
  PENDING_APPROVAL
  FAILED_BANK_TRANSFER
}
```

### `PermissionStatus` — Atomic Phase 032 (Phase1-4_EbooklineliffV2.md:17431)

```prisma
enum PermissionStatus {
  PROMPT
  GRANTED
  DENIED
  RESTRICTED
  UNSUPPORTED
}
```

### `PermissionType` — Atomic Phase 032 (Phase1-4_EbooklineliffV2.md:17424)

```prisma
enum PermissionType {
  CAMERA
  PHOTO_LIBRARY
  GEOLOCATION
  MICROPHONE
}
```

### `PointActivityType` — Atomic Phase 096 (Phase5-7_EbooklineliffV2.md:12755)

```prisma
enum PointActivityType {
  EBOOK_PAGE_READ
  LESSON_WATCHED
  QUIZ_PASSED
  DAILY_CHECKIN
  SQUAD_CHALLENGE_COMPLETED
  REFERRAL_BONUS
}
```

### `ProductStatus` — Atomic Phase 008 (Phase1-4_EbooklineliffV2.md:4557)

```prisma
enum ProductStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
  SUSPENDED
}
```

### `ProductType` — Atomic Phase 000, Atomic Phase 008, Atomic Phase 012, Atomic Phase 037, Atomic Phase 093, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:148)

```prisma
enum ProductType {
  PHYSICAL_BOOK
  EBOOK
  ELEARNING_COURSE
  LIVE_CLASS
  HYBRID_BUNDLE
}
```

### `PromptPayStatus` — Atomic Phase 013 (Phase1-4_EbooklineliffV2.md:7391)

```prisma
enum PromptPayStatus {
  PENDING
  PAID
  EXPIRED
  CANCELLED
}
```

### `QrStatus` — Atomic Phase 007 (Phase1-4_EbooklineliffV2.md:4054)

```prisma
enum QrStatus {
  PENDING
  SCANNED
  AUTHORIZED
  EXPIRED
  REJECTED
}
```

### `QuizType` — Atomic Phase 047 (Phase1-4_EbooklineliffV2.md:24659)

```prisma
enum QuizType {
  SINGLE_CHOICE
  MULTIPLE_CHOICE
  TRUE_FALSE
  SHORT_ANSWER
}
```

### `ReadingFontFamily` — Atomic Phase 066 (Phase1-4_EbooklineliffV2.md:34156)

```prisma
enum ReadingFontFamily {
  PROMPT
  SARABUN
  INTER
  MERRIWEATHER
}
```

### `ReceiptStatus` — Atomic Phase 019 (Phase1-4_EbooklineliffV2.md:11260)

```prisma
enum ReceiptStatus {
  PENDING
  GENERATED
  DELIVERED
  FAILED
}
```

### `RecommendationReasonType` — Atomic Phase 104 (Phase5-7_EbooklineliffV2.md:16875)

```prisma
enum RecommendationReasonType {
  BASED_ON_READING_HISTORY
  BASED_ON_COURSE_COMPLETION
  VECTOR_SIMILARITY_MATCH
  COLLABORATIVE_USER_ALSO_BOUGHT
  TRENDING_IN_CATEGORY
  COLD_START_ONBOARDING
}
```

### `ReconciliationStatus` — Atomic Phase 115 (Phase5-7_EbooklineliffV2.md:23173)

```prisma
enum ReconciliationStatus {
  UNMATCHED
  AUTO_MATCHED
  MANUAL_OVERRIDDEN
  DISCREPANCY_FLAGGED
  REJECTED_DUPLICATE
}
```

### `RedemptionStatus` — Atomic Phase 083 (Phase5-7_EbooklineliffV2.md:6345)

```prisma
enum RedemptionStatus {
  COMPLETED
  PENDING_SHIPMENT
  CANCELLED
}
```

### `RewardType` — Atomic Phase 083 (Phase5-7_EbooklineliffV2.md:6337)

```prisma
enum RewardType {
  EBOOK_UNLOCK
  COURSE_UNLOCK
  DISCOUNT_COUPON
  PHYSICAL_ITEM
  STREAK_FREEZE_ITEM
}
```

### `RiskLevel` — Atomic Phase 110, Atomic Phase 120 (Phase5-7_EbooklineliffV2.md:20363)

```prisma
enum RiskLevel {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}
```

### `RuntimeEnvironment` — Atomic Phase 056 (Phase1-4_EbooklineliffV2.md:29248)

```prisma
enum RuntimeEnvironment {
  LINE_LIFF_MOBILE
  LINE_LIFF_DESKTOP
  WEB_MOBILE_PWA
  WEB_DESKTOP_WORKSPACE
}
```

### `SeatStatus` — Atomic Phase 097 (Phase5-7_EbooklineliffV2.md:13298)

```prisma
enum SeatStatus {
  UNASSIGNED
  INVITED
  ACTIVE
  REVOKED
}
```

### `SecurityActionType` — Atomic Phase 050 (Phase1-4_EbooklineliffV2.md:26015)

```prisma
enum SecurityActionType {
  WARNING_THROTTLE
  TEMPORARY_BLOCK
  PERMANENT_BAN
}
```

### `SecuritySeverity` — Atomic Phase 028 (Phase1-4_EbooklineliffV2.md:15631)

```prisma
enum SecuritySeverity {
  INFO
  WARNING
  CRITICAL
  BLOCKED_XSS
}
```

### `SenderType` — Atomic Phase 103 (Phase5-7_EbooklineliffV2.md:16446)

```prisma
enum SenderType {
  USER
  AI_BOT
  HUMAN_AGENT
  SYSTEM_ALERT
}
```

### `SensitiveFieldType` — Atomic Phase 107 (Phase5-7_EbooklineliffV2.md:18547)

```prisma
enum SensitiveFieldType {
  PHONE_NUMBER
  BANK_ACCOUNT
  NATIONAL_ID
  TAX_ID
  STREET_ADDRESS
  EMAIL_ADDRESS
}
```

### `SessionStatus` — Atomic Phase 119 (Phase5-7_EbooklineliffV2.md:25090)

```prisma
enum SessionStatus {
  ACTIVE_STREAMING
  IDLE
  EVICTED_CONCURRENT
  BLOCKED_FRAUD
}
```

### `ShareStatus` — Atomic Phase 026 (Phase1-4_EbooklineliffV2.md:14797)

```prisma
enum ShareStatus {
  SUCCESS
  CANCELLED
  FAILED
}
```

### `ShareTargetType` — Atomic Phase 026 (Phase1-4_EbooklineliffV2.md:14790)

```prisma
enum ShareTargetType {
  INDIVIDUAL
  GROUP
  ROOM
  EXTERNAL_URL
}
```

### `ShipmentStatus` — Atomic Phase 077 (Phase5-7_EbooklineliffV2.md:3029)

```prisma
enum ShipmentStatus {
  PENDING_BOOKING
  BOOKED
  PICKED_UP
  IN_TRANSIT
  OUT_FOR_DELIVERY
  DELIVERED
  FAILED_ATTEMPT
  RETURNED
}
```

### `SquadMemberRole` — Atomic Phase 096 (Phase5-7_EbooklineliffV2.md:12749)

```prisma
enum SquadMemberRole {
  LEADER
  CO_LEADER
  MEMBER
}
```

### `StatementSource` — Atomic Phase 115 (Phase5-7_EbooklineliffV2.md:23181)

```prisma
enum StatementSource {
  OPEN_BANKING_API
  BANK_WEBHOOK
  CSV_IMPORT
  SCRAPER_FEED
}
```

### `StorageAlertStatus` — Atomic Phase 123 (Phase5-7_EbooklineliffV2.md:26787)

```prisma
enum StorageAlertStatus {
  PENDING
  DELIVERED
  FAILED
  RESOLVED
}
```

### `TaxFormType` — Atomic Phase 082 (Phase5-7_EbooklineliffV2.md:5923)

```prisma
enum TaxFormType {
  PND_1K
  PND_2
  PND_3
  PND_53
}
```

### `TaxPayerType` — Atomic Phase 082 (Phase5-7_EbooklineliffV2.md:5912)

```prisma
enum TaxPayerType {
  INDIVIDUAL
  JURISTIC_PERSON
}
```

### `TenantStatus` — Atomic Phase 071 (Phase5-7_EbooklineliffV2.md:137)

```prisma
enum TenantStatus {
  ACTIVE
  SUSPENDED
  PENDING_SETUP
  ARCHIVED
}
```

### `ThemeMode` — Atomic Phase 066 (Phase1-4_EbooklineliffV2.md:34148)

```prisma
enum ThemeMode {
  LIGHT
  DARK
  SEPIA
  OLED_BLACK
  SYSTEM
}
```

### `ThreatSeverity` — Atomic Phase 127 (Phase5-7_EbooklineliffV2.md:28530)

```prisma
enum ThreatSeverity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}
```

### `TicketPriority` — Atomic Phase 103 (Phase5-7_EbooklineliffV2.md:16439)

```prisma
enum TicketPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}
```

### `TicketStatus` — Atomic Phase 103 (Phase5-7_EbooklineliffV2.md:16431)

```prisma
enum TicketStatus {
  OPEN
  IN_PROGRESS
  WAITING_USER_RESPONSE
  RESOLVED
  CLOSED
}
```

### `TransactionEntryType` — Atomic Phase 114 (Phase5-7_EbooklineliffV2.md:22648)

```prisma
enum TransactionEntryType {
  DEBIT
  CREDIT
}
```

### `TranscodeStatus` — Atomic Phase 044 (Phase1-4_EbooklineliffV2.md:23156)

```prisma
enum TranscodeStatus {
  QUEUED
  PROCESSING_UPLOAD
  TRANSCODING
  UPLOADING_R2
  COMPLETED
  FAILED
}
```

### `UserRole` — Atomic Phase 000, Atomic Phase 001, Atomic Phase 003, Atomic Phase 006, Atomic Phase 008, Atomic Phase 012, Atomic Phase 093, Atomic Phase 109, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:138)

```prisma
enum UserRole {
  SUPER_ADMIN
  FINANCE_ADMIN
  CONTENT_MODERATOR
  SUPPORT_STAFF
  INSTRUCTOR
  SELLER
  MEMBER
}
```

### `VectorSourceType` — Atomic Phase 092 (Phase5-7_EbooklineliffV2.md:11037)

```prisma
enum VectorSourceType {
  EBOOK_CHUNK
  COURSE_TRANSCRIPT
}
```

### `VideoQuality` — Atomic Phase 044, Atomic Phase 067 (Phase1-4_EbooklineliffV2.md:23165)

```prisma
enum VideoQuality {
  RES_1080P
  RES_720P
  RES_480P
  RES_360P
  AUTO
  QUALITY_1080P
  QUALITY_720P
  QUALITY_480P
  QUALITY_360P
}
```

### `VideoResolution` — Atomic Phase 043 (Phase1-4_EbooklineliffV2.md:22726)

```prisma
enum VideoResolution {
  RES_1080P
  RES_720P
  RES_480P
  RES_360P
}
```

### `VideoStatus` — Atomic Phase 043 (Phase1-4_EbooklineliffV2.md:22717)

```prisma
enum VideoStatus {
  PENDING_UPLOAD
  UPLOADING
  TRANSCODING_QUEUED
  TRANSCODING_PROCESSING
  READY
  FAILED
}
```

---

## MODELS (279 tables)

### `AIBotConversationHistory` — Atomic Phase 103 (Phase5-7_EbooklineliffV2.md:16518)

```prisma
// Source: Atomic Phase 103
model AIBotConversationHistory {
  id        String   @id @default(uuid())
  userId    String
  sessionId String
  userQuery String   @db.Text
  botAnswer String   @db.Text
  isHandled Boolean  @default(true)
  createdAt DateTime @default(now())

  @@index([userId, sessionId])
}
```

### `AbandonedCartLog` — Atomic Phase 084 (Phase5-7_EbooklineliffV2.md:7080)

```prisma
// Source: Atomic Phase 084
model AbandonedCartLog {
  id             String           @id @default(uuid())
  cartId         String
  cart           Cart             @relation(fields: [cartId], references: [id], onDelete: Cascade)
  step           NotificationStep
  sentAt         DateTime         @default(now())
  lineMessageId  String?
  couponCode     String?
  isClicked      Boolean          @default(false)
  clickedAt      DateTime?

  createdAt      DateTime         @default(now())

  @@index([cartId])
  @@index([step])
}
```

### `Account` — Atomic Phase 005 (Phase1-4_EbooklineliffV2.md:2778)

```prisma
// Source: Atomic Phase 005
model Account {
  id                String    @id @default(uuid())
  userId            String
  provider          UserRole  // Account Auth Type Provider
  providerAccountId String    // External ID e.g., lineUserId or googleSub
  refreshToken      String?   @db.Text
  accessToken       String?   @db.Text
  expiresAt         Int?
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@unique([provider, providerAccountId])
  @@index([userId])
}
```

### `ActiveDeviceSession` — Atomic Phase 057 (Phase1-4_EbooklineliffV2.md:29783)

```prisma
// Source: Atomic Phase 057
model ActiveDeviceSession {
  id           String   @id @default(uuid())
  userId       String
  deviceId     String
  tenantId     String
  socketId     String   @unique
  clientIp     String
  userAgent    String
  lastActiveAt DateTime @default(now())

  @@index([userId, tenantId])
}
```

### `ActiveSession` — Atomic Phase 119 (Phase5-7_EbooklineliffV2.md:25115)

```prisma
// Source: Atomic Phase 119
model ActiveSession {
  id                String        @id @default(uuid())
  userId            String
  user              User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  deviceId          String
  device            UserDevice    @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  sessionToken      String        @unique @default(uuid())
  activeStreamLessonId String?
  sessionStatus     SessionStatus @default(ACTIVE_STREAMING)
  ipAddress         String
  lastHeartbeatAt   DateTime      @default(now())
  createdAt         DateTime      @default(now())
  expiresAt         DateTime

  @@index([userId, sessionStatus])
  @@index([sessionToken])
}
```

### `AdaptiveQuestionItem` — Atomic Phase 093 (Phase5-7_EbooklineliffV2.md:11574)

```prisma
// Source: Atomic Phase 093
model AdaptiveQuestionItem {
  id            String                 @id @default(uuid())
  lessonId      String
  lesson        CourseLesson           @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  questionText  String                 @db.Text
  optionsJson   Json                   // [{id: "A", text: "..."}, {id: "B", text: "..."}]
  correctOption String
  difficulty    Float                  @default(0.0) // Item Parameter: Difficulty (b)
  discrimination Float                 @default(1.0) // Item Parameter: Discrimination (a)
  pseudoGuessing Float                 @default(0.0) // Item Parameter: Guessing (c)
  responses     AdaptiveQuizResponse[]
  createdAt     DateTime               @default(now())
  updatedAt     DateTime               @updatedAt

  @@index([lessonId])
  @@index([difficulty])
}
```

### `AdaptiveQuizResponse` — Atomic Phase 093 (Phase5-7_EbooklineliffV2.md:11605)

```prisma
// Source: Atomic Phase 093
model AdaptiveQuizResponse {
  id             String               @id @default(uuid())
  userId         String
  user           User                 @relation(fields: [userId], references: [id], onDelete: Cascade)
  questionId     String
  question       AdaptiveQuestionItem @relation(fields: [questionId], references: [id], onDelete: Cascade)
  selectedOption String
  isCorrect      Boolean
  responseTimeMs Int
  thetaAfter     Float
  createdAt      DateTime             @default(now())

  @@index([userId])
  @@index([questionId])
}
```

### `AffiliateAttribution` — Atomic Phase 025 (Phase1-4_EbooklineliffV2.md:14344)

```prisma
// Source: Atomic Phase 025
model AffiliateAttribution {
  id            String   @id @default(uuid())
  userId        String
  affiliateCode String
  tenantId      String
  touchpointUrl String
  expiresAt     DateTime
  createdAt     DateTime @default(now())

  @@unique([userId, tenantId])
  @@index([affiliateCode])
}
```

### `AffiliateClick` — Atomic Phase 080 (Phase5-7_EbooklineliffV2.md:4864)

```prisma
// Source: Atomic Phase 080
model AffiliateClick {
  id            String      @id @default(uuid())
  shareEventId  String
  shareEvent    ShareEvent  @relation(fields: [shareEventId], references: [id], onDelete: Cascade)
  visitorLineId String?
  ipAddress     String
  userAgent     String
  isConverted   Boolean     @default(false)
  convertedOrderId String?  @unique
  createdAt     DateTime    @default(now())

  @@index([shareEventId])
  @@index([visitorLineId])
}
```

### `AffiliatePayout` — Atomic Phase 079, Atomic Phase 128 (Phase5-7_EbooklineliffV2.md:4359)

```prisma
// Source: Atomic Phase 079, Atomic Phase 128
model AffiliatePayout {
  id                 String       @id @default(uuid())
  payoutNo           String       @unique
  userId             String
  user               User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  requestedAmount    Decimal      @db.Decimal(10, 2)
  taxWithheldAmount  Decimal      @db.Decimal(10, 2) // 3% e-Withholding Tax
  netPayoutAmount    Decimal      @db.Decimal(10, 2)
  bankName           String
  bankAccountNumber  String
  bankAccountName    String
  status             PayoutStatus @default(REQUESTED)
  processedAt        DateTime?
  rejectionReason    String?
  createdAt          DateTime     @default(now())
  updatedAt          DateTime     @updatedAt

  @@index([userId])
  @@index([payoutNo])
}
```

### `AffiliateTierConfig` — Atomic Phase 079 (Phase5-7_EbooklineliffV2.md:4327)

```prisma
// Source: Atomic Phase 079
model AffiliateTierConfig {
  id               String             @id @default(uuid())
  productId        String?            @unique // NULL means Global Default Config
  tier1RatePercent Decimal            @default(10.00) @db.Decimal(5, 2)
  tier2RatePercent Decimal            @default(3.00) @db.Decimal(5, 2)
  tier3RatePercent Decimal            @default(1.00) @db.Decimal(5, 2)
  isActive         Boolean            @default(true)
  createdAt        DateTime           @default(now())
  updatedAt        DateTime           @updatedAt
}
```

### `AiChatMessage` — Atomic Phase 092 (Phase5-7_EbooklineliffV2.md:11073)

```prisma
// Source: Atomic Phase 092
model AiChatMessage {
  id             String        @id @default(uuid())
  sessionId      String
  session        AiChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  sender         String        // 'USER' | 'AI'
  content        String        @db.Text
  citationsJson  Json?
  promptTokens   Int           @default(0)
  completionTokens Int         @default(0)
  createdAt      DateTime      @default(now())

  @@index([sessionId])
}
```

### `AiChatSession` — Atomic Phase 092 (Phase5-7_EbooklineliffV2.md:11060)

```prisma
// Source: Atomic Phase 092
model AiChatSession {
  id           String          @id @default(uuid())
  userId       String
  user         User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  productId    String
  product      Product         @relation(fields: [productId], references: [id], onDelete: Cascade)
  messages     AiChatMessage[]
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  @@index([userId, productId])
}
```

### `AiCoPilotJob` — Atomic Phase 094 (Phase5-7_EbooklineliffV2.md:11993)

```prisma
// Source: Atomic Phase 094
model AiCoPilotJob {
  id              String      @id @default(uuid())
  userId          String
  user            User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  jobType         AiJobType
  status          AiJobStatus @default(QUEUED)
  progressPercent Int         @default(0)
  inputPayload    Json
  resultData      Json?
  errorMessage    String?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@index([userId])
  @@index([status])
}
```

### `AiGeneratedQuiz` — Atomic Phase 094 (Phase5-7_EbooklineliffV2.md:12038)

```prisma
// Source: Atomic Phase 094
model AiGeneratedQuiz {
  id          String       @id @default(uuid())
  lessonId    String
  lesson      CourseLesson @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  question    String
  optionsJson Json         // Array of options
  answerIndex Int
  explanation String
  createdAt   DateTime     @default(now())

  @@index([lessonId])
}
```

### `AppVersion` — Atomic Phase 033 (Phase1-4_EbooklineliffV2.md:17894)

```prisma
// Source: Atomic Phase 033
model AppVersion {
  id                  String   @id @default(uuid())
  tenantId            String
  version             String
  buildHash           String   @unique
  minSupportedVersion String
  updatePolicy        String   @default("OPTIONAL") // OPTIONAL, RECOMMENDED, FORCE_IMMEDIATE
  releaseNotes        String?  @db.Text
  assetsManifestUrl   String?
  isActive            Boolean  @default(true)
  releasedAt          DateTime @default(now())
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  clientDeviceLogs    ClientDeviceLog[]

  @@index([tenantId, isActive])
  @@index([version])
}
```

### `AuditLog` — Atomic Phase 003, Atomic Phase 109, Atomic Phase 118, Atomic Phase 128 (Phase5-7_EbooklineliffV2.md:24725)

```prisma
// Source: Atomic Phase 003, Atomic Phase 109, Atomic Phase 118, Atomic Phase 128
model AuditLog {
  id                String               @id @default(uuid())
  sequenceNumber    BigInt               @unique @default(autoincrement())
  actorId           String
  actorRole         AuditAdminRole
  actorEmail        String
  ipAddress         String
  userAgent         String
  actionCategory    AuditActionCategory
  actionName        String
  targetEntity      String
  targetEntityId    String?
  payloadBeforeJson Json?                @db.JsonB
  payloadAfterJson  Json?                @db.JsonB
  previousHash      String               @db.VarChar(64)
  currentHash       String               @db.VarChar(64)
  signature         String               @db.Text
  integrityStatus   AuditIntegrityStatus @default(PENDING_VAULT_SYNC)
  createdAt         DateTime             @default(now())

  actor             User                 @relation(fields: [actorId], references: [id], onDelete: Restrict)

  @@index([sequenceNumber])
  @@index([actorId])
  @@index([actionCategory])
  @@index([createdAt])
  @@index([currentHash])
}
```

### `AuditVaultSyncState` — Atomic Phase 118 (Phase5-7_EbooklineliffV2.md:24754)

```prisma
// Source: Atomic Phase 118
model AuditVaultSyncState {
  id                 String   @id @default(uuid())
  lastSyncedSequence BigInt   @unique
  lastSyncedHash     String   @db.VarChar(64)
  r2ObjectKey        String
  syncedAt           DateTime @default(now())
}
```

### `AuthAuditLog` — Atomic Phase 005, Atomic Phase 006 (Phase1-4_EbooklineliffV2.md:3425)

```prisma
// Source: Atomic Phase 005, Atomic Phase 006
model AuthAuditLog {
  id        String   @id @default(uuid())
  userId    String?
  user      User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  event     String   // e.g., "LINE_LIFF_LOGIN_SUCCESS", "INVALID_TOKEN_ATTEMPT"
  ipAddress String?
  details   Json?
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([event])
}
```

### `AuthSession` — Atomic Phase 006 (Phase1-4_EbooklineliffV2.md:3410)

```prisma
// Source: Atomic Phase 006
model AuthSession {
  id           String    @id @default(uuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshToken String    @unique
  ipAddress    String?
  userAgent    String?
  isRevoked    Boolean   @default(false)
  expiresAt    DateTime
  createdAt    DateTime  @default(now())

  @@index([userId])
  @@index([refreshToken])
}
```

### `B2BCorporateSeat` — Atomic Phase 098 (Phase5-7_EbooklineliffV2.md:13814)

```prisma
// Source: Atomic Phase 098
model B2BCorporateSeat {
  id             String            @id @default(uuid())
  organizationId String
  organization   B2BOrganization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  departmentId   String?
  department     B2BDepartment?    @relation(fields: [departmentId], references: [id], onDelete: SetNull)
  userId         String?           @unique
  user           User?             @relation(fields: [userId], references: [id], onDelete: SetNull)
  employeeEmail  String
  employeeName   String?
  status         String            @default("INVITED") // INVITED, ACTIVE, REVOKED
  assignedAt     DateTime          @default(now())

  quizAttempts   B2BQuizAttempt[]

  @@index([organizationId])
  @@index([departmentId])
  @@index([employeeEmail])
}
```

### `B2BDepartment` — Atomic Phase 098 (Phase5-7_EbooklineliffV2.md:13805)

```prisma
// Source: Atomic Phase 098
model B2BDepartment {
  id             String            @id @default(uuid())
  organizationId String
  organization   B2BOrganization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name           String
  seats          B2BCorporateSeat[]
  createdAt      DateTime          @default(now())
}
```

### `B2BOrganization` — Atomic Phase 098 (Phase5-7_EbooklineliffV2.md:13792)

```prisma
// Source: Atomic Phase 098
model B2BOrganization {
  id             String            @id @default(uuid())
  companyName    String
  taxId          String?           @unique
  logoUrl        String?
  totalSeats     Int               @default(0)
  usedSeats      Int               @default(0)
  departments    B2BDepartment[]
  corporateSeats B2BCorporateSeat[]
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
}
```

### `B2BQuizAttempt` — Atomic Phase 098 (Phase5-7_EbooklineliffV2.md:13834)

```prisma
// Source: Atomic Phase 098
model B2BQuizAttempt {
  id             String           @id @default(uuid())
  seatId         String
  seat           B2BCorporateSeat @relation(fields: [seatId], references: [id], onDelete: Cascade)
  courseId       String
  quizId         String
  scoreObtained  Decimal          @db.Decimal(5, 2)
  maxScore       Decimal          @db.Decimal(5, 2)
  isPassed       Boolean          @default(false)
  timeTakenSec   Int
  completedAt    DateTime         @default(now())

  @@index([seatId])
  @@index([courseId])
}
```

### `Badge` — Atomic Phase 083 (Phase5-7_EbooklineliffV2.md:6382)

```prisma
// Source: Atomic Phase 083
model Badge {
  id                String        @id @default(uuid())
  code              String        @unique
  name              String
  description       String
  iconUrl           String
  category          BadgeCategory @default(READING_MILESTONE)
  criteriaType      String        // e.g., "READ_PAGES", "STREAK_DAYS", "PURCHASE_COUNT"
  criteriaThreshold Int
  pointsReward      Int           @default(100)
  userBadges        UserBadge[]
  createdAt         DateTime      @default(now())
}
```

### `BankAccountConfig` — Atomic Phase 115 (Phase5-7_EbooklineliffV2.md:23188)

```prisma
// Source: Atomic Phase 115
model BankAccountConfig {
  id                      String          @id @default(uuid())
  tenantId                String          @default("DEFAULT")
  bankName                String
  bankCode                String
  accountNumber           String          @unique
  promptPayId             String?
  autoMatchToleranceMins  Int             @default(30)
  isEnabled               Boolean         @default(true)
  statements              BankStatement[]
  createdAt               DateTime        @default(now())
  updatedAt               DateTime        @updatedAt

  @@index([tenantId])
}
```

### `BankStatement` — Atomic Phase 115 (Phase5-7_EbooklineliffV2.md:23204)

```prisma
// Source: Atomic Phase 115
model BankStatement {
  id                 String               @id @default(uuid())
  bankAccountId      String
  bankAccount        BankAccountConfig    @relation(fields: [bankAccountId], references: [id])
  transRef           String?              @unique
  amount             Decimal              @db.Decimal(12, 2)
  txType             String               @default("CREDIT") // CREDIT or DEBIT
  txTimestamp        DateTime
  senderBank         String?
  senderName         String?
  rawPayload         Json
  hashSign           String               // SHA-256 of raw data to prevent duplicates
  status             ReconciliationStatus @default(UNMATCHED)
  mismatchReason     String?
  matchedOrderId     String?              @unique
  matchedOrder       Order?               @relation(fields: [matchedOrderId], references: [id])
  source             StatementSource      @default(BANK_WEBHOOK)

  reconciliationLogs ReconciliationLog[]
  manualOverrides    FinancialManualOverride[]

  createdAt          DateTime             @default(now())
  updatedAt          DateTime             @updatedAt

  @@index([transRef])
  @@index([status])
  @@index([txTimestamp])
  @@index([amount])
}
```

### `BehavioralCampaign` — Atomic Phase 084 (Phase5-7_EbooklineliffV2.md:7097)

```prisma
// Source: Atomic Phase 084
model BehavioralCampaign {
  id            String   @id @default(uuid())
  tenantId      String
  name          String
  isActive      Boolean  @default(true)
  delayMinutes  Int      @default(15)
  discountType  String   @default("PERCENTAGE") // PERCENTAGE / FIXED
  discountValue Decimal  @default(10.00) @db.Decimal(10, 2)
  flexTemplate  Json     // Custom LINE Flex Template Structure
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([tenantId, isActive])
}
```

### `BookProcessingJob` — Atomic Phase 038 (Phase1-4_EbooklineliffV2.md:20241)

```prisma
// Source: Atomic Phase 038
model BookProcessingJob {
  id                 String        @id @default(uuid())
  productId          String        @unique
  product            Product       @relation(fields: [productId], references: [id], onDelete: Cascade)
  status             BookJobStatus @default(QUEUED)
  progressPercentage Float         @default(0.0)
  totalPages         Int           @default(0)
  processedPages     Int           @default(0)
  errorMessage       String?       @db.Text
  startedAt          DateTime?
  completedAt        DateTime?
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  @@index([status])
}
```

### `BundleItem` — Atomic Phase 008, Atomic Phase 074 (Phase1-4_EbooklineliffV2.md:4711)

```prisma
// Source: Atomic Phase 008, Atomic Phase 074
model BundleItem {
  id             String   @id @default(uuid())
  parentBundleId String
  parentBundle   Product  @relation("ParentBundle", fields: [parentBundleId], references: [id], onDelete: Cascade)
  childProductId String
  childProduct   Product  @relation("ChildProducts", fields: [childProductId], references: [id], onDelete: Cascade)

  createdAt      DateTime @default(now())

  @@unique([parentBundleId, childProductId])
}
```

### `BundleManifest` — Atomic Phase 029 (Phase1-4_EbooklineliffV2.md:16140)

```prisma
// Source: Atomic Phase 029
model BundleManifest {
  id             String   @id @default(uuid())
  buildHash      String   @unique
  totalSizeBytes Int
  gzipSizeBytes  Int
  isPassedGuard  Boolean  @default(true)
  chunksJson     Json     // Detail of generated JS/CSS chunks
  createdAt      DateTime @default(now())

  @@index([buildHash])
}
```

### `Campaign` — Atomic Phase 117 (Phase5-7_EbooklineliffV2.md:24200)

```prisma
// Source: Atomic Phase 117
model Campaign {
  id              String         @id @default(uuid())
  tenantId        String?
  name            String
  slug            String         @unique
  description     String?        @db.Text
  bannerImageUrl  String?
  startDate       DateTime
  endDate         DateTime
  isActive        Boolean        @default(true)
  coupons         Coupon[]
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([tenantId])
  @@index([startDate, endDate])
}
```

### `CampaignAnalyticsLog` — Atomic Phase 116 (Phase5-7_EbooklineliffV2.md:23840)

```prisma
// Source: Atomic Phase 116
model CampaignAnalyticsLog {
  id              String            @id @default(uuid())
  campaignId      String
  campaign        MarketingCampaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  date            DateTime          @db.Date
  clicks          Int               @default(0)
  conversions     Int               @default(0)
  spend           Decimal           @db.Decimal(10, 2)
  calculatedCac   Decimal           @db.Decimal(10, 2)

  @@unique([campaignId, date])
}
```

### `CarrierApiConfig` — Atomic Phase 077 (Phase5-7_EbooklineliffV2.md:3079)

```prisma
// Source: Atomic Phase 077
model CarrierApiConfig {
  id            String           @id @default(uuid())
  carrier       LogisticsCarrier @unique
  mchId         String           // Merchant ID / Account
  apiKey        String           @db.Text
  apiSecret     String           @db.Text
  isSandbox     Boolean          @default(false)
  isActive      Boolean          @default(true)
  updatedAt     DateTime         @updatedAt
}
```

### `Cart` — Atomic Phase 011, Atomic Phase 084 (Phase5-7_EbooklineliffV2.md:7047)

```prisma
// Source: Atomic Phase 011, Atomic Phase 084
model Cart {
  id             String            @id @default(uuid())
  userId         String            @unique
  user           User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenantId       String            @default("default")
  status         AbandonedStatus   @default(ACTIVE)
  lastActivityAt DateTime          @default(now())
  abandonedAt    DateTime?
  recoveredAt    DateTime?

  items          CartItem[]
  logs           AbandonedCartLog[]

  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  @@index([userId])
  @@index([status, lastActivityAt])
}
```

### `CartItem` — Atomic Phase 011, Atomic Phase 084 (Phase1-4_EbooklineliffV2.md:6220)

```prisma
// Source: Atomic Phase 011, Atomic Phase 084
model CartItem {
  id           String   @id @default(uuid())
  cartId       String
  cart         Cart     @relation(fields: [cartId], references: [id], onDelete: Cascade)
  productId    String
  product      Product  @relation(fields: [productId], references: [id])
  quantity     Int      @default(1)
  itemCategory String   @default("DIGITAL") // "DIGITAL" or "PHYSICAL"
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([cartId, productId])
  @@index([cartId])
  @@index([productId])
}
```

### `Category` — Atomic Phase 008, Atomic Phase 009 (Phase1-4_EbooklineliffV2.md:5138)

```prisma
// Source: Atomic Phase 008, Atomic Phase 009
model Category {
  id          String            @id @default(uuid())
  tenantId    String
  name        String
  slug        String            @unique
  description String?
  products    ProductCategory[]
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  @@index([tenantId])
}
```

### `CertificateVerificationLog` — Atomic Phase 105 (Phase5-7_EbooklineliffV2.md:17443)

```prisma
// Source: Atomic Phase 105
model CertificateVerificationLog {
  id            String            @id @default(uuid())
  certificateId String
  certificate   CourseCertificate @relation(fields: [certificateId], references: [id], onDelete: Cascade)
  scannedAt     DateTime          @default(now())
  ipAddress     String
  userAgent     String
  isSuccess     Boolean
  resultStatus  String            // VERIFIED, INVALID, REVOKED

  @@index([certificateId])
  @@index([scannedAt])
}
```

### `ChaosTestRun` — Atomic Phase 124 (Phase5-7_EbooklineliffV2.md:27372)

```prisma
// Source: Atomic Phase 124
model ChaosTestRun {
  id            String         @id @default(uuid())
  faultType     ChaosFaultType
  targetService String
  durationMs    Int
  failureRate   Float          @default(1.0)
  isActive      Boolean        @default(true)
  triggeredBy   String
  startedAt     DateTime       @default(now())
  endedAt       DateTime?

  @@index([faultType, isActive])
}
```

### `CircuitBreakerMetric` — Atomic Phase 124 (Phase5-7_EbooklineliffV2.md:27386)

```prisma
// Source: Atomic Phase 124
model CircuitBreakerMetric {
  id              String       @id @default(uuid())
  serviceName     String       @unique
  state           CircuitState @default(CLOSED)
  failureCount    Int          @default(0)
  successCount    Int          @default(0)
  lastStateChange DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
}
```

### `ClientDeviceLog` — Atomic Phase 033 (Phase1-4_EbooklineliffV2.md:17914)

```prisma
// Source: Atomic Phase 033
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
  appVersion      AppVersion? @relation(fields: [appVersionId], references: [id])
  updatedAt       DateTime   @updatedAt
  createdAt       DateTime   @default(now())

  @@index([tenantId, clientVersion])
}
```

### `CommissionLog` — Atomic Phase 079 (Phase5-7_EbooklineliffV2.md:4338)

```prisma
// Source: Atomic Phase 079
model CommissionLog {
  id              String             @id @default(uuid())
  orderId         String
  order           Order              @relation(fields: [orderId], references: [id], onDelete: Cascade)
  beneficiaryId   String
  beneficiary     User               @relation("EarnedCommissions", fields: [beneficiaryId], references: [id])
  originBuyerId   String
  originBuyer     User               @relation("GeneratedCommissions", fields: [originBuyerId], references: [id])
  tierLevel       AffiliateTierLevel
  orderAmount     Decimal            @db.Decimal(10, 2)
  commissionRate  Decimal            @db.Decimal(5, 2)
  commissionAmount Decimal           @db.Decimal(10, 2)
  status          CommissionStatus   @default(APPROVED)
  fraudReason     String?
  createdAt       DateTime           @default(now())

  @@index([beneficiaryId])
  @@index([orderId])
  @@index([originBuyerId])
}
```

### `CommissionRule` — Atomic Phase 081 (Phase5-7_EbooklineliffV2.md:5395)

```prisma
// Source: Atomic Phase 081
model CommissionRule {
  id                 String   @id @default(uuid())
  productId          String?  @unique // Null for global rule
  platformFeePercent Decimal  @default(5.00) @db.Decimal(5, 2)
  tier1Percent       Decimal  @default(10.00) @db.Decimal(5, 2)
  tier2Percent       Decimal  @default(2.00) @db.Decimal(5, 2)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

### `CompanyTheme` — Atomic Phase 072 (Phase5-7_EbooklineliffV2.md:573)

```prisma
// Source: Atomic Phase 072
model CompanyTheme {
  id                   String   @id @default(uuid())
  tenantId             String   @unique
  tenant               Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  primaryColor         String   @default("#059669")
  secondaryColor       String   @default("#10B981")
  accentColor          String   @default("#F59E0B")
  backgroundColor      String   @default("#FFFFFF")
  textColor            String   @default("#0F172A")
  borderRadiusRem      Float    @default(0.5)
  primaryLogoUrl       String
  squareLogoUrl        String?
  faviconUrl           String?
  watermarkLogoUrl     String?
  fontFamily           String   @default("Inter")
  fontUrl              String?
  isAccessibilityValid Boolean  @default(true)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([tenantId])
}
```

### `ContentFlagReport` — Atomic Phase 112 (Phase5-7_EbooklineliffV2.md:21532)

```prisma
// Source: Atomic Phase 112
model ContentFlagReport {
  id           String       @id @default(uuid())
  productId    String
  product      Product      @relation(fields: [productId], references: [id], onDelete: Cascade)
  reporterId   String
  reporter     User         @relation(fields: [reporterId], references: [id])
  category     FlagCategory
  description  String       @db.Text
  evidenceUrls String[]
  isResolved   Boolean      @default(false)
  createdAt    DateTime     @default(now())

  @@index([productId])
  @@index([reporterId])
}
```

### `ContentHeatmapAggregate` — Atomic Phase 052 (Phase1-4_EbooklineliffV2.md:27224)

```prisma
// Source: Atomic Phase 052
model ContentHeatmapAggregate {
  id                   String   @id @default(uuid())
  productId            String
  contentType          ProductType
  segmentIndex         Int      // Page Number หรือ Interval 5-second ของวิดีโอ
  viewCount            Int      @default(0)
  totalDwellTimeSec    BigInt   @default(0)
  dropoffCount         Int      @default(0)
  updatedAt            DateTime @updatedAt

  @@unique([productId, contentType, segmentIndex])
  @@index([productId])
}
```

### `ContentModerationLog` — Atomic Phase 112 (Phase5-7_EbooklineliffV2.md:21503)

```prisma
// Source: Atomic Phase 112
model ContentModerationLog {
  id                String             @id @default(uuid())
  productId         String
  product           Product            @relation(fields: [productId], references: [id], onDelete: Cascade)
  status            ModerationStatus   @default(PENDING_SCAN)
  confidenceScore   Decimal            @default(0.00) @db.Decimal(5, 4)
  severity          ModerationSeverity @default(LOW)
  flaggedCategories FlagCategory[]
  violatingPages    String[]           // e.g. ["page_12", "timestamp_01:23:45"]
  aiAnalysisJson    Json?
  scannedAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt

  @@index([productId])
  @@index([status])
}
```

### `ContentVectorChunk` — Atomic Phase 092 (Phase5-7_EbooklineliffV2.md:11042)

```prisma
// Source: Atomic Phase 092
model ContentVectorChunk {
  id             String           @id @default(uuid())
  productId      String
  product        Product          @relation(fields: [productId], references: [id], onDelete: Cascade)
  sourceType     VectorSourceType
  pageNumber     Int?
  lessonId       String?
  chunkIndex     Int
  textContent    String           @db.Text
  // pgvector extension support for 1536-dimensional embeddings (e.g., text-embedding-3-small)
  embedding      Unsupported("vector(1536)")?
  metadataJson   Json
  createdAt      DateTime         @default(now())

  @@index([productId])
  @@index([sourceType])
}
```

### `ContentVectorEmbedding` — Atomic Phase 091 (Phase5-7_EbooklineliffV2.md:10550)

```prisma
// Source: Atomic Phase 091
model ContentVectorEmbedding {
  id           String            @id @default(uuid())
  tenantId     String
  productId    String
  sourceType   ContentSourceType
  sourceId     String            // EbookDetail ID หรือ CourseLesson ID
  chunkIndex   Int
  contentText  String            @db.Text
  // pgvector extension column type Unsupported("vector(1536)")
  embedding    Unsupported("vector(1536)")?
  metadataJson Json?             // เก็บข้อมูลเพิ่มเติม เช่น pageNumber, timestampSec
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt

  product      Product           @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([productId])
  @@index([sourceType, sourceId])
}
```

### `CopyrightFingerprint` — Atomic Phase 112 (Phase5-7_EbooklineliffV2.md:21520)

```prisma
// Source: Atomic Phase 112
model CopyrightFingerprint {
  id                 String   @id @default(uuid())
  productId          String   @unique
  product            Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  perceptualHash     String   // pHash for cover & keyframes
  textEmbeddingHash  String?  // Hash of text semantic vector
  digitalWatermarkId String   @unique @default(uuid())
  createdAt          DateTime @default(now())

  @@index([perceptualHash])
}
```

### `CorporateAccount` — Atomic Phase 097 (Phase5-7_EbooklineliffV2.md:13305)

```prisma
// Source: Atomic Phase 097
model CorporateAccount {
  id             String                @id @default(uuid())
  companyName    String
  taxId          String                @unique
  contactEmail   String
  contactPhone   String?
  billingAddress String                @db.Text
  licenses       CorporateLicense[]
  departments    CorporateDepartment[]
  createdAt      DateTime              @default(now())
  updatedAt      DateTime              @updatedAt

  @@index([taxId])
}
```

### `CorporateDepartment` — Atomic Phase 097 (Phase5-7_EbooklineliffV2.md:13320)

```prisma
// Source: Atomic Phase 097
model CorporateDepartment {
  id                 String           @id @default(uuid())
  corporateAccountId String
  corporateAccount   CorporateAccount @relation(fields: [corporateAccountId], references: [id], onDelete: Cascade)
  name               String
  seats              CorporateSeat[]
  createdAt          DateTime         @default(now())
}
```

### `CorporateLicense` — Atomic Phase 097 (Phase5-7_EbooklineliffV2.md:13329)

```prisma
// Source: Atomic Phase 097
model CorporateLicense {
  id                 String                 @id @default(uuid())
  corporateAccountId String
  corporateAccount   CorporateAccount       @relation(fields: [corporateAccountId], references: [id], onDelete: Cascade)
  productId          String
  product            Product                @relation(fields: [productId], references: [id])
  totalSeats         Int
  usedSeats          Int                    @default(0)
  licenseCode        String                 @unique @default(uuid())
  status             CorporateLicenseStatus @default(ACTIVE)
  expiresAt          DateTime?
  seats              CorporateSeat[]
  createdAt          DateTime               @default(now())
  updatedAt          DateTime               @updatedAt

  @@index([corporateAccountId])
  @@index([licenseCode])
}
```

### `CorporateSeat` — Atomic Phase 097 (Phase5-7_EbooklineliffV2.md:13348)

```prisma
// Source: Atomic Phase 097
model CorporateSeat {
  id               String               @id @default(uuid())
  licenseId        String
  license          CorporateLicense     @relation(fields: [licenseId], references: [id], onDelete: Cascade)
  departmentId     String?
  department       CorporateDepartment? @relation(fields: [departmentId], references: [id], onDelete: SetNull)
  assignedUserId   String?
  assignedUser     User?                @relation(fields: [assignedUserId], references: [id], onDelete: SetNull)
  inviteEmail      String?
  inviteLineUserId String?
  status           SeatStatus           @default(UNASSIGNED)
  assignedAt       DateTime?
  revokedAt        DateTime?
  createdAt        DateTime             @default(now())
  updatedAt        DateTime             @updatedAt

  @@index([licenseId])
  @@index([assignedUserId])
  @@index([inviteEmail])
}
```

### `Coupon` — Atomic Phase 088, Atomic Phase 117 (Phase5-7_EbooklineliffV2.md:24218)

```prisma
// Source: Atomic Phase 088, Atomic Phase 117
model Coupon {
  id                  String             @id @default(uuid())
  campaignId          String?
  campaign            Campaign?          @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  code                String             @unique
  scope               CouponScope        @default(GLOBAL_PLATFORM)
  sellerId            String?            // Null if Platform-wide
  couponType          CouponType
  discountValue       Decimal            @db.Decimal(10, 2) // Amount or Percentage value
  maxDiscountAmount   Decimal?           @db.Decimal(10, 2) // Cap for percentage coupons
  minPurchaseAmount   Decimal            @default(0.00) @db.Decimal(10, 2)
  globalUsageLimit    Int                @default(1000)
  perUserUsageLimit   Int                @default(1)
  currentUsageCount   Int                @default(0)
  targetProductType   ProductType?       // Null if applies to all types

  // Stacking Rules Configuration
  canStackWithPlatform Boolean           @default(true)
  canStackWithStore    Boolean           @default(false)
  canStackWithShipping Boolean           @default(true)

  startDate           DateTime
  endDate             DateTime
  isActive            Boolean            @default(true)

  redemptions         CouponRedemption[]
  userClaims          UserCouponClaim[]

  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt

  @@index([code])
  @@index([sellerId])
  @@index([isActive, startDate, endDate])
}
```

### `CouponRedemption` — Atomic Phase 088, Atomic Phase 117 (Phase5-7_EbooklineliffV2.md:24267)

```prisma
// Source: Atomic Phase 088, Atomic Phase 117
model CouponRedemption {
  id             String   @id @default(uuid())
  couponId       String
  coupon         Coupon   @relation(fields: [couponId], references: [id])
  userId         String
  user           User     @relation(fields: [userId], references: [id])
  orderId        String
  order          Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  discountAmount Decimal  @db.Decimal(10, 2)
  redeemedAt     DateTime @default(now())

  @@index([couponId])
  @@index([userId])
  @@index([orderId])
}
```

### `CouponTargetProduct` — Atomic Phase 088 (Phase5-7_EbooklineliffV2.md:8977)

```prisma
// Source: Atomic Phase 088
model CouponTargetProduct {
  id        String   @id @default(uuid())
  couponId  String
  coupon    Coupon   @relation(fields: [couponId], references: [id], onDelete: Cascade)
  productId String
  createdAt DateTime @default(now())

  @@unique([couponId, productId])
}
```

### `CourseCertificate` — Atomic Phase 048, Atomic Phase 105 (Phase5-7_EbooklineliffV2.md:17414)

```prisma
// Source: Atomic Phase 048, Atomic Phase 105
model CourseCertificate {
  id             String                   @id @default(uuid())
  certificateNo  String                   @unique
  userId         String
  user           User                     @relation(fields: [userId], references: [id], onDelete: Cascade)
  courseId       String
  course         CourseDetail             @relation(fields: [courseId], references: [id], onDelete: Cascade)
  issuedAt       DateTime                 @default(now())
  pdfStoragePath String

  // Security & Verification Extensions (Phase 105)
  hashSignature  String                   // HMAC-SHA256 signature calculated at issuance
  qrCodeUrl      String                   // Public verification link stored in QR
  isRevoked      Boolean                  @default(false)
  revokedAt      DateTime?
  revokedReason  String?
  viewCount      Int                      @default(0)

  // Verification Audit Logs
  verificationLogs CertificateVerificationLog[]

  createdAt      DateTime                 @default(now())
  updatedAt      DateTime                 @updatedAt

  @@index([certificateNo])
  @@index([hashSignature])
  @@index([userId])
}
```

### `CourseDetail` — Atomic Phase 000, Atomic Phase 008, Atomic Phase 037, Atomic Phase 045, Atomic Phase 051, Atomic Phase 078, Atomic Phase 093, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:4668)

```prisma
// Source: Atomic Phase 000, Atomic Phase 008, Atomic Phase 037, Atomic Phase 045, Atomic Phase 051, Atomic Phase 078, Atomic Phase 093, Atomic Phase 128
model CourseDetail {
  id                 String          @id @default(uuid())
  productId          String          @unique
  product            Product         @relation(fields: [productId], references: [id], onDelete: Cascade)
  totalHours         Float           @default(0.0)
  certificateEnabled Boolean         @default(true)
  dripContentEnabled Boolean         @default(false)
  sections           CourseSection[]

  createdAt          DateTime        @default(now())
  updatedAt          DateTime        @updatedAt
}
```

### `CourseLearningProgress` — Atomic Phase 000, Atomic Phase 018, Atomic Phase 045, Atomic Phase 046, Atomic Phase 054, Atomic Phase 057, Atomic Phase 064, Atomic Phase 093, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:23611)

```prisma
// Source: Atomic Phase 000, Atomic Phase 018, Atomic Phase 045, Atomic Phase 046, Atomic Phase 054, Atomic Phase 057, Atomic Phase 064, Atomic Phase 093, Atomic Phase 128
model CourseLearningProgress {
  id          String       @id @default(uuid())
  userId      String
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  lessonId    String
  lesson      CourseLesson @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  watchedSec  Int          @default(0)
  isCompleted Boolean      @default(false)
  updatedAt   DateTime     @updatedAt

  @@unique([userId, lessonId])
  @@index([userId])
  @@index([lessonId])
}
```

### `CourseLesson` — Atomic Phase 008, Atomic Phase 036, Atomic Phase 037, Atomic Phase 045, Atomic Phase 051, Atomic Phase 058, Atomic Phase 078, Atomic Phase 093, Atomic Phase 102, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:30222)

```prisma
// Source: Atomic Phase 008, Atomic Phase 036, Atomic Phase 037, Atomic Phase 045, Atomic Phase 051, Atomic Phase 058, Atomic Phase 078, Atomic Phase 093, Atomic Phase 102, Atomic Phase 128
model CourseLesson {
  id                   String                 @id @default(uuid())
  sectionId            String
  section              CourseSection          @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  lessonOrder          Int
  title                String
  videoHlsUrl          String
  durationSec          Int
  isPreview            Boolean                @default(false)

  // Phase 058: High-Performance Thumbnail Scrubbing Metadata
  hasSpriteScrubbing   Boolean                @default(false)
  spriteVttUrl         String?
  spriteIntervalSec    Int                    @default(2)
  tileWidth            Int                    @default(160)
  tileHeight           Int                    @default(90)
  columnsCount         Int                    @default(10)
  spriteSheets         VideoSpriteSheet[]

  quizzes              LessonQuiz[]
  learningProgress     CourseLearningProgress[]
  createdAt            DateTime               @default(now())
  updatedAt            DateTime               @updatedAt

  @@index([sectionId])
}
```

### `CourseSection` — Atomic Phase 008, Atomic Phase 037, Atomic Phase 045, Atomic Phase 051, Atomic Phase 078, Atomic Phase 128 (Phase5-7_EbooklineliffV2.md:3711)

```prisma
// Source: Atomic Phase 008, Atomic Phase 037, Atomic Phase 045, Atomic Phase 051, Atomic Phase 078, Atomic Phase 128
model CourseSection {
  id           String         @id @default(uuid())
  courseId     String
  course       CourseDetail   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  sectionOrder Int            @default(0)
  title        String
  lessons      CourseLesson[]
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt

  @@index([courseId])
  @@index([sectionOrder])
}
```

### `CreatorAppeal` — Atomic Phase 112 (Phase5-7_EbooklineliffV2.md:21548)

```prisma
// Source: Atomic Phase 112
model CreatorAppeal {
  id             String    @id @default(uuid())
  productId      String    @unique
  product        Product   @relation(fields: [productId], references: [id], onDelete: Cascade)
  creatorId      String
  creator        User      @relation(fields: [creatorId], references: [id])
  appealReason   String    @db.Text
  proofDocuments String[]
  status         String    @default("PENDING") // PENDING, APPROVED, REJECTED
  reviewedBy     String?
  adminNotes     String?   @db.Text
  reviewedAt     DateTime?
  createdAt      DateTime  @default(now())

  @@index([creatorId])
  @@index([status])
}
```

### `CreatorKYC` — Atomic Phase 003, Atomic Phase 085, Atomic Phase 109, Atomic Phase 111 (Phase5-7_EbooklineliffV2.md:21009)

```prisma
// Source: Atomic Phase 003, Atomic Phase 085, Atomic Phase 109, Atomic Phase 111
model CreatorKYC {
  id                     String         @id @default(uuid())
  userId                 String         @unique
  user                   User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Encrypted PII Fields (AES-256-GCM)
  idCardNumberEncrypted  String
  idCardNumberMasked     String         // e.g. 1-1004-XXXXX-12-1
  fullNameTh             String
  dateOfBirth            DateTime?

  // Financial PII Fields
  bankName               String
  bankAccountNumberEncrypted String
  bankAccountNumberMasked    String     // e.g. XXX-X-X1234-X
  bankAccountName        String
  taxIdEncrypted         String?

  // Document Vault Storage Paths (Private R2 Bucket Paths)
  idCardR2Key            String
  bankBookR2Key          String

  // Verification Metrics & AI OCR Assessment
  ocrConfidenceScore     Decimal        @db.Decimal(5, 2)
  ocrRawJson             Json?
  riskLevel              KYCRiskLevel   @default(LOW)
  isPossibleTamper       Boolean        @default(false)

  // Approval Lifecycle
  status                 KYCStatus      @default(PENDING)
  submittedAt            DateTime       @default(now())
  verifiedAt             DateTime?
  verifiedByAdminId      String?
  rejectionReason        String?        @db.Text

  auditLogs              KYCAuditLog[]

  @@index([userId])
  @@index([status])
  @@index([riskLevel])
  @@index([submittedAt])
}
```

### `CreatorPayoutAccount` — Atomic Phase 085 (Phase5-7_EbooklineliffV2.md:7516)

```prisma
// Source: Atomic Phase 085
model CreatorPayoutAccount {
  id                 String              @id @default(uuid())
  creatorKycId       String              @unique
  creatorKyc         CreatorKYC          @relation(fields: [creatorKycId], references: [id], onDelete: Cascade)
  userId             String

  bankCode           String
  bankAccountNumberEnc String
  bankAccountName    String
  nameMatchScore     Decimal             @db.Decimal(5, 4)
  status             PayoutAccountStatus @default(PENDING_VERIFICATION)

  taxId              String?
  isWithholdingTaxReq Boolean            @default(true) // 3% Withholding Tax

  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt

  @@index([userId])
  @@index([status])
}
```

### `CrossDeviceSyncState` — Atomic Phase 070 (Phase1-4_EbooklineliffV2.md:36097)

```prisma
// Source: Atomic Phase 070
model CrossDeviceSyncState {
  id             String       @id @default(uuid())
  userId         String
  productId      String
  contentType    String       // "EBOOK" | "COURSE_LESSON"
  lastPage       Int?         @default(1)
  lastWatchedSec Int?         @default(0)
  vectorClock    Int          @default(1)
  lastDevice     DeviceType
  updatedAt      DateTime     @updatedAt

  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  product        Product      @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([userId, productId, contentType])
  @@index([userId, productId])
}
```

### `DailyAnalyticsSnapshot` — Atomic Phase 116 (Phase5-7_EbooklineliffV2.md:23853)

```prisma
// Source: Atomic Phase 116
model DailyAnalyticsSnapshot {
  id                   String   @id @default(uuid())
  tenantId             String
  snapshotDate         DateTime @db.Date
  gmv                  Decimal  @db.Decimal(12, 2)
  netRevenue           Decimal  @db.Decimal(12, 2)
  totalOrders          Int
  newUsersCount        Int
  activeUsersCount     Int
  churnedUsersCount    Int
  avgOrderValue        Decimal  @db.Decimal(10, 2)
  calculatedLtv        Decimal  @db.Decimal(10, 2)
  calculatedCac        Decimal  @db.Decimal(10, 2)
  churnRatePercentage  Float
  createdAt            DateTime @default(now())

  @@unique([tenantId, snapshotDate])
  @@index([tenantId])
}
```

### `DailyCheckin` — Atomic Phase 083, Atomic Phase 128 (Phase5-7_EbooklineliffV2.md:6366)

```prisma
// Source: Atomic Phase 083, Atomic Phase 128
model DailyCheckin {
  id              String   @id @default(uuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  checkinDate     DateTime @db.Date
  streakCount     Int      @default(1)
  pointsEarned    Int      @default(10)
  bonusMultiplier Decimal  @default(1.00) @db.Decimal(3, 2)
  isFrozenUsed    Boolean  @default(false)
  createdAt       DateTime @default(now())

  @@unique([userId, checkinDate])
  @@index([userId])
  @@index([checkinDate])
}
```

### `DataScopePolicy` — Atomic Phase 107 (Phase5-7_EbooklineliffV2.md:18594)

```prisma
// Source: Atomic Phase 107
model DataScopePolicy {
  id           String        @id @default(uuid())
  tenantId     String
  role         DataScopeRole
  canUnmask    Boolean       @default(false)
  maxUnmasksPerDay Int       @default(50)
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  @@unique([tenantId, role])
}
```

### `DataSubjectRequest` — Atomic Phase 129 (Phase5-7_EbooklineliffV2.md:29697)

```prisma
// Source: Atomic Phase 129
model DataSubjectRequest {
  id           String    @id @default(uuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  requestType  DSRType
  status       DSRStatus @default(PENDING)
  reason       String?   @db.Text
  processedBy  String?
  processedAt  DateTime?
  rejectedNote String?   @db.Text
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@index([userId])
  @@index([status])
}
```

### `DatabaseReplicaNode` — Atomic Phase 125 (Phase5-7_EbooklineliffV2.md:27872)

```prisma
// Source: Atomic Phase 125
model DatabaseReplicaNode {
  id               String    @id @default(uuid())
  regionZone       String    @unique // ASIA_SOUTHEAST, ASIA_EAST, US_WEST
  connectionString String
  isPrimary        Boolean   @default(false)
  isActive         Boolean   @default(true)
  maxConnections   Int       @default(100)
  currentLagMs     Int       @default(0)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@index([regionZone])
}
```

### `DeepLinkLog` — Atomic Phase 025 (Phase1-4_EbooklineliffV2.md:14329)

```prisma
// Source: Atomic Phase 025
model DeepLinkLog {
  id             String      @id @default(uuid())
  shortLinkId    String
  shortLink      ShortLink   @relation(fields: [shortLinkId], references: [id], onDelete: Cascade)
  environment    String
  ipAddress      String
  userAgent      String
  referer        String?
  convertedOrder Boolean     @default(false)
  createdAt      DateTime    @default(now())

  @@index([shortLinkId])
  @@index([createdAt])
}
```

### `DeviceStorageProfile` — Atomic Phase 068 (Phase1-4_EbooklineliffV2.md:35121)

```prisma
// Source: Atomic Phase 068
model DeviceStorageProfile {
  id                String   @id @default(uuid())
  userId            String
  deviceIdHash      String   @unique
  deviceModel       String?
  allocatedQuotaBytes BigInt  @default(5368709120) // Default 5GB
  usedStorageBytes  BigInt   @default(0)
  lastSyncAt        DateTime @updatedAt

  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

### `DisasterRecoverySnapshot` — Atomic Phase 127 (Phase5-7_EbooklineliffV2.md:28562)

```prisma
// Source: Atomic Phase 127
model DisasterRecoverySnapshot {
  id                String   @id @default(uuid())
  snapshotId        String   @unique
  backupType        String   // 'FULL', 'WAL_LOG', 'INCREMENTAL'
  r2StoragePath     String
  fileSizeBytes     BigInt
  checksumSha256    String
  verifiedAt        DateTime?
  isRestorationTested Boolean @default(false)
  createdAt         DateTime @default(now())

  @@index([snapshotId])
  @@index([createdAt])
}
```

### `DisputeClaim` — Atomic Phase 113 (Phase5-7_EbooklineliffV2.md:22116)

```prisma
// Source: Atomic Phase 113
model DisputeClaim {
  id                    String            @id @default(uuid())
  disputeNo             String            @unique
  orderId               String            @unique
  order                 Order             @relation(fields: [orderId], references: [id], onDelete: Cascade)
  escrowId              String            @unique
  escrow                EscrowAccount     @relation(fields: [escrowId], references: [id], onDelete: Cascade)
  buyerId               String
  buyer                 User              @relation("BuyerDisputes", fields: [buyerId], references: [id])
  reason                DisputeReason
  description           String            @db.Text
  requestedRefundAmount Decimal           @db.Decimal(10, 2)
  approvedRefundAmount  Decimal?          @db.Decimal(10, 2)
  status                DisputeStatus     @default(SUBMITTED)
  adminComment          String?           @db.Text
  resolvedById          String?
  evidences             DisputeEvidence[]
  timelines             DisputeTimeline[]
  createdAt             DateTime          @default(now())
  updatedAt             DateTime          @updatedAt

  @@index([buyerId])
  @@index([status])
}
```

### `DisputeEvidence` — Atomic Phase 113 (Phase5-7_EbooklineliffV2.md:22141)

```prisma
// Source: Atomic Phase 113
model DisputeEvidence {
  id           String       @id @default(uuid())
  disputeId    String
  dispute      DisputeClaim @relation(fields: [disputeId], references: [id], onDelete: Cascade)
  fileUrl      String
  fileType     String       @default("IMAGE") // IMAGE, VIDEO, DOCUMENT
  uploadedAt   DateTime     @default(now())
}
```

### `DisputeTimeline` — Atomic Phase 113 (Phase5-7_EbooklineliffV2.md:22150)

```prisma
// Source: Atomic Phase 113
model DisputeTimeline {
  id           String       @id @default(uuid())
  disputeId    String
  dispute      DisputeClaim @relation(fields: [disputeId], references: [id], onDelete: Cascade)
  actorRole    String       // BUYER, SELLER, ADMIN, SYSTEM
  actionState  String
  note         String?      @db.Text
  createdAt    DateTime     @default(now())
}
```

### `DomainWhitelistRegistry` — Atomic Phase 028 (Phase1-4_EbooklineliffV2.md:15656)

```prisma
// Source: Atomic Phase 028
model DomainWhitelistRegistry {
  id                 String   @id @default(uuid())
  tenantId           String   @unique
  liffId             String
  domainUrl          String
  hlsCdnDomain       String
  r2StorageDomain    String
  isVerified         Boolean  @default(true)
  updatedAt          DateTime @updatedAt
  createdAt          DateTime @default(now())

  @@index([tenantId])
}
```

### `DrmOfflineLease` — Atomic Phase 063 (Phase1-4_EbooklineliffV2.md:32533)

```prisma
// Source: Atomic Phase 063
model DrmOfflineLease {
  id             String    @id @default(uuid())
  userId         String
  productId      String
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  product        Product   @relation(fields: [productId], references: [id], onDelete: Cascade)
  deviceId       String
  clientPublicKey String   @db.Text
  leaseToken     String    @db.Text
  issuedAt       DateTime  @default(now())
  expiresAt      DateTime
  revoked        Boolean   @default(false)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@unique([userId, productId, deviceId])
  @@index([userId])
  @@index([expiresAt])
}
```

### `DrmSecurityKey` — Atomic Phase 061 (Phase1-4_EbooklineliffV2.md:31653)

```prisma
// Source: Atomic Phase 061
model DrmSecurityKey {
  id            String       @id @default(uuid())
  userId        String
  user          User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  productId     String
  product       Product      @relation(fields: [productId], references: [id], onDelete: Cascade)
  sessionNonce  String       @unique @default(uuid())
  hmacSecret    String
  algorithm     DrmAlgorithm @default(HYBRID_WEBGL_MATRIX)
  expiresAt     DateTime
  createdAt     DateTime     @default(now())

  @@index([userId, productId])
  @@index([sessionNonce])
}
```

### `DrmSession` — Atomic Phase 049 (Phase1-4_EbooklineliffV2.md:25622)

```prisma
// Source: Atomic Phase 049
model DrmSession {
  id                String            @id @default(uuid())
  userId            String
  productId         String
  pageNumber        Int
  sessionSeed       String
  permutationVector Json
  expiresAt         DateTime
  createdAt         DateTime          @default(now())
  user              User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  product           Product           @relation(fields: [productId], references: [id], onDelete: Cascade)
  violationLogs     DrmViolationLog[]

  @@index([userId, productId])
  @@index([expiresAt])
}
```

### `DrmViolationLog` — Atomic Phase 049, Atomic Phase 061 (Phase1-4_EbooklineliffV2.md:31669)

```prisma
// Source: Atomic Phase 049, Atomic Phase 061
model DrmViolationLog {
  id          String   @id @default(uuid())
  userId      String?
  user        User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  productId   String
  pageNumber  Int
  violationType String // e.g., "CANVAS_DATA_URL_EXPLOIT", "DOM_SCRAPE_ATTEMPT", "WEBGL_CONTEXT_TAMPER"
  ipAddress   String
  userAgent   String
  metadata    Json?
  createdAt   DateTime @default(now())

  @@index([userId])
  @@index([productId])
}
```

### `EbookBookmark` — Atomic Phase 041 (Phase1-4_EbooklineliffV2.md:21590)

```prisma
// Source: Atomic Phase 041
model EbookBookmark {
  id           String      @id @default(uuid())
  userId       String
  ebookId      String
  pageNumber   Int
  chapterTitle String?
  user         User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  ebook        EbookDetail @relation(fields: [ebookId], references: [id], onDelete: Cascade)
  createdAt    DateTime    @default(now())

  @@unique([userId, ebookId, pageNumber])
  @@index([userId, ebookId])
}
```

### `EbookChapter` — Atomic Phase 008, Atomic Phase 037, Atomic Phase 060, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:19842)

```prisma
// Source: Atomic Phase 008, Atomic Phase 037, Atomic Phase 060, Atomic Phase 128
model EbookChapter {
  id            String      @id @default(uuid())
  ebookId       String
  ebook         EbookDetail @relation(fields: [ebookId], references: [id], onDelete: Cascade)
  chapterIndex  Int
  title         String
  chunkCount    Int
  chunkR2Prefix String

  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@unique([ebookId, chapterIndex])
  @@index([ebookId])
}
```

### `EbookChunk` — Atomic Phase 038 (Phase1-4_EbooklineliffV2.md:20258)

```prisma
// Source: Atomic Phase 038
model EbookChunk {
  id                 String      @id @default(uuid())
  ebookDetailId      String
  ebookDetail        EbookDetail @relation(fields: [ebookDetailId], references: [id], onDelete: Cascade)
  pageNumber         Int
  chunkR2Path        String
  fileSizeBytes      Int
  chunkHash          String
  createdAt          DateTime    @default(now())

  @@unique([ebookDetailId, pageNumber])
  @@index([ebookDetailId])
}
```

### `EbookChunkMeta` — Atomic Phase 036 (Phase1-4_EbooklineliffV2.md:19118)

```prisma
// Source: Atomic Phase 036
model EbookChunkMeta {
  id            String      @id @default(uuid())
  ebookId       String
  ebook         EbookDetail @relation(fields: [ebookId], references: [id], onDelete: Cascade)
  pageNumber    Int
  r2ObjectKey   String
  chunkSizeBytes Int
  vectorChecksum String

  @@unique([ebookId, pageNumber])
  @@index([ebookId])
}
```

### `EbookDetail` — Atomic Phase 000, Atomic Phase 008, Atomic Phase 036, Atomic Phase 037, Atomic Phase 039, Atomic Phase 051, Atomic Phase 060, Atomic Phase 093, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:19104)

```prisma
// Source: Atomic Phase 000, Atomic Phase 008, Atomic Phase 036, Atomic Phase 037, Atomic Phase 039, Atomic Phase 051, Atomic Phase 060, Atomic Phase 093, Atomic Phase 128
model EbookDetail {
  id             String             @id @default(uuid())
  productId      String             @unique
  product        Product            @relation(fields: [productId], references: [id], onDelete: Cascade)
  totalPages     Int
  previewPages   Int                @default(10)
  storagePathR2  String             // Path prefix in R2
  fileHash       String

  // Relations for Phase 036
  r2VaultAsset   StorageVaultAsset? @relation("EbookR2Source")
  chunkManifests EbookChunkMeta[]
}
```

### `EbookHighlight` — Atomic Phase 041 (Phase1-4_EbooklineliffV2.md:21604)

```prisma
// Source: Atomic Phase 041
model EbookHighlight {
  id               String      @id @default(uuid())
  userId           String
  ebookId          String
  pageNumber       Int
  colorHex         String      @default("#FFE066")
  boundingRectsJson Json        // พิกัด Vector Bounding Box บน Canvas Layer
  selectedText     String      @db.Text
  noteText         String?     @db.Text
  user             User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  ebook            EbookDetail @relation(fields: [ebookId], references: [id], onDelete: Cascade)
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  @@index([userId, ebookId, pageNumber])
}
```

### `EbookPageAnalytics` — Atomic Phase 052 (Phase1-4_EbooklineliffV2.md:27188)

```prisma
// Source: Atomic Phase 052
model EbookPageAnalytics {
  id                   String   @id @default(uuid())
  userId               String
  ebookId             String
  pageNumber           Int
  dwellTimeSec         Int      @default(0)
  scrollDepth          Float    @default(100.0)
  interactionCount     Int      @default(0)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, ebookId])
  @@index([ebookId, pageNumber])
  @@index([createdAt])
}
```

### `EbookPageReadLog` — Atomic Phase 110 (Phase5-7_EbooklineliffV2.md:20402)

```prisma
// Source: Atomic Phase 110
model EbookPageReadLog {
  id               String   @id @default(uuid())
  userId           String
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  ebookId          String
  pageNumber       Int
  dwellTimeSeconds Int      @default(0)
  sessionToken     String?
  createdAt        DateTime @default(now())

  @@index([userId, ebookId])
  @@index([ebookId, pageNumber])
  @@index([createdAt])
}
```

### `EbookPageText` — Atomic Phase 038 (Phase1-4_EbooklineliffV2.md:20272)

```prisma
// Source: Atomic Phase 038
model EbookPageText {
  id            String      @id @default(uuid())
  ebookDetailId String
  ebookDetail   EbookDetail @relation(fields: [ebookDetailId], references: [id], onDelete: Cascade)
  pageNumber    Int
  extractedText String      @db.Text

  @@unique([ebookDetailId, pageNumber])
  @@index([ebookDetailId])
}
```

### `EbookReadingProgress` — Atomic Phase 000, Atomic Phase 018, Atomic Phase 057, Atomic Phase 060, Atomic Phase 064, Atomic Phase 093, Atomic Phase 128 (Phase5-7_EbooklineliffV2.md:29180)

```prisma
// Source: Atomic Phase 000, Atomic Phase 018, Atomic Phase 057, Atomic Phase 060, Atomic Phase 064, Atomic Phase 093, Atomic Phase 128
model EbookReadingProgress {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  ebookId     String
  lastPage    Int      @default(1)
  updatedAt   DateTime @updatedAt

  @@unique([userId, ebookId], map: "uniq_ebook_reading_progress")
  @@index([userId, updatedAt(sort: Desc)], map: "idx_ebook_progress_user_updated")
}
```

### `EncryptedUserPII` — Atomic Phase 129 (Phase5-7_EbooklineliffV2.md:29731)

```prisma
// Source: Atomic Phase 129
model EncryptedUserPII {
  id             String   @id @default(uuid())
  userId         String   @unique
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  encryptedPhone String?  @db.Text // AES-256-GCM Encrypted
  encryptedAddress String? @db.Text // AES-256-GCM Encrypted
  encryptedTaxId String?  @db.Text // AES-256-GCM Encrypted
  encryptionIv   String   // Initialization Vector
  authTag        String   // Authentication Tag for GCM
  updatedAt      DateTime @updatedAt
}
```

### `Entitlement` — Atomic Phase 000, Atomic Phase 008, Atomic Phase 012, Atomic Phase 014, Atomic Phase 015, Atomic Phase 016, Atomic Phase 018, Atomic Phase 020, Atomic Phase 051, Atomic Phase 093, Atomic Phase 128 (Phase5-7_EbooklineliffV2.md:29117)

```prisma
// Source: Atomic Phase 000, Atomic Phase 008, Atomic Phase 012, Atomic Phase 014, Atomic Phase 015, Atomic Phase 016, Atomic Phase 018, Atomic Phase 020, Atomic Phase 051, Atomic Phase 093, Atomic Phase 128
model Entitlement {
  id           String            @id @default(uuid())
  userId       String
  productId    String
  accessType   ContentAccessType @default(FULL_PURCHASE)
  expiresAt    DateTime?
  user         User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  product      Product           @relation(fields: [productId], references: [id], onDelete: Cascade)
  createdAt    DateTime          @default(now())

  @@unique([userId, productId], map: "uniq_entitlement_user_product")
  @@index([userId, productId, expiresAt], map: "idx_entitlement_verification")
}
```

### `EscrowAccount` — Atomic Phase 113 (Phase5-7_EbooklineliffV2.md:22096)

```prisma
// Source: Atomic Phase 113
model EscrowAccount {
  id            String       @id @default(uuid())
  orderId       String       @unique
  order         Order        @relation(fields: [orderId], references: [id], onDelete: Cascade)
  sellerId      String
  grossAmount   Decimal      @db.Decimal(10, 2)
  platformFee   Decimal      @default(0.00) @db.Decimal(10, 2)
  netSellerPay  Decimal      @db.Decimal(10, 2)
  holdingUntil  DateTime
  status        EscrowStatus @default(HELD)
  disputeClaim  DisputeClaim?
  releasedAt    DateTime?
  refundedAt    DateTime?
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  @@index([sellerId])
  @@index([status])
}
```

### `ExternalApiAuditLog` — Atomic Phase 122 (Phase5-7_EbooklineliffV2.md:26326)

```prisma
// Source: Atomic Phase 122
model ExternalApiAuditLog {
  id           String   @id @default(uuid())
  serviceName  String
  endpoint     String
  httpMethod   String
  responseMs   Int
  isSuccess    Boolean
  circuitState String   // CLOSED, OPEN, HALF_OPEN
  errorMessage String?  @db.Text
  createdAt    DateTime @default(now())

  @@index([serviceName, createdAt])
}
```

### `FinancialAccount` — Atomic Phase 081 (Phase5-7_EbooklineliffV2.md:5348)

```prisma
// Source: Atomic Phase 081
model FinancialAccount {
  id             String            @id @default(uuid())
  userId         String?           @unique // Null if platform system account
  accountType    LedgerAccountType
  currentBalance Decimal           @default(0.00) @db.Decimal(18, 4)
  currency       String            @default("THB")

  debitEntries   LedgerEntry[]     @relation("DebitAccount")
  creditEntries  LedgerEntry[]     @relation("CreditAccount")

  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  @@index([userId])
  @@index([accountType])
}
```

### `FinancialClearinghouseLedger` — Atomic Phase 114 (Phase5-7_EbooklineliffV2.md:22661)

```prisma
// Source: Atomic Phase 114
model FinancialClearinghouseLedger {
  id            String               @id @default(uuid())
  tenantId      String               @default("default")
  orderId       String?
  payoutId      String?
  accountType   LedgerAccountType
  entryType     TransactionEntryType
  amount        Decimal              @db.Decimal(14, 2)
  currency      String               @default("THB")
  description   String
  referenceCode String?              @unique
  createdAt     DateTime             @default(now())

  order         Order?               @relation(fields: [orderId], references: [id])
  payout        SellerPayout?        @relation(fields: [payoutId], references: [id])

  @@index([tenantId])
  @@index([accountType])
  @@index([orderId])
}
```

### `FinancialManualOverride` — Atomic Phase 115 (Phase5-7_EbooklineliffV2.md:23247)

```prisma
// Source: Atomic Phase 115
model FinancialManualOverride {
  id              String        @id @default(uuid())
  bankStatementId String
  bankStatement   BankStatement @relation(fields: [bankStatementId], references: [id], onDelete: Cascade)
  orderId         String
  order           Order         @relation(fields: [orderId], references: [id])
  initiatedBy     String        // User ID of Maker
  approvedBy      String?       // User ID of Checker
  reason          String        @db.Text
  note            String?       @db.Text
  previousStatus  String
  newStatus       String
  isApproved      Boolean       @default(false)
  auditHash       String        // Cryptographic Chain Hash
  ipAddress       String
  userAgent       String
  createdAt       DateTime      @default(now())

  @@index([bankStatementId])
  @@index([orderId])
  @@index([initiatedBy])
}
```

### `FlashSaleCampaign` — Atomic Phase 087 (Phase5-7_EbooklineliffV2.md:8434)

```prisma
// Source: Atomic Phase 087
model FlashSaleCampaign {
  id          String             @id @default(uuid())
  tenantId    String             @default("default")
  title       String
  description String?            @db.Text
  bannerUrl   String?
  startTime   DateTime
  endTime     DateTime
  status      FlashSaleStatus    @default(UPCOMING)

  items       FlashSaleItem[]

  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  @@index([tenantId, status])
  @@index([startTime, endTime])
}
```

### `FlashSaleItem` — Atomic Phase 087 (Phase5-7_EbooklineliffV2.md:8453)

```prisma
// Source: Atomic Phase 087
model FlashSaleItem {
  id             String            @id @default(uuid())
  campaignId     String
  campaign       FlashSaleCampaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  productId      String
  product        Product           @relation(fields: [productId], references: [id], onDelete: Cascade)

  flashPrice     Decimal           @db.Decimal(10, 2)
  allocatedStock Int
  reservedStock  Int               @default(0)
  soldQty        Int               @default(0)
  maxPerUser     Int               @default(1)

  reservations   StockReservation[]

  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  @@unique([campaignId, productId])
  @@index([productId])
}
```

### `FulfillmentBatch` — Atomic Phase 076 (Phase5-7_EbooklineliffV2.md:2556)

```prisma
// Source: Atomic Phase 076
model FulfillmentBatch {
  id              String            @id @default(uuid())
  batchNumber     String            @unique
  tenantId        String
  courierProvider CourierProvider
  totalOrders     Int
  successCount    Int               @default(0)
  failureCount    Int               @default(0)
  status          String            @default("PROCESSING") // PROCESSING, COMPLETED, FAILED
  items           FulfillmentItem[]
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  @@index([tenantId])
}
```

### `FulfillmentItem` — Atomic Phase 076 (Phase5-7_EbooklineliffV2.md:2572)

```prisma
// Source: Atomic Phase 076
model FulfillmentItem {
  id              String            @id @default(uuid())
  batchId         String?
  batch           FulfillmentBatch? @relation(fields: [batchId], references: [id], onDelete: SetNull)
  orderId         String            @unique
  order           Order             @relation(fields: [orderId], references: [id], onDelete: Cascade)
  warehouseId     String
  warehouse       Warehouse         @relation(fields: [warehouseId], references: [id])
  courierProvider CourierProvider
  trackingNumber  String?           @unique
  sortingCode     String?
  labelUrl        String?
  status          FulfillmentStatus @default(UNFULFILLED)
  printedAt       DateTime?
  shippedAt       DateTime?
  deliveredAt     DateTime?
  errorMessage    String?
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  @@index([courierProvider])
  @@index([status])
  @@index([trackingNumber])
}
```

### `GamificationBadge` — Atomic Phase 096 (Phase5-7_EbooklineliffV2.md:12836)

```prisma
// Source: Atomic Phase 096
model GamificationBadge {
  id          String      @id @default(uuid())
  code        String      @unique
  name        String
  description String
  iconUrl     String
  userBadges  UserBadge[]
}
```

### `GiftOrder` — Atomic Phase 089 (Phase5-7_EbooklineliffV2.md:9484)

```prisma
// Source: Atomic Phase 089
model GiftOrder {
  id                String          @id @default(uuid())
  orderId           String          @unique
  order             Order           @relation(fields: [orderId], references: [id], onDelete: Cascade)
  senderUserId      String
  senderUser        User            @relation("SentGifts", fields: [senderUserId], references: [id])
  recipientUserId   String?
  recipientUser     User?           @relation("ReceivedGifts", fields: [recipientUserId], references: [id])
  productId         String
  product           Product         @relation(fields: [productId], references: [id])

  claimCode         String          @unique @default(uuid())
  status            GiftStatus      @default(PENDING_PAYMENT)
  greetingTheme     GreetingTheme   @default(BIRTHDAY_CELEBRATION)
  greetingMessage   String          @db.Text
  senderDisplayName String
  isAnonymous       Boolean         @default(false)

  expiresAt         DateTime
  claimedAt         DateTime?
  revertedAt        DateTime?

  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  @@index([claimCode])
  @@index([senderUserId])
  @@index([recipientUserId])
  @@index([status])
}
```

### `GroupBuyingConfig` — Atomic Phase 090 (Phase5-7_EbooklineliffV2.md:9976)

```prisma
// Source: Atomic Phase 090
model GroupBuyingConfig {
  id               String      @id @default(uuid())
  productId        String      @unique
  product          Product     @relation(fields: [productId], references: [id], onDelete: Cascade)
  isEnabled        Boolean     @default(true)
  buddyPassPrice   Decimal     @db.Decimal(10, 2)
  groupBuy3pPrice  Decimal?    @db.Decimal(10, 2)
  groupBuy5pPrice  Decimal?    @db.Decimal(10, 2)
  timeLimitHours   Int         @default(24)
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt
}
```

### `GroupBuyingMember` — Atomic Phase 090 (Phase5-7_EbooklineliffV2.md:10014)

```prisma
// Source: Atomic Phase 090
model GroupBuyingMember {
  id          String          @id @default(uuid())
  roomId      String
  room        GroupBuyingRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  userId      String
  user        User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  orderId     String          @unique
  order       Order           @relation(fields: [orderId], references: [id])
  isCreator   Boolean         @default(false)
  joinedAt    DateTime        @default(now())

  @@unique([roomId, userId])
  @@index([userId])
}
```

### `GroupBuyingRoom` — Atomic Phase 090 (Phase5-7_EbooklineliffV2.md:9989)

```prisma
// Source: Atomic Phase 090
model GroupBuyingRoom {
  id                  String             @id @default(uuid())
  roomCode            String             @unique @default(uuid())
  productId           String
  product             Product            @relation(fields: [productId], references: [id], onDelete: Cascade)
  creatorId           String
  creator             User               @relation("CreatedGroupRooms", fields: [creatorId], references: [id])
  groupType           GroupType          @default(BUDDY_PASS_2P)
  requiredMembers     Int                @default(2)
  currentMembersCount Int                @default(1)
  discountedPrice     Decimal            @db.Decimal(10, 2)
  status              GroupBuyingStatus  @default(WAITING_FOR_MEMBERS)
  expiresAt           DateTime

  members             GroupBuyingMember[]
  orders              Order[]

  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt

  @@index([productId])
  @@index([creatorId])
  @@index([status, expiresAt])
}
```

### `HandshakeToken` — Atomic Phase 070 (Phase1-4_EbooklineliffV2.md:36115)

```prisma
// Source: Atomic Phase 070
model HandshakeToken {
  id             String       @id @default(uuid())
  handshakeToken String       @unique
  lineUserId     String
  webSessionId   String?
  isConsumed     Boolean      @default(false)
  expiresAt      DateTime
  createdAt      DateTime     @default(now())

  @@index([handshakeToken])
}
```

### `HeaderConfig` — Atomic Phase 023 (Phase1-4_EbooklineliffV2.md:13429)

```prisma
// Source: Atomic Phase 023
model HeaderConfig {
  id                String            @id @default(uuid())
  productId         String            @unique
  product           Product           @relation(fields: [productId], references: [id], onDelete: Cascade)
  customHeaderTitle String?
  overrideBrandColor String?
  showProgress      Boolean           @default(true)
  metadataJson      Json?             // Stores custom action buttons and contextual icons
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  @@index([productId])
}
```

### `HlsSegmentMeta` — Atomic Phase 036 (Phase1-4_EbooklineliffV2.md:19146)

```prisma
// Source: Atomic Phase 036
model HlsSegmentMeta {
  id            String       @id @default(uuid())
  lessonId      String
  lesson        CourseLesson @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  segmentIndex  Int
  resolution    String       // e.g. "1080p", "720p"
  r2ObjectKey   String
  durationSec   Float

  @@unique([lessonId, resolution, segmentIndex])
  @@index([lessonId])
}
```

### `IdempotencyLog` — Atomic Phase 122 (Phase5-7_EbooklineliffV2.md:26312)

```prisma
// Source: Atomic Phase 122
model IdempotencyLog {
  id           String   @id @default(uuid())
  key          String   @unique
  requestHash  String
  endpoint     String
  statusCode   Int
  responseJson Json
  createdAt    DateTime @default(now())
  expiresAt    DateTime

  @@index([key])
  @@index([expiresAt])
}
```

### `ImmutableAuditLog` — Atomic Phase 129 (Phase5-7_EbooklineliffV2.md:29714)

```prisma
// Source: Atomic Phase 129
model ImmutableAuditLog {
  id           String   @id @default(uuid())
  actorId      String?
  action       String   // e.g., "LOGIN_LIFF", "ACCESS_PII", "UPDATE_CONSENT", "DELETE_ACCOUNT"
  resource     String   // e.g., "User:123", "Ebook:456"
  ipAddress    String
  userAgent    String
  previousData Json?
  newData      Json?
  hashChain    String   // SHA-256 HMAC hash of previous log + current data for tamper detection
  createdAt    DateTime @default(now())

  @@index([actorId])
  @@index([action])
  @@index([createdAt])
}
```

### `KYCAuditLog` — Atomic Phase 085, Atomic Phase 111 (Phase5-7_EbooklineliffV2.md:21052)

```prisma
// Source: Atomic Phase 085, Atomic Phase 111
model KYCAuditLog {
  id           String     @id @default(uuid())
  kycId        String
  kyc          CreatorKYC @relation(fields: [kycId], references: [id], onDelete: Cascade)
  actionBy     String     // Admin User ID or "SYSTEM_OCR_ENGINE"
  action       String     // SUBMITTED, OCR_PROCESSED, APPROVED, REJECTED, VIEWED_PII
  ipAddress    String
  userAgent    String
  detailsJson  Json?
  createdAt    DateTime   @default(now())

  @@index([kycId])
}
```

### `KnowledgeBaseVector` — Atomic Phase 103 (Phase5-7_EbooklineliffV2.md:16504)

```prisma
// Source: Atomic Phase 103
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

  @@index([tenantId])
}
```

### `KnownUserDevice` — Atomic Phase 120 (Phase5-7_EbooklineliffV2.md:25567)

```prisma
// Source: Atomic Phase 120
model KnownUserDevice {
  id                String   @id @default(uuid())
  userId            String
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  deviceFingerprint String
  deviceName        String?
  lastUsedIp        String
  lastUsedCountry   String?
  trustScore        Int      @default(100)
  lastSeenAt        DateTime @default(now())
  createdAt         DateTime @default(now())

  @@unique([userId, deviceFingerprint])
  @@index([userId])
}
```

### `LedgerEntry` — Atomic Phase 081 (Phase5-7_EbooklineliffV2.md:5377)

```prisma
// Source: Atomic Phase 081
model LedgerEntry {
  id               String           @id @default(uuid())
  journalId        String
  journal          LedgerJournal    @relation(fields: [journalId], references: [id], onDelete: Cascade)
  debitAccountId   String?
  debitAccount     FinancialAccount? @relation("DebitAccount", fields: [debitAccountId], references: [id])
  creditAccountId  String?
  creditAccount    FinancialAccount? @relation("CreditAccount", fields: [creditAccountId], references: [id])
  amount           Decimal          @db.Decimal(18, 4)
  entryType        EntryType
  runningBalance   Decimal          @db.Decimal(18, 4)
  createdAt        DateTime         @default(now())

  @@index([journalId])
  @@index([debitAccountId])
  @@index([creditAccountId])
}
```

### `LedgerJournal` — Atomic Phase 081 (Phase5-7_EbooklineliffV2.md:5365)

```prisma
// Source: Atomic Phase 081
model LedgerJournal {
  id              String        @id @default(uuid())
  referenceOrderId String?      @unique
  description     String
  eventPayload    Json?         // Audit Snapshot of transaction event
  entries         LedgerEntry[]
  createdAt       DateTime      @default(now())

  @@index([referenceOrderId])
  @@index([createdAt])
}
```

### `LessonNote` — Atomic Phase 065 (Phase1-4_EbooklineliffV2.md:33675)

```prisma
// Source: Atomic Phase 065
model LessonNote {
  id           String         @id @default(uuid())
  userId       String
  user         User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  lessonId     String
  lesson       CourseLesson   @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  courseId     String
  timestampSec Int            // วินาทีในวิดีโอ (เช่น 225 = 03:45)
  content      String         @db.Text
  tags         String[]       @default([])
  visibility   NoteVisibility @default(PRIVATE)
  aiSummary    String?        @db.Text

  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt

  @@index([userId, lessonId])
  @@index([userId, courseId])
  @@index([lessonId, timestampSec])
  @@index([visibility])
}
```

### `LessonQuiz` — Atomic Phase 037, Atomic Phase 047, Atomic Phase 078 (Phase1-4_EbooklineliffV2.md:24666)

```prisma
// Source: Atomic Phase 037, Atomic Phase 047, Atomic Phase 078
model LessonQuiz {
  id              String         @id @default(uuid())
  lessonId        String
  lesson          CourseLesson   @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  timestampSec    Int            // วินาทีบนวิดีโอที่ให้หยุดและแสดง ควิซ
  question        String         @db.Text
  quizType        QuizType       @default(SINGLE_CHOICE)
  passScore       Float          @default(100.0)
  maxRetries      Int            @default(0) // 0 = ไม่จำกัดจำนวนครั้ง
  explanation     String?        @db.Text
  aiPromptContext String?        @db.Text

  options         QuizOption[]
  attempts        QuizAttempt[]
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([lessonId, timestampSec])
}
```

### `LineAuthProfile` — Atomic Phase 006 (Phase1-4_EbooklineliffV2.md:3395)

```prisma
// Source: Atomic Phase 006
model LineAuthProfile {
  id            String    @id @default(uuid())
  userId        String    @unique
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  lineSub       String    @unique
  displayName   String
  pictureUrl    String?
  email         String?
  rawPayload    Json
  lastLoginAt   DateTime  @default(now())
  createdAt     DateTime  @default(now())

  @@index([lineSub])
}
```

### `LineMiniAppSandboxAudit` — Atomic Phase 035 (Phase1-4_EbooklineliffV2.md:18729)

```prisma
// Source: Atomic Phase 035
model LineMiniAppSandboxAudit {
  id                      String                   @id @default(uuid())
  tenantId                String
  overallScore            Float                    @default(0.0)
  isApprovedForSubmission Boolean                  @default(false)
  testedByUserId          String
  testResults             LineSandboxResultItem[]
  createdAt               DateTime                 @default(now())

  @@index([tenantId])
}
```

### `LineOAFriendshipLog` — Atomic Phase 034 (Phase1-4_EbooklineliffV2.md:18348)

```prisma
// Source: Atomic Phase 034
model LineOAFriendshipLog {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  eventType   String   // "FOLLOW" | "UNFOLLOW"
  rawPayload  Json?
  createdAt   DateTime @default(now())

  @@index([userId])
  @@index([eventType])
}
```

### `LineSandboxResultItem` — Atomic Phase 035 (Phase1-4_EbooklineliffV2.md:18741)

```prisma
// Source: Atomic Phase 035
model LineSandboxResultItem {
  id                String                  @id @default(uuid())
  auditId           String
  audit             LineMiniAppSandboxAudit @relation(fields: [auditId], references: [id], onDelete: Cascade)
  category          LineReviewCategory
  checkPointName    String
  isPassed          Boolean
  executionTimeMs   Int
  memoryUsageMB     Float
  diagnosticMessage String?
  createdAt         DateTime                @default(now())

  @@index([auditId])
}
```

### `LiveActiveSession` — Atomic Phase 100 (Phase5-7_EbooklineliffV2.md:14733)

```prisma
// Source: Atomic Phase 100
model LiveActiveSession {
  id               String   @id @default(uuid())
  liveRoomId       String
  userId           String
  sessionToken     String   @unique
  deviceFingerprint String
  ipAddress        String
  lastHeartbeatAt  DateTime @default(now())
  isKicked         Boolean  @default(false)
  kickReason       String?

  liveRoom         LiveRoom @relation(fields: [liveRoomId], references: [id], onDelete: Cascade)
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([liveRoomId, userId])
  @@index([sessionToken])
}
```

### `LiveAnalytics` — Atomic Phase 101 (Phase5-7_EbooklineliffV2.md:15521)

```prisma
// Source: Atomic Phase 101
model LiveAnalytics {
  id             String      @id @default(uuid())
  sessionId      String      @unique
  session        LiveSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  peakViewers    Int         @default(0)
  totalMessages  Int         @default(0)
  totalStickers  Int         @default(0)
  totalHandRaises Int        @default(0)
  totalPollVotes Int         @default(0)
  avgWatchSec    Float       @default(0.0)
  updatedAt      DateTime    @updatedAt
}
```

### `LiveChatMessage` — Atomic Phase 099, Atomic Phase 101 (Phase5-7_EbooklineliffV2.md:15452)

```prisma
// Source: Atomic Phase 099, Atomic Phase 101
model LiveChatMessage {
  id               String          @id @default(uuid())
  sessionId        String
  userId           String
  messageType      LiveMessageType @default(TEXT)
  content          String          @db.Text
  stickerPackageId String?
  stickerId        String?
  session          LiveSession     @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  user             User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt        DateTime        @default(now())

  @@index([sessionId, createdAt])
  @@index([userId])
}
```

### `LiveEntitlement` — Atomic Phase 100 (Phase5-7_EbooklineliffV2.md:14714)

```prisma
// Source: Atomic Phase 100
model LiveEntitlement {
  id             String         @id @default(uuid())
  liveRoomId     String
  userId         String
  accessRole     LiveAccessRole @default(STANDARD_VIEWER)
  isGranted      Boolean        @default(true)
  expiresAt      DateTime?

  liveRoom       LiveRoom       @relation(fields: [liveRoomId], references: [id], onDelete: Cascade)
  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  @@unique([liveRoomId, userId])
  @@index([userId])
  @@index([liveRoomId])
}
```

### `LiveHandRaise` — Atomic Phase 101 (Phase5-7_EbooklineliffV2.md:15468)

```prisma
// Source: Atomic Phase 101
model LiveHandRaise {
  id            String          @id @default(uuid())
  sessionId     String
  userId        String
  status        HandRaiseStatus @default(PENDING)
  queuePosition Int             @default(0)
  session       LiveSession     @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  user          User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  @@index([sessionId, status])
  @@index([userId])
}
```

### `LiveHeartbeatLog` — Atomic Phase 100 (Phase5-7_EbooklineliffV2.md:14751)

```prisma
// Source: Atomic Phase 100
model LiveHeartbeatLog {
  id            String   @id @default(uuid())
  liveRoomId    String
  userId        String
  playbackSec   Int
  clientIp      String
  timestamp     DateTime @default(now())

  liveRoom      LiveRoom @relation(fields: [liveRoomId], references: [id], onDelete: Cascade)

  @@index([liveRoomId, userId])
}
```

### `LivePoll` — Atomic Phase 099, Atomic Phase 101 (Phase5-7_EbooklineliffV2.md:15483)

```prisma
// Source: Atomic Phase 099, Atomic Phase 101
model LivePoll {
  id          String           @id @default(uuid())
  sessionId   String
  question    String           @db.Text
  isActive    Boolean          @default(true)
  expiresAt   DateTime
  session     LiveSession      @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  options     LivePollOption[]
  votes       LivePollVote[]
  createdAt   DateTime         @default(now())

  @@index([sessionId, isActive])
}
```

### `LivePollOption` — Atomic Phase 099, Atomic Phase 101 (Phase5-7_EbooklineliffV2.md:15497)

```prisma
// Source: Atomic Phase 099, Atomic Phase 101
model LivePollOption {
  id        String         @id @default(uuid())
  pollId    String
  text      String
  poll      LivePoll       @relation(fields: [pollId], references: [id], onDelete: Cascade)
  votes     LivePollVote[]

  @@index([pollId])
}
```

### `LivePollVote` — Atomic Phase 099, Atomic Phase 101 (Phase5-7_EbooklineliffV2.md:15507)

```prisma
// Source: Atomic Phase 099, Atomic Phase 101
model LivePollVote {
  id        String         @id @default(uuid())
  pollId    String
  optionId  String
  userId    String
  poll      LivePoll       @relation(fields: [pollId], references: [id], onDelete: Cascade)
  option    LivePollOption @relation(fields: [optionId], references: [id], onDelete: Cascade)
  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime       @default(now())

  @@unique([pollId, userId])
  @@index([pollId, optionId])
}
```

### `LiveRoom` — Atomic Phase 100 (Phase5-7_EbooklineliffV2.md:14687)

```prisma
// Source: Atomic Phase 100
model LiveRoom {
  id               String               @id @default(uuid())
  tenantId         String
  title            String
  description      String?              @db.Text
  coverImageUrl    String
  streamStatus     LiveStreamStatus     @default(SCHEDULED)
  rtmpIngestUrl    String?
  hlsPlaybackUrl   String
  scheduledStart   DateTime
  actualEndedAt    DateTime?
  maxAllowedSeats  Int                  @default(10000)
  isPaywallActive  Boolean              @default(true)
  linkedProductId  String?

  entitlements     LiveEntitlement[]
  activeSessions   LiveActiveSession[]
  heartbeatLogs    LiveHeartbeatLog[]

  createdAt        DateTime             @default(now())
  updatedAt        DateTime             @updatedAt

  @@index([tenantId])
  @@index([streamStatus])
  @@index([linkedProductId])
}
```

### `LiveSession` — Atomic Phase 099, Atomic Phase 101, Atomic Phase 102 (Phase5-7_EbooklineliffV2.md:14175)

```prisma
// Source: Atomic Phase 099, Atomic Phase 101, Atomic Phase 102
model LiveSession {
  id               String            @id @default(uuid())
  productId        String?
  product          Product?          @relation(fields: [productId], references: [id], onDelete: SetNull)
  instructorId     String
  instructor       User              @relation("InstructorSessions", fields: [instructorId], references: [id])
  title            String
  description      String            @db.Text
  coverImageUrl    String
  vendor           LiveStreamVendor  @default(AMAZON_IVS)
  status           LiveSessionStatus @default(SCHEDULED)
  streamKey        String            @unique
  playbackArn      String?           // For Amazon IVS
  scheduledAt      DateTime
  startedAt        DateTime?
  endedAt          DateTime?
  peakViewers      Int               @default(0)

  // Relations
  chatMessages     LiveChatMessage[]
  polls            LivePoll[]
  vodRecord        LiveToVodRecord?

  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  @@index([productId])
  @@index([instructorId])
  @@index([status])
}
```

### `LiveToVodRecord` — Atomic Phase 099 (Phase5-7_EbooklineliffV2.md:14250)

```prisma
// Source: Atomic Phase 099
model LiveToVodRecord {
  id            String      @id @default(uuid())
  sessionId     String      @unique
  session       LiveSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  storagePathR2 String
  hlsMasterUrl  String
  durationSec   Int         @default(0)
  fileSizeBytes BigInt      @default(0)
  createdAt     DateTime    @default(now())
}
```

### `LogisticsCarrierConfig` — Atomic Phase 076 (Phase5-7_EbooklineliffV2.md:2540)

```prisma
// Source: Atomic Phase 076
model LogisticsCarrierConfig {
  id              String          @id @default(uuid())
  tenantId        String
  provider        CourierProvider
  accountNo       String
  apiKey          String
  apiSecret       String?
  sortingCode     String?
  isAutoBooking   Boolean         @default(true)
  isActive        Boolean         @default(true)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@unique([tenantId, provider])
}
```

### `LogisticsWebhookLog` — Atomic Phase 077 (Phase5-7_EbooklineliffV2.md:3090)

```prisma
// Source: Atomic Phase 077
model LogisticsWebhookLog {
  id            String   @id @default(uuid())
  carrier       String
  payload       Json
  isProcessed   Boolean  @default(false)
  errorMessage  String?
  createdAt     DateTime @default(now())
}
```

### `LowBandwidthAssetCache` — Atomic Phase 055 (Phase1-4_EbooklineliffV2.md:28773)

```prisma
// Source: Atomic Phase 055
model LowBandwidthAssetCache {
  id              String   @id @default(uuid())
  productId       String
  pageNumber      Int
  brotliChunkPath String   // Path in Cloudflare R2
  byteSize        Int
  sha256Hash      String
  updatedAt       DateTime @updatedAt

  @@unique([productId, pageNumber])
  @@index([productId])
}
```

### `MarketingCampaign` — Atomic Phase 116 (Phase5-7_EbooklineliffV2.md:23823)

```prisma
// Source: Atomic Phase 116
model MarketingCampaign {
  id              String         @id @default(uuid())
  tenantId        String
  campaignName    String
  channel         String         // e.g., LINE_ADS, FACEBOOK, TIKTOK, AFFILIATE
  totalAdSpend    Decimal        @db.Decimal(12, 2)
  startDate       DateTime
  endDate         DateTime?
  acquiredUsers   Int            @default(0)
  analyticsLogs   CampaignAnalyticsLog[]
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([tenantId])
  @@index([channel])
}
```

### `MerchantAnalyticsDaily` — Atomic Phase 073 (Phase5-7_EbooklineliffV2.md:1058)

```prisma
// Source: Atomic Phase 073
model MerchantAnalyticsDaily {
  id             String   @id @default(uuid())
  tenantId       String
  recordDate     DateTime @db.Date
  totalGmv       Decimal  @default(0.00) @db.Decimal(12, 2)
  totalOrders    Int      @default(0)
  ebookSalesCount Int     @default(0)
  courseSalesCount Int    @default(0)
  physicalSalesCount Int  @default(0)
  newStudentsCount Int    @default(0)

  @@unique([tenantId, recordDate])
  @@index([tenantId])
}
```

### `MerchantProfile` — Atomic Phase 073 (Phase5-7_EbooklineliffV2.md:987)

```prisma
// Source: Atomic Phase 073
model MerchantProfile {
  id              String        @id @default(uuid())
  tenantId        String        @unique
  userId          String        @unique
  user            User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  storeName       String
  storeSlug       String        @unique
  logoUrl         String?
  bannerUrl       String?
  taxId           String?
  vatRegistered   Boolean       @default(false)
  bankName        String
  bankAccountNo   String
  bankAccountName String
  warehouses      Warehouse[]
  payouts         PayoutTransaction[]
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@index([tenantId])
}
```

### `NetworkPerformanceLog` — Atomic Phase 055 (Phase1-4_EbooklineliffV2.md:28754)

```prisma
// Source: Atomic Phase 055
model NetworkPerformanceLog {
  id               String   @id @default(uuid())
  userId           String?
  productId        String?
  effectiveType    String   // SLOW_2G, GOOD_3G, FAST_4G_5G
  rttMs            Int
  downlinkMbps     Float
  pageLoadTimeMs   Int
  chunkByteSize    Int
  ramUsageMb       Float
  isBufferUnderrun Boolean  @default(false)
  deviceModel      String?
  userAgent        String
  createdAt        DateTime @default(now())

  @@index([effectiveType])
  @@index([createdAt])
}
```

### `NetworkTelemetryLog` — Atomic Phase 069 (Phase1-4_EbooklineliffV2.md:35490)

```prisma
// Source: Atomic Phase 069
model NetworkTelemetryLog {
  id               String   @id @default(uuid())
  userId           String?
  user             User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  lineUserId       String?
  deviceType       String   // e.g., "LINE_LIFF_IOS", "LINE_LIFF_ANDROID", "WEB_DESKTOP"
  disconnectionSec Int      // Duration of network loss in seconds
  actionsQueued    Int      @default(0)
  effectiveType    String?  // 4g, 3g, 2g
  tenantId         String?
  createdAt        DateTime @default(now())

  @@index([userId])
  @@index([lineUserId])
  @@index([createdAt])
}
```

### `NotificationLog` — Atomic Phase 024 (Phase1-4_EbooklineliffV2.md:13932)

```prisma
// Source: Atomic Phase 024
model NotificationLog {
  id             String                 @id @default(uuid())
  tenantId       String
  userId         String
  lineUserId     String
  messageType    MessageType
  templateId     String
  template       ServiceMessageTemplate @relation(fields: [templateId], references: [id])
  status         DispatchStatus         @default(QUEUED)
  payload        Json
  errorCode      String?
  retryCount     Int                    @default(0)
  deliveredAt    DateTime?
  costAmount     Decimal                @default(0.00) @db.Decimal(10, 4) // ควรเป็น 0.0000 บาท
  createdAt      DateTime               @default(now())

  @@index([tenantId])
  @@index([lineUserId])
  @@index([status])
  @@index([createdAt])
}
```

### `OfflineDeviceSession` — Atomic Phase 062 (Phase1-4_EbooklineliffV2.md:32114)

```prisma
// Source: Atomic Phase 062
model OfflineDeviceSession {
  id           String           @id @default(uuid())
  userId       String
  deviceId     String
  user         User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  lastSyncedAt DateTime         @updatedAt
  syncLogs     OfflineSyncLog[]

  @@unique([userId, deviceId])
  @@index([userId])
}
```

### `OfflineLicense` — Atomic Phase 068 (Phase1-4_EbooklineliffV2.md:35101)

```prisma
// Source: Atomic Phase 068
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

  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  product             Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([userId, productId, deviceIdHash])
  @@index([userId])
  @@index([deviceIdHash])
}
```

### `OfflineSyncLog` — Atomic Phase 062, Atomic Phase 063 (Phase1-4_EbooklineliffV2.md:32126)

```prisma
// Source: Atomic Phase 062, Atomic Phase 063
model OfflineSyncLog {
  id            String               @id @default(uuid())
  sessionId     String
  deviceSession OfflineDeviceSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  targetType    String
  itemsCount    Int                  @default(1)
  status        String               @default("SUCCESS") // SUCCESS, PARTIAL, FAILED
  createdAt     DateTime             @default(now())

  @@index([sessionId])
}
```

### `Order` — Atomic Phase 000, Atomic Phase 012, Atomic Phase 014, Atomic Phase 015, Atomic Phase 016, Atomic Phase 020, Atomic Phase 093, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:8588)

```prisma
// Source: Atomic Phase 000, Atomic Phase 012, Atomic Phase 014, Atomic Phase 015, Atomic Phase 016, Atomic Phase 020, Atomic Phase 093, Atomic Phase 128
model Order {
  id             String        @id @default(uuid())
  orderNumber    String        @unique
  userId         String
  user           User          @relation(fields: [userId], references: [id], onDelete: Restrict)
  totalAmount    Decimal       @db.Decimal(10, 2)
  shippingFee    Decimal       @default(0.00) @db.Decimal(10, 2)
  discountAmount Decimal       @default(0.00) @db.Decimal(10, 2)
  netAmount      Decimal       @db.Decimal(10, 2)
  orderStatus    String        @default("PENDING_PAYMENT") // PENDING_PAYMENT, PROCESSING, COMPLETED, CANCELLED
  paymentStatus  String        @default("UNPAID")          // UNPAID, PAYMENT_VERIFYING, VERIFIED, FAILED
  orderItems     OrderItem[]
  paymentSlip    PaymentSlip?
  outboxEvents   OutboxEvent[]
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@index([userId])
  @@index([orderNumber])
  @@index([orderStatus, paymentStatus])
}
```

### `OrderFulfillment` — Atomic Phase 073 (Phase5-7_EbooklineliffV2.md:1022)

```prisma
// Source: Atomic Phase 073
model OrderFulfillment {
  id              String            @id @default(uuid())
  orderId         String            @unique
  order           Order             @relation(fields: [orderId], references: [id], onDelete: Cascade)
  warehouseId     String
  warehouse       Warehouse         @relation(fields: [warehouseId], references: [id])
  status          FulfillmentStatus @default(UNFULFILLED)
  courierName     String?           // Flash, Kerry, J&T, ThaiPost
  trackingNumber  String?           @unique
  shippingLabelUrl String?
  shippedAt       DateTime?
  deliveredAt     DateTime?
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  @@index([warehouseId])
  @@index([status])
}
```

### `OrderItem` — Atomic Phase 000, Atomic Phase 008, Atomic Phase 012, Atomic Phase 014, Atomic Phase 020, Atomic Phase 093, Atomic Phase 128 (Phase5-7_EbooklineliffV2.md:29152)

```prisma
// Source: Atomic Phase 000, Atomic Phase 008, Atomic Phase 012, Atomic Phase 014, Atomic Phase 020, Atomic Phase 093, Atomic Phase 128
model OrderItem {
  id        String   @id @default(uuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  productId String
  product   Product  @relation(fields: [productId], references: [id])
  price     Decimal  @db.Decimal(10, 2)
  quantity  Int      @default(1)

  @@index([orderId], map: "idx_order_item_order_id")
  @@index([productId], map: "idx_order_item_product_id")
}
```

### `OrderTransactionIndex` — Atomic Phase 126 (Phase5-7_EbooklineliffV2.md:28258)

```prisma
// Source: Atomic Phase 126
model OrderTransactionIndex {
  id            String   @id @default(uuid())
  orderNumber   String   @unique
  userId        String
  orderStatus   String
  createdBucket DateTime @default(now())

  @@index([orderStatus, createdBucket])
  @@index([userId, createdBucket])
}
```

### `OutboxEvent` — Atomic Phase 015 (Phase1-4_EbooklineliffV2.md:8644)

```prisma
// Source: Atomic Phase 015
model OutboxEvent {
  id          String    @id @default(uuid())
  aggregateType String  // e.g. "ORDER"
  aggregateId   String  // orderId
  eventType     String  // "PAYMENT_VERIFIED_ENTITLEMENT_GRANTED"
  payload       Json
  isProcessed   Boolean   @default(false)
  processedAt   DateTime?
  createdAt     DateTime  @default(now())

  @@index([isProcessed, createdAt])
}
```

### `PIIAccessAuditLog` — Atomic Phase 107 (Phase5-7_EbooklineliffV2.md:18578)

```prisma
// Source: Atomic Phase 107
model PIIAccessAuditLog {
  id           String             @id @default(uuid())
  actorUserId  String
  targetUserId String
  fieldType    SensitiveFieldType
  accessScope  DataScopeRole
  actionReason String
  ipAddress    String
  userAgent    String
  accessedAt   DateTime           @default(now())

  @@index([actorUserId])
  @@index([targetUserId])
  @@index([accessedAt])
}
```

### `PaymentOutboxQueue` — Atomic Phase 124 (Phase5-7_EbooklineliffV2.md:27396)

```prisma
// Source: Atomic Phase 124
model PaymentOutboxQueue {
  id           String       @id @default(uuid())
  orderId      String       @unique
  order        Order        @relation(fields: [orderId], references: [id], onDelete: Cascade)
  slipImageUrl String
  retryCount   Int          @default(0)
  lastError    String?      @db.Text
  status       OutboxStatus @default(PENDING)
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  @@index([status])
  @@index([retryCount])
}
```

### `PaymentSlip` — Atomic Phase 000, Atomic Phase 012, Atomic Phase 014, Atomic Phase 015, Atomic Phase 016, Atomic Phase 020, Atomic Phase 093, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:8610)

```prisma
// Source: Atomic Phase 000, Atomic Phase 012, Atomic Phase 014, Atomic Phase 015, Atomic Phase 016, Atomic Phase 020, Atomic Phase 093, Atomic Phase 128
model PaymentSlip {
  id               String    @id @default(uuid())
  orderId          String    @unique
  order            Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  slipImageUrl     String
  transRef         String    @unique // Enforces Unique Transaction Reference across the entire platform
  sendingBank      String?
  receivingBank    String?
  receivingAccount String?
  amount           Decimal   @db.Decimal(10, 2)
  verifiedAt       DateTime  @default(now())
  apiRawResponse   Json
  createdAt        DateTime  @default(now())

  @@index([transRef])
  @@index([verifiedAt])
}
```

### `PayoutRequest` — Atomic Phase 086 (Phase5-7_EbooklineliffV2.md:7937)

```prisma
// Source: Atomic Phase 086
model PayoutRequest {
  id               String        @id @default(uuid())
  payoutNo         String        @unique
  userId           String
  user             User          @relation(fields: [userId], references: [id])
  grossAmount      Decimal       @db.Decimal(10, 2)
  taxRate          Decimal       @default(3.00) @db.Decimal(5, 2) // 3%
  taxAmount        Decimal       @db.Decimal(10, 2)
  feeAmount        Decimal       @default(0.00) @db.Decimal(10, 2)
  netAmount        Decimal       @db.Decimal(10, 2)
  status           PayoutStatus  @default(PENDING_APPROVAL)
  bankName         String
  bankAccountNumber String
  bankAccountName  String
  transRef         String?       @unique
  rejectionReason  String?
  processedBy      String?       // Admin User ID
  processedAt      DateTime?
  taxCertificateUrl String?      // Path to PDF
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  @@index([userId])
  @@index([status])
  @@index([payoutNo])
}
```

### `PayoutTransaction` — Atomic Phase 073, Atomic Phase 081 (Phase5-7_EbooklineliffV2.md:5405)

```prisma
// Source: Atomic Phase 073, Atomic Phase 081
model PayoutTransaction {
  id                   String              @id @default(uuid())
  payoutNo             String              @unique
  userId               String
  user                 User                @relation(fields: [userId], references: [id])
  grossAmount          Decimal             @db.Decimal(12, 2)
  taxRatePercent       Decimal             @default(3.00) @db.Decimal(5, 2)
  taxWithheldAmount    Decimal             @db.Decimal(12, 2)
  netTransferAmount    Decimal             @db.Decimal(12, 2)
  status               PayoutStatus        @default(REQUESTED)
  bankAccountDetail    Json                // Snapshot of bank details
  withholdingTaxRecord WithholdingTaxRecord?
  createdAt            DateTime            @default(now())
  updatedAt            DateTime            @updatedAt

  @@index([userId])
  @@index([status])
}
```

### `PerformanceMetric` — Atomic Phase 029 (Phase1-4_EbooklineliffV2.md:16125)

```prisma
// Source: Atomic Phase 029
model PerformanceMetric {
  id           String     @id @default(uuid())
  tenantId     String     @default("default")
  metricType   MetricType
  metricValue  Decimal    @db.Decimal(10, 4)
  route        String
  deviceMemory Int?       // Device RAM in GB
  effectiveType String?   // 4g, 3g, 2g
  userAgent    String?    @db.Text
  createdAt    DateTime   @default(now())

  @@index([tenantId, metricType])
  @@index([createdAt])
}
```

### `PermissionAuditLog` — Atomic Phase 032 (Phase1-4_EbooklineliffV2.md:17439)

```prisma
// Source: Atomic Phase 032
model PermissionAuditLog {
  id             String           @id @default(uuid())
  userId         String
  user           User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  permissionType PermissionType
  status         PermissionStatus
  purpose        String
  devicePlatform String
  ipAddress      String
  userAgent      String
  createdAt      DateTime         @default(now())

  @@index([userId])
  @@index([permissionType])
}
```

### `PhysicalDetail` — Atomic Phase 000, Atomic Phase 008, Atomic Phase 093, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:4622)

```prisma
// Source: Atomic Phase 000, Atomic Phase 008, Atomic Phase 093, Atomic Phase 128
model PhysicalDetail {
  id           String   @id @default(uuid())
  productId    String   @unique
  product      Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  isbn         String?  @unique
  weightGrams  Int      @default(0)
  lengthCm     Decimal? @db.Decimal(6, 2)
  widthCm      Decimal? @db.Decimal(6, 2)
  heightCm     Decimal? @db.Decimal(6, 2)
  stockQty     Int      @default(0)
  reservedQty  Int      @default(0)
  sku          String   @unique

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

### `PointRedemptionRule` — Atomic Phase 088 (Phase5-7_EbooklineliffV2.md:9002)

```prisma
// Source: Atomic Phase 088
model PointRedemptionRule {
  id             String   @id @default(uuid())
  pointsPerThb   Int      @default(10) // 10 แต้ม = 1 บาท
  minPointsToRedeem Int   @default(100) // ขั้นต่ำ 100 แต้ม
  maxPointsPercent  Decimal @default(50.00) @db.Decimal(5, 2) // แลกได้ไม่เกิน 50% ของยอดรวม
  updatedAt      DateTime @updatedAt
}
```

### `PointTransaction` — Atomic Phase 096 (Phase5-7_EbooklineliffV2.md:12805)

```prisma
// Source: Atomic Phase 096
model PointTransaction {
  id           String            @id @default(uuid())
  userId       String
  user         User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  squadId      String?
  squad        StudySquad?       @relation(fields: [squadId], references: [id], onDelete: SetNull)
  activityType PointActivityType
  pointsEarned Int
  multiplier   Float             @default(1.0)
  metadataJson Json?
  createdAt    DateTime          @default(now())

  @@index([userId, createdAt])
  @@index([squadId])
}
```

### `PrefetchAnalytics` — Atomic Phase 029 (Phase1-4_EbooklineliffV2.md:16152)

```prisma
// Source: Atomic Phase 029
model PrefetchAnalytics {
  id           String   @id @default(uuid())
  userId       String
  productId    String
  resourceKey  String
  isHit        Boolean  @default(false)
  latencySavedMs Int   @default(0)
  createdAt    DateTime @default(now())

  @@index([userId, productId])
  @@index([isHit])
}
```

### `PreviewUsageLog` — Atomic Phase 051 (Phase1-4_EbooklineliffV2.md:26578)

```prisma
// Source: Atomic Phase 051
model PreviewUsageLog {
  id            String   @id @default(uuid())
  userId        String?
  lineUserId    String?
  productId     String
  product       Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  contentType   String   // "EBOOK" | "VIDEO"
  maxPageReached Int      @default(0)
  maxSecWatched Int      @default(0)
  convertedToBuy Boolean @default(false)
  updatedAt     DateTime @updatedAt

  @@index([userId, productId])
  @@index([lineUserId])
}
```

### `Product` — Atomic Phase 000, Atomic Phase 008, Atomic Phase 009, Atomic Phase 010, Atomic Phase 012, Atomic Phase 020, Atomic Phase 037, Atomic Phase 051, Atomic Phase 074, Atomic Phase 093, Atomic Phase 128 (Phase1-4_EbooklineliffV2.md:4581)

```prisma
// Source: Atomic Phase 000, Atomic Phase 008, Atomic Phase 009, Atomic Phase 010, Atomic Phase 012, Atomic Phase 020, Atomic Phase 037, Atomic Phase 051, Atomic Phase 074, Atomic Phase 093, Atomic Phase 128
model Product {
  id             String          @id @default(uuid())
  tenantId       String
  tenant         Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sellerId       String
  title          String
  slug           String          @unique
  description    String          @db.Text
  coverImageUrl  String
  productType    ProductType
  status         ProductStatus   @default(DRAFT)
  price          Decimal         @db.Decimal(10, 2)
  discountPrice  Decimal?        @db.Decimal(10, 2)
  isPublished    Boolean         @default(false)

  // Relations according to Product Types
  physicalDetail PhysicalDetail?
  ebookDetail    EbookDetail?
  courseDetail   CourseDetail?

  // Hybrid Bundle Relationships (Self-referential Many-to-Many)
  bundleParents  BundleItem[]    @relation("ChildProducts")
  bundleChildren BundleItem[]    @relation("ParentBundle")

  // System Integrity & Analytics
  categories     ProductCategoryMap[]
  tags           ProductTagMap[]
  entitlements   Entitlement[]
  orderItems     OrderItem[]

  deletedAt      DateTime?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  @@index([tenantId])
  @@index([sellerId])
  @@index([productType])
  @@index([status, isPublished])
  @@index([slug])
}
```

### `ProductCategory` — Atomic Phase 009 (Phase1-4_EbooklineliffV2.md:5151)

```prisma
// Source: Atomic Phase 009
model ProductCategory {
  productId  String
  categoryId String
  product    Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  category   Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@id([productId, categoryId])
  @@index([categoryId])
}
```

### `ProductCategoryMap` — Atomic Phase 008 (Phase1-4_EbooklineliffV2.md:4731)

```prisma
// Source: Atomic Phase 008
model ProductCategoryMap {
  productId  String
  categoryId String
  product    Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  category   Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@id([productId, categoryId])
}
```

### `ProductDraft` — Atomic Phase 074 (Phase5-7_EbooklineliffV2.md:1431)

```prisma
// Source: Atomic Phase 074
model ProductDraft {
  id          String      @id @default(uuid())
  sellerId    String
  productType ProductType
  draftName   String      @default("Untitled Draft")
  stepIndex   Int         @default(1)
  payloadJson Json        // Complete Intermediate Form State
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@index([sellerId])
  @@index([updatedAt])
}
```

### `ProductEmbedding` — Atomic Phase 104 (Phase5-7_EbooklineliffV2.md:16896)

```prisma
// Source: Atomic Phase 104
model ProductEmbedding {
  id          String   @id @default(uuid())
  productId   String   @unique
  product     Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  embedding   Unsupported("vector(768)") // Content Feature Vector Embedding
  summaryText String   @db.Text
  updatedAt   DateTime @updatedAt

  @@index([productId])
}
```

### `ProductTagMap` — Atomic Phase 008 (Phase1-4_EbooklineliffV2.md:4746)

```prisma
// Source: Atomic Phase 008
model ProductTagMap {
  productId String
  tagId     String
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  tag       Tag     @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([productId, tagId])
}
```

### `ProgressSyncAuditLog` — Atomic Phase 064 (Phase1-4_EbooklineliffV2.md:33177)

```prisma
// Source: Atomic Phase 064
model ProgressSyncAuditLog {
  id               String   @id @default(uuid())
  userId           String
  syncBatchId      String   @unique
  itemCount        Int
  conflictsHandled Int      @default(0)
  ipAddress        String
  userAgent        String
  createdAt        DateTime @default(now())

  @@index([userId])
}
```

### `PromptPayTransaction` — Atomic Phase 013 (Phase1-4_EbooklineliffV2.md:7398)

```prisma
// Source: Atomic Phase 013
model PromptPayTransaction {
  id             String          @id @default(uuid())
  orderId        String          @unique
  order          Order           @relation(fields: [orderId], references: [id], onDelete: Cascade)
  promptPayId    String          // Biller ID or Mobile / Tax ID
  qrPayload      String          @db.Text
  ref1           String
  ref2           String?
  baseAmount     Decimal         @db.Decimal(10, 2)
  fractionalCent Decimal         @db.Decimal(3, 2) @default(0.00)
  totalAmount    Decimal         @db.Decimal(10, 2)
  expiresAt      DateTime
  status         PromptPayStatus @default(PENDING)
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  @@index([expiresAt])
  @@index([ref1])
  @@index([totalAmount, status])
}
```

### `QrSessionNonce` — Atomic Phase 007 (Phase1-4_EbooklineliffV2.md:4062)

```prisma
// Source: Atomic Phase 007
model QrSessionNonce {
  id                String       @id @default(uuid())
  qrToken           String       @unique @default(uuid())
  nonceHash         String       @unique
  socketClientId    String
  status            QrStatus     @default(PENDING)
  scannedByUserId   String?
  scannedByUser     User?        @relation(fields: [scannedByUserId], references: [id], onDelete: SetNull)
  deviceFingerprint String?
  desktopIpAddress  String?
  mobileIpAddress   String?
  expiresAt         DateTime
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt

  @@index([qrToken])
  @@index([expiresAt])
}
```

### `QuizAttempt` — Atomic Phase 047, Atomic Phase 078 (Phase1-4_EbooklineliffV2.md:24697)

```prisma
// Source: Atomic Phase 047, Atomic Phase 078
model QuizAttempt {
  id            String     @id @default(uuid())
  userId        String
  user          User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  quizId        String
  quiz          LessonQuiz @relation(fields: [quizId], references: [id], onDelete: Cascade)
  isPassed      Boolean    @default(false)
  selectedOpts  String[]   // Array ของ Option IDs ที่ผู้ใช้เลือก
  shortAnswer   String?    @db.Text
  scoreObtained Float      @default(0.0)
  attemptCount  Int        @default(1)
  createdAt     DateTime   @default(now())

  @@index([userId, quizId])
}
```

### `QuizOption` — Atomic Phase 047, Atomic Phase 078 (Phase1-4_EbooklineliffV2.md:24686)

```prisma
// Source: Atomic Phase 047, Atomic Phase 078
model QuizOption {
  id           String     @id @default(uuid())
  quizId       String
  quiz         LessonQuiz @relation(fields: [quizId], references: [id], onDelete: Cascade)
  optionText   String     @db.Text
  isCorrect    Boolean    @default(false) // ปกปิดบน Frontend ส่งเฉพาะเมื่อ Validate
  optionOrder  Int        @default(0)

  @@index([quizId])
}
```

### `ReceiptNotificationLog` — Atomic Phase 019 (Phase1-4_EbooklineliffV2.md:11279)

```prisma
// Source: Atomic Phase 019
model ReceiptNotificationLog {
  id             String        @id @default(uuid())
  orderId        String
  order          Order         @relation(fields: [orderId], references: [id], onDelete: Cascade)
  lineUserId     String
  status         ReceiptStatus @default(PENDING)
  lineMessageId  String?
  pdfR2Path      String?
  errorMessage   String?
  retryCount     Int           @default(0)
  sentAt         DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@index([orderId])
  @@index([lineUserId])
  @@index([status])
}
```

### `RecommendationSlateLog` — Atomic Phase 104 (Phase5-7_EbooklineliffV2.md:16923)

```prisma
// Source: Atomic Phase 104
model RecommendationSlateLog {
  id             String                   @id @default(uuid())
  userId         String
  user           User                     @relation(fields: [userId], references: [id], onDelete: Cascade)
  productId      String
  product        Product                  @relation(fields: [productId], references: [id], onDelete: Cascade)
  positionIndex  Int
  reasonType     RecommendationReasonType
  isClicked      Boolean                  @default(false)
  isPurchased    Boolean                  @default(false)
  createdAt      DateTime                 @default(now())

  @@index([userId])
  @@index([productId])
}
```

### `ReconciliationLog` — Atomic Phase 115 (Phase5-7_EbooklineliffV2.md:23234)

```prisma
// Source: Atomic Phase 115
model ReconciliationLog {
  id              String        @id @default(uuid())
  bankStatementId String
  bankStatement   BankStatement @relation(fields: [bankStatementId], references: [id], onDelete: Cascade)
  orderId         String?
  matchScore      Float         // 0.0 to 100.0 score
  matchedByAlgorithm String
  executionTimeMs Int
  createdAt       DateTime      @default(now())

  @@index([bankStatementId])
}
```

### `RevenueShareRule` — Atomic Phase 114 (Phase5-7_EbooklineliffV2.md:22707)

```prisma
// Source: Atomic Phase 114
model RevenueShareRule {
  id                  String   @id @default(uuid())
  tenantId            String   @default("default")
  productType         String   // PHYSICAL_BOOK, EBOOK, ELEARNING_COURSE
  platformFeePercent  Decimal  @db.Decimal(5, 2)
  creatorSharePercent Decimal  @db.Decimal(5, 2)
  affiliateSharePercent Decimal @db.Decimal(5, 2)
  createdAt           DateTime @default(now())

  @@unique([tenantId, productType])
}
```

### `RevocationBlacklist` — Atomic Phase 106 (Phase5-7_EbooklineliffV2.md:18125)

```prisma
// Source: Atomic Phase 106
model RevocationBlacklist {
  jti       String   @id
  userId    String
  reason    String
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([expiresAt])
}
```

### `RewardItem` — Atomic Phase 083 (Phase5-7_EbooklineliffV2.md:6408)

```prisma
// Source: Atomic Phase 083
model RewardItem {
  id             String             @id @default(uuid())
  title          String
  description    String             @db.Text
  imageUrl       String
  rewardType     RewardType
  pointsRequired Int
  stockQty       Int                @default(0)
  productId      String?
  discountAmount Decimal?           @db.Decimal(10, 2)
  isPublished    Boolean            @default(true)
  redemptions    RewardRedemption[]
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt

  @@index([rewardType])
}
```

### `RewardRedemption` — Atomic Phase 083 (Phase5-7_EbooklineliffV2.md:6426)

```prisma
// Source: Atomic Phase 083
model RewardRedemption {
  id             String           @id @default(uuid())
  redemptionCode String           @unique @default(uuid())
  userId         String
  rewardItemId   String
  pointsSpent    Int
  status         RedemptionStatus @default(COMPLETED)
  user           User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  rewardItem     RewardItem       @relation(fields: [rewardItemId], references: [id])
  redeemedAt     DateTime         @default(now())

  @@index([userId])
  @@index([redemptionCode])
}
```

### `RoleScopeRegistry` — Atomic Phase 106 (Phase5-7_EbooklineliffV2.md:18100)

```prisma
// Source: Atomic Phase 106
model RoleScopeRegistry {
  id           String       @id @default(uuid())
  roleId       String
  role         SecurityRole @relation(fields: [roleId], references: [id], onDelete: Cascade)
  scopePattern String       // e.g. "tenant:COMP-1:ebook:read"
  createdAt    DateTime     @default(now())

  @@index([roleId])
  @@index([scopePattern])
}
```

### `ScraperBlacklist` — Atomic Phase 050 (Phase1-4_EbooklineliffV2.md:26040)

```prisma
// Source: Atomic Phase 050
model ScraperBlacklist {
  id                 String             @id @default(uuid())
  userId             String
  ipAddress          String
  reason             String
  violationCount     Int                @default(1)
  actionTaken        SecurityActionType @default(TEMPORARY_BLOCK)
  blockedUntil       DateTime?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  user               User               @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([ipAddress])
  @@index([userId])
}
```

### `SecurityAuditLog` — Atomic Phase 106, Atomic Phase 119, Atomic Phase 127 (Phase5-7_EbooklineliffV2.md:28544)

```prisma
// Source: Atomic Phase 106, Atomic Phase 119, Atomic Phase 127
model SecurityAuditLog {
  id             String         @id @default(uuid())
  userId         String?
  ipAddress      String
  userAgent      String
  endpoint       String
  threatType     String
  severity       ThreatSeverity @default(LOW)
  payloadSnippet String?        @db.Text
  isBlocked      Boolean        @default(true)
  createdAt      DateTime       @default(now())

  @@index([userId])
  @@index([ipAddress])
  @@index([severity])
  @@index([createdAt])
}
```

### `SecurityCspLog` — Atomic Phase 028 (Phase1-4_EbooklineliffV2.md:15638)

```prisma
// Source: Atomic Phase 028
model SecurityCspLog {
  id                 String           @id @default(uuid())
  tenantId           String?
  userId             String?
  ipAddress          String
  userAgent          String
  documentUri        String
  violatedDirective  String
  blockedUri         String
  originalPolicy     String           @db.Text
  severity           SecuritySeverity @default(WARNING)
  createdAt          DateTime         @default(now())

  @@index([tenantId])
  @@index([violatedDirective])
  @@index([createdAt])
}
```

### `SecurityIpBlacklist` — Atomic Phase 120 (Phase5-7_EbooklineliffV2.md:25583)

```prisma
// Source: Atomic Phase 120
model SecurityIpBlacklist {
  id         String    @id @default(uuid())
  ipAddress  String    @unique
  reason     String
  riskScore  Int       @default(100)
  expiresAt  DateTime?
  createdAt  DateTime  @default(now())

  @@index([ipAddress])
}
```

### `SecurityRole` — Atomic Phase 106 (Phase5-7_EbooklineliffV2.md:18085)

```prisma
// Source: Atomic Phase 106
model SecurityRole {
  id                 String               @id @default(uuid())
  tenantId           String
  name               String
  description        String?
  bitwiseMask        Decimal              @default(0) @db.Decimal(39, 0) // BigInt Representation for 128-bit future proofing
  scopes             RoleScopeRegistry[]
  userAssignments    UserTenantRole[]
  createdAt          DateTime             @default(now())
  updatedAt          DateTime             @updatedAt

  @@unique([tenantId, name])
  @@index([tenantId])
}
```

### `SecurityViolationLog` — Atomic Phase 042 (Phase1-4_EbooklineliffV2.md:22336)

```prisma
// Source: Atomic Phase 042
model SecurityViolationLog {
  id            String   @id @default(uuid())
  userId        String
  lineUserId    String?
  violationType String   // TAMPER_DOM, SCREENSHOT_DETECTED, DEVTOOLS_OPENED
  metadataJson  Json
  ipAddress     String
  createdAt     DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([violationType])
}
```

### `SellerPayout` — Atomic Phase 114 (Phase5-7_EbooklineliffV2.md:22682)

```prisma
// Source: Atomic Phase 114
model SellerPayout {
  id                 String                         @id @default(uuid())
  tenantId           String                         @default("default")
  sellerId           String
  seller             User                           @relation(fields: [sellerId], references: [id])
  grossAmount        Decimal                        @db.Decimal(12, 2)
  taxRatePercent     Decimal                        @default(3.00) @db.Decimal(5, 2)
  taxWithheldAmount  Decimal                        @db.Decimal(12, 2)
  netPayoutAmount    Decimal                        @db.Decimal(12, 2)
  payoutStatus       PayoutStatus                   @default(PENDING)
  bankName           String
  bankAccountNumber  String
  bankAccountName    String
  transRef           String?                        @unique
  taxCertificatePath String?
  executedAt         DateTime?
  createdAt          DateTime                       @default(now())
  updatedAt          DateTime                       @updatedAt

  ledgerEntries      FinancialClearinghouseLedger[]

  @@index([sellerId])
  @@index([payoutStatus])
}
```

### `SentryErrorIncident` — Atomic Phase 121 (Phase5-7_EbooklineliffV2.md:26023)

```prisma
// Source: Atomic Phase 121
model SentryErrorIncident {
  id            String   @id @default(uuid())
  sentryId      String   @unique
  traceId       String?
  environment   String
  serviceName   String
  exceptionClass String
  errorMessage  String   @db.Text
  stackTrace    String?  @db.Text
  handled       Boolean  @default(false)
  tenantId      String?
  createdAt     DateTime @default(now())

  @@index([traceId])
  @@index([sentryId])
  @@index([createdAt])
}
```

### `ServiceMessageTemplate` — Atomic Phase 024 (Phase1-4_EbooklineliffV2.md:13918)

```prisma
// Source: Atomic Phase 024
model ServiceMessageTemplate {
  id              String         @id @default(uuid())
  tenantId        String
  templateName    String
  messageType     MessageType
  flexTemplateJson Json          // โครงสร้าง Flex Message JSON Template
  isActive        Boolean        @default(true)
  logs            NotificationLog[]
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@unique([tenantId, messageType])
}
```

### `Session` — Atomic Phase 005 (Phase1-4_EbooklineliffV2.md:2794)

```prisma
// Source: Atomic Phase 005
model Session {
  id           String   @id @default(uuid())
  userId       String
  tenantId     String
  sessionToken String   @unique
  refreshToken String   @unique
  deviceOs     String?
  userAgent    String?
  ipAddress    String?
  isRevoked    Boolean  @default(false)
  expiresAt    DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([userId])
  @@index([sessionToken])
}
```

### `ShareEvent` — Atomic Phase 079, Atomic Phase 080 (Phase5-7_EbooklineliffV2.md:4846)

```prisma
// Source: Atomic Phase 079, Atomic Phase 080
model ShareEvent {
  id            String      @id @default(uuid())
  userId        String
  user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  productId     String
  product       Product     @relation(fields: [productId], references: [id], onDelete: Cascade)
  targetType    String      @default("PRODUCT_PDP")
  refToken      String      @unique
  shareChannel  String      @default("LINE_FLEX")
  clickCount    Int         @default(0)
  clicks        AffiliateClick[]
  createdAt     DateTime    @default(now())

  @@index([userId])
  @@index([productId])
  @@index([refToken])
}
```

### `ShareLog` — Atomic Phase 026 (Phase1-4_EbooklineliffV2.md:14803)

```prisma
// Source: Atomic Phase 026
model ShareLog {
  id                 String           @id @default(uuid())
  userId             String
  user               User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  productId          String
  product            Product          @relation(fields: [productId], references: [id], onDelete: Cascade)
  shareToken         String           @unique
  targetType         ShareTargetType  @default(INDIVIDUAL)
  status             ShareStatus      @default(SUCCESS)
  rewardPointsAwarded Int              @default(0)
  clickCount         Int              @default(0)
  conversionCount    Int              @default(0)
  attributions       ViralAttribution[]
  createdAt          DateTime         @default(now())

  @@index([userId])
  @@index([productId])
  @@index([shareToken])
}
```

### `Shipment` — Atomic Phase 077 (Phase5-7_EbooklineliffV2.md:3040)

```prisma
// Source: Atomic Phase 077
model Shipment {
  id              String           @id @default(uuid())
  orderId         String           @unique
  order           Order            @relation(fields: [orderId], references: [id], onDelete: Cascade)
  carrier         LogisticsCarrier
  trackingNumber  String           @unique
  courierOrderId  String?          // Internal Order ID from Carrier API
  labelUrl        String?          @db.Text
  status          ShipmentStatus   @default(PENDING_BOOKING)
  weightGrams     Int
  shippingFee     Decimal          @db.Decimal(10, 2)
  senderName      String
  senderPhone     String
  recipientName   String
  recipientPhone  String
  destinationAddr String           @db.Text

  trackingLogs    TrackingHistory[]
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@index([trackingNumber])
  @@index([carrier, status])
}
```

### `ShippingRateTable` — Atomic Phase 011 (Phase1-4_EbooklineliffV2.md:6236)

```prisma
// Source: Atomic Phase 011
model ShippingRateTable {
  id             String   @id @default(uuid())
  carrierName    String   // e.g., FLASH, KERRY, THAIPOST
  minWeightGrams Int
  maxWeightGrams Int
  baseFee        Decimal  @db.Decimal(10, 2)
  provinceZone   String   @default("BANGKOK_METRO") // or "UPCOUNTRY", "REMOTE"
  createdAt      DateTime @default(now())

  @@index([carrierName, provinceZone])
}
```

### `ShortLink` — Atomic Phase 025 (Phase1-4_EbooklineliffV2.md:14306)

```prisma
// Source: Atomic Phase 025
model ShortLink {
  id             String         @id @default(uuid())
  tenantId       String
  shortCode      String         @unique
  targetType     ProductType
  targetId       String
  customPath     String
  affiliateCode  String?
  campaignId     String?
  couponCode     String?
  signature      String
  clickCount     Int            @default(0)
  maxRedemptions Int?
  expiresAt      DateTime?
  isActive       Boolean        @default(true)
  clickLogs      DeepLinkLog[]
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  @@index([shortCode])
  @@index([tenantId, targetId])
}
```

### `SocialNote` — Atomic Phase 095 (Phase5-7_EbooklineliffV2.md:12321)

```prisma
// Source: Atomic Phase 095
model SocialNote {
  id           String         @id @default(uuid())
  ebookId      String
  ebook        EbookDetail    @relation(fields: [ebookId], references: [id], onDelete: Cascade)
  userId       String
  user         User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  pageNumber   Int
  positionX    Float          // Relative X percentage (0 - 100)
  positionY    Float          // Relative Y percentage (0 - 100)
  selectedText String?        @db.Text
  content      String         @db.Text
  visibility   NoteVisibility @default(PUBLIC)
  noteType     NoteType       @default(MARGIN_TEXT)
  studyGroupId String?
  studyGroup   StudyGroup?    @relation(fields: [studyGroupId], references: [id], onDelete: SetNull)
  likesCount   Int            @default(0)

  reactions    SocialNoteReaction[]
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt

  @@index([ebookId, pageNumber])
  @@index([userId])
  @@index([visibility])
}
```

### `SocialNoteReaction` — Atomic Phase 095 (Phase5-7_EbooklineliffV2.md:12356)

```prisma
// Source: Atomic Phase 095
model SocialNoteReaction {
  id        String     @id @default(uuid())
  noteId    String
  note      SocialNote @relation(fields: [noteId], references: [id], onDelete: Cascade)
  userId    String
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      String     @default("LIKE")

  @@unique([noteId, userId])
}
```

### `SquadChallenge` — Atomic Phase 096 (Phase5-7_EbooklineliffV2.md:12821)

```prisma
// Source: Atomic Phase 096
model SquadChallenge {
  id           String      @id @default(uuid())
  squadId      String
  squad        StudySquad  @relation(fields: [squadId], references: [id], onDelete: Cascade)
  title        String
  targetPoints Int
  currentPoints Int        @default(0)
  rewardPoints Int
  isCompleted  Boolean     @default(false)
  endDate      DateTime
  createdAt    DateTime    @default(now())

  @@index([squadId])
}
```

### `SquadMember` — Atomic Phase 096 (Phase5-7_EbooklineliffV2.md:12790)

```prisma
// Source: Atomic Phase 096
model SquadMember {
  id                String          @id @default(uuid())
  squadId           String
  squad             StudySquad      @relation(fields: [squadId], references: [id], onDelete: Cascade)
  userId            String
  user              User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  role              SquadMemberRole @default(MEMBER)
  pointsContributed Int             @default(0)
  joinedAt          DateTime        @default(now())

  @@unique([squadId, userId])
  @@index([userId])
  @@index([squadId])
}
```

### `StockMovementLog` — Atomic Phase 075 (Phase5-7_EbooklineliffV2.md:2050)

```prisma
// Source: Atomic Phase 075
model StockMovementLog {
  id            String      @id @default(uuid())
  warehouseId   String
  warehouse     Warehouse   @relation(fields: [warehouseId], references: [id])
  sku           String
  previousQty   Int
  newQty        Int
  quantityDelta Int
  adjustmentType String     // PURCHASE_RECEIPT, SALES_DEDUCTION, etc.
  remark        String?
  updatedBy     String
  user          User        @relation(fields: [updatedBy], references: [id])
  createdAt     DateTime    @default(now())

  @@index([sku])
  @@index([warehouseId])
  @@index([createdAt])
}
```

### `StockReservation` — Atomic Phase 087 (Phase5-7_EbooklineliffV2.md:8475)

```prisma
// Source: Atomic Phase 087
model StockReservation {
  id               String        @id @default(uuid())
  reservationToken String        @unique @default(uuid())
  flashSaleItemId  String
  flashSaleItem    FlashSaleItem @relation(fields: [flashSaleItemId], references: [id], onDelete: Cascade)
  userId           String
  user             User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  quantity         Int           @default(1)
  status           String        @default("HOLD") // HOLD, CONFIRMED, EXPIRED, CANCELLED
  expiresAt        DateTime

  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  @@index([userId])
  @@index([reservationToken])
  @@index([expiresAt, status])
}
```

### `StorageBucketPolicy` — Atomic Phase 123 (Phase5-7_EbooklineliffV2.md:26800)

```prisma
// Source: Atomic Phase 123
model StorageBucketPolicy {
  id                           String   @id @default(uuid())
  tenantId                     String
  bucketName                   String
  ruleId                       String   @unique
  prefix                       String
  enabled                      Boolean  @default(true)
  expireDays                   Int?
  abortIncompleteMultipartDays Int      @default(1)
  description                  String?  @db.Text
  createdAt                    DateTime @default(now())
  updatedAt                    DateTime @updatedAt

  @@index([tenantId])
  @@index([bucketName])
}
```

### `StorageBudgetAlertConfig` — Atomic Phase 123 (Phase5-7_EbooklineliffV2.md:26831)

```prisma
// Source: Atomic Phase 123
model StorageBudgetAlertConfig {
  id                       String   @id @default(uuid())
  tenantId                 String   @unique
  monthlyBudgetLimitTHB    Decimal  @db.Decimal(10, 2)
  warningThresholdPercent  Float    @default(70.0)
  criticalThresholdPercent Float    @default(85.0)
  notifyLineUserIds        String[]
  autoPurgeTempOnExceed    Boolean  @default(true)
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
}
```

### `StorageCostAlertLog` — Atomic Phase 123 (Phase5-7_EbooklineliffV2.md:26843)

```prisma
// Source: Atomic Phase 123
model StorageCostAlertLog {
  id               String             @id @default(uuid())
  tenantId         String
  severity         AlertSeverity
  alertMessage     String             @db.Text
  currentCostTHB   Decimal            @db.Decimal(10, 2)
  budgetLimitTHB   Decimal            @db.Decimal(10, 2)
  percentUsed      Float
  deliveryStatus   StorageAlertStatus @default(PENDING)
  lineLogResponse  Json?
  triggeredAt      DateTime           @default(now())

  @@index([tenantId, triggeredAt])
}
```

### `StorageUsageMetric` — Atomic Phase 123 (Phase5-7_EbooklineliffV2.md:26817)

```prisma
// Source: Atomic Phase 123
model StorageUsageMetric {
  id                   String   @id @default(uuid())
  tenantId             String
  bucketName           String
  totalSizeBytes       BigInt   @default(0)
  totalObjectsCount    Int      @default(0)
  classAOperations     Int      @default(0)
  classBOperations     Int      @default(0)
  estimatedCostTHB     Decimal  @default(0.00) @db.Decimal(10, 2)
  recordedAt           DateTime @default(now())

  @@index([tenantId, recordedAt])
}
```

### `StorageVaultAsset` — Atomic Phase 036 (Phase1-4_EbooklineliffV2.md:19080)

```prisma
// Source: Atomic Phase 036
model StorageVaultAsset {
  id              String         @id @default(uuid())
  bucketName      String         @default("omni-commerce-vault")
  objectKey       String         @unique
  fileSizeBytes   BigInt
  mimeType        String
  sha256Checksum  String
  storageClass    String         @default("STANDARD")
  isPublic        Boolean        @default(false)

  // Storage relationships
  ebookDetailId   String?        @unique
  ebookDetail     EbookDetail?   @relation("EbookR2Source", fields: [ebookDetailId], references: [id], onDelete: Cascade)

  courseLessonId  String?        @unique
  courseLesson    CourseLesson?  @relation("LessonVideoR2Source", fields: [courseLessonId], references: [id], onDelete: Cascade)

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([objectKey])
  @@index([mimeType])
}
```

### `StudyGroup` — Atomic Phase 095 (Phase5-7_EbooklineliffV2.md:12347)

```prisma
// Source: Atomic Phase 095
model StudyGroup {
  id          String       @id @default(uuid())
  name        String
  ownerId     String
  owner       User         @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  socialNotes SocialNote[]
  createdAt   DateTime     @default(now())
}
```

### `StudySquad` — Atomic Phase 096 (Phase5-7_EbooklineliffV2.md:12764)

```prisma
// Source: Atomic Phase 096
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
  members       SquadMember[]
  challenges    SquadChallenge[]
  pointLogs     PointTransaction[]

  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt

  @@index([tenantId])
  @@index([squadCode])
  @@index([totalPoints(sort: Desc)])
}
```

### `SubtitleSegment` — Atomic Phase 094 (Phase5-7_EbooklineliffV2.md:12024)

```prisma
// Source: Atomic Phase 094
model SubtitleSegment {
  id              String        @id @default(uuid())
  videoSubtitleId String
  videoSubtitle   VideoSubtitle @relation(fields: [videoSubtitleId], references: [id], onDelete: Cascade)
  segmentIndex    Int
  startTimeSec    Float
  endTimeSec      Float
  textContent     String
  translatedJson  Json?         // Key-Value of target languages
  createdAt       DateTime      @default(now())

  @@index([videoSubtitleId, segmentIndex])
}
```

### `SupportCategory` — Atomic Phase 103 (Phase5-7_EbooklineliffV2.md:16453)

```prisma
// Source: Atomic Phase 103
model SupportCategory {
  id          String          @id @default(uuid())
  name        String
  description String?
  tickets     SupportTicket[]
  createdAt   DateTime        @default(now())
}
```

### `SupportTicket` — Atomic Phase 103 (Phase5-7_EbooklineliffV2.md:16461)

```prisma
// Source: Atomic Phase 103
model SupportTicket {
  id           String            @id @default(uuid())
  ticketNo     String            @unique
  userId       String
  user         User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  categoryId   String
  category     SupportCategory   @relation(fields: [categoryId], references: [id])
  assignedTo   String?           // Agent User ID
  subject      String
  priority     TicketPriority    @default(MEDIUM)
  status       TicketStatus      @default(OPEN)
  messages     TicketMessage[]
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt

  @@index([userId])
  @@index([status])
  @@index([assignedTo])
}
```

### `SystemAuditLog` — Atomic Phase 121 (Phase5-7_EbooklineliffV2.md:26002)

```prisma
// Source: Atomic Phase 121
model SystemAuditLog {
  id          String   @id @default(uuid())
  traceId     String
  spanId      String?
  tenantId    String?
  userId      String?
  user        User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  action      String
  resource    String
  statusCode  Int
  ipAddress   String   @default("[REDACTED]")
  userAgent   String?
  payloadJson Json?
  createdAt   DateTime @default(now())

  @@index([traceId])
  @@index([userId])
  @@index([tenantId])
  @@index([createdAt])
}
```

### `SystemHealth` — Atomic Phase 001 (Phase1-4_EbooklineliffV2.md:632)

```prisma
// Source: Atomic Phase 001
model SystemHealth {
  id        String   @id @default(uuid())
  status    String
  nodeName  String
  createdAt DateTime @default(now())
}
```

### `SystemHealthMetric` — Atomic Phase 127 (Phase5-7_EbooklineliffV2.md:28577)

```prisma
// Source: Atomic Phase 127
model SystemHealthMetric {
  id                   String   @id @default(uuid())
  nodeName             String
  cpuUsagePercent      Float
  memoryUsagePercent   Float
  dbConnectionPoolUsed Int
  redisMemoryUsedMb    Float
  drState              DRState  @default(NORMAL)
  recordedAt           DateTime @default(now())

  @@index([recordedAt])
}
```

### `Tag` — Atomic Phase 008 (Phase1-4_EbooklineliffV2.md:4740)

```prisma
// Source: Atomic Phase 008
model Tag {
  id        String          @id @default(uuid())
  name      String          @unique
  products  ProductTagMap[]
}
```

### `Tenant` — Atomic Phase 006, Atomic Phase 008, Atomic Phase 030, Atomic Phase 071, Atomic Phase 072 (Phase5-7_EbooklineliffV2.md:144)

```prisma
// Source: Atomic Phase 006, Atomic Phase 008, Atomic Phase 030, Atomic Phase 071, Atomic Phase 072
model Tenant {
  id              String               @id @default(uuid())
  slug            String               @unique
  name            String
  status          TenantStatus         @default(ACTIVE)
  brandingConfig  TenantBrandingConfig?
  customDomains   TenantDomain[]
  users           UserTenantMapping[]
  products        Product[]
  orders          Order[]
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt

  @@index([slug])
}
```

### `TenantBranding` — Atomic Phase 023, Atomic Phase 030 (Phase1-4_EbooklineliffV2.md:16597)

```prisma
// Source: Atomic Phase 023, Atomic Phase 030
model TenantBranding {
  id                      String   @id @default(uuid())
  tenantId                String   @unique
  tenant                  Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  primaryColor            String   @default("#10B981")
  navBarBgColor           String   @default("#0F172A")
  navBarTextColor         String   @default("#FFFFFF")
  iconTheme               String   @default("LIGHT") // LIGHT | DARK | AUTO
  enableCustomCloseButton Boolean  @default(true)
  enableShareOptionMenu   Boolean  @default(true)
  logoUrl                 String?
  updatedAt               DateTime @updatedAt

  @@index([tenantId])
}
```

### `TenantBrandingConfig` — Atomic Phase 071 (Phase5-7_EbooklineliffV2.md:171)

```prisma
// Source: Atomic Phase 071
model TenantBrandingConfig {
  id             String   @id @default(uuid())
  tenantId       String   @unique
  tenant         Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  primaryColor   String   @default("#000000")
  secondaryColor String   @default("#ffffff")
  accentColor    String   @default("#10b981")
  logoUrl        String
  faviconUrl     String?
  customFontUrl  String?
  updatedAt      DateTime @updatedAt
}
```

### `TenantCompany` — Atomic Phase 108 (Phase5-7_EbooklineliffV2.md:19073)

```prisma
// Source: Atomic Phase 108
model TenantCompany {
  id                   String               @id @default(uuid())
  name                 String
  slug                 String               @unique
  status               CompanyStatus        @default(PENDING_KYC)
  packageTier          PackageTier          @default(STARTER_FREE)
  contactEmail         String
  contactPhone         String?
  logoUrl              String?
  primaryColor         String               @default("#10B981")

  // Resource Quotas
  maxUsers             Int                  @default(1000)
  maxStorageBytes      BigInt               @default(10737418240) // Default 10 GB
  maxMonthlyLiffMAU    Int                  @default(5000)

  // Dynamic Feature Flags Configuration
  featureFlags         Json                 @default("{\"customDomain\": false, \"affiliate\": true, \"whiteLabel\": false}")

  // Relations
  domains              TenantDomain[]
  subscriptions        TenantSubscription[]
  usageMetrics         TenantUsageMetric[]
  createdAt            DateTime             @default(now())
  updatedAt            DateTime             @updatedAt

  @@index([slug])
  @@index([status])
  @@index([packageTier])
}
```

### `TenantConfig` — Atomic Phase 034 (Phase1-4_EbooklineliffV2.md:18336)

```prisma
// Source: Atomic Phase 034
model TenantConfig {
  id                   String        @id @default(uuid())
  tenantName           String
  lineOaId             String        @unique // e.g. @brand_official
  lineOaChannelId      String
  lineOaChannelSecret  String
  lineOaChannelToken   String        @db.Text
  botPromptMode        BotPromptMode @default(AGGRESSIVE)
  createdAt            DateTime      @default(now())
  updatedAt            DateTime      @updatedAt
}
```

### `TenantDomain` — Atomic Phase 071, Atomic Phase 108 (Phase5-7_EbooklineliffV2.md:19104)

```prisma
// Source: Atomic Phase 071, Atomic Phase 108
model TenantDomain {
  id           String         @id @default(uuid())
  tenantId     String
  tenant       TenantCompany  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  domain       String         @unique
  isPrimary    Boolean        @default(false)
  status       DomainStatus   @default(PENDING_DNS)
  sslVerified  Boolean        @default(false)
  cnameTarget  String         @default("ingress.omnichannel-liff.com")
  verifiedAt   DateTime?
  createdAt    DateTime       @default(now())

  @@index([tenantId])
  @@index([domain])
}
```

### `TenantLineConfig` — Atomic Phase 024 (Phase1-4_EbooklineliffV2.md:13906)

```prisma
// Source: Atomic Phase 024
model TenantLineConfig {
  id                 String   @id @default(uuid())
  tenantId           String   @unique
  lineChannelId      String
  lineChannelSecret  String
  lineChannelAccessToken String @db.Text
  serviceMsgServiceId String? // ID สำหรับเปิดใช้งาน LINE Service Message (LNM)
  isServiceMsgActive Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

### `TenantSetting` — Atomic Phase 019 (Phase1-4_EbooklineliffV2.md:11267)

```prisma
// Source: Atomic Phase 019
model TenantSetting {
  id               String   @id @default(uuid())
  tenantSlug       String   @unique
  companyName      String
  taxRegistrationNo String?
  logoUrl          String
  primaryColorHex  String   @default("#00C751")
  lineChannelToken String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

### `TenantSubscription` — Atomic Phase 108 (Phase5-7_EbooklineliffV2.md:19120)

```prisma
// Source: Atomic Phase 108
model TenantSubscription {
  id             String        @id @default(uuid())
  tenantId       String
  tenant         TenantCompany @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  packageTier    PackageTier
  monthlyFee     Decimal       @db.Decimal(10, 2)
  startsAt       DateTime
  expiresAt      DateTime
  isAutoRenew    Boolean       @default(true)
  paymentStatus  String        @default("PAID")
  createdAt      DateTime      @default(now())

  @@index([tenantId])
}
```

### `TenantUsageMetric` — Atomic Phase 108 (Phase5-7_EbooklineliffV2.md:19135)

```prisma
// Source: Atomic Phase 108
model TenantUsageMetric {
  id               String        @id @default(uuid())
  tenantId         String
  tenant           TenantCompany @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  recordedDate     DateTime      @db.Date
  activeUsersCount Int          @default(0)
  storageBytesUsed BigInt       @default(0)
  apiCallsCount    Int          @default(0)
  liffSessionsCount Int         @default(0)

  @@unique([tenantId, recordedDate])
  @@index([tenantId])
}
```

### `TicketAttachment` — Atomic Phase 103 (Phase5-7_EbooklineliffV2.md:16494)

```prisma
// Source: Atomic Phase 103
model TicketAttachment {
  id         String        @id @default(uuid())
  messageId  String
  message    TicketMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  fileUrl    String
  fileType   String
  fileSize   Int
  createdAt  DateTime      @default(now())
}
```

### `TicketMessage` — Atomic Phase 103 (Phase5-7_EbooklineliffV2.md:16481)

```prisma
// Source: Atomic Phase 103
model TicketMessage {
  id            String            @id @default(uuid())
  ticketId      String
  ticket        SupportTicket     @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  senderType    SenderType
  senderId      String?
  messageText   String            @db.Text
  attachments   TicketAttachment[]
  createdAt     DateTime          @default(now())

  @@index([ticketId])
}
```

### `TrackingHistory` — Atomic Phase 077 (Phase5-7_EbooklineliffV2.md:3065)

```prisma
// Source: Atomic Phase 077
model TrackingHistory {
  id             String         @id @default(uuid())
  shipmentId     String
  shipment       Shipment       @relation(fields: [shipmentId], references: [id], onDelete: Cascade)
  statusCode     String
  statusText     String
  location       String?
  rawPayload     Json?
  eventTimestamp DateTime
  createdAt      DateTime       @default(now())

  @@index([shipmentId])
}
```

### `TranscodeJob` — Atomic Phase 102 (Phase5-7_EbooklineliffV2.md:16051)

```prisma
// Source: Atomic Phase 102
model TranscodeJob {
  id               String       @id @default(uuid())
  liveSessionId    String       @unique
  liveSession      LiveSession  @relation(fields: [liveSessionId], references: [id], onDelete: Cascade)
  progressPct      Float        @default(0.0)
  hlsManifestPath  String?
  durationSec      Int          @default(0)
  errorMessage     String?
  startedAt        DateTime?
  completedAt      DateTime?
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
}
```

### `User` — Atomic Phase 000, Atomic Phase 003, Atomic Phase 006, Atomic Phase 012, Atomic Phase 018, Atomic Phase 020, Atomic Phase 021, Atomic Phase 034, Atomic Phase 079, Atomic Phase 093, Atomic Phase 109, Atomic Phase 128 (Phase5-7_EbooklineliffV2.md:28996)

```prisma
// Source: Atomic Phase 000, Atomic Phase 003, Atomic Phase 006, Atomic Phase 012, Atomic Phase 018, Atomic Phase 020, Atomic Phase 021, Atomic Phase 034, Atomic Phase 079, Atomic Phase 093, Atomic Phase 109, Atomic Phase 128
model User {
  id                   String                 @id @default(uuid())
  lineUserId           String?                @unique
  email                String?                @unique
  phone                String?                @unique
  displayName          String
  avatarUrl            String?
  role                 UserRole               @default(MEMBER)
  walletBalance        Decimal                @default(0.00) @db.Decimal(12, 2)
  rewardPoints         Int                    @default(0)
  affiliateCode        String                 @unique @default(uuid())
  referredById         String?
  referredBy           User?                  @relation("AffiliateReferrals", fields: [referredById], references: [id])
  referrals            User[]                 @relation("AffiliateReferrals")
  entitlements         Entitlement[]
  orders               Order[]
  readingProgress      EbookReadingProgress[]
  learningProgress     CourseLearningProgress[]
  dailyCheckins        DailyCheckin[]
  affiliatePayouts     AffiliatePayout[]
  auditLogs            AuditLog[]
  createdAt            DateTime               @default(now())
  updatedAt            DateTime               @updatedAt

  @@index([lineUserId], map: "idx_user_line_user_id")
  @@index([email], map: "idx_user_email")
  @@index([referredById], map: "idx_user_referred_by_id")
  @@index([role, createdAt], map: "idx_user_role_created_at")
}
```

### `User360Metric` — Atomic Phase 110 (Phase5-7_EbooklineliffV2.md:20381)

```prisma
// Source: Atomic Phase 110
model User360Metric {
  id                   String   @id @default(uuid())
  userId               String   @unique
  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  lifetimeValue        Decimal  @default(0.00) @db.Decimal(12, 2)
  totalOrders          Int      @default(0)
  totalEbooksRead      Int      @default(0)
  totalCoursesEnrolled Int      @default(0)
  recencyScore         Int      @default(1)
  frequencyScore       Int      @default(1)
  monetaryScore        Int      @default(1)
  rfmSegment           String   @default("NEW_USER")
  riskLevel            RiskLevel @default(LOW)
  lastCalculatedAt     DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([userId])
  @@index([riskLevel])
  @@index([rfmSegment])
}
```

### `UserAdaptiveProfile` — Atomic Phase 093 (Phase5-7_EbooklineliffV2.md:11592)

```prisma
// Source: Atomic Phase 093
model UserAdaptiveProfile {
  id             String   @id @default(uuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  subjectContext String   // e.g., lessonId or courseId
  theta          Float    @default(0.0) // Estimated User Ability Parameter (\theta)
  standardError  Float    @default(1.0) // Measurement Error
  totalQuestions Int      @default(0)
  updatedAt      DateTime @updatedAt

  @@unique([userId, subjectContext])
}
```

### `UserAddress` — Atomic Phase 003 (Phase1-4_EbooklineliffV2.md:1753)

```prisma
// Source: Atomic Phase 003
model UserAddress {
  id           String   @id @default(uuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  recipient    String
  phoneNumber  String
  addressLine1 String
  addressLine2 String?
  subdistrict  String
  district     String
  province     String
  postalCode   String
  isDefault    Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([userId])
}
```

### `UserBadge` — Atomic Phase 083, Atomic Phase 096 (Phase5-7_EbooklineliffV2.md:12845)

```prisma
// Source: Atomic Phase 083, Atomic Phase 096
model UserBadge {
  id         String            @id @default(uuid())
  userId     String
  user       User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  badgeId    String
  badge      GamificationBadge @relation(fields: [badgeId], references: [id], onDelete: Cascade)
  unlockedAt DateTime          @default(now())

  @@unique([userId, badgeId])
}
```

### `UserConsentHistory` — Atomic Phase 129 (Phase5-7_EbooklineliffV2.md:29682)

```prisma
// Source: Atomic Phase 129
model UserConsentHistory {
  id             String         @id @default(uuid())
  userId         String
  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  purpose        ConsentPurpose
  isGranted      Boolean
  consentVersion String
  ipAddress      String
  userAgent      String
  createdAt      DateTime       @default(now())

  @@index([userId])
  @@index([purpose])
}
```

### `UserCouponClaim` — Atomic Phase 117 (Phase5-7_EbooklineliffV2.md:24254)

```prisma
// Source: Atomic Phase 117
model UserCouponClaim {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  couponId    String
  coupon      Coupon   @relation(fields: [couponId], references: [id], onDelete: Cascade)
  claimedAt   DateTime @default(now())
  isUsed      Boolean  @default(false)

  @@unique([userId, couponId])
  @@index([userId])
}
```

### `UserDevice` — Atomic Phase 119 (Phase5-7_EbooklineliffV2.md:25097)

```prisma
// Source: Atomic Phase 119
model UserDevice {
  id              String          @id @default(uuid())
  userId          String
  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  fingerprintHash String          // Unique SHA-256 Combined Fingerprint
  deviceName      String          // e.g., "iPhone 15 Pro (LINE LIFF)"
  deviceType      DeviceType
  isTrusted       Boolean         @default(true)
  lastIpAddress   String
  registeredAt    DateTime        @default(now())
  lastActiveAt    DateTime        @updatedAt
  activeSessions  ActiveSession[]

  @@unique([userId, fingerprintHash])
  @@index([userId])
  @@index([fingerprintHash])
}
```

### `UserDeviceMetric` — Atomic Phase 022 (Phase1-4_EbooklineliffV2.md:12970)

```prisma
// Source: Atomic Phase 022
model UserDeviceMetric {
  id               String          @id @default(uuid())
  userId           String?
  tenantId         String
  user             User?           @relation(fields: [userId], references: [id], onDelete: SetNull)
  environment      EnvironmentType
  viewportWidth    Int
  viewportHeight   Int
  safeAreaTop      Float
  safeAreaBottom   Float
  safeAreaLeft     Float
  safeAreaRight    Float
  devicePixelRatio Float
  userAgent        String          @db.Text
  createdAt        DateTime        @default(now())

  @@index([environment])
  @@index([tenantId])
  @@index([userId])
}
```

### `UserDeviceSession` — Atomic Phase 007, Atomic Phase 056, Atomic Phase 070 (Phase1-4_EbooklineliffV2.md:36079)

```prisma
// Source: Atomic Phase 007, Atomic Phase 056, Atomic Phase 070
model UserDeviceSession {
  id             String       @id @default(uuid())
  userId         String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  deviceType     DeviceType
  deviceIdHash   String
  sessionToken   String       @unique
  ipAddress      String
  userAgent      String
  isActive       Boolean      @default(true)
  lastHandshake  DateTime     @default(now())
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([userId, isActive])
  @@index([sessionToken])
}
```

### `UserInteractionLog` — Atomic Phase 104 (Phase5-7_EbooklineliffV2.md:16907)

```prisma
// Source: Atomic Phase 104
model UserInteractionLog {
  id                 String          @id @default(uuid())
  userId             String
  user               User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  productId          String
  product            Product         @relation(fields: [productId], references: [id], onDelete: Cascade)
  eventType          InteractionType
  dwellTimeSec       Int?            @default(0)
  progressPercentage Float?          @default(0.0)
  createdAt          DateTime        @default(now())

  @@index([userId, eventType])
  @@index([productId])
  @@index([createdAt])
}
```

### `UserLearningInsight` — Atomic Phase 092 (Phase5-7_EbooklineliffV2.md:11087)

```prisma
// Source: Atomic Phase 092
model UserLearningInsight {
  id                String   @id @default(uuid())
  userId            String   @unique
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  comprehensionRate Float    @default(0.0) // 0.0 - 100.0%
  weakTopicsJson    Json     // รายการหัวข้อที่ผู้เรียนยังไม่เข้าใจ
  strengthTopicsJson Json    // รายการหัวข้อที่เชี่ยวชาญ
  adaptedQuizLevel  String   @default("MEDIUM") // 'EASY' | 'MEDIUM' | 'HARD'
  updatedAt         DateTime @updatedAt
}
```

### `UserLiffSessionState` — Atomic Phase 031 (Phase1-4_EbooklineliffV2.md:17058)

```prisma
// Source: Atomic Phase 031
model UserLiffSessionState {
  id           String       @id @default(uuid())
  userId       String
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenantId     String       @default("default")
  viewportType String       // EBOOK_READER, VIDEO_PLAYER, CHECKOUT_FORM
  stateJson    Json         // Flexible serialized viewport payload
  lastActiveAt DateTime     @default(now()) @updatedAt

  @@unique([userId, tenantId, viewportType])
  @@index([userId, tenantId])
  @@index([lastActiveAt])
}
```

### `UserLocationCache` — Atomic Phase 032 (Phase1-4_EbooklineliffV2.md:17455)

```prisma
// Source: Atomic Phase 032
model UserLocationCache {
  id          String   @id @default(uuid())
  userId      String   @unique
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  latitude    Float
  longitude   Float
  subdistrict String
  district    String
  province    String
  postalCode  String
  updatedAt   DateTime @updatedAt

  @@index([userId])
}
```

### `UserLoginLog` — Atomic Phase 120 (Phase5-7_EbooklineliffV2.md:25539)

```prisma
// Source: Atomic Phase 120
model UserLoginLog {
  id                String        @id @default(uuid())
  userId            String
  user              User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  ipAddress         String
  country           String?
  countryCode       String?
  region            String?
  city              String?
  latitude          Float?
  longitude         Float?
  isp               String?
  userAgent         String
  deviceFingerprint String
  isVpnProxy        Boolean       @default(false)
  riskScore         Int           @default(0)
  riskLevel         RiskLevel     @default(LOW)
  anomalyType       IpAnomalyType @default(NORMAL)
  isMfaChallenged   Boolean       @default(false)
  isSessionBlocked  Boolean       @default(false)
  createdAt         DateTime      @default(now())

  @@index([userId])
  @@index([ipAddress])
  @@index([createdAt])
  @@index([userId, createdAt])
}
```

### `UserNavigationSession` — Atomic Phase 027 (Phase1-4_EbooklineliffV2.md:15289)

```prisma
// Source: Atomic Phase 027
model UserNavigationSession {
  id                 String   @id @default(uuid())
  userId             String   @unique
  user               User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenantId           String   @default("default")
  lastPathname       String
  stackDepth         Int      @default(1)
  isDirtyState       Boolean  @default(false)
  stateSnapshotJson  Json
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([userId])
  @@index([tenantId])
}
```

### `UserPII` — Atomic Phase 107 (Phase5-7_EbooklineliffV2.md:18556)

```prisma
// Source: Atomic Phase 107
model UserPII {
  id                  String   @id @default(uuid())
  userId              String   @unique
  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Encrypted PII Fields (AES-256-GCM Encrypted JSON)
  encryptedPhone      Json?    // EncryptedFieldSchema
  encryptedBankAccount Json?   // EncryptedFieldSchema
  encryptedIdCard     Json?    // EncryptedFieldSchema

  // Searchable Hashes (Blind Index for exact match queries without decryption)
  phoneHash           String?  @unique
  bankAccountHash     String?  @unique
  idCardHash          String?  @unique

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@index([phoneHash])
  @@index([idCardHash])
}
```

### `UserPreferenceProfile` — Atomic Phase 104 (Phase5-7_EbooklineliffV2.md:16884)

```prisma
// Source: Atomic Phase 104
model UserPreferenceProfile {
  id                  String   @id @default(uuid())
  userId              String   @unique
  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  preferredCategories Json     // Weight map e.g. {"business": 0.85, "ai": 0.95}
  priceSensitivity    Float    @default(0.5) // Range 0.0 - 1.0
  embedding           Unsupported("vector(768)")? // User Intent Vector Embedding
  updatedAt           DateTime @updatedAt

  @@index([userId])
}
```

### `UserReaderPreference` — Atomic Phase 041, Atomic Phase 059 (Phase1-4_EbooklineliffV2.md:30719)

```prisma
// Source: Atomic Phase 041, Atomic Phase 059
model UserReaderPreference {
  id                      String   @id @default(uuid())
  userId                  String   @unique
  user                    User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  invertTapZones          Boolean  @default(false)
  swipeSensitivity        Float    @default(1.0)
  enableKeyboardShortcuts Boolean  @default(true)
  hapticFeedbackEnabled   Boolean  @default(true)
  customKeybindingsJson   Json?    // บันทึก custom keymap เช่น { "NEXT": "Space", "PREV": "Backspace" }
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  @@index([userId])
}
```

### `UserReadingPreference` — Atomic Phase 066 (Phase1-4_EbooklineliffV2.md:34163)

```prisma
// Source: Atomic Phase 066
model UserReadingPreference {
  id                 String            @id @default(uuid())
  userId             String            @unique
  user               User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  themeMode          ThemeMode         @default(SYSTEM)
  fontSizePx         Int               @default(16)
  fontFamily         ReadingFontFamily @default(PROMPT)
  lineHeightRatio    Float             @default(1.5)
  brightnessLevel    Int               @default(100)
  autoSyncWithSystem Boolean           @default(true)
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  @@index([userId])
}
```

### `UserSecurityAuditLog` — Atomic Phase 110 (Phase5-7_EbooklineliffV2.md:20432)

```prisma
// Source: Atomic Phase 110
model UserSecurityAuditLog {
  id                String       @id @default(uuid())
  userId            String
  user              User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  activityType      ActivityType
  ipAddress         String
  userAgent         String
  deviceFingerprint String?
  lineSessionId     String?
  geoCountry        String?
  geoCity           String?
  riskLevel         RiskLevel    @default(LOW)
  metadata          Json?
  createdAt         DateTime     @default(now())

  @@index([userId, createdAt])
  @@index([activityType])
  @@index([ipAddress])
}
```

### `UserSecuritySetting` — Atomic Phase 120 (Phase5-7_EbooklineliffV2.md:25594)

```prisma
// Source: Atomic Phase 120
model UserSecuritySetting {
  id                    String   @id @default(uuid())
  userId                String   @unique
  user                  User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  enableGeoAlerts       Boolean  @default(true)
  enableLineFlexAlerts  Boolean  @default(true)
  strictImpossibleTravel Boolean  @default(true)
  updatedAt             DateTime @updatedAt
}
```

### `UserStreak` — Atomic Phase 083 (Phase5-7_EbooklineliffV2.md:6352)

```prisma
// Source: Atomic Phase 083
model UserStreak {
  id                String    @id @default(uuid())
  userId            String    @unique
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  currentStreak     Int       @default(0)
  longestStreak     Int       @default(0)
  lastCheckinDate   DateTime? @db.Date
  streakFreezeCount Int       @default(1)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([userId])
}
```

### `UserTaxProfile` — Atomic Phase 082 (Phase5-7_EbooklineliffV2.md:5930)

```prisma
// Source: Atomic Phase 082
model UserTaxProfile {
  id                    String       @id @default(uuid())
  userId                String       @unique
  user                  User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  payerType             TaxPayerType @default(INDIVIDUAL)
  taxId                 String       // เลขประจำตัวผู้เสียภาษี 13 หลัก หรือ เลขบัตรประชาชน
  fullNameOrCompanyName String
  branchCode            String       @default("00000") // 00000 = สำนักงานใหญ่
  address               String       @db.Text
  isTaxExempt           Boolean      @default(false)
  verifiedAt            DateTime?
  certificates          WithholdingTaxCertificate[]

  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt

  @@index([taxId])
}
```

### `UserTenantMapping` — Atomic Phase 071 (Phase5-7_EbooklineliffV2.md:184)

```prisma
// Source: Atomic Phase 071
model UserTenantMapping {
  id        String   @id @default(uuid())
  userId    String
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  role      UserRole @default(MEMBER)
  createdAt DateTime @default(now())

  @@unique([userId, tenantId])
  @@index([userId])
  @@index([tenantId])
}
```

### `UserTenantRole` — Atomic Phase 106 (Phase5-7_EbooklineliffV2.md:18111)

```prisma
// Source: Atomic Phase 106
model UserTenantRole {
  id         String       @id @default(uuid())
  userId     String
  tenantId   String
  roleId     String
  user       User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  role       SecurityRole @relation(fields: [roleId], references: [id], onDelete: Cascade)
  customMask Decimal?     @db.Decimal(39, 0) // Override mask for specific user
  createdAt  DateTime     @default(now())

  @@unique([userId, tenantId, roleId])
  @@index([userId, tenantId])
}
```

### `UserVideoWatchTelemetry` — Atomic Phase 110 (Phase5-7_EbooklineliffV2.md:20417)

```prisma
// Source: Atomic Phase 110
model UserVideoWatchTelemetry {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  courseId      String
  lessonId      String
  watchedSec    Int      @default(0)
  maxPositionSec Int     @default(0)
  isCompleted   Boolean  @default(false)
  lastWatchedAt DateTime @default(now())

  @@unique([userId, lessonId])
  @@index([userId, courseId])
}
```

### `VideoAsset` — Atomic Phase 043 (Phase1-4_EbooklineliffV2.md:22733)

```prisma
// Source: Atomic Phase 043
model VideoAsset {
  id              String           @id @default(uuid())
  lessonId        String           @unique
  originalFileName String
  fileSizeBytes   BigInt
  durationSec     Int              @default(0)
  status          VideoStatus      @default(PENDING_UPLOAD)
  rawStorageR2Key String
  hlsMasterR2Key  String?
  thumbnailR2Key  String?
  errorMessage    String?          @db.Text

  renditions      VideoRendition[]
  encryptionKeys  VideoKeyRotation[]

  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@index([status])
  @@index([lessonId])
}
```

### `VideoKeyRotation` — Atomic Phase 043 (Phase1-4_EbooklineliffV2.md:22768)

```prisma
// Source: Atomic Phase 043
model VideoKeyRotation {
  id             String      @id @default(uuid())
  videoId        String
  videoAsset     VideoAsset  @relation(fields: [videoId], references: [id], onDelete: Cascade)
  keySecretHex   String      // AES-128 Key Hex Encrypted
  keyIvHex       String      // Initialization Vector Hex
  createdAt      DateTime    @default(now())

  @@index([videoId])
}
```

### `VideoQualityVariant` — Atomic Phase 044 (Phase1-4_EbooklineliffV2.md:23192)

```prisma
// Source: Atomic Phase 044
model VideoQualityVariant {
  id                   String            @id @default(uuid())
  transcodeJobId       String
  transcodeJob         VideoTranscodeJob @relation(fields: [transcodeJobId], references: [id], onDelete: Cascade)
  quality              VideoQuality
  bandwidth            Int
  width                Int
  height               Int
  playlistPath         String
  totalChunks          Int               @default(0)
  avgChunkSizeBytes    Int               @default(0)
  createdAt            DateTime          @default(now())

  @@unique([transcodeJobId, quality])
}
```

### `VideoRendition` — Atomic Phase 043 (Phase1-4_EbooklineliffV2.md:22755)

```prisma
// Source: Atomic Phase 043
model VideoRendition {
  id             String          @id @default(uuid())
  videoId        String
  videoAsset     VideoAsset      @relation(fields: [videoId], references: [id], onDelete: Cascade)
  resolution     VideoResolution
  bitrateBps     Int
  playlistR2Key  String
  segmentPrefix  String
  createdAt      DateTime        @default(now())

  @@unique([videoId, resolution])
}
```

### `VideoSpriteSheet` — Atomic Phase 058 (Phase1-4_EbooklineliffV2.md:30249)

```prisma
// Source: Atomic Phase 058
model VideoSpriteSheet {
  id             String       @id @default(uuid())
  lessonId       String
  lesson         CourseLesson @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  sheetIndex     Int
  imageUrlR2     String
  startFrameSec  Int
  endFrameSec    Int
  createdAt      DateTime     @default(now())

  @@unique([lessonId, sheetIndex])
  @@index([lessonId])
}
```

### `VideoStreamSession` — Atomic Phase 050, Atomic Phase 053 (Phase1-4_EbooklineliffV2.md:26021)

```prisma
// Source: Atomic Phase 050, Atomic Phase 053
model VideoStreamSession {
  id                String   @id @default(uuid())
  userId            String
  lessonId          String
  sessionToken      String   @unique
  deviceFingerprint String
  ipAddress         String
  isActive          Boolean  @default(true)
  expiresAt         DateTime
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  user              User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  courseLesson      CourseLesson @relation(fields: [lessonId], references: [id], onDelete: Cascade)

  @@index([userId, lessonId])
  @@index([sessionToken])
}
```

### `VideoStreamTelemetry` — Atomic Phase 067 (Phase1-4_EbooklineliffV2.md:34636)

```prisma
// Source: Atomic Phase 067
model VideoStreamTelemetry {
  id               String       @id @default(uuid())
  userId           String
  lessonId         String
  user             User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  selectedQuality  VideoQuality @default(AUTO)
  activeQuality    VideoQuality
  measuredMbps     Decimal      @db.Decimal(8, 2)
  bufferStallCount Int          @default(0)
  ramUsageMb       Decimal      @db.Decimal(6, 2)
  createdAt        DateTime     @default(now())

  @@index([userId])
  @@index([lessonId])
  @@index([createdAt])
}
```

### `VideoSubtitle` — Atomic Phase 094 (Phase5-7_EbooklineliffV2.md:12010)

```prisma
// Source: Atomic Phase 094
model VideoSubtitle {
  id            String             @id @default(uuid())
  lessonId      String             @unique
  lesson        CourseLesson       @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  language      String             @default("TH")
  vttStorageR2  String
  srtStorageR2  String
  segments      SubtitleSegment[]
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt

  @@index([lessonId])
}
```

### `VideoTranscodeJob` — Atomic Phase 044 (Phase1-4_EbooklineliffV2.md:23172)

```prisma
// Source: Atomic Phase 044
model VideoTranscodeJob {
  id                 String               @id @default(uuid())
  lessonId           String               @unique
  originalFileName   String
  originalFileR2Path String
  fileSizeBytes      BigInt
  durationSeconds    Float                @default(0.0)
  status             TranscodeStatus      @default(QUEUED)
  progressPercentage Float                @default(0.0)
  masterPlaylistUrl  String?
  encryptionKeyPath  String?
  errorMessage       String?              @db.Text
  variants           VideoQualityVariant[]
  createdAt          DateTime             @default(now())
  updatedAt          DateTime             @updatedAt

  @@index([lessonId])
  @@index([status])
}
```

### `VideoWatchAnalytics` — Atomic Phase 052 (Phase1-4_EbooklineliffV2.md:27206)

```prisma
// Source: Atomic Phase 052
model VideoWatchAnalytics {
  id                   String   @id @default(uuid())
  userId               String
  lessonId             String
  watchedSec           Int      @default(0)
  maxWatchedSec        Int      @default(0)
  lastPositionSec      Int      @default(0)
  completionRate       Float    @default(0.0) // 0.0 - 100.0%
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, lessonId])
  @@index([lessonId])
  @@index([userId])
}
```

### `ViralAttribution` — Atomic Phase 026 (Phase1-4_EbooklineliffV2.md:14823)

```prisma
// Source: Atomic Phase 026
model ViralAttribution {
  id             String    @id @default(uuid())
  shareLogId     String
  shareLog       ShareLog  @relation(fields: [shareLogId], references: [id], onDelete: Cascade)
  referredUserId String
  referredUser   User      @relation(fields: [referredUserId], references: [id], onDelete: Cascade)
  orderId        String?   @unique
  commissionAmt  Decimal   @default(0.00) @db.Decimal(10, 2)
  createdAt      DateTime  @default(now())

  @@index([shareLogId])
  @@index([referredUserId])
}
```

### `Wallet` — Atomic Phase 017 (Phase1-4_EbooklineliffV2.md:10301)

```prisma
// Source: Atomic Phase 017
model Wallet {
  id            String         @id @default(uuid())
  userId        String         @unique
  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  mainBalance   Decimal        @default(0.00) @db.Decimal(12, 2)
  bonusBalance  Decimal        @default(0.00) @db.Decimal(12, 2)
  pinHash       String?
  isLocked      Boolean        @default(false)
  ledgers       WalletLedger[]
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  @@index([userId])
}
```

### `WalletAuditLedger` — Atomic Phase 109 (Phase5-7_EbooklineliffV2.md:19599)

```prisma
// Source: Atomic Phase 109
model WalletAuditLedger {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  adminId       String?
  amountDelta   Decimal  @db.Decimal(12, 2)
  balanceBefore Decimal  @db.Decimal(12, 2)
  balanceAfter  Decimal  @db.Decimal(12, 2)
  reason        String
  referenceId   String?
  createdAt     DateTime @default(now())

  @@index([userId])
  @@index([createdAt])
}
```

### `WalletLedger` — Atomic Phase 017, Atomic Phase 086 (Phase5-7_EbooklineliffV2.md:7922)

```prisma
// Source: Atomic Phase 017, Atomic Phase 086
model WalletLedger {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  amount        Decimal  @db.Decimal(12, 2)
  balanceBefore Decimal  @db.Decimal(12, 2)
  balanceAfter  Decimal  @db.Decimal(12, 2)
  transactionType String // "SALE_REVENUE", "AFFILIATE_COMMISSION", "PAYOUT_LOCK", "PAYOUT_DEDUCT", "REFUND_RELEASE"
  referenceId   String?  // OrderId or PayoutId
  createdAt     DateTime @default(now())

  @@index([userId])
  @@index([referenceId])
}
```

### `Warehouse` — Atomic Phase 073, Atomic Phase 075, Atomic Phase 076 (Phase5-7_EbooklineliffV2.md:2015)

```prisma
// Source: Atomic Phase 073, Atomic Phase 075, Atomic Phase 076
model Warehouse {
  id              String           @id @default(uuid())
  tenantId        String
  code            String           @unique
  name            String
  address         String?          @db.Text
  isMainWarehouse Boolean          @default(false)
  isActive        Boolean          @default(true)
  warehouseStocks WarehouseStock[]
  stockLogs       StockMovementLog[]
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@index([tenantId])
  @@index([code])
}
```

### `WarehouseStock` — Atomic Phase 075 (Phase5-7_EbooklineliffV2.md:2032)

```prisma
// Source: Atomic Phase 075
model WarehouseStock {
  id           String         @id @default(uuid())
  warehouseId  String
  warehouse    Warehouse      @relation(fields: [warehouseId], references: [id], onDelete: Cascade)
  physicalDetailId String
  physicalDetail PhysicalDetail @relation(fields: [physicalDetailId], references: [id], onDelete: Cascade)
  stockQty     Int            @default(0)
  reservedQty  Int            @default(0) // สำหรับออร์เดอร์ที่อยู่ระหว่างจัดส่ง/ชำระเงิน
  safetyStock  Int            @default(10)
  rackLocation String?        // ตำแหน่งจัดเก็บ เช่น A-01-02
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt

  @@unique([warehouseId, physicalDetailId])
  @@index([warehouseId])
  @@index([physicalDetailId])
}
```

### `WatermarkSeedLog` — Atomic Phase 042 (Phase1-4_EbooklineliffV2.md:22317)

```prisma
// Source: Atomic Phase 042
model WatermarkSeedLog {
  id            String   @id @default(uuid())
  seedId        String   @unique
  userId        String
  lineUserId    String?
  productId     String
  clientIp      String
  userAgent     String
  hmacSignature String
  createdAt     DateTime @default(now())
  expiresAt     DateTime

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([userId, productId])
  @@index([seedId])
}
```

### `WithholdingTaxCertificate` — Atomic Phase 082 (Phase5-7_EbooklineliffV2.md:5949)

```prisma
// Source: Atomic Phase 082
model WithholdingTaxCertificate {
  id               String         @id @default(uuid())
  certificateNo   String         @unique // เลขที่เอกสาร เช่น 50TW-202610-0001
  tenantId         String?        // รองรับ Multi-Tenant
  userId           String
  user             User           @relation(fields: [userId], references: [id])
  taxProfileId     String
  taxProfile       UserTaxProfile @relation(fields: [taxProfileId], references: [id])

  formType         TaxFormType    @default(PND_3)
  incomeType       IncomeType     @default(CREATOR_SHARE_40_8)

  grossAmount      Decimal        @db.Decimal(12, 2)
  taxRate          Decimal        @default(3.00) @db.Decimal(5, 2) // 3.00%
  taxWithheld      Decimal        @db.Decimal(12, 2)
  netAmount        Decimal        @db.Decimal(12, 2)

  paymentDate      DateTime       @default(now())
  pdfStoragePathR2 String         @db.Text
  pdfFileHash      String         // SHA-256 ป้องกันการแก้ไข

  isSubmittedETax  Boolean        @default(false)
  eTaxBatchRef     String?

  createdAt        DateTime       @default(now())

  @@index([userId])
  @@index([certificateNo])
  @@index([paymentDate])
}
```

### `WithholdingTaxRecord` — Atomic Phase 081 (Phase5-7_EbooklineliffV2.md:5424)

```prisma
// Source: Atomic Phase 081
model WithholdingTaxRecord {
  id                  String            @id @default(uuid())
  payoutTransactionId String            @unique
  payoutTransaction   PayoutTransaction @relation(fields: [payoutTransactionId], references: [id], onDelete: Cascade)
  taxCertificateNo    String            @unique
  taxId               String
  payeeName           String
  payeeAddress        String
  incomeType          String            @default("COMMISSION_AND_PROFESSIONAL_FEE")
  grossAmount         Decimal           @db.Decimal(12, 2)
  taxAmount           Decimal           @db.Decimal(12, 2)
  issuedAt            DateTime          @default(now())
  pdfStoragePathR2    String
}
```

---

## Appendix: Table → Phase index

| Table / Enum | Kind | Phases | First seen |
|---|---|---|---|
| `AIBotConversationHistory` | model | Atomic Phase 103 | Phase5-7_EbooklineliffV2.md:16518 |
| `AbandonedCartLog` | model | Atomic Phase 084 | Phase5-7_EbooklineliffV2.md:7080 |
| `Account` | model | Atomic Phase 005 | Phase1-4_EbooklineliffV2.md:2778 |
| `ActiveDeviceSession` | model | Atomic Phase 057 | Phase1-4_EbooklineliffV2.md:29783 |
| `ActiveSession` | model | Atomic Phase 119 | Phase5-7_EbooklineliffV2.md:25115 |
| `AdaptiveQuestionItem` | model | Atomic Phase 093 | Phase5-7_EbooklineliffV2.md:11574 |
| `AdaptiveQuizResponse` | model | Atomic Phase 093 | Phase5-7_EbooklineliffV2.md:11605 |
| `AffiliateAttribution` | model | Atomic Phase 025 | Phase1-4_EbooklineliffV2.md:14344 |
| `AffiliateClick` | model | Atomic Phase 080 | Phase5-7_EbooklineliffV2.md:4864 |
| `AffiliatePayout` | model | Atomic Phase 079, Atomic Phase 128 | Phase5-7_EbooklineliffV2.md:4359 |
| `AffiliateTierConfig` | model | Atomic Phase 079 | Phase5-7_EbooklineliffV2.md:4327 |
| `AiChatMessage` | model | Atomic Phase 092 | Phase5-7_EbooklineliffV2.md:11073 |
| `AiChatSession` | model | Atomic Phase 092 | Phase5-7_EbooklineliffV2.md:11060 |
| `AiCoPilotJob` | model | Atomic Phase 094 | Phase5-7_EbooklineliffV2.md:11993 |
| `AiGeneratedQuiz` | model | Atomic Phase 094 | Phase5-7_EbooklineliffV2.md:12038 |
| `AppVersion` | model | Atomic Phase 033 | Phase1-4_EbooklineliffV2.md:17894 |
| `AuditLog` | model | Atomic Phase 003, Atomic Phase 109, Atomic Phase 118, Atomic Phase 128 | Phase5-7_EbooklineliffV2.md:24725 |
| `AuditVaultSyncState` | model | Atomic Phase 118 | Phase5-7_EbooklineliffV2.md:24754 |
| `AuthAuditLog` | model | Atomic Phase 005, Atomic Phase 006 | Phase1-4_EbooklineliffV2.md:3425 |
| `AuthSession` | model | Atomic Phase 006 | Phase1-4_EbooklineliffV2.md:3410 |
| `B2BCorporateSeat` | model | Atomic Phase 098 | Phase5-7_EbooklineliffV2.md:13814 |
| `B2BDepartment` | model | Atomic Phase 098 | Phase5-7_EbooklineliffV2.md:13805 |
| `B2BOrganization` | model | Atomic Phase 098 | Phase5-7_EbooklineliffV2.md:13792 |
| `B2BQuizAttempt` | model | Atomic Phase 098 | Phase5-7_EbooklineliffV2.md:13834 |
| `Badge` | model | Atomic Phase 083 | Phase5-7_EbooklineliffV2.md:6382 |
| `BankAccountConfig` | model | Atomic Phase 115 | Phase5-7_EbooklineliffV2.md:23188 |
| `BankStatement` | model | Atomic Phase 115 | Phase5-7_EbooklineliffV2.md:23204 |
| `BehavioralCampaign` | model | Atomic Phase 084 | Phase5-7_EbooklineliffV2.md:7097 |
| `BookProcessingJob` | model | Atomic Phase 038 | Phase1-4_EbooklineliffV2.md:20241 |
| `BundleItem` | model | Atomic Phase 008, Atomic Phase 074 | Phase1-4_EbooklineliffV2.md:4711 |
| `BundleManifest` | model | Atomic Phase 029 | Phase1-4_EbooklineliffV2.md:16140 |
| `Campaign` | model | Atomic Phase 117 | Phase5-7_EbooklineliffV2.md:24200 |
| `CampaignAnalyticsLog` | model | Atomic Phase 116 | Phase5-7_EbooklineliffV2.md:23840 |
| `CarrierApiConfig` | model | Atomic Phase 077 | Phase5-7_EbooklineliffV2.md:3079 |
| `Cart` | model | Atomic Phase 011, Atomic Phase 084 | Phase5-7_EbooklineliffV2.md:7047 |
| `CartItem` | model | Atomic Phase 011, Atomic Phase 084 | Phase1-4_EbooklineliffV2.md:6220 |
| `Category` | model | Atomic Phase 008, Atomic Phase 009 | Phase1-4_EbooklineliffV2.md:5138 |
| `CertificateVerificationLog` | model | Atomic Phase 105 | Phase5-7_EbooklineliffV2.md:17443 |
| `ChaosTestRun` | model | Atomic Phase 124 | Phase5-7_EbooklineliffV2.md:27372 |
| `CircuitBreakerMetric` | model | Atomic Phase 124 | Phase5-7_EbooklineliffV2.md:27386 |
| `ClientDeviceLog` | model | Atomic Phase 033 | Phase1-4_EbooklineliffV2.md:17914 |
| `CommissionLog` | model | Atomic Phase 079 | Phase5-7_EbooklineliffV2.md:4338 |
| `CommissionRule` | model | Atomic Phase 081 | Phase5-7_EbooklineliffV2.md:5395 |
| `CompanyTheme` | model | Atomic Phase 072 | Phase5-7_EbooklineliffV2.md:573 |
| `ContentFlagReport` | model | Atomic Phase 112 | Phase5-7_EbooklineliffV2.md:21532 |
| `ContentHeatmapAggregate` | model | Atomic Phase 052 | Phase1-4_EbooklineliffV2.md:27224 |
| `ContentModerationLog` | model | Atomic Phase 112 | Phase5-7_EbooklineliffV2.md:21503 |
| `ContentVectorChunk` | model | Atomic Phase 092 | Phase5-7_EbooklineliffV2.md:11042 |
| `ContentVectorEmbedding` | model | Atomic Phase 091 | Phase5-7_EbooklineliffV2.md:10550 |
| `CopyrightFingerprint` | model | Atomic Phase 112 | Phase5-7_EbooklineliffV2.md:21520 |
| `CorporateAccount` | model | Atomic Phase 097 | Phase5-7_EbooklineliffV2.md:13305 |
| `CorporateDepartment` | model | Atomic Phase 097 | Phase5-7_EbooklineliffV2.md:13320 |
| `CorporateLicense` | model | Atomic Phase 097 | Phase5-7_EbooklineliffV2.md:13329 |
| `CorporateSeat` | model | Atomic Phase 097 | Phase5-7_EbooklineliffV2.md:13348 |
| `Coupon` | model | Atomic Phase 088, Atomic Phase 117 | Phase5-7_EbooklineliffV2.md:24218 |
| `CouponRedemption` | model | Atomic Phase 088, Atomic Phase 117 | Phase5-7_EbooklineliffV2.md:24267 |
| `CouponTargetProduct` | model | Atomic Phase 088 | Phase5-7_EbooklineliffV2.md:8977 |
| `CourseCertificate` | model | Atomic Phase 048, Atomic Phase 105 | Phase5-7_EbooklineliffV2.md:17414 |
| `CourseDetail` | model | Atomic Phase 000, Atomic Phase 008, Atomic Phase 037, Atomic Phase 045, Atomic Phase 051, Atomic Phase 078, Atomic Phase 093, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:4668 |
| `CourseLearningProgress` | model | Atomic Phase 000, Atomic Phase 018, Atomic Phase 045, Atomic Phase 046, Atomic Phase 054, Atomic Phase 057, Atomic Phase 064, Atomic Phase 093, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:23611 |
| `CourseLesson` | model | Atomic Phase 008, Atomic Phase 036, Atomic Phase 037, Atomic Phase 045, Atomic Phase 051, Atomic Phase 058, Atomic Phase 078, Atomic Phase 093, Atomic Phase 102, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:30222 |
| `CourseSection` | model | Atomic Phase 008, Atomic Phase 037, Atomic Phase 045, Atomic Phase 051, Atomic Phase 078, Atomic Phase 128 | Phase5-7_EbooklineliffV2.md:3711 |
| `CreatorAppeal` | model | Atomic Phase 112 | Phase5-7_EbooklineliffV2.md:21548 |
| `CreatorKYC` | model | Atomic Phase 003, Atomic Phase 085, Atomic Phase 109, Atomic Phase 111 | Phase5-7_EbooklineliffV2.md:21009 |
| `CreatorPayoutAccount` | model | Atomic Phase 085 | Phase5-7_EbooklineliffV2.md:7516 |
| `CrossDeviceSyncState` | model | Atomic Phase 070 | Phase1-4_EbooklineliffV2.md:36097 |
| `DailyAnalyticsSnapshot` | model | Atomic Phase 116 | Phase5-7_EbooklineliffV2.md:23853 |
| `DailyCheckin` | model | Atomic Phase 083, Atomic Phase 128 | Phase5-7_EbooklineliffV2.md:6366 |
| `DataScopePolicy` | model | Atomic Phase 107 | Phase5-7_EbooklineliffV2.md:18594 |
| `DataSubjectRequest` | model | Atomic Phase 129 | Phase5-7_EbooklineliffV2.md:29697 |
| `DatabaseReplicaNode` | model | Atomic Phase 125 | Phase5-7_EbooklineliffV2.md:27872 |
| `DeepLinkLog` | model | Atomic Phase 025 | Phase1-4_EbooklineliffV2.md:14329 |
| `DeviceStorageProfile` | model | Atomic Phase 068 | Phase1-4_EbooklineliffV2.md:35121 |
| `DisasterRecoverySnapshot` | model | Atomic Phase 127 | Phase5-7_EbooklineliffV2.md:28562 |
| `DisputeClaim` | model | Atomic Phase 113 | Phase5-7_EbooklineliffV2.md:22116 |
| `DisputeEvidence` | model | Atomic Phase 113 | Phase5-7_EbooklineliffV2.md:22141 |
| `DisputeTimeline` | model | Atomic Phase 113 | Phase5-7_EbooklineliffV2.md:22150 |
| `DomainWhitelistRegistry` | model | Atomic Phase 028 | Phase1-4_EbooklineliffV2.md:15656 |
| `DrmOfflineLease` | model | Atomic Phase 063 | Phase1-4_EbooklineliffV2.md:32533 |
| `DrmSecurityKey` | model | Atomic Phase 061 | Phase1-4_EbooklineliffV2.md:31653 |
| `DrmSession` | model | Atomic Phase 049 | Phase1-4_EbooklineliffV2.md:25622 |
| `DrmViolationLog` | model | Atomic Phase 049, Atomic Phase 061 | Phase1-4_EbooklineliffV2.md:31669 |
| `EbookBookmark` | model | Atomic Phase 041 | Phase1-4_EbooklineliffV2.md:21590 |
| `EbookChapter` | model | Atomic Phase 008, Atomic Phase 037, Atomic Phase 060, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:19842 |
| `EbookChunk` | model | Atomic Phase 038 | Phase1-4_EbooklineliffV2.md:20258 |
| `EbookChunkMeta` | model | Atomic Phase 036 | Phase1-4_EbooklineliffV2.md:19118 |
| `EbookDetail` | model | Atomic Phase 000, Atomic Phase 008, Atomic Phase 036, Atomic Phase 037, Atomic Phase 039, Atomic Phase 051, Atomic Phase 060, Atomic Phase 093, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:19104 |
| `EbookHighlight` | model | Atomic Phase 041 | Phase1-4_EbooklineliffV2.md:21604 |
| `EbookPageAnalytics` | model | Atomic Phase 052 | Phase1-4_EbooklineliffV2.md:27188 |
| `EbookPageReadLog` | model | Atomic Phase 110 | Phase5-7_EbooklineliffV2.md:20402 |
| `EbookPageText` | model | Atomic Phase 038 | Phase1-4_EbooklineliffV2.md:20272 |
| `EbookReadingProgress` | model | Atomic Phase 000, Atomic Phase 018, Atomic Phase 057, Atomic Phase 060, Atomic Phase 064, Atomic Phase 093, Atomic Phase 128 | Phase5-7_EbooklineliffV2.md:29180 |
| `EncryptedUserPII` | model | Atomic Phase 129 | Phase5-7_EbooklineliffV2.md:29731 |
| `Entitlement` | model | Atomic Phase 000, Atomic Phase 008, Atomic Phase 012, Atomic Phase 014, Atomic Phase 015, Atomic Phase 016, Atomic Phase 018, Atomic Phase 020, Atomic Phase 051, Atomic Phase 093, Atomic Phase 128 | Phase5-7_EbooklineliffV2.md:29117 |
| `EscrowAccount` | model | Atomic Phase 113 | Phase5-7_EbooklineliffV2.md:22096 |
| `ExternalApiAuditLog` | model | Atomic Phase 122 | Phase5-7_EbooklineliffV2.md:26326 |
| `FinancialAccount` | model | Atomic Phase 081 | Phase5-7_EbooklineliffV2.md:5348 |
| `FinancialClearinghouseLedger` | model | Atomic Phase 114 | Phase5-7_EbooklineliffV2.md:22661 |
| `FinancialManualOverride` | model | Atomic Phase 115 | Phase5-7_EbooklineliffV2.md:23247 |
| `FlashSaleCampaign` | model | Atomic Phase 087 | Phase5-7_EbooklineliffV2.md:8434 |
| `FlashSaleItem` | model | Atomic Phase 087 | Phase5-7_EbooklineliffV2.md:8453 |
| `FulfillmentBatch` | model | Atomic Phase 076 | Phase5-7_EbooklineliffV2.md:2556 |
| `FulfillmentItem` | model | Atomic Phase 076 | Phase5-7_EbooklineliffV2.md:2572 |
| `GamificationBadge` | model | Atomic Phase 096 | Phase5-7_EbooklineliffV2.md:12836 |
| `GiftOrder` | model | Atomic Phase 089 | Phase5-7_EbooklineliffV2.md:9484 |
| `GroupBuyingConfig` | model | Atomic Phase 090 | Phase5-7_EbooklineliffV2.md:9976 |
| `GroupBuyingMember` | model | Atomic Phase 090 | Phase5-7_EbooklineliffV2.md:10014 |
| `GroupBuyingRoom` | model | Atomic Phase 090 | Phase5-7_EbooklineliffV2.md:9989 |
| `HandshakeToken` | model | Atomic Phase 070 | Phase1-4_EbooklineliffV2.md:36115 |
| `HeaderConfig` | model | Atomic Phase 023 | Phase1-4_EbooklineliffV2.md:13429 |
| `HlsSegmentMeta` | model | Atomic Phase 036 | Phase1-4_EbooklineliffV2.md:19146 |
| `IdempotencyLog` | model | Atomic Phase 122 | Phase5-7_EbooklineliffV2.md:26312 |
| `ImmutableAuditLog` | model | Atomic Phase 129 | Phase5-7_EbooklineliffV2.md:29714 |
| `KYCAuditLog` | model | Atomic Phase 085, Atomic Phase 111 | Phase5-7_EbooklineliffV2.md:21052 |
| `KnowledgeBaseVector` | model | Atomic Phase 103 | Phase5-7_EbooklineliffV2.md:16504 |
| `KnownUserDevice` | model | Atomic Phase 120 | Phase5-7_EbooklineliffV2.md:25567 |
| `LedgerEntry` | model | Atomic Phase 081 | Phase5-7_EbooklineliffV2.md:5377 |
| `LedgerJournal` | model | Atomic Phase 081 | Phase5-7_EbooklineliffV2.md:5365 |
| `LessonNote` | model | Atomic Phase 065 | Phase1-4_EbooklineliffV2.md:33675 |
| `LessonQuiz` | model | Atomic Phase 037, Atomic Phase 047, Atomic Phase 078 | Phase1-4_EbooklineliffV2.md:24666 |
| `LineAuthProfile` | model | Atomic Phase 006 | Phase1-4_EbooklineliffV2.md:3395 |
| `LineMiniAppSandboxAudit` | model | Atomic Phase 035 | Phase1-4_EbooklineliffV2.md:18729 |
| `LineOAFriendshipLog` | model | Atomic Phase 034 | Phase1-4_EbooklineliffV2.md:18348 |
| `LineSandboxResultItem` | model | Atomic Phase 035 | Phase1-4_EbooklineliffV2.md:18741 |
| `LiveActiveSession` | model | Atomic Phase 100 | Phase5-7_EbooklineliffV2.md:14733 |
| `LiveAnalytics` | model | Atomic Phase 101 | Phase5-7_EbooklineliffV2.md:15521 |
| `LiveChatMessage` | model | Atomic Phase 099, Atomic Phase 101 | Phase5-7_EbooklineliffV2.md:15452 |
| `LiveEntitlement` | model | Atomic Phase 100 | Phase5-7_EbooklineliffV2.md:14714 |
| `LiveHandRaise` | model | Atomic Phase 101 | Phase5-7_EbooklineliffV2.md:15468 |
| `LiveHeartbeatLog` | model | Atomic Phase 100 | Phase5-7_EbooklineliffV2.md:14751 |
| `LivePoll` | model | Atomic Phase 099, Atomic Phase 101 | Phase5-7_EbooklineliffV2.md:15483 |
| `LivePollOption` | model | Atomic Phase 099, Atomic Phase 101 | Phase5-7_EbooklineliffV2.md:15497 |
| `LivePollVote` | model | Atomic Phase 099, Atomic Phase 101 | Phase5-7_EbooklineliffV2.md:15507 |
| `LiveRoom` | model | Atomic Phase 100 | Phase5-7_EbooklineliffV2.md:14687 |
| `LiveSession` | model | Atomic Phase 099, Atomic Phase 101, Atomic Phase 102 | Phase5-7_EbooklineliffV2.md:14175 |
| `LiveToVodRecord` | model | Atomic Phase 099 | Phase5-7_EbooklineliffV2.md:14250 |
| `LogisticsCarrierConfig` | model | Atomic Phase 076 | Phase5-7_EbooklineliffV2.md:2540 |
| `LogisticsWebhookLog` | model | Atomic Phase 077 | Phase5-7_EbooklineliffV2.md:3090 |
| `LowBandwidthAssetCache` | model | Atomic Phase 055 | Phase1-4_EbooklineliffV2.md:28773 |
| `MarketingCampaign` | model | Atomic Phase 116 | Phase5-7_EbooklineliffV2.md:23823 |
| `MerchantAnalyticsDaily` | model | Atomic Phase 073 | Phase5-7_EbooklineliffV2.md:1058 |
| `MerchantProfile` | model | Atomic Phase 073 | Phase5-7_EbooklineliffV2.md:987 |
| `NetworkPerformanceLog` | model | Atomic Phase 055 | Phase1-4_EbooklineliffV2.md:28754 |
| `NetworkTelemetryLog` | model | Atomic Phase 069 | Phase1-4_EbooklineliffV2.md:35490 |
| `NotificationLog` | model | Atomic Phase 024 | Phase1-4_EbooklineliffV2.md:13932 |
| `OfflineDeviceSession` | model | Atomic Phase 062 | Phase1-4_EbooklineliffV2.md:32114 |
| `OfflineLicense` | model | Atomic Phase 068 | Phase1-4_EbooklineliffV2.md:35101 |
| `OfflineSyncLog` | model | Atomic Phase 062, Atomic Phase 063 | Phase1-4_EbooklineliffV2.md:32126 |
| `Order` | model | Atomic Phase 000, Atomic Phase 012, Atomic Phase 014, Atomic Phase 015, Atomic Phase 016, Atomic Phase 020, Atomic Phase 093, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:8588 |
| `OrderFulfillment` | model | Atomic Phase 073 | Phase5-7_EbooklineliffV2.md:1022 |
| `OrderItem` | model | Atomic Phase 000, Atomic Phase 008, Atomic Phase 012, Atomic Phase 014, Atomic Phase 020, Atomic Phase 093, Atomic Phase 128 | Phase5-7_EbooklineliffV2.md:29152 |
| `OrderTransactionIndex` | model | Atomic Phase 126 | Phase5-7_EbooklineliffV2.md:28258 |
| `OutboxEvent` | model | Atomic Phase 015 | Phase1-4_EbooklineliffV2.md:8644 |
| `PIIAccessAuditLog` | model | Atomic Phase 107 | Phase5-7_EbooklineliffV2.md:18578 |
| `PaymentOutboxQueue` | model | Atomic Phase 124 | Phase5-7_EbooklineliffV2.md:27396 |
| `PaymentSlip` | model | Atomic Phase 000, Atomic Phase 012, Atomic Phase 014, Atomic Phase 015, Atomic Phase 016, Atomic Phase 020, Atomic Phase 093, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:8610 |
| `PayoutRequest` | model | Atomic Phase 086 | Phase5-7_EbooklineliffV2.md:7937 |
| `PayoutTransaction` | model | Atomic Phase 073, Atomic Phase 081 | Phase5-7_EbooklineliffV2.md:5405 |
| `PerformanceMetric` | model | Atomic Phase 029 | Phase1-4_EbooklineliffV2.md:16125 |
| `PermissionAuditLog` | model | Atomic Phase 032 | Phase1-4_EbooklineliffV2.md:17439 |
| `PhysicalDetail` | model | Atomic Phase 000, Atomic Phase 008, Atomic Phase 093, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:4622 |
| `PointRedemptionRule` | model | Atomic Phase 088 | Phase5-7_EbooklineliffV2.md:9002 |
| `PointTransaction` | model | Atomic Phase 096 | Phase5-7_EbooklineliffV2.md:12805 |
| `PrefetchAnalytics` | model | Atomic Phase 029 | Phase1-4_EbooklineliffV2.md:16152 |
| `PreviewUsageLog` | model | Atomic Phase 051 | Phase1-4_EbooklineliffV2.md:26578 |
| `Product` | model | Atomic Phase 000, Atomic Phase 008, Atomic Phase 009, Atomic Phase 010, Atomic Phase 012, Atomic Phase 020, Atomic Phase 037, Atomic Phase 051, Atomic Phase 074, Atomic Phase 093, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:4581 |
| `ProductCategory` | model | Atomic Phase 009 | Phase1-4_EbooklineliffV2.md:5151 |
| `ProductCategoryMap` | model | Atomic Phase 008 | Phase1-4_EbooklineliffV2.md:4731 |
| `ProductDraft` | model | Atomic Phase 074 | Phase5-7_EbooklineliffV2.md:1431 |
| `ProductEmbedding` | model | Atomic Phase 104 | Phase5-7_EbooklineliffV2.md:16896 |
| `ProductTagMap` | model | Atomic Phase 008 | Phase1-4_EbooklineliffV2.md:4746 |
| `ProgressSyncAuditLog` | model | Atomic Phase 064 | Phase1-4_EbooklineliffV2.md:33177 |
| `PromptPayTransaction` | model | Atomic Phase 013 | Phase1-4_EbooklineliffV2.md:7398 |
| `QrSessionNonce` | model | Atomic Phase 007 | Phase1-4_EbooklineliffV2.md:4062 |
| `QuizAttempt` | model | Atomic Phase 047, Atomic Phase 078 | Phase1-4_EbooklineliffV2.md:24697 |
| `QuizOption` | model | Atomic Phase 047, Atomic Phase 078 | Phase1-4_EbooklineliffV2.md:24686 |
| `ReceiptNotificationLog` | model | Atomic Phase 019 | Phase1-4_EbooklineliffV2.md:11279 |
| `RecommendationSlateLog` | model | Atomic Phase 104 | Phase5-7_EbooklineliffV2.md:16923 |
| `ReconciliationLog` | model | Atomic Phase 115 | Phase5-7_EbooklineliffV2.md:23234 |
| `RevenueShareRule` | model | Atomic Phase 114 | Phase5-7_EbooklineliffV2.md:22707 |
| `RevocationBlacklist` | model | Atomic Phase 106 | Phase5-7_EbooklineliffV2.md:18125 |
| `RewardItem` | model | Atomic Phase 083 | Phase5-7_EbooklineliffV2.md:6408 |
| `RewardRedemption` | model | Atomic Phase 083 | Phase5-7_EbooklineliffV2.md:6426 |
| `RoleScopeRegistry` | model | Atomic Phase 106 | Phase5-7_EbooklineliffV2.md:18100 |
| `ScraperBlacklist` | model | Atomic Phase 050 | Phase1-4_EbooklineliffV2.md:26040 |
| `SecurityAuditLog` | model | Atomic Phase 106, Atomic Phase 119, Atomic Phase 127 | Phase5-7_EbooklineliffV2.md:28544 |
| `SecurityCspLog` | model | Atomic Phase 028 | Phase1-4_EbooklineliffV2.md:15638 |
| `SecurityIpBlacklist` | model | Atomic Phase 120 | Phase5-7_EbooklineliffV2.md:25583 |
| `SecurityRole` | model | Atomic Phase 106 | Phase5-7_EbooklineliffV2.md:18085 |
| `SecurityViolationLog` | model | Atomic Phase 042 | Phase1-4_EbooklineliffV2.md:22336 |
| `SellerPayout` | model | Atomic Phase 114 | Phase5-7_EbooklineliffV2.md:22682 |
| `SentryErrorIncident` | model | Atomic Phase 121 | Phase5-7_EbooklineliffV2.md:26023 |
| `ServiceMessageTemplate` | model | Atomic Phase 024 | Phase1-4_EbooklineliffV2.md:13918 |
| `Session` | model | Atomic Phase 005 | Phase1-4_EbooklineliffV2.md:2794 |
| `ShareEvent` | model | Atomic Phase 079, Atomic Phase 080 | Phase5-7_EbooklineliffV2.md:4846 |
| `ShareLog` | model | Atomic Phase 026 | Phase1-4_EbooklineliffV2.md:14803 |
| `Shipment` | model | Atomic Phase 077 | Phase5-7_EbooklineliffV2.md:3040 |
| `ShippingRateTable` | model | Atomic Phase 011 | Phase1-4_EbooklineliffV2.md:6236 |
| `ShortLink` | model | Atomic Phase 025 | Phase1-4_EbooklineliffV2.md:14306 |
| `SocialNote` | model | Atomic Phase 095 | Phase5-7_EbooklineliffV2.md:12321 |
| `SocialNoteReaction` | model | Atomic Phase 095 | Phase5-7_EbooklineliffV2.md:12356 |
| `SquadChallenge` | model | Atomic Phase 096 | Phase5-7_EbooklineliffV2.md:12821 |
| `SquadMember` | model | Atomic Phase 096 | Phase5-7_EbooklineliffV2.md:12790 |
| `StockMovementLog` | model | Atomic Phase 075 | Phase5-7_EbooklineliffV2.md:2050 |
| `StockReservation` | model | Atomic Phase 087 | Phase5-7_EbooklineliffV2.md:8475 |
| `StorageBucketPolicy` | model | Atomic Phase 123 | Phase5-7_EbooklineliffV2.md:26800 |
| `StorageBudgetAlertConfig` | model | Atomic Phase 123 | Phase5-7_EbooklineliffV2.md:26831 |
| `StorageCostAlertLog` | model | Atomic Phase 123 | Phase5-7_EbooklineliffV2.md:26843 |
| `StorageUsageMetric` | model | Atomic Phase 123 | Phase5-7_EbooklineliffV2.md:26817 |
| `StorageVaultAsset` | model | Atomic Phase 036 | Phase1-4_EbooklineliffV2.md:19080 |
| `StudyGroup` | model | Atomic Phase 095 | Phase5-7_EbooklineliffV2.md:12347 |
| `StudySquad` | model | Atomic Phase 096 | Phase5-7_EbooklineliffV2.md:12764 |
| `SubtitleSegment` | model | Atomic Phase 094 | Phase5-7_EbooklineliffV2.md:12024 |
| `SupportCategory` | model | Atomic Phase 103 | Phase5-7_EbooklineliffV2.md:16453 |
| `SupportTicket` | model | Atomic Phase 103 | Phase5-7_EbooklineliffV2.md:16461 |
| `SystemAuditLog` | model | Atomic Phase 121 | Phase5-7_EbooklineliffV2.md:26002 |
| `SystemHealth` | model | Atomic Phase 001 | Phase1-4_EbooklineliffV2.md:632 |
| `SystemHealthMetric` | model | Atomic Phase 127 | Phase5-7_EbooklineliffV2.md:28577 |
| `Tag` | model | Atomic Phase 008 | Phase1-4_EbooklineliffV2.md:4740 |
| `Tenant` | model | Atomic Phase 006, Atomic Phase 008, Atomic Phase 030, Atomic Phase 071, Atomic Phase 072 | Phase5-7_EbooklineliffV2.md:144 |
| `TenantBranding` | model | Atomic Phase 023, Atomic Phase 030 | Phase1-4_EbooklineliffV2.md:16597 |
| `TenantBrandingConfig` | model | Atomic Phase 071 | Phase5-7_EbooklineliffV2.md:171 |
| `TenantCompany` | model | Atomic Phase 108 | Phase5-7_EbooklineliffV2.md:19073 |
| `TenantConfig` | model | Atomic Phase 034 | Phase1-4_EbooklineliffV2.md:18336 |
| `TenantDomain` | model | Atomic Phase 071, Atomic Phase 108 | Phase5-7_EbooklineliffV2.md:19104 |
| `TenantLineConfig` | model | Atomic Phase 024 | Phase1-4_EbooklineliffV2.md:13906 |
| `TenantSetting` | model | Atomic Phase 019 | Phase1-4_EbooklineliffV2.md:11267 |
| `TenantSubscription` | model | Atomic Phase 108 | Phase5-7_EbooklineliffV2.md:19120 |
| `TenantUsageMetric` | model | Atomic Phase 108 | Phase5-7_EbooklineliffV2.md:19135 |
| `TicketAttachment` | model | Atomic Phase 103 | Phase5-7_EbooklineliffV2.md:16494 |
| `TicketMessage` | model | Atomic Phase 103 | Phase5-7_EbooklineliffV2.md:16481 |
| `TrackingHistory` | model | Atomic Phase 077 | Phase5-7_EbooklineliffV2.md:3065 |
| `TranscodeJob` | model | Atomic Phase 102 | Phase5-7_EbooklineliffV2.md:16051 |
| `User` | model | Atomic Phase 000, Atomic Phase 003, Atomic Phase 006, Atomic Phase 012, Atomic Phase 018, Atomic Phase 020, Atomic Phase 021, Atomic Phase 034, Atomic Phase 079, Atomic Phase 093, Atomic Phase 109, Atomic Phase 128 | Phase5-7_EbooklineliffV2.md:28996 |
| `User360Metric` | model | Atomic Phase 110 | Phase5-7_EbooklineliffV2.md:20381 |
| `UserAdaptiveProfile` | model | Atomic Phase 093 | Phase5-7_EbooklineliffV2.md:11592 |
| `UserAddress` | model | Atomic Phase 003 | Phase1-4_EbooklineliffV2.md:1753 |
| `UserBadge` | model | Atomic Phase 083, Atomic Phase 096 | Phase5-7_EbooklineliffV2.md:12845 |
| `UserConsentHistory` | model | Atomic Phase 129 | Phase5-7_EbooklineliffV2.md:29682 |
| `UserCouponClaim` | model | Atomic Phase 117 | Phase5-7_EbooklineliffV2.md:24254 |
| `UserDevice` | model | Atomic Phase 119 | Phase5-7_EbooklineliffV2.md:25097 |
| `UserDeviceMetric` | model | Atomic Phase 022 | Phase1-4_EbooklineliffV2.md:12970 |
| `UserDeviceSession` | model | Atomic Phase 007, Atomic Phase 056, Atomic Phase 070 | Phase1-4_EbooklineliffV2.md:36079 |
| `UserInteractionLog` | model | Atomic Phase 104 | Phase5-7_EbooklineliffV2.md:16907 |
| `UserLearningInsight` | model | Atomic Phase 092 | Phase5-7_EbooklineliffV2.md:11087 |
| `UserLiffSessionState` | model | Atomic Phase 031 | Phase1-4_EbooklineliffV2.md:17058 |
| `UserLocationCache` | model | Atomic Phase 032 | Phase1-4_EbooklineliffV2.md:17455 |
| `UserLoginLog` | model | Atomic Phase 120 | Phase5-7_EbooklineliffV2.md:25539 |
| `UserNavigationSession` | model | Atomic Phase 027 | Phase1-4_EbooklineliffV2.md:15289 |
| `UserPII` | model | Atomic Phase 107 | Phase5-7_EbooklineliffV2.md:18556 |
| `UserPreferenceProfile` | model | Atomic Phase 104 | Phase5-7_EbooklineliffV2.md:16884 |
| `UserReaderPreference` | model | Atomic Phase 041, Atomic Phase 059 | Phase1-4_EbooklineliffV2.md:30719 |
| `UserReadingPreference` | model | Atomic Phase 066 | Phase1-4_EbooklineliffV2.md:34163 |
| `UserSecurityAuditLog` | model | Atomic Phase 110 | Phase5-7_EbooklineliffV2.md:20432 |
| `UserSecuritySetting` | model | Atomic Phase 120 | Phase5-7_EbooklineliffV2.md:25594 |
| `UserStreak` | model | Atomic Phase 083 | Phase5-7_EbooklineliffV2.md:6352 |
| `UserTaxProfile` | model | Atomic Phase 082 | Phase5-7_EbooklineliffV2.md:5930 |
| `UserTenantMapping` | model | Atomic Phase 071 | Phase5-7_EbooklineliffV2.md:184 |
| `UserTenantRole` | model | Atomic Phase 106 | Phase5-7_EbooklineliffV2.md:18111 |
| `UserVideoWatchTelemetry` | model | Atomic Phase 110 | Phase5-7_EbooklineliffV2.md:20417 |
| `VideoAsset` | model | Atomic Phase 043 | Phase1-4_EbooklineliffV2.md:22733 |
| `VideoKeyRotation` | model | Atomic Phase 043 | Phase1-4_EbooklineliffV2.md:22768 |
| `VideoQualityVariant` | model | Atomic Phase 044 | Phase1-4_EbooklineliffV2.md:23192 |
| `VideoRendition` | model | Atomic Phase 043 | Phase1-4_EbooklineliffV2.md:22755 |
| `VideoSpriteSheet` | model | Atomic Phase 058 | Phase1-4_EbooklineliffV2.md:30249 |
| `VideoStreamSession` | model | Atomic Phase 050, Atomic Phase 053 | Phase1-4_EbooklineliffV2.md:26021 |
| `VideoStreamTelemetry` | model | Atomic Phase 067 | Phase1-4_EbooklineliffV2.md:34636 |
| `VideoSubtitle` | model | Atomic Phase 094 | Phase5-7_EbooklineliffV2.md:12010 |
| `VideoTranscodeJob` | model | Atomic Phase 044 | Phase1-4_EbooklineliffV2.md:23172 |
| `VideoWatchAnalytics` | model | Atomic Phase 052 | Phase1-4_EbooklineliffV2.md:27206 |
| `ViralAttribution` | model | Atomic Phase 026 | Phase1-4_EbooklineliffV2.md:14823 |
| `Wallet` | model | Atomic Phase 017 | Phase1-4_EbooklineliffV2.md:10301 |
| `WalletAuditLedger` | model | Atomic Phase 109 | Phase5-7_EbooklineliffV2.md:19599 |
| `WalletLedger` | model | Atomic Phase 017, Atomic Phase 086 | Phase5-7_EbooklineliffV2.md:7922 |
| `Warehouse` | model | Atomic Phase 073, Atomic Phase 075, Atomic Phase 076 | Phase5-7_EbooklineliffV2.md:2015 |
| `WarehouseStock` | model | Atomic Phase 075 | Phase5-7_EbooklineliffV2.md:2032 |
| `WatermarkSeedLog` | model | Atomic Phase 042 | Phase1-4_EbooklineliffV2.md:22317 |
| `WithholdingTaxCertificate` | model | Atomic Phase 082 | Phase5-7_EbooklineliffV2.md:5949 |
| `WithholdingTaxRecord` | model | Atomic Phase 081 | Phase5-7_EbooklineliffV2.md:5424 |
| `AbandonedStatus` | enum | Atomic Phase 084 | Phase5-7_EbooklineliffV2.md:7034 |
| `ActivityType` | enum | Atomic Phase 110 | Phase5-7_EbooklineliffV2.md:20370 |
| `AffiliateTierLevel` | enum | Atomic Phase 079 | Phase5-7_EbooklineliffV2.md:4277 |
| `AiJobStatus` | enum | Atomic Phase 094 | Phase5-7_EbooklineliffV2.md:11986 |
| `AiJobType` | enum | Atomic Phase 094 | Phase5-7_EbooklineliffV2.md:11979 |
| `AlertSeverity` | enum | Atomic Phase 123 | Phase5-7_EbooklineliffV2.md:26794 |
| `AuditActionCategory` | enum | Atomic Phase 118 | Phase5-7_EbooklineliffV2.md:24709 |
| `AuditAdminRole` | enum | Atomic Phase 118 | Phase5-7_EbooklineliffV2.md:24700 |
| `AuditIntegrityStatus` | enum | Atomic Phase 118 | Phase5-7_EbooklineliffV2.md:24718 |
| `BadgeCategory` | enum | Atomic Phase 083 | Phase5-7_EbooklineliffV2.md:6329 |
| `BookJobStatus` | enum | Atomic Phase 038 | Phase1-4_EbooklineliffV2.md:20231 |
| `BotPromptMode` | enum | Atomic Phase 034 | Phase1-4_EbooklineliffV2.md:18311 |
| `ChaosFaultType` | enum | Atomic Phase 124 | Phase5-7_EbooklineliffV2.md:27351 |
| `CircuitState` | enum | Atomic Phase 124 | Phase5-7_EbooklineliffV2.md:27359 |
| `CommissionStatus` | enum | Atomic Phase 079 | Phase5-7_EbooklineliffV2.md:4283 |
| `CompanyStatus` | enum | Atomic Phase 108 | Phase5-7_EbooklineliffV2.md:19048 |
| `ConsentPurpose` | enum | Atomic Phase 129 | Phase5-7_EbooklineliffV2.md:29660 |
| `ContentAccessType` | enum | Atomic Phase 000, Atomic Phase 008, Atomic Phase 012, Atomic Phase 093, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:156 |
| `ContentSourceType` | enum | Atomic Phase 091 | Phase5-7_EbooklineliffV2.md:10544 |
| `CorporateLicenseStatus` | enum | Atomic Phase 097 | Phase5-7_EbooklineliffV2.md:13291 |
| `CouponScope` | enum | Atomic Phase 088, Atomic Phase 117 | Phase5-7_EbooklineliffV2.md:8941 |
| `CouponType` | enum | Atomic Phase 088, Atomic Phase 117 | Phase5-7_EbooklineliffV2.md:8935 |
| `CourierProvider` | enum | Atomic Phase 076 | Phase5-7_EbooklineliffV2.md:2500 |
| `DRState` | enum | Atomic Phase 127 | Phase5-7_EbooklineliffV2.md:28537 |
| `DSRStatus` | enum | Atomic Phase 129 | Phase5-7_EbooklineliffV2.md:29675 |
| `DSRType` | enum | Atomic Phase 129 | Phase5-7_EbooklineliffV2.md:29667 |
| `DataScopeRole` | enum | Atomic Phase 107 | Phase5-7_EbooklineliffV2.md:18538 |
| `DeviceType` | enum | Atomic Phase 070, Atomic Phase 119 | Phase1-4_EbooklineliffV2.md:36072 |
| `DispatchStatus` | enum | Atomic Phase 024 | Phase1-4_EbooklineliffV2.md:13898 |
| `DisputeReason` | enum | Atomic Phase 113 | Phase5-7_EbooklineliffV2.md:22077 |
| `DisputeStatus` | enum | Atomic Phase 113 | Phase5-7_EbooklineliffV2.md:22087 |
| `DomainStatus` | enum | Atomic Phase 108 | Phase5-7_EbooklineliffV2.md:19058 |
| `DrmAlgorithm` | enum | Atomic Phase 061 | Phase1-4_EbooklineliffV2.md:31647 |
| `DrmViolationType` | enum | Atomic Phase 049 | Phase1-4_EbooklineliffV2.md:25615 |
| `EntryType` | enum | Atomic Phase 081 | Phase5-7_EbooklineliffV2.md:5335 |
| `EnvironmentType` | enum | Atomic Phase 022 | Phase1-4_EbooklineliffV2.md:12960 |
| `EscrowStatus` | enum | Atomic Phase 113 | Phase5-7_EbooklineliffV2.md:22069 |
| `FlagCategory` | enum | Atomic Phase 112 | Phase5-7_EbooklineliffV2.md:21487 |
| `FlashSaleStatus` | enum | Atomic Phase 087 | Phase5-7_EbooklineliffV2.md:8426 |
| `FulfillmentStatus` | enum | Atomic Phase 073, Atomic Phase 076 | Phase5-7_EbooklineliffV2.md:972 |
| `GiftStatus` | enum | Atomic Phase 089 | Phase5-7_EbooklineliffV2.md:9468 |
| `GreetingTheme` | enum | Atomic Phase 089 | Phase5-7_EbooklineliffV2.md:9476 |
| `GroupBuyingStatus` | enum | Atomic Phase 090 | Phase5-7_EbooklineliffV2.md:9969 |
| `GroupType` | enum | Atomic Phase 090 | Phase5-7_EbooklineliffV2.md:9962 |
| `HandRaiseStatus` | enum | Atomic Phase 101 | Phase5-7_EbooklineliffV2.md:15415 |
| `HlsTranscodeStatus` | enum | Atomic Phase 078 | Phase5-7_EbooklineliffV2.md:3693 |
| `IncomeType` | enum | Atomic Phase 082 | Phase5-7_EbooklineliffV2.md:5917 |
| `InteractionType` | enum | Atomic Phase 104 | Phase5-7_EbooklineliffV2.md:16866 |
| `IpAnomalyType` | enum | Atomic Phase 120 | Phase5-7_EbooklineliffV2.md:25521 |
| `KYCDocType` | enum | Atomic Phase 111 | Phase5-7_EbooklineliffV2.md:20995 |
| `KYCRiskLevel` | enum | Atomic Phase 111 | Phase5-7_EbooklineliffV2.md:21002 |
| `KYCStatus` | enum | Atomic Phase 003, Atomic Phase 085, Atomic Phase 109, Atomic Phase 111 | Phase1-4_EbooklineliffV2.md:1650 |
| `LedgerAccountType` | enum | Atomic Phase 081, Atomic Phase 114 | Phase5-7_EbooklineliffV2.md:5326 |
| `LedgerType` | enum | Atomic Phase 017 | Phase1-4_EbooklineliffV2.md:10291 |
| `LineReviewCategory` | enum | Atomic Phase 035 | Phase1-4_EbooklineliffV2.md:18720 |
| `LiveAccessRole` | enum | Atomic Phase 100 | Phase5-7_EbooklineliffV2.md:14680 |
| `LiveMessageType` | enum | Atomic Phase 101 | Phase5-7_EbooklineliffV2.md:15423 |
| `LiveSessionStatus` | enum | Atomic Phase 099 | Phase5-7_EbooklineliffV2.md:14166 |
| `LiveStreamStatus` | enum | Atomic Phase 100, Atomic Phase 102 | Phase5-7_EbooklineliffV2.md:14673 |
| `LiveStreamVendor` | enum | Atomic Phase 099 | Phase5-7_EbooklineliffV2.md:14159 |
| `LogLevel` | enum | Atomic Phase 121 | Phase5-7_EbooklineliffV2.md:25993 |
| `LogisticsCarrier` | enum | Atomic Phase 077 | Phase5-7_EbooklineliffV2.md:3023 |
| `MessageType` | enum | Atomic Phase 024 | Phase1-4_EbooklineliffV2.md:13889 |
| `MetricType` | enum | Atomic Phase 029 | Phase1-4_EbooklineliffV2.md:16116 |
| `ModerationSeverity` | enum | Atomic Phase 112 | Phase5-7_EbooklineliffV2.md:21496 |
| `ModerationStatus` | enum | Atomic Phase 112 | Phase5-7_EbooklineliffV2.md:21474 |
| `NoteType` | enum | Atomic Phase 095 | Phase5-7_EbooklineliffV2.md:12314 |
| `NoteVisibility` | enum | Atomic Phase 065, Atomic Phase 095 | Phase1-4_EbooklineliffV2.md:33669 |
| `NotificationStep` | enum | Atomic Phase 084 | Phase5-7_EbooklineliffV2.md:7041 |
| `OrderStatus` | enum | Atomic Phase 012, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:6827 |
| `OutboxStatus` | enum | Atomic Phase 124 | Phase5-7_EbooklineliffV2.md:27365 |
| `PackageTier` | enum | Atomic Phase 108 | Phase5-7_EbooklineliffV2.md:19066 |
| `PaymentStatus` | enum | Atomic Phase 012, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:6838 |
| `PayoutAccountStatus` | enum | Atomic Phase 085 | Phase5-7_EbooklineliffV2.md:7474 |
| `PayoutStatus` | enum | Atomic Phase 073, Atomic Phase 079, Atomic Phase 081, Atomic Phase 086, Atomic Phase 114 | Phase5-7_EbooklineliffV2.md:980 |
| `PermissionStatus` | enum | Atomic Phase 032 | Phase1-4_EbooklineliffV2.md:17431 |
| `PermissionType` | enum | Atomic Phase 032 | Phase1-4_EbooklineliffV2.md:17424 |
| `PointActivityType` | enum | Atomic Phase 096 | Phase5-7_EbooklineliffV2.md:12755 |
| `ProductStatus` | enum | Atomic Phase 008 | Phase1-4_EbooklineliffV2.md:4557 |
| `ProductType` | enum | Atomic Phase 000, Atomic Phase 008, Atomic Phase 012, Atomic Phase 037, Atomic Phase 093, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:148 |
| `PromptPayStatus` | enum | Atomic Phase 013 | Phase1-4_EbooklineliffV2.md:7391 |
| `QrStatus` | enum | Atomic Phase 007 | Phase1-4_EbooklineliffV2.md:4054 |
| `QuizType` | enum | Atomic Phase 047 | Phase1-4_EbooklineliffV2.md:24659 |
| `ReadingFontFamily` | enum | Atomic Phase 066 | Phase1-4_EbooklineliffV2.md:34156 |
| `ReceiptStatus` | enum | Atomic Phase 019 | Phase1-4_EbooklineliffV2.md:11260 |
| `RecommendationReasonType` | enum | Atomic Phase 104 | Phase5-7_EbooklineliffV2.md:16875 |
| `ReconciliationStatus` | enum | Atomic Phase 115 | Phase5-7_EbooklineliffV2.md:23173 |
| `RedemptionStatus` | enum | Atomic Phase 083 | Phase5-7_EbooklineliffV2.md:6345 |
| `RewardType` | enum | Atomic Phase 083 | Phase5-7_EbooklineliffV2.md:6337 |
| `RiskLevel` | enum | Atomic Phase 110, Atomic Phase 120 | Phase5-7_EbooklineliffV2.md:20363 |
| `RuntimeEnvironment` | enum | Atomic Phase 056 | Phase1-4_EbooklineliffV2.md:29248 |
| `SeatStatus` | enum | Atomic Phase 097 | Phase5-7_EbooklineliffV2.md:13298 |
| `SecurityActionType` | enum | Atomic Phase 050 | Phase1-4_EbooklineliffV2.md:26015 |
| `SecuritySeverity` | enum | Atomic Phase 028 | Phase1-4_EbooklineliffV2.md:15631 |
| `SenderType` | enum | Atomic Phase 103 | Phase5-7_EbooklineliffV2.md:16446 |
| `SensitiveFieldType` | enum | Atomic Phase 107 | Phase5-7_EbooklineliffV2.md:18547 |
| `SessionStatus` | enum | Atomic Phase 119 | Phase5-7_EbooklineliffV2.md:25090 |
| `ShareStatus` | enum | Atomic Phase 026 | Phase1-4_EbooklineliffV2.md:14797 |
| `ShareTargetType` | enum | Atomic Phase 026 | Phase1-4_EbooklineliffV2.md:14790 |
| `ShipmentStatus` | enum | Atomic Phase 077 | Phase5-7_EbooklineliffV2.md:3029 |
| `SquadMemberRole` | enum | Atomic Phase 096 | Phase5-7_EbooklineliffV2.md:12749 |
| `StatementSource` | enum | Atomic Phase 115 | Phase5-7_EbooklineliffV2.md:23181 |
| `StorageAlertStatus` | enum | Atomic Phase 123 | Phase5-7_EbooklineliffV2.md:26787 |
| `TaxFormType` | enum | Atomic Phase 082 | Phase5-7_EbooklineliffV2.md:5923 |
| `TaxPayerType` | enum | Atomic Phase 082 | Phase5-7_EbooklineliffV2.md:5912 |
| `TenantStatus` | enum | Atomic Phase 071 | Phase5-7_EbooklineliffV2.md:137 |
| `ThemeMode` | enum | Atomic Phase 066 | Phase1-4_EbooklineliffV2.md:34148 |
| `ThreatSeverity` | enum | Atomic Phase 127 | Phase5-7_EbooklineliffV2.md:28530 |
| `TicketPriority` | enum | Atomic Phase 103 | Phase5-7_EbooklineliffV2.md:16439 |
| `TicketStatus` | enum | Atomic Phase 103 | Phase5-7_EbooklineliffV2.md:16431 |
| `TransactionEntryType` | enum | Atomic Phase 114 | Phase5-7_EbooklineliffV2.md:22648 |
| `TranscodeStatus` | enum | Atomic Phase 044 | Phase1-4_EbooklineliffV2.md:23156 |
| `UserRole` | enum | Atomic Phase 000, Atomic Phase 001, Atomic Phase 003, Atomic Phase 006, Atomic Phase 008, Atomic Phase 012, Atomic Phase 093, Atomic Phase 109, Atomic Phase 128 | Phase1-4_EbooklineliffV2.md:138 |
| `VectorSourceType` | enum | Atomic Phase 092 | Phase5-7_EbooklineliffV2.md:11037 |
| `VideoQuality` | enum | Atomic Phase 044, Atomic Phase 067 | Phase1-4_EbooklineliffV2.md:23165 |
| `VideoResolution` | enum | Atomic Phase 043 | Phase1-4_EbooklineliffV2.md:22726 |
| `VideoStatus` | enum | Atomic Phase 043 | Phase1-4_EbooklineliffV2.md:22717 |
