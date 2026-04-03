const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  callClaude: (apiKey, messages, weekContext) =>
    ipcRenderer.invoke('call-claude', { apiKey, messages, weekContext }),
  saveICS: (icsContent) =>
    ipcRenderer.invoke('save-ics', { icsContent }),
  msLogin: (clientId) =>
    ipcRenderer.invoke('ms-login', { clientId }),
  msLogout: () =>
    ipcRenderer.invoke('ms-logout'),
  msStatus: () =>
    ipcRenderer.invoke('ms-status'),
  pushToOutlook: (events, clientId) =>
    ipcRenderer.invoke('push-to-outlook', { events, clientId }),
  readOutlookCalendar: (startDate, endDate, clientId) =>
    ipcRenderer.invoke('read-outlook-calendar', { startDate, endDate, clientId }),
  transcribeAudio: (audioBuffer) =>
    ipcRenderer.invoke('transcribe-audio', { audioBuffer }),
  whisperStatus: () =>
    ipcRenderer.invoke('whisper-status'),
});
