import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import os from 'os';
import crypto from 'crypto';
import QRCode from 'qrcode';
import photoPathsManager from './photo-paths-manager.js';
import deviceTokenManager from './device-token-manager.js';
import deviceConfigManager from './device-config-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server process
let serverProcess = null;

// WebRTC room ID - uses persistent device configuration for consistent QR codes
// Room ID persists across app restarts and is stored in device-config.json
const WEBRTC_ROOM_ID = deviceConfigManager.getPermanentRoomId();
const SIGNALING_SERVER = process.env.SIGNALING_SERVER || 'ws://localhost:3002';

console.log(`[WebRTC] Persistent Room ID: ${WEBRTC_ROOM_ID}`);
console.log(`[WebRTC] Signaling Server: ${SIGNALING_SERVER}`);
console.log(`[WebRTC] This Room ID remains the same across app restarts`);

/**
 * Get WebRTC configuration from persistent device config
 * This ensures consistent room ID across app restarts
 */
function getWebRTCConfig() {
  // Primary: Use persistent device configuration
  const deviceConfig = deviceConfigManager.getDeviceConfig();

  console.log(`[QR] Using persistent room ID: ${deviceConfig.roomId}`);

  return {
    roomId: deviceConfig.roomId,
    signalingServer: deviceConfig.qrConfig.signalingServer
  };
}

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

// IPC Handlers for Device Pairing

// Helper function to get all valid network addresses with scoring
function getAllNetworkAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];

  // VPN adapter patterns to skip
  const vpnPatterns = [
    /vpn/i,
    /tun/i,
    /tap/i,
    /mcafee/i,
    /openvpn/i,
    /wireguard/i,
    /tailscale/i,
    /zerotier/i,
    /nordvpn/i,
    /expressvpn/i,
    /vmware/i,
    /virtualbox/i,
    /vethernet.*wsl/i,
    /hyper-v/i
  ];

  // Preferred adapter patterns
  const wifiPatterns = [/wifi/i, /wlan/i, /wireless/i, /802\.11/i];
  const ethernetPatterns = [/ethernet/i, /eth/i, /lan/i];

  for (const [name, interfaces] of Object.entries(nets)) {
    // Skip VPN adapters
    if (vpnPatterns.some(pattern => pattern.test(name))) {
      continue;
    }

    for (const net of interfaces) {
      const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4;

      // Only include external IPv4 addresses
      if (net.family === familyV4Value && !net.internal) {
        // Score the address based on interface type
        let score = 0;
        let type = 'Other';

        if (wifiPatterns.some(pattern => pattern.test(name))) {
          score = 100;
          type = 'WiFi';
        } else if (ethernetPatterns.some(pattern => pattern.test(name))) {
          score = 90;
          type = 'Ethernet';
        } else {
          score = 50;
        }

        addresses.push({
          address: net.address,
          interfaceName: name,
          type,
          score
        });
      }
    }
  }

  // Sort by score (highest first)
  addresses.sort((a, b) => b.score - a.score);

  return addresses;
}

// Helper function to get best network IP address
function getNetworkAddress() {
  const addresses = getAllNetworkAddresses();

  if (addresses.length === 0) {
    console.warn('[Network] No valid network addresses found, using localhost');
    return 'localhost';
  }

  // Return the highest scored address
  const best = addresses[0];
  console.log(`[Network] Selected ${best.type} interface: ${best.interfaceName} (${best.address})`);

  // Log alternatives
  if (addresses.length > 1) {
    console.log('[Network] Other available addresses:');
    addresses.slice(1).forEach(addr => {
      console.log(`  - ${addr.type}: ${addr.interfaceName} (${addr.address})`);
    });
  }

  return best.address;
}

// Generate QR code for device pairing (WebRTC P2P)
// Uses persistent device configuration for consistent QR codes across restarts
ipcMain.handle('device:generateQR', async (event, deviceMetadata) => {
  try {
    // Validate deviceMetadata
    if (!deviceMetadata || typeof deviceMetadata !== 'object') {
      return { success: false, error: 'Invalid device metadata' };
    }

    // Get permanent QR payload from device config manager
    const qrPayload = deviceConfigManager.getQRPayload(
      deviceMetadata.deviceName || 'Web Device'
    );

    console.log('[QR] Generating persistent WebRTC QR code:', qrPayload);

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(
      JSON.stringify(qrPayload),
      {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 400,
        margin: 2
      }
    );

    // Track usage timestamp
    deviceConfigManager.updateLastUsed();

    // Get device config for metadata
    const deviceConfig = deviceConfigManager.getDeviceConfig();

    return {
      success: true,
      qrDataUrl,
      deviceName: qrPayload.deviceName,
      connectionType: 'WebRTC P2P',
      signalingServer: qrPayload.signalingServer,
      roomId: qrPayload.roomId,
      persistent: true, // Flag indicating this is a persistent QR code
      createdAt: deviceConfig.createdAt,
      lastUsed: deviceConfig.lastUsed,
      stats: {
        roomId: qrPayload.roomId,
        signalingServer: qrPayload.signalingServer,
        activePeers: 0 // This would need to be fetched from server if needed
      }
    };
  } catch (error) {
    console.error('Error generating QR code:', error);
    return { success: false, error: error.message };
  }
});

// Get all available network addresses
ipcMain.handle('device:getNetworkAddresses', () => {
  try {
    const addresses = getAllNetworkAddresses();
    return {
      success: true,
      addresses,
      selected: addresses.length > 0 ? addresses[0].address : 'localhost'
    };
  } catch (error) {
    console.error('Error getting network addresses:', error);
    return { success: false, error: error.message };
  }
});

// Generate QR code with specific IP address (now generates WebRTC QR)
ipcMain.handle('device:generateQRWithIP', async (event, ipAddress, deviceMetadata) => {
  try {
    // For WebRTC, IP address is not needed - just delegate to standard QR generation
    // This handler is kept for compatibility but now generates WebRTC QR

    // Validate deviceMetadata
    if (!deviceMetadata || typeof deviceMetadata !== 'object') {
      return { success: false, error: 'Invalid device metadata' };
    }

    // Get permanent QR payload from device config manager
    const qrPayload = deviceConfigManager.getQRPayload(
      deviceMetadata.deviceName || 'Web Device'
    );

    console.log('[QR] Generating persistent WebRTC QR code:', qrPayload);

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(
      JSON.stringify(qrPayload),
      {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 400,
        margin: 2
      }
    );

    // Track usage timestamp
    deviceConfigManager.updateLastUsed();

    // Get device config for metadata
    const deviceConfig = deviceConfigManager.getDeviceConfig();

    return {
      success: true,
      qrDataUrl,
      deviceName: qrPayload.deviceName,
      connectionType: 'WebRTC P2P',
      signalingServer: qrPayload.signalingServer,
      roomId: qrPayload.roomId,
      persistent: true, // Flag indicating this is a persistent QR code
      createdAt: deviceConfig.createdAt,
      lastUsed: deviceConfig.lastUsed,
      stats: {
        roomId: qrPayload.roomId,
        signalingServer: qrPayload.signalingServer,
        activePeers: 0 // This would need to be fetched from server if needed
      }
    };
  } catch (error) {
    console.error('Error generating QR code:', error);
    return { success: false, error: error.message };
  }
});

// Get device configuration (for UI display)
ipcMain.handle('device:getConfig', () => {
  try {
    const config = deviceConfigManager.getDeviceConfig();
    const stats = deviceConfigManager.getStats();

    return {
      success: true,
      config,
      stats
    };
  } catch (error) {
    console.error('Error getting device config:', error);
    return { success: false, error: error.message };
  }
});

// Regenerate QR code (manual user action)
ipcMain.handle('device:regenerateQR', async (event, reason) => {
  try {
    console.log(`[DeviceConfig] User requested QR regeneration. Reason: ${reason}`);

    // Regenerate the room ID
    const newConfig = deviceConfigManager.regenerateQR(reason || 'user_requested');

    // Update the WEBRTC_ROOM_ID constant value (though it's const, the config manager returns new value)
    // Note: Server process will need to be restarted to pick up the new room ID

    return {
      success: true,
      config: newConfig,
      message: 'QR code regenerated successfully. Please restart the app for changes to take effect.',
      requiresRestart: true
    };
  } catch (error) {
    console.error('Error regenerating QR code:', error);
    return { success: false, error: error.message };
  }
});

// Get all device tokens
ipcMain.handle('device:getAll', () => {
  try {
    return {
      success: true,
      tokens: deviceTokenManager.getAllTokens(),
      stats: deviceTokenManager.getStats()
    };
  } catch (error) {
    console.error('Error getting device tokens:', error);
    return { success: false, error: error.message };
  }
});

// Revoke device token
ipcMain.handle('device:revoke', (event, tokenValue) => {
  try {
    const revoked = deviceTokenManager.revokeToken(tokenValue);
    return {
      success: !!revoked,
      token: revoked,
      message: revoked ? 'Token revoked successfully' : 'Token not found'
    };
  } catch (error) {
    console.error('Error revoking token:', error);
    return { success: false, error: error.message };
  }
});

// Delete device token
ipcMain.handle('device:delete', (event, tokenValue) => {
  try {
    const deleted = deviceTokenManager.deleteToken(tokenValue);
    return {
      success: deleted,
      message: deleted ? 'Device deleted successfully' : 'Device not found'
    };
  } catch (error) {
    console.error('Error deleting token:', error);
    return { success: false, error: error.message };
  }
});

// Start HTTP server
function startServer() {
  console.log('Starting PhotoSync server...');

  // Pass room ID to server process via environment variable
  const env = {
    ...process.env,
    WEBRTC_ROOM_ID: WEBRTC_ROOM_ID,
    SIGNALING_SERVER: SIGNALING_SERVER
  };

  serverProcess = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true,
    env: env
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

  // Only start server if not running externally (e.g., via npm start with concurrently)
  if (!process.env.EXTERNAL_SERVER) {
    startServer();
  } else {
    console.log('Using external server process...');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (!process.env.EXTERNAL_SERVER) {
    stopServer();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (!process.env.EXTERNAL_SERVER) {
    stopServer();
  }
});
