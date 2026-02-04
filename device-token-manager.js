import Store from 'electron-store';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @typedef {Object} DeviceToken
 * @property {string} token - 64-character hex token
 * @property {string} deviceName - Human-readable device name
 * @property {string} deviceId - Unique device identifier
 * @property {string} userId - User ID (for future Supabase integration)
 * @property {string} userEmail - User email
 * @property {number} createdAt - Timestamp when token was created
 * @property {number} lastUsed - Timestamp when token was last used
 * @property {number} expiresAt - Timestamp when token expires
 * @property {boolean} active - Whether token is active
 * @property {number} connectionCount - Number of connections made with this token
 * @property {string|null} lastConnectedIp - Last IP address that connected
 * @property {number|null} revokedAt - Timestamp when token was revoked
 */

class DeviceTokenManager {
  constructor() {
    // Use project directory for storage so server process can access the JSON file
    this.store = new Store({
      name: 'device-tokens',
      cwd: __dirname,
      defaults: {
        tokens: []
      }
    });

    // Path to JSON file for server process access
    this.jsonPath = path.join(__dirname, 'device-tokens.json');

    // Initialize JSON file sync
    this.syncToJsonFile();
  }

  /**
   * Generate cryptographically secure 64-character hex token
   * @returns {string} - 64-character hex token
   */
  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a new device token
   * @param {Object} metadata - Device metadata
   * @param {string} metadata.deviceName - Human-readable device name
   * @param {string} [metadata.deviceId] - Unique device identifier (auto-generated if not provided)
   * @param {string} [metadata.userId] - User ID
   * @param {string} [metadata.userEmail] - User email
   * @returns {DeviceToken} - The created token object
   */
  createToken(metadata) {
    const token = {
      token: this.generateToken(),
      deviceName: metadata.deviceName || 'Unknown Device',
      deviceId: metadata.deviceId || crypto.randomBytes(16).toString('hex'),
      userId: metadata.userId || 'local',
      userEmail: metadata.userEmail || 'local@device',
      createdAt: Date.now(),
      lastUsed: null,
      expiresAt: Date.now() + (90 * 24 * 60 * 60 * 1000), // 90 days from now
      active: true,
      connectionCount: 0,
      lastConnectedIp: null,
      revokedAt: null
    };

    const tokens = this.store.get('tokens', []);
    tokens.push(token);
    this.store.set('tokens', tokens);
    this.syncToJsonFile();

    return token;
  }

  /**
   * Get all device tokens
   * @returns {DeviceToken[]} - Array of all tokens
   */
  getAllTokens() {
    return this.store.get('tokens', []);
  }

  /**
   * Get active (non-revoked, non-expired) tokens
   * @returns {DeviceToken[]} - Array of active tokens
   */
  getActiveTokens() {
    const now = Date.now();
    return this.getAllTokens().filter(t =>
      t.active && t.expiresAt > now
    );
  }

  /**
   * Revoke a token by its value
   * @param {string} tokenValue - The token string to revoke
   * @returns {DeviceToken|null} - The revoked token object, or null if not found
   */
  revokeToken(tokenValue) {
    const tokens = this.store.get('tokens', []);
    const token = tokens.find(t => t.token === tokenValue);

    if (token) {
      token.active = false;
      token.revokedAt = Date.now();
      this.store.set('tokens', tokens);
      this.syncToJsonFile();
    }

    return token || null;
  }

  /**
   * Delete a token by its value (permanently remove)
   * @param {string} tokenValue - The token string to delete
   * @returns {boolean} - Whether the deletion was successful
   */
  deleteToken(tokenValue) {
    const tokens = this.store.get('tokens', []);
    const initialLength = tokens.length;

    const filtered = tokens.filter(t => t.token !== tokenValue);

    if (filtered.length < initialLength) {
      this.store.set('tokens', filtered);
      this.syncToJsonFile();
      return true;
    }

    return false;
  }

  /**
   * Update last used timestamp and metadata for a token
   * @param {string} tokenValue - The token string
   * @param {string} [ipAddress] - IP address of the connection
   * @returns {boolean} - Whether the update was successful
   */
  updateLastUsed(tokenValue, ipAddress = null) {
    const tokens = this.store.get('tokens', []);
    const token = tokens.find(t => t.token === tokenValue);

    if (token) {
      token.lastUsed = Date.now();
      token.connectionCount++;
      if (ipAddress) {
        token.lastConnectedIp = ipAddress;
      }
      this.store.set('tokens', tokens);
      this.syncToJsonFile();
      return true;
    }

    return false;
  }

  /**
   * Clean up expired tokens
   * @returns {number} - Number of tokens removed
   */
  cleanExpiredTokens() {
    const tokens = this.store.get('tokens', []);
    const now = Date.now();

    // Keep only non-expired OR revoked tokens (keep revoked for audit trail)
    const filtered = tokens.filter(t =>
      t.expiresAt > now || !t.active
    );

    const removedCount = tokens.length - filtered.length;

    if (removedCount > 0) {
      this.store.set('tokens', filtered);
      this.syncToJsonFile();
    }

    return removedCount;
  }

  /**
   * Sync tokens to JSON file for server process access
   * This allows the server.js child process to read tokens without electron-store
   */
  syncToJsonFile() {
    try {
      const data = {
        tokens: this.store.get('tokens', []),
        lastSync: Date.now()
      };

      fs.writeFileSync(this.jsonPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[TokenManager] Error syncing to JSON file:', error);
    }
  }

  /**
   * Get statistics about tokens
   * @returns {{total: number, active: number, revoked: number, expired: number}}
   */
  getStats() {
    const tokens = this.getAllTokens();
    const now = Date.now();

    return {
      total: tokens.length,
      active: tokens.filter(t => t.active && t.expiresAt > now).length,
      revoked: tokens.filter(t => !t.active).length,
      expired: tokens.filter(t => t.active && t.expiresAt <= now).length
    };
  }
}

// Export singleton instance
export default new DeviceTokenManager();
