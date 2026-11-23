const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('coursepilotDesktop', {
  isDesktop: true,
  database: {
    initialize: (payload) => ipcRenderer.invoke('database-initialize', payload),
    save: (payload) => ipcRenderer.invoke('database-save', payload),
    read: () => ipcRenderer.invoke('database-read'),
  },
  auth: {
    status: () => ipcRenderer.invoke('auth-status'),
    register: (payload) => ipcRenderer.invoke('auth-register', payload),
    login: (payload) => ipcRenderer.invoke('auth-login', payload),
    logout: () => ipcRenderer.invoke('auth-logout'),
    changePassword: (payload) => ipcRenderer.invoke('auth-change-password', payload),
  },
  materials: {
    pick: (payload) => ipcRenderer.invoke('materials-pick', payload),
    open: (payload) => ipcRenderer.invoke('materials-open', payload),
    readImage: (payload) => ipcRenderer.invoke('materials-read-image', payload),
    delete: (payload) => ipcRenderer.invoke('materials-delete', payload),
    deleteCourse: (payload) => ipcRenderer.invoke('materials-delete-course', payload),
  },
  openSchool: () => ipcRenderer.invoke('open-school'),
  openPathly: () => ipcRenderer.invoke('open-pathly'),
  notify: (payload) => ipcRenderer.invoke('notify-assignment', payload),
  getPreferences: () => ipcRenderer.invoke('desktop-get-preferences'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('desktop-set-auto-launch', enabled),
  showMiniWindow: () => ipcRenderer.invoke('mini-window-show'),
  hideMiniWindow: () => ipcRenderer.invoke('mini-window-hide'),
  toggleMiniWindow: () => ipcRenderer.invoke('mini-window-toggle'),
  openMain: (route) => ipcRenderer.invoke('open-main', route),
  onDatabaseChanged: (callback) => {
    const listener = () => {
      callback();
    };
    ipcRenderer.on('database-changed', listener);
    return () => ipcRenderer.removeListener('database-changed', listener);
  },
  onPreferencesChanged: (callback) => {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('desktop-preferences-changed', listener);
    return () => ipcRenderer.removeListener('desktop-preferences-changed', listener);
  },
  onNeuImport: (callback) => {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('neu-import', listener);
    return () => ipcRenderer.removeListener('neu-import', listener);
  },
  onOpenAssignments: (callback) => {
    const listener = () => {
      callback();
    };
    ipcRenderer.on('open-assignments', listener);
    return () => ipcRenderer.removeListener('open-assignments', listener);
  },
});
