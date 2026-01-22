import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import photoPathsManager from './photo-paths-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server process
let serverProcess = null;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// IPC Handlers for Photo Path Management

// Open folder dialog to select directory
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  if (result.canceled) {
    return { canceled: true };
  }

  return {
    canceled: false,
    filePaths: result.filePaths
  };
});

// Get all configured photo paths
ipcMain.handle('paths:getAll', () => {
  return photoPathsManager.getAllPaths();
});

// Get enabled photo paths
ipcMain.handle('paths:getEnabled', () => {
  return photoPathsManager.getEnabledPaths();
});

// Add a new photo path
ipcMain.handle('paths:add', (event, dirPath) => {
  return photoPathsManager.addPath(dirPath);
});

// Remove a photo path
ipcMain.handle('paths:remove', (event, id) => {
  return photoPathsManager.removePath(id);
});

// Toggle path enabled/disabled
ipcMain.handle('paths:toggle', (event, id, enabled) => {
  return photoPathsManager.togglePath(id, enabled);
});

// Clear all paths
ipcMain.handle('paths:clearAll', () => {
  return photoPathsManager.clearAllPaths();
});

// Get path statistics
ipcMain.handle('paths:getStats', () => {
  return photoPathsManager.getStats();
});

// Start HTTP server
function startServer() {
  console.log('Starting PhotoSync server...');

  serverProcess = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });

  serverProcess.on('error', (error) => {
    console.error('Failed to start server:', error);
  });

  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`Server exited with code ${code}`);
    }
  });
}

// Stop HTTP server
function stopServer() {
  if (serverProcess) {
    console.log('Stopping PhotoSync server...');
    serverProcess.kill();
    serverProcess = null;
  }
}

app.whenReady().then(() => {
  createWindow();
  startServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServer();
});
