import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createEmptyState, normalizeState, normalizeStateForImport } from '../src/lib/storage.js';
const {
  copyMaterialFiles,
  deleteCourseMaterials,
  deleteMaterialFile,
  materialCourseFolder,
  readImageDataUrl,
  resolveStoredMaterial,
} = createRequire(import.meta.url)('../electron/materials.cjs');
const { openDatabase } = createRequire(import.meta.url)('../electron/database.cjs');

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'coursepilot-materials-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function sourceFiles(dir) {
  const files = {
    docx: join(dir, '第一讲 课件.docx'),
    pptx: join(dir, '演示.PPTX'),
    pdf: join(dir, '复习资料.pdf'),
    image: join(dir, '课堂板书.png'),
    invalid: join(dir, '说明.txt'),
  };
  writeFileSync(files.docx, 'docx-content');
  writeFileSync(files.pptx, 'pptx-content');
  writeFileSync(files.pdf, 'pdf-content');
  writeFileSync(files.image, 'png-content');
  writeFileSync(files.invalid, 'not-allowed');
  return files;
}

test('复制课件到当前用户目录，保留原文件名并拒绝不支持的格式', (t) => {
  const userDir = temporary(t);
  const sourceDir = temporary(t);
  const files = sourceFiles(sourceDir);
  const result = copyMaterialFiles({
    filePaths: [files.docx, files.pptx, files.pdf, files.image, files.invalid],
    courseId: 'course-1',
    userDir,
  });
  assert.equal(result.items.length, 4);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /说明\.txt/);
  assert.deepEqual(
    result.items.map((item) => item.originalName),
    ['第一讲 课件.docx', '演示.PPTX', '复习资料.pdf', '课堂板书.png']
  );
  for (const item of result.items) {
    assert.equal(item.courseId, 'course-1');
    assert.equal(item.storedPath.startsWith('materials/'), true);
    const fullPath = resolveStoredMaterial(userDir, item.storedPath);
    assert.equal(existsSync(fullPath), true);
    assert.equal(readFileSync(fullPath, 'utf8'), `${item.ext}-content`);
  }
  assert.equal(result.items.find((item) => item.ext === 'pptx').mime.includes('presentation'), true);
});

test('课件路径被限制在当前用户的 materials 目录内', (t) => {
  const userDir = temporary(t);
  for (const value of ['../coursepilot.db', 'materials/../coursepilot.db', 'C:\\Windows\\win.ini', '/etc/passwd']) {
    assert.throws(() => resolveStoredMaterial(userDir, value), /课件路径无效/);
  }
});

test('图片可以生成预览 Data URL，删除后清理空课程目录', (t) => {
  const userDir = temporary(t);
  const sourceDir = temporary(t);
  const files = sourceFiles(sourceDir);
  const result = copyMaterialFiles({ filePaths: [files.image], courseId: 'course-2', userDir });
  const item = result.items[0];
  const preview = readImageDataUrl(userDir, item.storedPath);
  assert.equal(preview.dataUrl.startsWith('data:image/png;base64,'), true);
  const folder = join(userDir, 'materials', materialCourseFolder('course-2'));
  assert.equal(existsSync(folder), true);
  deleteMaterialFile(userDir, item.storedPath);
  assert.equal(existsSync(resolveStoredMaterial(userDir, item.storedPath)), false);
  assert.equal(existsSync(folder), false);
});

test('按课程删除全部课件文件', (t) => {
  const userDir = temporary(t);
  const sourceDir = temporary(t);
  const files = sourceFiles(sourceDir);
  copyMaterialFiles({ filePaths: [files.docx, files.pdf], courseId: 'course-3', userDir });
  const folder = join(userDir, 'materials', materialCourseFolder('course-3'));
  assert.equal(existsSync(folder), true);
  deleteCourseMaterials(userDir, 'course-3');
  assert.equal(existsSync(folder), false);
});

test('课件记录进入 SQLite，重启读取保留，删除课程时级联清理', (t) => {
  const dir = temporary(t);
  const state = normalizeState({
    ...createEmptyState(),
    courses: [{ id: 'c1', name: '课件测试课', sessions: [] }],
    materials: [{
      id: 'm1',
      courseId: 'c1',
      originalName: '讲义.pdf',
      storedPath: 'materials/abc/def.pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      size: 1234,
      addedAt: '2026-11-19T10:00:00.000Z',
    }],
  });
  const db = openDatabase(dir);
  const first = db.initialize({ initialState: state });
  assert.deepEqual(first.state.materials, state.materials);
  db.close();
  const reopened = openDatabase(dir);
  assert.deepEqual(reopened.read().state.materials, state.materials);
  const removed = { ...reopened.read().state, courses: [], materials: [], assignments: [] };
  reopened.save(removed, reopened.read().revision);
  assert.deepEqual(reopened.read().state.materials, []);
  reopened.close();
});

test('无效课件路径、格式和悬空课程关联会被拒绝', () => {
  const base = {
    ...createEmptyState(),
    courses: [{ id: 'c1', name: '课程', sessions: [] }],
  };
  const badPath = {
    ...base,
    materials: [{
      id: 'm1', courseId: 'c1', originalName: 'a.pdf', storedPath: '../outside.pdf',
      ext: 'pdf', mime: 'application/pdf', size: 1, addedAt: '2026-11-19T10:00:00.000Z',
    }],
  };
  assert.throws(() => normalizeStateForImport(badPath), /无效的课件路径/);
  assert.throws(() => normalizeStateForImport({ ...base, materials: [{
    id: 'm1', courseId: 'missing', originalName: 'a.pdf', storedPath: 'materials/a.pdf',
    ext: 'pdf', mime: 'application/pdf', size: 1, addedAt: '2026-11-19T10:00:00.000Z',
  }] }), /课程不存在/);
});
