import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const { createAccountStore, hashPassword, verifyPassword } = createRequire(import.meta.url)(
  '../electron/accounts.cjs'
);

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), 'coursepilot-accounts-'));
  return { dir, store: createAccountStore(dir) };
}

async function cleanup(dir) {
  await rm(dir, { recursive: true, force: true });
}

test('首次注册成为本地账号并记住登录态', async () => {
  const { dir, store } = await makeStore();
  try {
    assert.deepEqual(store.status(), {
      hasUsers: false,
      users: [],
      currentUser: null,
      isLegacyOwner: false,
      legacyOwnerId: null,
    });

    let prepared = null;
    const user = store.register(
      { username: '小明', password: 'secret123' },
      { prepareUser: (payload) => { prepared = payload; } }
    );
    assert.equal(user.username, '小明');
    assert.equal(prepared.isFirstUser, true);
    assert.ok(prepared.userDir.endsWith(user.id));

    const status = store.status();
    assert.equal(status.hasUsers, true);
    assert.equal(status.currentUser.username, '小明');
    assert.equal(status.isLegacyOwner, true);
    assert.deepEqual(status.users.map((item) => item.username), ['小明']);

    const raw = await readFile(join(dir, 'accounts.json'), 'utf8');
    assert.doesNotMatch(raw, /secret123/);
    assert.match(raw, /"salt"/);
    assert.match(raw, /"hash"/);

    const reopened = createAccountStore(dir);
    assert.equal(reopened.status().currentUser.username, '小明', '记住登录');
  } finally {
    await cleanup(dir);
  }
});

test('用户名不区分大小写，重复注册失败', async () => {
  const { dir, store } = await makeStore();
  try {
    store.register({ username: 'Alice', password: 'secret123' });
    store.logout();
    assert.throws(
      () => store.register({ username: ' alice ', password: 'another123' }),
      /用户名已存在/
    );
  } finally {
    await cleanup(dir);
  }
});

test('密码错误不能登录，退出后不保留登录态', async () => {
  const { dir, store } = await makeStore();
  try {
    store.register({ username: 'Alice', password: 'secret123' });
    store.logout();
    const afterLogout = createAccountStore(dir);
    assert.equal(afterLogout.status().currentUser, null);

    assert.throws(() => store.login({ username: 'Alice', password: 'wrong' }), /密码不正确/);
    const user = store.login({ username: ' alice ', password: 'secret123' });
    assert.equal(user.username, 'Alice');
    assert.equal(createAccountStore(dir).status().currentUser.username, 'Alice');
  } finally {
    await cleanup(dir);
  }
});

test('第二个账号获得独立数据目录，旧数据只归第一个账号', async () => {
  const { dir, store } = await makeStore();
  try {
    const first = store.register({ username: 'Alice', password: 'secret123' });
    store.logout();
    const second = store.register({ username: 'Bob', password: 'secret123' });
    assert.notEqual(first.id, second.id);
    assert.equal(store.status().isLegacyOwner, false);
    assert.equal(createAccountStore(dir).status().currentUser.username, 'Bob');
    assert.equal(store.userDirFor(first.id).endsWith(first.id), true);
    assert.equal(store.userDirFor(second.id).endsWith(second.id), true);
    assert.notEqual(store.userDirFor(first.id), store.userDirFor(second.id));
  } finally {
    await cleanup(dir);
  }
});

test('准备用户数据失败时不留下账号和目录', async () => {
  const { dir, store } = await makeStore();
  try {
    assert.throws(
      () => {
        store.register(
          { username: 'Alice', password: 'secret123' },
          { prepareUser: () => { throw new Error('复制旧数据库失败'); } }
        );
      },
      /复制旧数据库失败/
    );
    assert.equal(store.status().hasUsers, false);
    assert.equal(store.status().currentUser, null);
    assert.deepEqual(await readdir(join(dir, 'users')), []);
  } finally {
    await cleanup(dir);
  }
});

test('修改密码后旧密码失效', async () => {
  const { dir, store } = await makeStore();
  try {
    store.register({ username: 'Alice', password: 'secret123' });
    assert.throws(
      () => store.changePassword({ currentPassword: 'wrong', newPassword: 'newsecret' }),
      /当前密码不正确/
    );
    store.changePassword({ currentPassword: 'secret123', newPassword: 'newsecret' });
    store.logout();
    assert.throws(() => store.login({ username: 'Alice', password: 'secret123' }));
    assert.equal(store.login({ username: 'Alice', password: 'newsecret' }).username, 'Alice');
  } finally {
    await cleanup(dir);
  }
});

test('账号和密码有基本长度和字符校验', async () => {
  const { dir, store } = await makeStore();
  try {
    assert.throws(() => store.register({ username: 'a', password: 'secret123' }), /用户名需要/);
    assert.throws(() => store.register({ username: 'Alice', password: '123' }), /密码需要/);
    assert.throws(() => store.register({ username: 'A\u0001lice', password: 'secret123' }), /无效字符/);
  } finally {
    await cleanup(dir);
  }
});

test('损坏的账号文件会报错而不是当成空账号', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'coursepilot-accounts-'));
  try {
    await writeFile(join(dir, 'accounts.json'), '{bad json', 'utf8');
    assert.throws(() => createAccountStore(dir), /账号文件无法读取/);
  } finally {
    await cleanup(dir);
  }
});

test('密码哈希可验证且不保存明文', () => {
  const { salt, hash } = hashPassword('secret123');
  assert.notEqual(hash, 'secret123');
  assert.equal(verifyPassword('secret123', salt, hash), true);
  assert.equal(verifyPassword('secret124', salt, hash), false);
  assert.equal(verifyPassword('secret123', salt, 'not-base64'), false);
});
