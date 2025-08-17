const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Meeting control functions
  joinMeeting: (meetingLink, hostEmail) => ipcRenderer.invoke('join-meeting', { meetingLink, hostEmail }),
  leaveMeeting: () => ipcRenderer.invoke('leave-meeting'),
  getMeetingStatus: () => ipcRenderer.invoke('get-status'),
  
  // Event listeners
  onMeetingJoined: (callback) => ipcRenderer.on('meeting-joined', callback),
  onMeetingLeft: (callback) => ipcRenderer.on('meeting-left', callback),
  onMeetingError: (callback) => ipcRenderer.on('meeting-error', callback),
  onAudioChunkProcessed: (callback) => ipcRenderer.on('audio-chunk-processed', callback),
  
  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
