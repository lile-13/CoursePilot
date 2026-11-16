export const NEU_SYSTEM_URL =
  'http://jwxt.neu.edu.cn/jwapp/sys/homeapp/home/index.html?av=&contextPath=/jwapp#/';
export const NEU_IMPORT_MESSAGE = 'COURSEPILOT_SCHEDULE';

const EXTRA_ALLOWED_HOSTS = ['219.216.96.4'];

/** 校验课表消息来源，只接受东北大学相关站点 */
export function isNeuMessageOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (url.hostname === 'neu.edu.cn' || url.hostname.endsWith('.neu.edu.cn')) return true;
    return EXTRA_ALLOWED_HOSTS.includes(url.hostname);
  } catch (error) {
    return false;
  }
}
