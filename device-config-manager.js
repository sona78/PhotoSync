import Store from 'electron-store';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @typedef {Object} DeviceConfig
 * @property {string} deviceId - Unique device identifier (32-char hex)
 * @property {string} roomId - Permanent WebRTC room ID (16-char hex)
 * @property {string} deviceName - Human-readable device name
 * @property {number} createdAt - Timestamp when device was first configured
 * @property {number} lastUsed - Timestamp when QR was last generated
 * @property {Object} qrConfig - QR code configuration
 * @property {string} qrConfig.type - Connection type ('webrtc')
 * @property {string} qrConfig.signalingServer - WebRTC signaling server URL
 * @property {string} qrConfig.version - API version
 */

class DeviceConfigManager {
  constructor() {
    // Use project directory for storage (consistent with device-token-manager.js)
    this.store = new Store({
      name: 'device-config',
      cwd: __dirname,
      defaults: {
        deviceId: null,
        roomId: null,
        deviceName: 'Desktop Device',
        createdAt: null,
        lastUsed: null,
        qrConfig: {
          type: 'webrtc',
          signalingServer: process.env.SIGNALING_SERVER || 'wss://photosync-signaling.onrender.com',
          version: '1.0'
        }
      }
    });

    // Ensure device configuration exists (initialize on first launch)
    this.ensureDeviceConfig();
  }

  /**
   * Ensure device configuration exists, generate if not present
   * Called automatically in constructor
   */
  ensureDeviceConfig() {
    // Check if permanent IDs have been generated
    if (!this.store.get('deviceId') || !this.store.get('roomId')) {
      console.log('[DeviceConfig] First launch detected, generating permanent device configuration...');

      const deviceId = crypto.randomBytes(16).toString('hex'); // 32-char hex
      const roomId = crypto.randomBytes(8).toString('hex');    // 16-char hex
      const now = Date.now();

      this.store.set('deviceId', deviceId);
      this.store.set('roomId', roomId);
      this.store.set('createdAt', now);
      this.store.set('lastUsed', now);

      // Ensure signaling server is set (from env or default)
      const currentQrConfig = this.store.get('qrConfig');
      this.store.set('qrConfig', {
        ...currentQrConfig,
        signalingServer: process.env.SIGNALING_SERVER || currentQrConfig.signalingServer
      });

      console.log('[DeviceConfig] Device configuration created:');
      console.log(`  Device ID: ${deviceId}`);
      console.log(`  Room ID: ${roomId}`);
      console.log(`  Created: ${new Date(now).toISOString()}`);
    } else {
      const config = this.getDeviceConfig();
      console.log('[DeviceConfig] Loaded existing configuration:');
      console.log(`  Device ID: ${config.deviceId}`);
      console.log(`  Room ID: ${config.roomId}`);
      console.log(`  Created: ${new Date(config.createdAt).toISOString()}`);
    }
  }

  /**
   * Get complete device configuration
   * @returns {DeviceConfig} - Complete device configuration
   */
  getDeviceConfig() {
    return {
      deviceId: this.store.get('deviceId'),
      roomId: this.store.get('roomId'),
      deviceName: this.store.get('deviceName'),
      createdAt: this.store.get('createdAt'),
      lastUsed: this.store.get('lastUsed'),
      qrConfig: this.store.get('qrConfig')
    };
  }

  /**
   * Get permanent room ID for WebRTC connections
   * @returns {string} - 16-character hex room ID
   */
  getPermanentRoomId() {
    return this.store.get('roomId');
  }

  /**
   * Get QR payload for QR code generation
   * @param {string} [deviceName] - Optional device name override
   * @returns {Object} - QR payload object ready for JSON.stringify
   */
  getQRPayload(deviceName = null) {
    const config = this.getDeviceConfig();
    const qrConfig = config.qrConfig;

    return {
      type: qrConfig.type,
      signalingServer: qrConfig.signalingServer,
      roomId: config.roomId,
      version: qrConfig.version,
      deviceName: deviceName || config.deviceName
    };
  }

  /**
   * Update last used timestamp
   * Called when QR code is generated
   */
  updateLastUsed() {
    const now = Date.now();
    this.store.set('lastUsed', now);
    console.log(`[DeviceConfig] Last used timestamp updated: ${new Date(now).toISOString()}`);
  }

  /**
   * Update device name
   * @param {string} name - New device name
   */
  updateDeviceName(name) {
    if (name && typeof name === 'string' && name.trim().length > 0) {
      this.store.set('deviceName', name.trim());
      console.log(`[DeviceConfig] Device name updated: ${name.trim()}`);
    }
  }

  /**
   * Regenerate QR code (generate new room ID)
   * @param {string} [reason] - Reason for regeneration (for audit logging)
   * @returns {DeviceConfig} - Updated device configuration
   */
  regenerateQR(reason = 'unknown') {
    const oldRoomId = this.store.get('roomId');
    const newRoomId = crypto.randomBytes(8).toString('hex');
    const now = Date.now();

    this.store.set('roomId', newRoomId);
    this.store.set('lastUsed', now);

    console.log('[DeviceConfig] QR code regenerated:');
    console.log(`  Reason: ${reason}`);
    console.log(`  Old Room ID: ${oldRoomId}`);
    console.log(`  New Room ID: ${newRoomId}`);
    console.log(`  Timestamp: ${new Date(now).toISOString()}`);

    return this.getDeviceConfig();
  }

  /**
   * Update signaling server URL
   * @param {string} serverUrl - New signaling server URL
   */
  updateSignalingServer(serverUrl) {
    if (serverUrl && typeof serverUrl === 'string' && serverUrl.trim().length > 0) {
      const qrConfig = this.store.get('qrConfig');
      this.store.set('qrConfig', {
        ...qrConfig,
        signalingServer: serverUrl.trim()
      });
      console.log(`[DeviceConfig] Signaling server updated: ${serverUrl.trim()}`);
    }
  }

  /**
   * Get device statistics
   * @returns {{deviceId: string, roomId: string, createdAt: number, daysSinceCreation: number, lastUsed: number}}
   */
  getStats() {
    const config = this.getDeviceConfig();
    const now = Date.now();
    const daysSinceCreation = Math.floor((now - config.createdAt) / (24 * 60 * 60 * 1000));

    return {
      deviceId: config.deviceId,
      roomId: config.roomId,
      createdAt: config.createdAt,
      daysSinceCreation,
      lastUsed: config.lastUsed
    };
  }
}

// Export singleton instance
export default new DeviceConfigManager();
