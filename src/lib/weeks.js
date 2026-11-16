/**
 * 周次表达式解析与判断。
 * 支持：1-16周、1-8,10-16周、1,3,5周、第1-16周(单)、2-16周（双）、单周、双周 等写法。
 */

export function parseWeekText(input) {
  if (input === null || input === undefined) return null;
  const original = String(input).trim();
  if (!original) return null;

  const text = original.normalize('NFKC')
    .replace(/[，、；;]/g, ',')
    .replace(/[－—–~～至到]/g, '-')
    .replace(/^周次\s*[:：]?\s*/, '')
    .trim();

  const segments = [];
  let pending = [];
  for (const part of text.split(',')) {
    const match = part.trim().match(/^第?\s*(\d+)(?:\s*-\s*(\d+))?\s*(周|weeks?)?\s*(?:[([【]\s*(单双|双单|单|双)\s*周?\s*[)\]】]|(单双|双单|单|双)\s*周?)?$/i);
    if (!match) {
      if (/^(单|双)周$/.test(text)) {
        return { ranges: [[1, 40]], parity: text[0] === '单' ? 'odd' : 'even', raw: original };
      }
      return null;
    }
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end > 40 || start > end) return null;
    pending.push([start, end]);
    const marker = match[4] || match[5];
    if (match[3] || marker) {
      const parity = marker === '单' ? 'odd' : marker === '双' ? 'even' : 'all';
      segments.push(...pending.map((range) => ({ range, parity })));
      pending = [];
    }
  }
  segments.push(...pending.map((range) => ({ range, parity: 'all' })));
  if (!segments.length) return null;

  // “1-8,10-16周(单)”是一组；“4-6周(双),11周”是两个独立片段。
  const parities = new Set(segments.map((segment) => segment.parity));
  const parity = parities.size === 1 ? segments[0].parity : 'all';
  const active = new Set();
  for (const segment of segments) {
    for (let week = segment.range[0]; week <= segment.range[1]; week += 1) {
      if (segment.parity === 'odd' && week % 2 === 0) continue;
      if (segment.parity === 'even' && week % 2 === 1) continue;
      active.add(week);
    }
  }
  if (!active.size) return null;
  const valid = parities.size === 1
    ? segments.map((segment) => segment.range)
    : [...active].map((week) => [week, week]);

  valid.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of valid) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }

  return { ranges: merged, parity, raw: original };
}

export function isWeekActive(weeks, week) {
  if (!weeks || !Array.isArray(weeks.ranges) || !weeks.ranges.length) return false;
  const inRange = weeks.ranges.some(([start, end]) => week >= start && week <= end);
  if (!inRange) return false;
  if (weeks.parity === 'odd') return week % 2 === 1;
  if (weeks.parity === 'even') return week % 2 === 0;
  return true;
}

export function formatWeeks(weeks) {
  if (!weeks || !Array.isArray(weeks.ranges) || !weeks.ranges.length) return '未设置周次';
  const rangeText = weeks.ranges
    .map(([start, end]) => (start === end ? String(start) : `${start}-${end}`))
    .join(',');
  const suffix = weeks.parity === 'odd' ? '(单周)' : weeks.parity === 'even' ? '(双周)' : '';
  return `${rangeText}周${suffix}`;
}

export function weeksKey(weeks) {
  if (!weeks) return '';
  return `${(weeks.ranges || []).map((range) => range.join('-')).join(',')}|${weeks.parity || 'all'}`;
}

export function sessionsMaxWeek(sessions, fallback = 16) {
  let max = 0;
  for (const session of sessions || []) {
    for (const [start, end] of session.weeks?.ranges || []) {
      max = Math.max(max, start, end);
    }
  }
  return max || fallback;
}
