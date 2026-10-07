// SSOT Phase 037 Task 5 — Catalog structure REST controller (TOC/curriculum)
// Canonical: apps/backend/src/modules/catalog/controllers/catalog-structure.controller.ts
// (legacy src/backend/modules/catalog/controllers/catalog-structure.controller.ts)
// - GET  /api/v1/catalog/structure/ebook?productId= — public TOC (logged-out
//   PDP/discovery reads the same lightweight tree, Gate 5).
// - GET  /api/v1/catalog/structure/course?productId= — public curriculum.
// - POST /api/v1/catalog/structure/chapters + /lessons — JWT-guarded creator
//   writes (ordering server-assigned); PUT /lessons/reorder — atomic.
// - Zero new deps.
import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { EbookStructureService } from '../services/ebook-structure.service';
import { CourseStructureService } from '../services/course-structure.service';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';

@Controller('api/v1/catalog/structure')
export class CatalogStructureController {
  constructor(
    private readonly ebooks: EbookStructureService,
    private readonly courses: CourseStructureService,
  ) {}

  @Get('ebook')
  toc(@Query('productId') productId: string | undefined) {
    return this.ebooks.tocByProduct(productId ?? '');
  }

  @Get('course')
  curriculum(@Query('productId') productId: string | undefined) {
    return this.courses.curriculumByProduct(productId ?? '');
  }

  @Post('chapters')
  @UseGuards(JwtAuthGuard)
  createChapter(@Body() body: unknown) {
    return this.ebooks.createChapter(body);
  }

  @Post('lessons')
  @UseGuards(JwtAuthGuard)
  createLesson(@Body() body: unknown) {
    return this.courses.createLesson(body);
  }

  @Put('lessons/reorder')
  @UseGuards(JwtAuthGuard)
  reorder(@Query('sectionId') sectionId: string | undefined, @Body() body: unknown) {
    return this.courses.reorderLessons(sectionId ?? '', (body as { orders?: unknown })?.orders ?? body);
  }
}
