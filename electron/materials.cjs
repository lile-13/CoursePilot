const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_MATERIAL_BYTES = 200 * 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 20 * 1024 * 1024;

const MATERIAL_MIME = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

const MATERIAL_EXTENSIONS = new Set(Object.keys(MATERIAL_MIME));
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);

function normalizeExtension(value) {
  return String(value || '').replace(/^\./, '').toLowerCase();
}

function isMaterialExtension(ext) {
  return MATERIAL_EXTENSIONS.has(normalizeExtension(ext));
}

function isImageExtension(ext) {
  return IMAGE_EXTENSIONS.has(normalizeExtension(ext));
}

function materialCourseFolder(courseId) {
  return crypto.createHash('sha1').update(String(courseId)).digest('hex').slice(0, 24);
}

function materialsRoot(userDir) {
  return path.join(userDir, 'materials');
}

function resolveStoredMaterial(userDir, storedPath) {
  if (typeof storedPath !== 'string' || !storedPath.trim() || storedPath.includes('\0')) {
    throw new Error('课件路径无效');
  }
  if (path.isAbsolute(storedPath) || storedPath.split(/[\\/]/).includes('..')) {
    throw new Error('课件路径无效');
  }
  const root = materialsRoot(userDir);
  const full = path.resolve(userDir, storedPath);
  const safeRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!full.startsWith(safeRoot)) throw new Error('课件路径无效');
  return full;
}

function copyMaterialFiles({ filePaths, courseId, userDir }) {
  const items = [];
  const errors = [];
  if (!Array.isArray(filePaths) || filePaths.length === 0) return { items, errors };
  if (typeof courseId !== 'string' || !courseId.trim()) throw new Error('课程无效');

  const folder = materialCourseFolder(courseId);
  const targetDir = path.join(materialsRoot(userDir), folder);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const sourcePath of filePaths) {
    const originalName = path.basename(String(sourcePath || ''));
    try {
      if (typeof sourcePath !== 'string' || !sourcePath.trim()) throw new Error('文件路径无效');
      const ext = normalizeExtension(path.extname(sourcePath));
      if (!isMaterialExtension(ext)) throw new Error(`不支持的文件格式：${ext || '未知'}`);
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) throw new Error('不是文件');
      if (stat.size > MAX_MATERIAL_BYTES) throw new Error('文件超过 200 MB');
      const storedName = `${crypto.randomUUID()}.${ext}`;
      fs.copyFileSync(sourcePath, path.join(targetDir, storedName));
      items.push({
        id: crypto.randomUUID(),
        courseId,
        originalName,
        storedPath: path.posix.join('materials', folder, storedName),
        ext,
        mime: MATERIAL_MIME[ext],
        size: stat.size,
        addedAt: new Date().toISOString(),
      });
    } catch (error) {
      errors.push(`${originalName || '文件'}：${error.message}`);
    }
  }
  return { items, errors };
}

function readImageDataUrl(userDir, storedPath) {
  const fullPath = resolveStoredMaterial(userDir, storedPath);
  const ext = normalizeExtension(path.extname(fullPath));
  if (!isImageExtension(ext)) throw new Error('该课件不是图片');
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) throw new Error('课件文件不存在');
  if (stat.size > MAX_IMAGE_PREVIEW_BYTES) throw new Error('图片超过 20 MB，无法在软件内预览');
  const data = fs.readFileSync(fullPath);
  return {
    dataUrl: `data:${MATERIAL_MIME[ext]};base64,${data.toString('base64')}`,
    mime: MATERIAL_MIME[ext],
    size: stat.size,
  };
}

function deleteMaterialFile(userDir, storedPath) {
  const fullPath = resolveStoredMaterial(userDir, storedPath);
  fs.rmSync(fullPath, { force: true });
  try {
    const parent = path.dirname(fullPath);
    const root = materialsRoot(userDir);
    if (parent !== root && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
  } catch {
    // Removing an empty folder is best effort.
  }
  return true;
}

function deleteCourseMaterials(userDir, courseId) {
  if (typeof courseId !== 'string' || !courseId.trim()) throw new Error('课程无效');
  const folder = path.join(materialsRoot(userDir), materialCourseFolder(courseId));
  fs.rmSync(folder, { recursive: true, force: true });
  return true;
}

module.exports = {
  MAX_MATERIAL_BYTES,
  MAX_IMAGE_PREVIEW_BYTES,
  MATERIAL_EXTENSIONS,
  MATERIAL_MIME,
  isMaterialExtension,
  isImageExtension,
  materialCourseFolder,
  resolveStoredMaterial,
  copyMaterialFiles,
  readImageDataUrl,
  deleteMaterialFile,
  deleteCourseMaterials,
};
