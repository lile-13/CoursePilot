import React, { useState } from 'react';
import { ArrowRightIcon, CalendarIcon } from './Icons.jsx';
import coursePilotIcon from '../assets/coursepilot-icon.svg';


const PREVIEW_DAYS = ['周一', '周二', '周三', '周四', '周五'];
const PREVIEW_COURSES = [
  { name: '数据结构', time: '08:30', day: 1, slot: 1, tone: 'blue' },
  { name: '软件设计', time: '10:30', day: 2, slot: 2, tone: 'violet' },
  { name: '计算机组成', time: '08:30', day: 3, slot: 1, tone: 'cyan' },
  { name: '上机实验', time: '14:00', day: 3, slot: 3, tone: 'blue' },
  { name: '概率统计', time: '10:30', day: 4, slot: 2, tone: 'violet' },
  { name: '数据结构', time: '14:00', day: 5, slot: 3, tone: 'cyan' },
];

function LoginSchedulePreview() {
  return (
    <div className="auth-showcase" aria-hidden="true">
      <div className="auth-preview">
        <div className="auth-preview-head">
          <CalendarIcon size={18} />
          <strong>周课表</strong>
          <span>示例课表</span>
        </div>
        <div className="auth-preview-days">
          {PREVIEW_DAYS.map((day, index) => (
            <span key={day} className={index === 2 ? 'is-today' : undefined}>{day}</span>
          ))}
        </div>
        <div className="auth-preview-grid">
          <span className="auth-preview-today" />
          <span className="auth-preview-scan" />
          {PREVIEW_COURSES.map(({ name, time, day, slot, tone }) => (
            <div
              key={day + ':' + slot}
              className={'auth-preview-course is-' + tone}
              style={{ gridColumn: day, gridRow: slot, '--preview-delay': day * 0.35 + 's' }}
            >
              <span>{time}</span>
              <strong>{name}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
          <LoginSchedulePreview />
          <div className="auth-intro-copy">
            <h2>把这一周排明白。</h2>
            <p>课表、作业和课件，随时在本机查看。</p>
          </div>
        </aside>

        <section className="auth-panel">
          <div className="auth-panel-inner">
            <div className="auth-panel-head">
              <h1>{mode === 'login' ? '登录 CoursePilot' : firstAccount ? '创建第一个账号' : '创建新账号'}</h1>
              <p>
                {mode === 'login'
                  ? '选择本地账号，继续查看你的课表。'
                  : firstAccount
                    ? '设置用户名和密码，即可开始使用。'
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
                  placeholder={mode === 'login' ? '输入密码' : '至少 6 个字符'}
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
                {!busy ? <ArrowRightIcon size={18} /> : null}
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
              登录状态会保留到退出登录。密码无法找回，请妥善保管。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
