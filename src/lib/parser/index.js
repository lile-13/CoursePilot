import { parseWithGenericTable } from './genericTable.js';

/**
 * 解析器注册表。
 * 后续拿到学校专属课表页面后，可在这里注册更精准的解析器（排在最前面优先执行）。
 */
const parsers = [parseWithGenericTable];

export function registerScheduleParser(parser) {
  parsers.unshift(parser);
}

export function parseScheduleHtml(html) {
  const warnings = [];
  if (!html || !String(html).trim()) {
    return { sessions: [], warnings: ['内容为空，请先粘贴或上传课表页面源码。'], parserName: '' };
  }
  const source = String(html);
  if (!/<table|<body|<html|<div/i.test(source)) {
    warnings.push('内容看起来不是网页源码，请粘贴完整的 HTML 内容（Ctrl+S 保存的网页文件也可以）。');
  }

  for (const parser of parsers) {
    try {
      const result = parser(source);
      if (result && result.sessions && result.sessions.length) {
        return {
          parserName: result.parserName || '课表解析器',
          sessions: result.sessions,
          warnings: [...warnings, ...(result.warnings || [])],
        };
      }
    } catch (error) {
      console.warn('课表解析器执行失败', error);
      warnings.push(`解析器执行出错：${error.message || error}`);
    }
  }

  warnings.push('没有识别到课表。请确认复制的是“课表查询/我的课表”页面，并且页面已经加载出课程内容。');
  return { sessions: [], warnings, parserName: '' };
}
