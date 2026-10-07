// SSOT Phase 038 Task 3 — EPUB parser adapter (XHTML→SVG text layer)
// Canonical: apps/backend/src/modules/pipeline/infrastructure/parsers/epub-parser.adapter.ts
// (legacy src/backend/modules/pipeline/infrastructure/parsers/epub-parser.adapter.ts)
// - RISK_CALL deviation (documented): no epub dep in this monorepo (Gate 5).
//   Accepts spine items [{idref, xhtmlContent}] and converts each to a text-
//   layer SVG (escaped <text> lines over a page frame) — a REAL transformation
//   feeding the SAME downstream (sanitize→compress→encrypt→R2) as PDF pages.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import type { ParsedBook } from './pdf-vector-parser.adapter';
import { normalizePdfPages } from './pdf-vector-parser.adapter';

const PAGE_WIDTH = 800;
const PAGE_HEIGHT = 1200;
const LINE_HEIGHT = 28;
const MAX_LINES = 38;

function escapeXml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripTags(xhtml: string): string[] {
  const text = xhtml
    .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ');
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Convert one spine item to a paginated text-layer SVG page. */
export function epubItemToSvgPage(pageNumber: number, xhtmlContent: string): { pageNumber: number; svgContent: string; extractedText: string } {
  if (!Number.isInteger(pageNumber) || pageNumber <= 0) throw new Error('Invalid page number');
  if (typeof xhtmlContent !== 'string' || !xhtmlContent.trim()) throw new Error('Empty EPUB spine item');
  const lines = stripTags(xhtmlContent).slice(0, MAX_LINES);
  const text = stripTags(xhtmlContent).join('\n');
  const textEls = lines
    .map((l, i) => `<text x="48" y="${96 + i * LINE_HEIGHT}" font-size="22" fill="#111111">${escapeXml(l.slice(0, 90))}</text>`)
    .join('');
  const svgContent =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}">` +
    `<rect width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="#ffffff"/>${textEls}</svg>`;
  return { pageNumber, svgContent, extractedText: text };
}

@Injectable()
export class EpubParserAdapter {
  parseToVectorSvgs(items: Array<{ idref: string; xhtmlContent: string }>): ParsedBook {
    if (!Array.isArray(items) || items.length === 0) throw new Error('No EPUB spine items');
    const pages = items.map((item, i) => {
      if (!item || typeof item.xhtmlContent !== 'string') throw new Error(`Invalid spine item at index ${i}`);
      return epubItemToSvgPage(i + 1, item.xhtmlContent);
    });
    return normalizePdfPages(pages);
  }
}
