const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('coursepilotDesktop', {
  isDesktop: true,
  openSchool: () => ipcRenderer.invoke('open-school'),
  notify: (payload) => ipcRenderer.invoke('notify-assignment', payload),
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
