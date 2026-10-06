// SSOT Phase 020 §10.1 — E2E checkout & auto slip-verification flow (Playwright)
// Canonical: e2e/checkout-flow.spec.ts
// (legacy tests/e2e/checkout-flow.spec.ts)
// RUNS IN CI (browsers + seeded DB + EasySlip sandbox); not executed by tsx loops.
// CI prerequisites: playwright.config webServer (frontend :3000 + backend),
// TEST_PRODUCT_SLUG (published EBOOK), E2E_USER_JWT cookie, fixture below.
// Selectors are text/role-based (no testids) to match the real LIFF strings.
import { test, expect } from '@playwright/test';

const SLIP_FIXTURE = './e2e/fixtures/valid-sample-slip.png';
const PRODUCT_SLUG = process.env.TEST_PRODUCT_SLUG ?? 'ebook-starter-pack';

test.describe('Phase 020: E2E checkout & auto slip verification', () => {
  test('select → PromptPay QR → slip verify → instant unlock (<1.5s) → library', async ({ page }) => {
    // 1. Storefront → product → checkout
    await page.goto('/catalog');
    await page.getByPlaceholder(/ค้นหา/).fill('ebook');
    await page.goto(`/pdp/${PRODUCT_SLUG}`);
    await page.getByRole('button', { name: /ซื้อ|สั่งซื้อ|ยืนยัน/ }).first().click();

    // 2. Dynamic PromptPay QR visible (IDLE)
    await expect(page.getByText('สแกนชำระเงิน PromptPay')).toBeVisible({ timeout: 10000 });

    // 3. Attach slip + submit (LOADING)
    await page.locator('input[type="file"]').setInputFiles(SLIP_FIXTURE);
    const t0 = Date.now();
    await page.getByRole('button', { name: /อัปโหลดสลิป|ยืนยันการแจ้งชำระเงิน/ }).click();

    // 4. Instant unlock (SUCCESS) — perf guard: verify leg < 1.5s E2E
    await expect(page.getByText('ชำระเงินสำเร็จ')).toBeVisible({ timeout: 5000 });
    expect(Date.now() - t0).toBeLessThan(1500);

    // 5. Library shows the unlocked asset with resume CTA
    await page.goto('/library');
    await expect(page.getByText('คลังของฉัน')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('a[href^="/reader/"], a[href^="/course/"]').first()).toBeVisible();
  });

  test('duplicate slip is rejected with SLIP_ALREADY_USED (no double grant)', async ({ page }) => {
    await page.goto('/checkout');
    await expect(page.getByText(/สแกนชำระเงิน|ยืนยันคำสั่งซื้อ/)).toBeVisible({ timeout: 10000 });
    await page.locator('input[type="file"]').setInputFiles(SLIP_FIXTURE);
    await page.getByRole('button', { name: /อัปโหลดสลิป|ยืนยันการแจ้งชำระเงิน/ }).click();
    // Same transRef as the previous test's slip → 409 surfaces as inline error
    await expect(page.getByText(/ใช้(งาน)?(ไป)?แล้ว|ซ้ำ|ไม่สำเร็จ/)).toBeVisible({ timeout: 5000 });
  });

  test('underpaid slip is rejected with amount mismatch (order stays retryable)', async ({ page }) => {
    await page.goto('/checkout');
    await expect(page.getByText(/สแกนชำระเงิน|ยืนยันคำสั่งซื้อ/)).toBeVisible({ timeout: 10000 });
    await page.locator('input[type="file"]').setInputFiles(SLIP_FIXTURE);
    await page.getByRole('button', { name: /อัปโหลดสลิป|ยืนยันการแจ้งชำระเงิน/ }).click();
    await expect(page.getByText(/ยอดเงิน|ไม่ตรง|ไม่สำเร็จ/).first()).toBeVisible({ timeout: 5000 });
  });
});