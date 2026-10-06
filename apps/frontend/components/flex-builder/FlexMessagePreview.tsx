// SSOT Phase 024 §6.1 — Flex message live preview (pixel-approximate, zero-dep)
// Canonical: apps/frontend/components/flex-builder/FlexMessagePreview.tsx
// (legacy src/frontend/components/flex-builder/FlexMessagePreview.tsx)
// - Strict-safe {{var}} interpolation (escaped keys, primitive-only values).
// - Unknown/missing keys left intact (preview-safe); malformed template → fallback card.
// - Images render only https R2 URLs (zero-egress rule surfaced visually).
'use client';

import React, { useMemo } from 'react';

interface FlexMessagePreviewProps {
  templateJson: Record<string, unknown>;
  sampleData: Record<string, string>;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asText(node: unknown): string {
  return typeof node === 'string' ? node : '';
}

function asRecord(node: unknown): Record<string, unknown> {
  return node && typeof node === 'object' && !Array.isArray(node)
    ? (node as Record<string, unknown>)
    : {};
}

function compileTemplate(
  templateJson: Record<string, unknown>,
  sampleData: Record<string, string>,
): Record<string, unknown> | null {
  try {
    let raw = JSON.stringify(templateJson);
    for (const [key, val] of Object.entries(sampleData)) {
      raw = raw.replace(new RegExp(`\\{\\{${escapeRegExp(key)}\\}\\}`, 'g'), val);
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const FlexMessagePreview: React.FC<FlexMessagePreviewProps> = ({ templateJson, sampleData }) => {
  const compiled = useMemo(() => compileTemplate(templateJson, sampleData), [templateJson, sampleData]);

  if (!compiled) {
    return (
      <div className="flex flex-col items-center p-4 bg-slate-900 rounded-xl border border-slate-800">
        <div className="text-xs text-red-400 font-mono">Invalid Flex template JSON</div>
      </div>
    );
  }

  const header = asRecord(compiled.header);
  const hero = asRecord(compiled.hero);
  const body = asRecord(compiled.body);
  const footer = asRecord(compiled.footer);
  const heroUrl = asText(hero.url);
  const showHero = heroUrl.startsWith('https://');
  const buttonUrl = asText(footer.buttonUrl);
  const buttonLabel = asText(footer.buttonLabel) || 'ดูรายละเอียด';

  return (
    <div className="flex flex-col items-center p-4 bg-slate-900 rounded-xl border border-slate-800">
      <div className="text-xs text-slate-400 mb-2 font-mono">LINE Flex Preview Engine (Zero-Fee Template)</div>
      <div className="w-[300px] bg-[#84A4C8] p-3 rounded-2xl shadow-2xl">
        <div className="bg-white rounded-xl overflow-hidden text-slate-900 text-sm shadow-sm">
          {showHero && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={heroUrl} alt="" className="w-full h-32 object-cover" loading="lazy" />
          )}
          <div className="p-4">
            <h4 className="font-bold text-base border-b pb-2 mb-2">{asText(header.text) || 'Notification'}</h4>
            <p className="text-xs text-slate-600 mb-4">{asText(body.text)}</p>
            {buttonUrl && (
              <a
                href={buttonUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-center w-full py-2 bg-emerald-600 text-white rounded-lg font-semibold text-xs hover:bg-emerald-500 transition-all"
              >
                {buttonLabel}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FlexMessagePreview;
