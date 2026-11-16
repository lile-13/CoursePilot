import { addDays, getBeijingNow } from './time.js';
import { parseWeekText } from './weeks.js';
import { createId } from './id.js';
import { defaultSettings } from './storage.js';

function makeSession(day, start, end, location, weeksText) {
  return {
    id: createId('session'),
    day,
    start,
    end,
    location,
    weeks: parseWeekText(weeksText),
  };
}

function makeCourse(name, teacher, type, colorIndex, sessions, note = '') {
  return {
    id: createId('course'),
    name,
    teacher,
    type,
    colorIndex,
    note,
    sessions,
  };
}

export function createDemoState() {
  const today = getBeijingNow().dateStr;
  const courses = [
    makeCourse('高等数学 A', '张建国', 'theory', 0, [
      makeSession(1, 1, 2, '教1-201', '1-16周'),
      makeSession(3, 3, 4, '教1-201', '1-16周'),
    ]),
    makeCourse('大学物理', '李明', 'theory', 1, [
      makeSession(2, 1, 2, '理综楼101', '1-16周'),
      makeSession(5, 1, 2, '理综楼101', '1-16周'),
    ]),
    makeCourse('数据结构', '刘洋', 'theory', 2, [
      makeSession(4, 1, 2, '计算机楼401', '1-18周'),
      makeSession(1, 5, 6, '计算机楼401', '1-18周'),
    ]),
    makeCourse('数据结构实验', '刘洋', 'lab', 3, [
      makeSession(5, 5, 6, '计算机楼402', '3-14周(单)'),
    ]),
    makeCourse('程序设计基础', '王芳', 'theory', 4, [
      makeSession(3, 1, 2, '计算机楼305', '1-16周'),
    ]),
    makeCourse('大学英语', 'Sarah', 'theory', 5, [
      makeSession(2, 3, 4, '外语楼302', '1-16周'),
      makeSession(4, 5, 6, '外语楼302', '2-16周(双)'),
    ]),
    makeCourse('物理实验', '赵磊', 'lab', 6, [
      makeSession(3, 7, 8, '物理实验中心203', '2-16周(双)'),
    ]),
    makeCourse('体育', '陈强', 'theory', 7, [
      makeSession(5, 3, 4, '田径场', '1-16周'),
    ]),
  ];

  const courseId = (name) => courses.find((course) => course.name === name)?.id || null;

  const assignments = [
    {
      id: createId('assignment'),
      courseId: courseId('数据结构'),
      title: '实验一：顺序表与链表实现',
      notes: '提交源码与实验报告 PDF，命名格式：学号_姓名_实验一。',
      dueAt: `${addDays(today, -1)}T23:59`,
      status: 'todo',
      createdAt: new Date().toISOString(),
      doneAt: null,
    },
    {
      id: createId('assignment'),
      courseId: courseId('高等数学 A'),
      title: '习题册第三章：导数与微分',
      notes: 'P56-P60，奇数题，下节课前交。',
      dueAt: `${addDays(today, 2)}T23:59`,
      status: 'todo',
      createdAt: new Date().toISOString(),
      doneAt: null,
    },
    {
      id: createId('assignment'),
      courseId: courseId('大学英语'),
      title: 'Unit 4 写作练习',
      notes: '150 词左右的议论文，题目自拟。',
      dueAt: `${today}T22:00`,
      status: 'todo',
      createdAt: new Date().toISOString(),
      doneAt: null,
    },
    {
      id: createId('assignment'),
      courseId: courseId('物理实验'),
      title: '实验报告：惠斯通电桥测电阻',
      notes: '包含数据处理与误差分析。',
      dueAt: `${addDays(today, 5)}T23:59`,
      status: 'todo',
      createdAt: new Date().toISOString(),
      doneAt: null,
    },
    {
      id: createId('assignment'),
      courseId: courseId('程序设计基础'),
      title: '上机作业二：循环与数组',
      notes: 'OJ 平台提交，通过全部测试点。',
      dueAt: `${addDays(today, -3)}T23:59`,
      status: 'done',
      createdAt: new Date().toISOString(),
      doneAt: new Date().toISOString(),
    },
  ];

  return {
    settings: { ...defaultSettings(), semesterName: '2026-2027 学年第一学期' },
    courses,
    assignments,
  };
}
