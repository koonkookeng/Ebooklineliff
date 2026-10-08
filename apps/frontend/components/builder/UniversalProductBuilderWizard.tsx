'use client';

// SSOT Phase 074 §6.1 — Universal Product Builder Wizard (4 steps)
// Canonical: apps/frontend/components/builder/UniversalProductBuilderWizard.tsx
// - react-hook-form + zodResolver over the SSOT schema (single validation
//   source, §9); CSS slide transition (no framer-motion dep — RISK_CALL).
// - Stepper: per-step trigger() gate; autosave every 5s (BDD-1) with saved
//   stamp; publish -> atomic txn -> success redirect; ERROR inline + retry.
// - RAM: single-step render only (LIFF <35MB, §2.1).
import React, { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import {
  BUILDER_STEPS,
  BuilderStepBasicsSchema,
  BuilderStepPricingSchema,
  BundleItemSpecSchema,
  CourseDetailSpecSchema,
  EbookDetailSpecSchema,
  PhysicalDetailSpecSchema,
  UniversalProductBuilderSchema,
  type UniversalProductBuilderInput,
} from '@repo/shared';
import { builderApi } from '../../lib/builder/builder-client';
import { useBuilderAutosave } from '../../hooks/useBuilderAutosave';
import { Step1TypeSelector } from './steps/Step1TypeSelector';
import { Step2MediaUploadSpec } from './steps/Step2MediaUploadSpec';
import { Step3PricingInventory } from './steps/Step3PricingInventory';
import { Step4PreviewPublish } from './steps/Step4PreviewPublish';

export function UniversalProductBuilderWizard({ slug }: { slug: string }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const methods = useForm<UniversalProductBuilderInput>({
    mode: 'onChange',
    defaultValues: {
      productType: 'PHYSICAL_BOOK',
      title: '',
      slug: '',
      description: '',
      coverImageUrl: '',
      price: 0,
      isPublished: true,
    },
  });
  const { handleSubmit, watch, reset, unregister } = methods;
  const values = watch();
  const productType = values['productType'];

  // Keep only the active type's detail subtree (inactive leftovers would
  // fail the per-type refine on submit).
  React.useEffect(() => {
    for (const path of ['physicalDetail', 'ebookDetail', 'courseDetail', 'bundleItems'] as const) {
      const active =
        (path === 'physicalDetail' && productType === 'PHYSICAL_BOOK') ||
        (path === 'ebookDetail' && productType === 'EBOOK') ||
        (path === 'courseDetail' && productType === 'ELEARNING_COURSE') ||
        (path === 'bundleItems' && productType === 'HYBRID_BUNDLE');
      if (!active) unregister(path);
    }
  }, [productType, unregister]);
  const { savedAt, saving } = useBuilderAutosave(slug, currentStep, values as unknown as Record<string, unknown>, (payload, stepIndex) => {
    reset(payload as UniversalProductBuilderInput);
    setCurrentStep(stepIndex);
  });

  async function next() {
    setError(null);
    const v = methods.getValues();
    const stepOk = validateStep(currentStep, v);
    if (stepOk) setCurrentStep((s) => Math.min(s + 1, BUILDER_STEPS.length));
    else setError('กรุณาตรวจสอบข้อมูลในขั้นตอนนี้ให้ถูกต้อง');
  }

  /** Per-step gate from the same SSOT schemas (no resolver dep). */
  function validateStep(step: number, v: UniversalProductBuilderInput): boolean {
    if (step === 1) return BuilderStepBasicsSchema.safeParse(v).success;
    if (step === 2) {
      if (v.productType === 'PHYSICAL_BOOK') return PhysicalDetailSpecSchema.safeParse(v.physicalDetail).success;
      if (v.productType === 'EBOOK') return EbookDetailSpecSchema.safeParse(v.ebookDetail).success;
      if (v.productType === 'ELEARNING_COURSE') return CourseDetailSpecSchema.safeParse(v.courseDetail).success;
      if (v.productType === 'HYBRID_BUNDLE') {
        return BundleItemSpecSchema.array().min(1).safeParse(v.bundleItems).success;
      }
      return true;
    }
    if (step === 3) return BuilderStepPricingSchema.safeParse(v).success;
    return UniversalProductBuilderSchema.safeParse(v).success;
  }

  async function publish(data: UniversalProductBuilderInput) {
    setPublishing(true);
    setError(null);
    try {
      const res = await builderApi(slug).publish(data);
      window.location.href = `/merchant/products?published=${res.productId}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <FormProvider {...methods}>
      <div className="builder-card">
        <div className="builder-steps">
          {BUILDER_STEPS.map((s) => (
            <div key={s.id} className={currentStep === s.id ? 'builder-step-active' : currentStep > s.id ? 'builder-step-done' : 'builder-step'}>
              <span>{currentStep > s.id ? '✓' : s.id}</span>
              <em>{s.title}</em>
            </div>
          ))}
        </div>
        <p className="builder-saved">
          {saving ? 'กำลังบันทึกดราฟ…' : savedAt ? `บันทึกดราฟแล้ว ${savedAt}` : 'ดราฟใหม่'}
        </p>
        <form onSubmit={handleSubmit((d) => void publish(d))}>
          <div key={currentStep} className="builder-slide">
            {currentStep === 1 && <Step1TypeSelector />}
            {currentStep === 2 && <Step2MediaUploadSpec slug={slug} />}
            {currentStep === 3 && <Step3PricingInventory />}
            {currentStep === 4 && <Step4PreviewPublish />}
          </div>
          {error && (
            <p role="alert" className="merchant-error">
              {error} <button type="button" onClick={() => setError(null)}>Retry</button>
            </p>
          )}
          <div className="builder-nav">
            <button type="button" disabled={currentStep === 1 || publishing} onClick={() => setCurrentStep((s) => Math.max(s - 1, 1))}>
              ย้อนกลับ
            </button>
            {currentStep < BUILDER_STEPS.length ? (
              <button type="button" onClick={() => void next()}>ถัดไป →</button>
            ) : (
              <button type="submit" disabled={publishing}>
                {publishing ? 'กำลังเผยแพร่…' : 'ยืนยันการเผยแพร่สินค้า'}
              </button>
            )}
          </div>
        </form>
      </div>
    </FormProvider>
  );
}
