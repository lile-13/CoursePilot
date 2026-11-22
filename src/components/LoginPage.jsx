import React, { useState } from 'react';
import { CheckIcon } from './Icons.jsx';
import coursePilotIcon from '../assets/coursepilot-icon.svg';

export default function LoginPage({ status, onAuthenticated }) {
  const auth = window.coursepilotDesktop?.auth;
  const [mode, setMode] = useState(status?.hasUsers ? 'login' : 'register');
  const [username, setUsername] = useState(status?.users?.[0]?.username || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setPassword('');
    setConfirm('');
    if (nextMode === 'register') setUsername('');
    else setUsername(status?.users?.[0]?.username || '');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!auth) {
      setError('当前环境不支持本地账号');
      return;
    }
    const name = username.trim();
    if (mode === 'register') {
      if (name.length < 2) {
        setError('用户名至少需要 2 个字符');
        return;
      }
      if (password.length < 6) {
        setError('密码至少需要 6 个字符');
        return;
      }
      if (password !== confirm) {
        setError('两次输入的密码不一致');
        return;
      }
    }
    setBusy(true);
    setError('');
    try {
      const result =
        mode === 'login'
          ? await auth.login({ username: name, password })
          : await auth.register({ username: name, password });
      if (!result?.ok) {
        setError(result?.error || '操作失败，请重试');
        return;
      }
      await onAuthenticated?.();
    } catch (submitError) {
      setError(submitError.message || String(submitError));
    } finally {
      setBusy(false);
    }
  };

  const firstAccount = !status?.hasUsers;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <aside className="auth-intro">
          <div className="auth-brand">
            <img
              className="brand-mark auth-brand-icon"
              src={coursePilotIcon}
              alt=""
              width={42}
              height={42}
            />
            <div>
              <strong>CoursePilot</strong>
              <span>课表助手</span>
            </div>
          </div>
          <div className="auth-intro-copy">
            <h1>
              课表、作业和提醒，
              <br />
              都在一个地方。
            </h1>
            <p>本地多用户账号，每个账号拥有独立的课表和作业数据，不需要联网。</p>
          </div>
          <ul className="auth-points">
            <li>
              <CheckIcon size={15} />
              每个账号独立保存课表、作业和提醒记录
            </li>
            <li>
              <CheckIcon size={15} />
              支持周次、单双周、实验课和截止提醒
            </li>
            <li>
              <CheckIcon size={15} />
              数据只保存在这台电脑的 SQLite 数据库中
            </li>
          </ul>
        </aside>

        <section className="auth-panel">
          <div className="auth-panel-inner">
          <div className="auth-panel-head">
            <span className="auth-badge">本地账号</span>
            <h2>{mode === 'login' ? '登录 CoursePilot' : firstAccount ? '创建第一个账号' : '创建新账号'}</h2>
            <p>
              {mode === 'login'
                ? '选择账号并输入密码，登录状态会保留到退出登录。'
                : firstAccount
                  ? '创建后会直接进入软件；现有课表和作业会归入这个账号。'
                  : '新账号会从空课表开始，不会影响其他账号的数据。'}
            </p>
          </div>

          {firstAccount && status?.legacyDatabaseExists ? (
            <div className="notice-bar">
              检测到现有课表和作业数据，创建账号后会自动归入这个账号。
            </div>
          ) : null}

          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === 'login' ? (
              <label className="field">
                <span className="field-label">账号</span>
                <select
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoFocus
                >
                  {(status?.users || []).map((user) => (
                    <option key={user.id} value={user.username}>
                      {user.username}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field">
                <span className="field-label">用户名</span>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="例如：小明"
                  maxLength={24}
                  autoFocus
                  autoComplete="username"
                />
              </label>
            )}

            <label className="field">
              <span className="field-label">密码</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 6 个字符"
                maxLength={64}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>

            {mode === 'register' ? (
              <label className="field">
                <span className="field-label">确认密码</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="再次输入密码"
                  maxLength={64}
                  autoComplete="new-password"
                />
              </label>
            ) : null}

            {error ? (
              <div className="auth-error" role="alert">
                {error}
              </div>
            ) : null}

            <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={busy}>
              {busy ? '请稍候…' : mode === 'login' ? '登录' : '创建并进入'}
            </button>
          </form>

          {status?.hasUsers ? (
            <button
              type="button"
              className="auth-switch"
              onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? '新建一个本地账号' : '返回登录'}
            </button>
          ) : null}

          <p className="auth-note">
            登录状态会保留，退出登录后即可切换账号。密码只保存在本机且无法找回，请妥善保管。
          </p>
          </div>
        </section>
      </div>
    </div>
  );
}
