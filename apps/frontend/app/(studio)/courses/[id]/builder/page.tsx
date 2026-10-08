// SSOT Phase 078 Task 5 — Course builder workspace page
// Canonical: apps/frontend/app/(studio)/courses/[id]/builder/page.tsx
'use client';

import React, { Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useCourseStudio } from '../../../../../hooks/useCourseStudio';
import { CurriculumBuilder } from '../../../../../components/studio/curriculum-builder';
import { HlsUploader } from '../../../../../components/studio/hls-uploader';
import { QuizBuilder } from '../../../../../components/studio/quiz-builder';

function BuilderInner() {
  const params = useParams<{ id: string }>();
  const query = useSearchParams();
  const slug = query.get('tenant') ?? 'default';
  const { status, error, sections, retry } = useCourseStudio(slug, params.id);
  const [lessonId, setLessonId] = useState('');

  if (status === 'STUDIO_INIT' || status === 'IDLE') return <p>กำลังโหลดโครงสร้างคอร์ส…</p>;
  if (status === 'ERROR') {
    return (
      <div>
        <p role="alert">โหลดไม่สำเร็จ: {error}</p>
        <button type="button" onClick={retry}>ลองใหม่</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Course Studio Builder</h1>
      <CurriculumBuilder slug={slug} courseId={params.id} initial={sections} />
      <h2>อัปโหลดวิดีโอ HLS</h2>
      <input placeholder="Lesson ID" value={lessonId} onChange={(e) => setLessonId(e.target.value)} />
      {lessonId && <HlsUploader slug={slug} lessonId={lessonId} />}
      <h2>Quiz Builder</h2>
      {lessonId ? <QuizBuilder slug={slug} lessonId={lessonId} /> : <p>กรอก Lesson ID เพื่อสร้างข้อสอบ</p>}
    </div>
  );
}

export default function CourseBuilderPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดโครงสร้างคอร์ส…</p>}>
      <BuilderInner />
    </Suspense>
  );
}
