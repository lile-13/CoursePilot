export const COURSE_COLORS = [
  { key: 'indigo', label: '靛蓝' },
  { key: 'sky', label: '天蓝' },
  { key: 'teal', label: '青绿' },
  { key: 'emerald', label: '翠绿' },
  { key: 'amber', label: '琥珀' },
  { key: 'orange', label: '暖橙' },
  { key: 'rose', label: '玫红' },
  { key: 'violet', label: '紫罗兰' },
];

export const COURSE_COLOR_COUNT = COURSE_COLORS.length;

export function normalizeColorIndex(index) {
  const value = Number(index);
  if (!Number.isFinite(value)) return 0;
  return ((value % COURSE_COLOR_COUNT) + COURSE_COLOR_COUNT) % COURSE_COLOR_COUNT;
}

export function courseToneClass(index) {
  return `course-tone-${normalizeColorIndex(index)}`;
}

/** 为新课程挑选使用次数最少的配色，避免颜色重复 */
export function nextColorIndex(courses) {
  const counts = new Array(COURSE_COLOR_COUNT).fill(0);
  for (const course of courses || []) {
    counts[normalizeColorIndex(course.colorIndex)] += 1;
  }
  let best = 0;
  for (let i = 1; i < counts.length; i += 1) {
    if (counts[i] < counts[best]) best = i;
  }
  return best;
}
