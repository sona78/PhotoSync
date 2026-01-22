const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Version info
  getVersions: () => ({
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  }),

  // Photo path management
  photoPaths: {
    // Open folder selection dialog
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),

    // Get all configured paths
    getAll: () => ipcRenderer.invoke('paths:getAll'),

    // Get enabled paths
    getEnabled: () => ipcRenderer.invoke('paths:getEnabled'),

    // Add a new path
    add: (dirPath) => ipcRenderer.invoke('paths:add', dirPath),

    // Remove a path
    remove: (id) => ipcRenderer.invoke('paths:remove', id),

    // Toggle path enabled/disabled
    toggle: (id, enabled) => ipcRenderer.invoke('paths:toggle', id, enabled),

    // Clear all paths
    clearAll: () => ipcRenderer.invoke('paths:clearAll'),

    // Get statistics
    getStats: () => ipcRenderer.invoke('paths:getStats')
  }
});
