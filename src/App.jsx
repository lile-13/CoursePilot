import React, { useCallback, useEffect, useState } from 'react';
import { StoreProvider, useStore } from './store.jsx';
import Header from './components/Header.jsx';
import TodayPage from './components/TodayPage.jsx';
import SchedulePage from './components/SchedulePage.jsx';
import AssignmentsPage from './components/AssignmentsPage.jsx';
import ImportPage from './components/ImportPage.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import LoginPage from './components/LoginPage.jsx';
import Toast from './components/Toast.jsx';
import ReminderScheduler from './components/ReminderScheduler.jsx';
import ClassReminderScheduler from './components/ClassReminderScheduler.jsx';
import coursePilotIcon from './assets/coursepilot-icon.svg';

const TAB_KEYS = ['today', 'schedule', 'assignments', 'import', 'settings'];

function readTabFromHash() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return TAB_KEYS.includes(hash) ? hash : 'today';
}

function Shell({ onLogout, currentUser }) {
  const { storageKind } = useStore();
  const [activeTab, setActiveTab] = useState(readTabFromHash);
  const [desktopImport, setDesktopImport] = useState(null);

  useEffect(() => {
    const api = window.coursepilotDesktop;
    if (!api?.onNeuImport) return undefined;

    return api.onNeuImport((payload) => {
      if (!payload || !Array.isArray(payload.sessions)) return;
      setActiveTab('import');
      setDesktopImport({ payload, receivedAt: Date.now() });
    });
  }, []);

  useEffect(() => {
    const api = window.coursepilotDesktop;
    if (!api?.onOpenAssignments) return undefined;
    return api.onOpenAssignments(() => setActiveTab('assignments'));
  }, []);

  useEffect(() => {
    if (window.location.hash !== `#${activeTab}`) {
      window.history.replaceState(null, '', `#${activeTab}`);
    }
  }, [activeTab]);

  useEffect(() => {
    const handleHashChange = () => setActiveTab(readTabFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <div className="app">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="app-main">
        {activeTab === 'today' ? (
          <TodayPage
            onGoSchedule={() => setActiveTab('schedule')}
            onGoAssignments={() => setActiveTab('assignments')}
          />
        ) : null}
        {activeTab === 'schedule' ? <SchedulePage onGoImport={() => setActiveTab('import')} /> : null}
        {activeTab === 'assignments' ? <AssignmentsPage /> : null}
        {activeTab === 'import' ? (
          <ImportPage
            onDone={() => setActiveTab('schedule')}
            desktopImport={desktopImport}
          />
        ) : null}
        {activeTab === 'settings' ? (
          <SettingsPage currentUser={currentUser} onLogout={onLogout} />
        ) : null}
      </main>
      <footer className="app-footer">
        <span>
          数据保存在本机{storageKind === 'sqlite' ? ' SQLite 数据库' : '浏览器 localStorage'} · 关闭后仍然保留
        </span>
        {currentUser ? (
          <>
            <span className="dot">·</span>
            <span>当前账号：{currentUser.username}</span>
          </>
        ) : null}
        <span className="dot">·</span>
        <span>北京时间 UTC+8</span>
      </footer>
      <Toast />
    </div>
  );
}

function Workspace({ user = null, allowLegacyMigration = true, onLogout = null }) {
  return (
    <StoreProvider allowLegacyMigration={allowLegacyMigration}>
      <ReminderScheduler />
      <ClassReminderScheduler />
      <Shell currentUser={user} onLogout={onLogout} />
    </StoreProvider>
  );
}

function AuthLoading({ error, onRetry }) {
  return (
    <div className="auth-page auth-page-loading">
      <div className="auth-loading">
        <img
          className="brand-mark auth-loading-icon"
          src={coursePilotIcon}
          alt=""
          width={46}
          height={46}
        />
        <strong>CoursePilot</strong>
        <span>{error || '正在读取账号…'}</span>
        {error ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
            重试
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DesktopAuthGate() {
  const [status, setStatus] = useState(undefined);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const result = await window.coursepilotDesktop.auth.status();
      if (!result?.ok) {
        setError(result?.error || '读取账号失败');
        return;
      }
      setStatus(result);
      setError('');
    } catch (readError) {
      setError(readError.message || String(readError));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleLogout = async () => {
    const result = await window.coursepilotDesktop.auth.logout();
    if (!result?.ok) throw new Error(result?.error || '退出登录失败');
    await refresh();
  };

  if (!status) return <AuthLoading error={error} onRetry={refresh} />;
  if (!status.currentUser) {
    return <LoginPage status={status} onAuthenticated={refresh} />;
  }
  return (
    <Workspace
      key={status.currentUser.id}
      user={status.currentUser}
      allowLegacyMigration={status.isLegacyOwner}
      onLogout={handleLogout}
    />
  );
}

export default function App() {
  const desktop = typeof window !== 'undefined' ? window.coursepilotDesktop : null;
  if (desktop?.auth) return <DesktopAuthGate />;
  return <Workspace />;
}
