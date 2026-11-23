export const MATERIAL_EXTENSIONS = ['doc', 'docx', 'ppt', 'pptx', 'pdf', 'png', 'jpg', 'jpeg'];

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);
const WORD_EXTENSIONS = new Set(['doc', 'docx']);
const PPT_EXTENSIONS = new Set(['ppt', 'pptx']);

export function normalizeMaterialExt(value) {
  return String(value || '').replace(/^\./, '').toLowerCase();
}

export function isMaterialExt(value) {
  return MATERIAL_EXTENSIONS.includes(normalizeMaterialExt(value));
}

export function isImageMaterial(value) {
  return IMAGE_EXTENSIONS.has(normalizeMaterialExt(value));
}

export function materialKind(value) {
  const ext = normalizeMaterialExt(value);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (WORD_EXTENSIONS.has(ext)) return 'word';
  if (PPT_EXTENSIONS.has(ext)) return 'ppt';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

export function materialBadge(value) {
  const ext = normalizeMaterialExt(value);
  if (ext === 'jpg' || ext === 'jpeg') return 'JPG';
  return ext.toUpperCase();
}

export function formatMaterialSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '0 KB';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatMaterialDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}
