import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { parseWeekText, isWeekActive } from '../src/lib/weeks.js';

const card = ({ title, code, lines = [], span, start }) => `
  <div class="kbappTimetableCourseRenderCourseItem___MgPtp" data-scales-span="${span}" data-test-start="${start}">
    <div class="courseItemInfoTextWrapper">
      <div class="title___3o2RH">${title}</div>
      <span class="courseCode___DrIml">${code}</span>
    </div>
    ${lines
      .map(
        (line) =>
          `<div class="courseItemInfoTextWrapper"><div class="kbappTimetableCourseRenderCourseItemInfoText___2Zmwu">${line}</div></div>`
      )
      .join('')}
    <div class="tags___1clP_"></div>
  </div>`;

const richCard = card({
  title: '软件2501-03',
  code: 'A0801040040',
  start: 1,
  span: 2,
  lines: [
    '计算机组成原理 A112584',
    '5-8周姜琳颖  浑南校区 1号A303 ',
    '4周姜琳颖  浑南校区 1号A105 ',
    '考试 / 百分制',
  ],
});

const pythonCard = card({
  title: '软件2502-01',
  code: 'A0806151010',
  start: 5,
  span: 2,
  lines: ['Python编程与数据分析基础 A112647', '1-4周姜琳颖  浑南校区 1号A401'],
});

const labCard = card({
  title: '[实]Python编程与数据分析基础-使用scikit-learn构建模型',
  code: 'A0806151010-A0806151010-004',
  start: 1,
  span: 4,
});

const chemCard = card({
  title: '化学实验',
  code: 'ZZZ9999',
  start: 7,
  span: 2,
});

const dayColumns = [
  ['星期日', []],
  ['星期一', [richCard, pythonCard]],
  ['星期二', [chemCard]],
  ['星期三', []],
  ['星期四', []],
  ['星期五', [labCard]],
  ['星期六', []],
];

const html = `<!doctype html>
<html lang="zh-CN">
<head><title>我的课表 - 东北大学</title></head>
<body>
  <div id="weekIndicator">第12周</div>
  <div id="termIndicator">2026-2027学年秋季学期</div>
  <div class="schoolTable___2pFP9">
    <div class="header___1nzOM">
      <div class="weekFirst___vbYQn"></div>
      ${dayColumns.map(([label]) => `<div class="week___1g40K">${label}</div>`).join('')}
    </div>
    <div class="tableBox___3Bh_3">
      <div class="sections___3kLoj">
        ${Array.from({ length: 12 }, (_, index) => `<div class="section___31jjb"><div class="sectionName___E7hhT">第${index + 1}节</div></div>`).join('')}
      </div>
      <div class="kbappTimetableContentContainer___1Uhus">
        ${dayColumns
          .map(([, cards]) => `<div class="kbappTimetableDayColumnRoot___1DlDV">${cards.join('')}</div>`)
          .join('')}
      </div>
    </div>
  </div>
</body>
</html>`;

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  url: 'https://jwxt.neu.edu.cn/',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
  configurable: true,
  get() {
    return this.textContent;
  },
  set(value) {
    this.textContent = value;
  },
});

const defaultRect = {
  top: 0,
  left: 0,
  right: 10,
  bottom: 10,
  width: 10,
  height: 10,
  x: 0,
  y: 0,
};
window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return this.__rect || defaultRect;
};

const setRect = (element, top, height, width = 100, left = 0) => {
  element.__rect = {
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
  };
};

setRect(document.querySelector('.schoolTable___2pFP9'), 0, 900, 1000);
document.querySelectorAll('.week___1g40K').forEach((element, index) => {
  setRect(element, 150, 50, 100, index * 100);
});
document.querySelectorAll('.section___31jjb').forEach((element, index) => {
  setRect(element, 200 + index * 50, 50, 80);
});
document.querySelectorAll('.kbappTimetableDayColumnRoot___1DlDV').forEach((element, index) => {
  setRect(element, 200, 600, 100, index * 100);
});
document.querySelectorAll('[data-test-start]').forEach((element) => {
  const start = Number(element.dataset.testStart);
  setRect(element, 200 + (start - 1) * 50, Number(element.dataset.scalesSpan) * 50);
});

const messages = [];
const fakeOpener = {
  closed: false,
  postMessage(payload) {
    messages.push(payload);
  },
};
Object.defineProperty(window, 'opener', { configurable: true, value: fakeOpener });
// 明确模拟接口不可用和剪贴板兜底，避免把测试环境缺少API误写成产品错误。
window.fetch = async () => { throw new Error('测试：接口不可用，走DOM回退'); };
document.execCommand = (command) => command === 'copy';
const fallbackWarnings = [];
window.console = { ...console, warn: (...args) => fallbackWarnings.push(args) };

window.eval(fs.readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8'));

await new Promise((resolve) => setTimeout(resolve, 100));
let button = document.querySelector('#cpx-neu-widget .cpx-btn');
if (!button) {
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  button = document.querySelector('#cpx-neu-widget .cpx-btn');
}
assert.ok(button, '未注入导入按钮');

button.click();
await new Promise((resolve) => setTimeout(resolve, 150));

assert.equal(messages.length, 1, `期望 1 条回传消息，实际 ${messages.length} 条`);
const payload = messages[0];
assert.equal(payload.type, 'COURSEPILOT_SCHEDULE');
assert.equal(payload.version, 2);
assert.equal(payload.currentWeek, 12);

const sessions = payload.sessions;
assert.equal(sessions.length, 5, `期望 5 个时段，实际：${JSON.stringify(sessions, null, 2)}`);

const comp = sessions.filter((session) => session.name === '计算机组成原理');
assert.equal(comp.length, 2);
assert.deepEqual([...comp].map((session) => session.weeksText).sort(), ['4周', '5-8周']);
assert.ok(comp.every((session) => session.teacher === '姜琳颖'));
assert.ok(comp.every((session) => session.day === 1 && session.start === 1 && session.end === 2));
assert.ok(comp.some((session) => session.location.includes('A303')));
assert.ok(comp.some((session) => session.location.includes('A105')));

const python = sessions.find((session) => session.name === 'Python编程与数据分析基础');
assert.ok(python);
assert.equal(python.day, 1);
assert.equal(python.start, 5);
assert.equal(python.end, 6);
assert.equal(python.weeksText, '1-4周');

const lab = sessions.find((session) => session.name.includes('scikit-learn'));
assert.ok(lab);
assert.equal(lab.type, 'lab');
assert.equal(lab.day, 5);
assert.equal(lab.start, 1);
assert.equal(lab.end, 4);
assert.equal(lab.teacher, '', '不能借用理论课教师');
assert.equal(lab.location, '', '不能借用理论课教室');
assert.equal(lab.weeksText, '', '不能借用理论课周次');

const chem = sessions.find((session) => session.name === '化学实验');
assert.ok(chem);
assert.equal(chem.day, 2);
assert.equal(chem.start, 7);
assert.equal(chem.end, 8);
assert.equal(chem.weeksText, '');
assert.equal(chem.teacher, '');
assert.ok(payload.warnings.some((warning) => warning.includes('未显示周次')));

// 模拟“学期课表”没有星期文字表头的情况：仍应通过列坐标确定星期
await new Promise((resolve) => setTimeout(resolve, 1000));
document.querySelectorAll('.week___1g40K').forEach((element) => element.remove());
button.click();
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(messages.length, 2, '无表头时也应产生回传消息');
const fallbackPayload = messages[1];
assert.equal(fallbackPayload.sessions.length, 5);
const fallbackComp = fallbackPayload.sessions.filter(
  (session) => session.name === '计算机组成原理'
);
assert.ok(fallbackComp.length === 2);
assert.ok(fallbackComp.every((session) => session.day === 1));
assert.ok(
  fallbackPayload.sessions.some(
    (session) => session.name.includes('scikit-learn') && session.day === 5
  )
);

// 实验课自己的关联详情可包含与理论课完全不同的周次、教师、教室。
await new Promise((resolve) => setTimeout(resolve, 1000));
const labElement = document.querySelector('[class*="TimetableDayColumnRoot"]:nth-child(6) [data-test-start]');
labElement.setAttribute('aria-describedby', 'synthetic-lab-details');
const tooltip = document.createElement('div');
tooltip.id = 'synthetic-lab-details';
tooltip.innerHTML = '<div class="kbappTimetableCourseRenderCourseItemInfoPopperInfo">11周示例教师  示例校区 虚构实验室B301</div>';
document.body.appendChild(tooltip);
button.click();
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(messages.length, 3);
const ownLab = messages[2].sessions.find((item) => item.name.includes('scikit-learn'));
assert.equal(ownLab.weeksText, '11周');
assert.equal(ownLab.teacher, '示例教师');
assert.match(ownLab.location, /虚构实验室B301/);

// 接口优先：模拟教务接口返回整学期结构化数据
await new Promise((resolve) => setTimeout(resolve, 1000));
const apiFixture = {
  code: '0',
  datas: {
    arrangedList: [
      {
        courseName: '马克思主义基本原理',
        courseCode: 'A3505000018',
        courseSerialNo: 'A116441',
        dayOfWeek: 3,
        beginSection: 7,
        endSection: 8,
        beginTime: '16:00',
        endTime: '17:40',
        campusName: '浑南校区',
        placeName: '1号A407',
        weeksAndTeachers: '1-2周,4周[理论]/张晓红[主讲]',
        titleDetail: [
          '软件2501-03,软特2501-02',
          '马克思主义基本原理 A116441',
          '1-2周,4周 张晓红 浑南校区 1号A407',
          '考试 / 百分制',
        ],
      },
      {
        courseName: '计算机组成原理',
        dayOfWeek: 1,
        beginSection: 1,
        endSection: 2,
        campusName: '浑南校区',
        placeName: '1号A303',
        weeksAndTeachers: '5-8周[理论]/姜琳颖[主讲]',
        titleDetail: [
          '示例班级001', '计算机组成原理 A123456',
          '5-8周 示例教师 示例校区 示例A303',
          '4周 示例教师 示例校区 示例A105',
          '10-13周 示例教师 示例校区 示例A302',
          '1-3周 示例教师 示例校区 示例A107',
        ],
      },
      {
        courseName: '概率论与数理统计', dayOfWeek: 1, beginSection: 3, endSection: 4,
        campusName: '示例校区', placeName: '示例A105',
        weeksAndTeachers: '1-2周[理论]/示例教师[主讲]',
        titleDetail: [
          '概率论与数理统计 A654321',
          '1-2周 示例教师 示例校区 示例A105',
          '8周,13-16周 示例教师 示例校区 示例A303',
          '9周 示例教师 示例校区 示例B201',
          '3-7周,10-12周 示例教师 示例校区 示例A227',
        ],
      },
      {
        courseName: '计算机组成原理', dayOfWeek: 3, beginSection: 1, endSection: 2,
        campusName: '示例校区', placeName: '线上',
        weeksAndTeachers: '4-6周(双),11周[理论]/示例教师[主讲]',
        titleDetail: [
          '4-6周(双),11周 示例教师 示例校区 线上',
          '1-3周,5周,7-8周,10周,12-13周 示例教师 示例校区 示例A404',
        ],
      },
      {
        courseName: '概率论与数理统计', dayOfWeek: 5, beginSection: 1, endSection: 2,
        campusName: '示例校区', placeName: '示例A105',
        weeksAndTeachers: '1-8周,10-13周[理论]/示例教师[主讲]',
      },
      {
        courseName: '[实]计算机组成原理-微结构', dayOfWeek: 3, beginSection: 9, endSection: 12,
        campusName: '示例校区', placeName: '虚构实验室A407',
        weeksAndTeachers: '12-13周[实验]/示例教师[主讲]',
      },
    ],
  },
};

const sectionTimes = ['08:30', '09:25', '10:30', '11:25', '14:00', '14:55', '16:00', '16:55', '18:30', '19:25', '20:20', '21:15'];
const sectionEnds = ['09:15', '10:10', '11:15', '12:10', '14:45', '15:40', '16:45', '17:40', '19:15', '20:10', '21:05', '22:00'];
const sectionFixture = {
  code: '0',
  datas: [
    ...Array.from({ length: 12 }, (_, index) => ({
      id: String(index + 1),
      campusName: '南湖校区',
      sectionName: `第${index + 1}节`,
      startTime: '08:00',
      endTime: '08:45',
    })),
    ...Array.from({ length: 12 }, (_, index) => ({
      id: String(index + 1),
      campusName: '浑南校区',
      sectionName: `第${index + 1}节`,
      startTime: sectionTimes[index],
      endTime: sectionEnds[index],
    })),
  ],
};

let apiRequests = [];
window.fetch = async (url, options) => {
  const requestUrl = String(url);
  apiRequests.push({ url: requestUrl, options });
  if (requestUrl.includes('querySectionInfo.do')) {
    return { ok: true, json: async () => sectionFixture };
  }
  return { ok: true, json: async () => apiFixture };
};

button.click();
await new Promise((resolve) => setTimeout(resolve, 400));
assert.equal(messages.length, 4, '接口路径也应产生回传消息');
const apiPayload = messages[3];
assert.equal(apiPayload.parserName, '东北大学教务接口');
const scheduleRequest = apiRequests.find((item) =>
  item.url.includes('/jwapp/sys/homeapp/api/home/student/getMyScheduleDetail.do')
);
assert.ok(scheduleRequest);
assert.ok(String(scheduleRequest.options.body).includes('termCode=2026-2027-1'));
assert.ok(apiRequests.some((item) => item.url.includes('querySectionInfo.do')));
assert.equal(apiPayload.sessions.length, 13, '同一课程的每组周次与教室均需展开');
assert.equal(apiPayload.sectionTimes.length, 12);
assert.equal(apiPayload.sectionTimes[0].start, '08:30');
assert.equal(apiPayload.sectionTimes[0].end, '09:15');

const marx = apiPayload.sessions.find((session) => session.name === '马克思主义基本原理');
assert.ok(marx);
assert.equal(marx.day, 3);
assert.equal(marx.start, 7);
assert.equal(marx.end, 8);
assert.equal(marx.teacher, '张晓红');
assert.equal(marx.location, '浑南校区 1号A407');
assert.equal(marx.weeksText, '1-2周,4周');

const compApi = apiPayload.sessions.find((session) => session.name === '计算机组成原理');
assert.ok(compApi);
assert.equal(compApi.day, 1);
assert.equal(compApi.teacher, '示例教师');
assert.ok(apiPayload.sessions.some((item) => item.name === '计算机组成原理' && item.weeksText === '10-13周' && item.location.includes('示例A302')));
const probabilityApi = apiPayload.sessions.filter((item) => item.name === '概率论与数理统计' && item.day === 1);
assert.equal(probabilityApi.length, 4);
assert.ok(probabilityApi.every((item) => item.day === 1 && item.start === 3 && item.end === 4));
assert.ok(probabilityApi.some((item) => item.weeksText === '3-7周,10-12周' && item.location.includes('示例A227')));

// 对照用户提供的第12周截图，核对最终周次过滤，而非只检查原始解析字段。
const actualWeek12 = Array.from(apiPayload.sessions).filter((item) =>
  /计算机组成原理|概率论与数理统计/.test(item.name) && isWeekActive(parseWeekText(item.weeksText), 12)
).map((item) => ({ name: item.name, day: item.day, start: item.start, end: item.end, location: item.location }));
assert.deepEqual(actualWeek12, [
  { name: '计算机组成原理', day: 1, start: 1, end: 2, location: '示例校区 示例A302' },
  { name: '概率论与数理统计', day: 1, start: 3, end: 4, location: '示例校区 示例A227' },
  { name: '计算机组成原理', day: 3, start: 1, end: 2, location: '示例校区 示例A404' },
  { name: '概率论与数理统计', day: 5, start: 1, end: 2, location: '示例校区 示例A105' },
  { name: '[实]计算机组成原理-微结构', day: 3, start: 9, end: 12, location: '示例校区 虚构实验室A407' },
]);

// DOM回退：并列冲突列的像素坐标可能重叠，不能把第3节错判为第1节。
await new Promise((resolve) => setTimeout(resolve, 1000));
window.fetch = async () => { throw new Error('测试：接口不可用'); };
const mondayColumn = document.querySelectorAll('[class*="TimetableDayColumnRoot"]')[1];
mondayColumn.innerHTML = `<div class="kbappTimetableDayColumnConflictContainer" style="flex-grow:4">
  <div class="kbappTimetableCourseRenderColumn">
    <div class="kbappTimetableCourseRenderCourseItemContainer" style="flex-grow:2">${richCard}</div>
    <div style="flex-grow:2"></div>
  </div>
  <div class="kbappTimetableCourseRenderColumn">
    <div style="flex-grow:2"></div>
    <div class="kbappTimetableCourseRenderCourseItemContainer" style="flex-grow:2">${card({ title: '示例教学班', code: 'DEMO02', start: 3, span: 2, lines: ['概率论与数理统计 A654321', '3-7周,10-12周 示例教师  示例校区 示例A227'] })}</div>
  </div>
</div><div style="flex-grow:8"></div>`;
for (const element of mondayColumn.querySelectorAll('[data-test-start]')) setRect(element, 200, 100, 100, 100);
button.click();
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(messages.length, 5);
const probabilityDom = messages[4].sessions.find((item) => item.name === '概率论与数理统计');
assert.ok(probabilityDom);
assert.equal(probabilityDom.start, 3, '按flex跨度确定第3节，而不是卡片像素顶部');
assert.equal(probabilityDom.end, 4);
assert.equal(probabilityDom.weeksText, '3-7周,10-12周');

// 第二个冲突组之前有四节跨度，平行列内再有两节空白，应定位到第7节。
await new Promise((resolve) => setTimeout(resolve, 1000));
const group = mondayColumn.children[0];
const precedingGap = document.createElement('div');
precedingGap.style.flexGrow = '4';
mondayColumn.insertBefore(precedingGap, group);
button.click();
await new Promise((resolve) => setTimeout(resolve, 200));
const shiftedProbability = messages[5].sessions.find((item) => item.name === '概率论与数理统计');
assert.equal(shiftedProbability.start, 7);
assert.equal(shiftedProbability.end, 8);

console.log('东北大学课表提取测试通过');
assert.ok(fallbackWarnings.some((args) => String(args[0]).includes('回退 DOM')));
console.log('已验证：接口多组周次/地点展开、第12周组原和概率论的5条安排、DOM结构跨度定位、接口失败回退、实验课详情与缺失信息。');
dom.window.close();
