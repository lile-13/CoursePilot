import React, { useEffect, useState } from 'react';
import { StoreProvider } from './store.jsx';
import Header from './components/Header.jsx';
import SchedulePage from './components/SchedulePage.jsx';
import AssignmentsPage from './components/AssignmentsPage.jsx';
import ImportPage from './components/ImportPage.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import Toast from './components/Toast.jsx';
import ReminderScheduler from './components/ReminderScheduler.jsx';

const TAB_KEYS = ['schedule', 'assignments', 'import', 'settings'];

function readTabFromHash() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return TAB_KEYS.includes(hash) ? hash : 'schedule';
}

function Shell() {
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
        {activeTab === 'schedule' ? <SchedulePage onGoImport={() => setActiveTab('import')} /> : null}
        {activeTab === 'assignments' ? <AssignmentsPage /> : null}
        {activeTab === 'import' ? (
          <ImportPage
            onDone={() => setActiveTab('schedule')}
            desktopImport={desktopImport}
          />
        ) : null}
        {activeTab === 'settings' ? <SettingsPage /> : null}
      </main>
      <footer className="app-footer">
        <span>数据保存在本机浏览器 localStorage · 关闭页面后仍然保留</span>
        <span className="dot">·</span>
        <span>北京时间 UTC+8</span>
      </footer>
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ReminderScheduler />
      <Shell />
    </StoreProvider>
  );
}
