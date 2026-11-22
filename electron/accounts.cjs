const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const USERNAME_MIN = 2;
const USERNAME_MAX = 24;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;
const KEY_LENGTH = 64;

function normalizeUsername(value) {
  return String(value ?? '').trim();
}

function validateUsername(username) {
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    throw new Error(`用户名需要 ${USERNAME_MIN}-${USERNAME_MAX} 个字符`);
  }
  if (/[\u0000-\u001f\u007f]/.test(username)) {
    throw new Error('用户名包含无效字符');
  }
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new Error(`密码需要 ${PASSWORD_MIN}-${PASSWORD_MAX} 个字符`);
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64')) {
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('base64');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  try {
    const expected = Buffer.from(hash, 'base64');
    const candidate = crypto.scryptSync(password, salt, KEY_LENGTH);
    return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
  } catch {
    return false;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}

function createEmptyAccounts() {
  return { version: 1, legacyOwnerId: null, users: [] };
}

function loadAccounts(accountsFile) {
  if (!fs.existsSync(accountsFile)) return createEmptyAccounts();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
  } catch (error) {
    throw new Error(`账号文件无法读取：${error.message}`);
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.users)) {
    throw new Error('账号文件结构无效');
  }
  parsed.users = parsed.users.filter(
    (user) => user && typeof user.id === 'string' && typeof user.username === 'string' &&
      typeof user.salt === 'string' && typeof user.hash === 'string'
  );
  if (!parsed.legacyOwnerId) parsed.legacyOwnerId = null;
  return parsed;
}

/**
 * 本地账号存储。只读写 accounts.json / session.json / users 目录，
 * 不依赖 Electron，便于单独测试。
 */
function createAccountStore(baseDir) {
  if (!baseDir) throw new Error('缺少账号数据目录');
  fs.mkdirSync(baseDir, { recursive: true });
  const accountsFile = path.join(baseDir, 'accounts.json');
  const sessionFile = path.join(baseDir, 'session.json');
  const data = loadAccounts(accountsFile);

  const savedSession = readJson(sessionFile, null);
  let sessionUserId =
    savedSession && data.users.some((user) => user.id === savedSession.userId)
      ? savedSession.userId
      : null;

  const publicUser = (user) =>
    user
      ? { id: user.id, username: user.username, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt }
      : null;

  function persistAccounts() {
    writeJson(accountsFile, data);
  }

  function persistSession() {
    if (!sessionUserId) {
      try {
        fs.rmSync(sessionFile, { force: true });
      } catch {
        // session file is optional
      }
      return;
    }
    writeJson(sessionFile, { userId: sessionUserId });
  }

  function findUser(username) {
    const key = normalizeUsername(username).toLocaleLowerCase();
    return data.users.find((user) => user.username.toLocaleLowerCase() === key) || null;
  }

  function currentUser() {
    return data.users.find((user) => user.id === sessionUserId) || null;
  }

  function status() {
    const current = currentUser();
    return {
      hasUsers: data.users.length > 0,
      users: data.users.map((user) => ({ id: user.id, username: user.username })),
      currentUser: publicUser(current),
      isLegacyOwner: Boolean(current && data.legacyOwnerId === current.id),
      legacyOwnerId: data.legacyOwnerId,
    };
  }

  function register({ username, password }, options = {}) {
    const name = normalizeUsername(username);
    validateUsername(name);
    validatePassword(password);
    if (findUser(name)) throw new Error('用户名已存在');

    const isFirstUser = data.users.length === 0;
    const { salt, hash } = hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      username: name,
      salt,
      hash,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    const userDir = path.join(baseDir, 'users', user.id);
    fs.mkdirSync(userDir, { recursive: true });
    try {
      options.prepareUser?.({ user, userDir, isFirstUser });
      data.users.push(user);
      if (isFirstUser && !data.legacyOwnerId) data.legacyOwnerId = user.id;
      sessionUserId = user.id;
      persistAccounts();
      try {
        persistSession();
      } catch (error) {
        console.warn('[CoursePilot] 保存登录状态失败，下次需要重新登录', error);
      }
    } catch (error) {
      data.users = data.users.filter((item) => item.id !== user.id);
      sessionUserId = null;
      try {
        fs.rmSync(userDir, { recursive: true, force: true });
      } catch {
        // keep the original error
      }
      throw error;
    }
    return publicUser(user);
  }

  function login({ username, password }) {
    const user = findUser(username);
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      throw new Error('用户名或密码不正确');
    }
    user.lastLoginAt = new Date().toISOString();
    sessionUserId = user.id;
    persistAccounts();
    try {
      persistSession();
    } catch (error) {
      console.warn('[CoursePilot] 保存登录状态失败，下次需要重新登录', error);
    }
    return publicUser(user);
  }

  function logout() {
    sessionUserId = null;
    persistSession();
  }

  function changePassword({ currentPassword, newPassword }) {
    const user = currentUser();
    if (!user) throw new Error('尚未登录');
    if (!verifyPassword(currentPassword, user.salt, user.hash)) throw new Error('当前密码不正确');
    validatePassword(newPassword);
    const { salt, hash } = hashPassword(newPassword);
    user.salt = salt;
    user.hash = hash;
    persistAccounts();
    return true;
  }

  function userDirFor(userId) {
    if (!data.users.some((user) => user.id === userId)) throw new Error('账号不存在');
    return path.join(baseDir, 'users', userId);
  }

  return {
    status,
    register,
    login,
    logout,
    currentUser,
    changePassword,
    userDirFor,
    accountsFile,
  };
}

module.exports = {
  createAccountStore,
  hashPassword,
  verifyPassword,
  validatePassword,
  validateUsername,
};
