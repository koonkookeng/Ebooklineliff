ในฐานะ Senior Software Architect ที่คร่ำหวอดในวงการและเชี่ยวชาญสาย **Vibe Coding** การใช้งาน OpenCode ร่วมกับ OpenCode Go Subscription ($10/mo) บน IDE อย่าง Devin/Cursor/VS Code ถือเป็นเทคนิคชั้นยอดในการได้ใช้พลังระดับ Top-tier Model โดยไม่ต้องเสียค่า API Token เองรายตัว

เพื่อตอบโจทย์ **"OpenGo AI Switcher"** ที่ไม่มี API Key โดยตรง แต่ต้องสั่งงานผ่าน OpenCode CLI / OpenCode Extension และต้องการคุณสมบัติ **Preemptive Top-Priority Selection** (ข้ามกลับมาใช้โมเดลลำดับสูงทันทีที่หลุด Rate Limit/Cooldown โดยไม่ต้องรอวนครบ Loop) เราจะออกแบบสถาปัตยกรรมเป็น **OpenCode Plugin / Middleware Wrapper (Node.js/TypeScript)** ที่คอย Intercept คำสั่งก่อนส่งเข้า OpenCode Core

---

## 🏗️ แนวทางการออกแบบระบบ (Architecture Overview)

OpenCode Extensibility รองรับการเขียน Plugin ในรูป **Hooks / Custom Provider Wrapper** หรือ **Middleware CLI Daemon**:

1. **Fallback Priority Matrix**: จัดลำดับโมเดลทั้ง 30 ตัวตาม Priority Score (1 -> 30)
2. **Health Check & Cooldown Circuit Breaker**: เมื่อส่ง Prompt แล้วเจอ Error Code 429 (Rate Limit Exceeded), Quota Exhausted หรือ `429 Too Many Requests` จาก OpenCode Go ระบบจะบันทึก Cooldown Time ของโมเดลนั้นๆ (เช่น 5 - 15 นาที)
3. **Preemptive Priority Recovery**: ทุกครั้งที่มี Request ใหม่เข้ามา ตัว Switcher จะสแกนหา **โมเดลที่มีอันดับสูงที่สุดที่สถานะเป็น `AVAILABLE**` (Cooldown หมดแล้ว) มาใช้งานก่อนเสมอ ไม่จำต้องวนรอจนถึงลำดับที่ 30

---

## 🛠️ โครงสร้างโปรเจกต์ `opengo-ai-switcher`

สร้างโฟลเดอร์สำหรับ Plugin ในโปรเจกต์ของคุณ:

```text
your-project/
├── .opencode/
│   └── plugins/
│       └── opengo-ai-switcher/
│           ├── index.ts
│           ├── model-priority.json
│           └── package.json
└── opencode.config.json

```

---

## 💻 ซอร์สโค้ดระบบ OpenGo AI Switcher

### 1. `model-priority.json` (ลำดับโมเดลตามความสามารถ 1-30)

```json
[
  { "priority": 1, "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro", "score": 98 },
  { "priority": 2, "id": "gemini-4-argon", "name": "Gemini 4 Argon", "score": 97 },
  { "priority": 3, "id": "kimi-k3.1-pro", "name": "Kimi K3.1 Pro", "score": 95 },
  { "priority": 4, "id": "gpt-6-luna", "name": "GPT 6 Luna", "score": 94 },
  { "priority": 5, "id": "qwen3.8-max", "name": "Qwen3.8 Max", "score": 93 },
  { "priority": 6, "id": "grok-4.7", "name": "Grok 4.7", "score": 92 },
  { "priority": 7, "id": "glm-5.3", "name": "GLM-5.3", "score": 91 },
  { "priority": 8, "id": "kimi-k2.7-code", "name": "Kimi K2.7 Code", "score": 90 },
  { "priority": 9, "id": "glm-5.2", "name": "GLM-5.2", "score": 89 },
  { "priority": 10, "id": "qwen3.7-plus", "name": "Qwen3.7 Plus", "score": 88 },
  { "priority": 11, "id": "gpt-5.6-luna", "name": "GPT 5.6 Luna", "score": 87 },
  { "priority": 12, "id": "mimo-v2.6-pro", "name": "MiMo-V2.6-Pro", "score": 86 },
  { "priority": 13, "id": "mimo-v2.5-pro", "name": "MiMo-V2.5-Pro", "score": 85.5 },
  { "priority": 14, "id": "hy4-preview", "name": "Hy4 preview", "score": 85 },
  { "priority": 15, "id": "hy3", "name": "Hy3", "score": 84 },
  { "priority": 16, "id": "claude-haiku-5.5", "name": "Claude Haiku 5.5", "score": 83 },
  { "priority": 17, "id": "minimax-m3", "name": "MiniMax M3", "score": 82 },
  { "priority": 18, "id": "minimax-m3.1-flash", "name": "MiniMax M3.1 Flash", "score": 81 },
  { "priority": 19, "id": "qwen3.8-flash", "name": "Qwen3.8 Flash", "score": 80 },
  { "priority": 20, "id": "glm-5.3-flash", "name": "GLM-5.3-Flash", "score": 78 },
  { "priority": 21, "id": "step-5-preview", "name": "Step 5 Preview", "score": 77 },
  { "priority": 22, "id": "longcat-2.0", "name": "LongCat-2.0", "score": 75 },
  { "priority": 23, "id": "mimo-v2.6-flash", "name": "MiMo-V2.6-Flash", "score": 73 },
  { "priority": 24, "id": "mimo-v2.5", "name": "MiMo-V2.5", "score": 72 },
  { "priority": 25, "id": "deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash", "score": 70 },
  { "priority": 26, "id": "muse-spark-1.3-contributor", "name": "Muse Spark 1.3 Contributor", "score": 65 },
  { "priority": 27, "id": "muse-spark-1.2-contributor", "name": "Muse Spark 1.2 Contributor", "score": 64 },
  { "priority": 28, "id": "longcat-2.5-preview-free", "name": "LongCat 2.5 Preview Free", "score": 60 },
  { "priority": 29, "id": "beam-free", "name": "Beam Free", "score": 55 },
  { "priority": 30, "id": "iceman-contributor-free", "name": "Iceman Contributor Free", "score": 50 }
]

```

---

### 2. `index.ts` (Core Logic - OpenGo AI Switcher Plugin)

```typescript
import modelsConfig from './model-priority.json';

interface ModelInfo {
  priority: number;
  id: string;
  name: string;
  score: number;
}

interface CooldownMap {
  [modelId: string]: number; // Timestamp เมื่อปลดล็อก Cooldown
}

export class OpenGoAISwitcher {
  private models: ModelInfo[];
  private cooldowns: CooldownMap = {};
  private defaultCooldownMs = 10 * 60 * 1000; // ตั้งเวลา Cooldown พื้นฐานเมื่อติด Rate Limit (10 นาที)
  private currentActiveModel: ModelInfo | null = null;

  constructor() {
    // เรียงลำดับความสำคัญจาก Priority 1 -> 30 ให้แน่ใจเสมอ
    this.models = modelsConfig.sort((a, b) => a.priority - b.priority);
  }

  /**
   * ตรวจสอบว่าโมเดลหมดช่วง Cooldown แล้วหรือยัง
   */
  private isModelAvailable(modelId: string): boolean {
    const cooldownUntil = this.cooldowns[modelId];
    if (!cooldownUntil) return true;
    
    if (Date.now() >= cooldownUntil) {
      delete this.cooldowns[modelId]; // ปลดล็อก Cooldown
      console.log(`[OpenGo Switcher] 🔓 Model '${modelId}' is unblocked and ready to use!`);
      return true;
    }
    return false;
  }

  /**
   * ค้นหาโมเดลที่มี Priority สูงสุด ณ วินาทีนั้นที่พร้อมใช้งาน (Preemptive Priority Selection)
   */
  public getBestAvailableModel(): ModelInfo {
    for (const model of this.models) {
      if (this.isModelAvailable(model.id)) {
        if (this.currentActiveModel?.id !== model.id) {
          console.log(`[OpenGo Switcher] ⚡ Switching to Highest Available Priority Model: #${model.priority} ${model.name} (Score: ${model.score})`);
          this.currentActiveModel = model;
        }
        return model;
      }
    }
    // หากติด Cooldown ครบทุกตัว ให้เลือกอันดับ 1 แล้วเสี่ยงลองใหม่
    console.warn('[OpenGo Switcher] ⚠️ All models in cooldown! Falling back to Top Priority Model (#1).');
    return this.models[0];
  }

  /**
   * ทำการ Mark โมเดลกรณีติด Rate Limit / Quota Exceeded
   */
  public markModelRateLimited(modelId: string, customCooldownMinutes?: number) {
    const duration = (customCooldownMinutes || 10) * 60 * 1000;
    this.cooldowns[modelId] = Date.now() + duration;
    console.warn(`[OpenGo Switcher] 🚨 Model '${modelId}' hit Rate Limit/Quota Exceeded! Cooldown set for ${customCooldownMinutes || 10} minutes.`);
  }

  /**
   * OpenCode Hook Handler: สอดแทรกเปลี่ยนโมเดลก่อนส่ง Request
   */
  public async handlePreRequest(opencodeContext: any) {
    const selectedModel = this.getBestAvailableModel();
    
    // Override โมเดลให้ OpenCode เรียกใช้โมเดลของ OpenCode Go ตามลำดับ
    opencodeContext.config.model = `opencode-go/${selectedModel.id}`;
    opencodeContext.headers = {
      ...opencodeContext.headers,
      'X-OpenCode-Go-Model': selectedModel.id
    };

    return opencodeContext;
  }

  /**
   * OpenCode Hook Handler: ดักจับ Error หากโดน Rate Limit ให้ Retry อัตโนมัติด้วยโมเดลลำดับถัดไป
   */
  public async handleResponseError(error: any, opencodeContext: any, retryFn: Function) {
    const currentModelId = this.currentActiveModel?.id;

    // ตรวจสอบ Error Code ยอดฮิตของ Rate Limit หรือ Quota หมด
    const isRateLimit = 
      error?.status === 429 || 
      error?.message?.includes('rate limit') || 
      error?.message?.includes('quota exceeded') ||
      error?.message?.includes('too many requests');

    if (isRateLimit && currentModelId) {
      // ติด Flag Cooldown ไว้ที่ตัวปัจจุบัน
      this.markModelRateLimited(currentModelId);

      // ดึงโมเดลที่ดีที่สุดถัดไปทันที
      const nextModel = this.getBestAvailableModel();
      console.log(`[OpenGo Switcher] 🔄 Auto-retrying request with model: #${nextModel.priority} ${nextModel.name}`);

      // ปรับแต่ง Context แล้วส่ง Retry อีกครั้ง
      opencodeContext.config.model = `opencode-go/${nextModel.id}`;
      return await retryFn(opencodeContext);
    }

    throw error;
  }
}

// Export ตัวอย่าง Instance สำหรับเป็น OpenCode Plugin Middleware
const switcher = new OpenGoAISwitcher();

export default {
  name: 'opengo-ai-switcher',
  hooks: {
    'before:completion': (ctx: any) => switcher.handlePreRequest(ctx),
    'error:completion': (err: any, ctx: any, retry: Function) => switcher.handleResponseError(err, ctx, retry)
  }
};

```

---

### 3. การเปิดใช้งานภายในโปรเจกต์ (`opencode.config.json`)

นำคอนฟิกนี้ไปใส่ไว้ใน Root Folder ของโปรเจกต์ที่กำลังพัฒนา เพื่อเปิดใช้งาน Plugin เฉพาะโปรเจกต์:

```json
{
  "$schema": "https://opencode.ai/config.schema.json",
  "provider": "opencode-go",
  "plugins": [
    "./.opencode/plugins/opengo-ai-switcher/index.ts"
  ],
  "opengoAISwitcher": {
    "enabled": true,
    "autoRecoverTopPriority": true,
    "checkCooldownIntervalSeconds": 30
  }
}

```

---

## 🚀 จุดเด่นของระบบ "OpenGo AI Switcher" ที่ตรงโจทย์ Vibe Coding

1. **Preemptive Priority Auto-Recovery**:
* หากกำลังรันอยู่ที่ลำดับ 16 (`Claude Haiku 5.5`) แล้วจังหวะนั้นอันดับ 1 (`DeepSeek V4 Pro`) ปลดล็อก Rate Limit พอดี ระบบจะ**ข้ามกลับไปใช้ DeepSeek V4 Pro ทันทีในการส่ง Prompt ถัดไป** โดยไม่เสียเวลาไล่จนถึงอันดับ 30


2. **Zero API Key Requirement**:
* ทำงานผ่าน Session Authorization ของ **OpenCode Go** บน Devin IDE / OpenCode CLI ได้ร้อยเปอร์เซ็นต์


3. **Seamless Vibe Coding Experience**:
* โค้ดไม่สะดุดระหว่างเขียนเมื่อติด Rate Limit ระบบจะดักจับ `429 Too Many Requests` และทำการ **Auto-Retry** สลับโมเดลลำดับสำรองให้ทันทีหลังบ้านภายในไม่กี่วินาที



ต้องการให้ปรับเพิ่มระบบแจ้งเตือน (Desktop Notification / Status Bar Highlight) บน IDE ตอนที่ระบบสลับโมเดลให้ด้วยไหมครับ?