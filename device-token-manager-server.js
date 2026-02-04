import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Server-side device token manager (read-only)
 * Used by server.js child process to validate tokens
 * Reads from device-tokens.json file created by main process
 */
class DeviceTokenManagerServer {
  constructor() {
    this.jsonPath = path.join(__dirname, 'device-tokens.json');
    this.cache = null;
    this.cacheTimestamp = 0;
    this.CACHE_TTL = 5000; // 5 seconds - balance between freshness and performance

    this.ensureFileExists();
  }

  /**
   * Ensure the JSON file exists
   */
  ensureFileExists() {
    if (!fs.existsSync(this.jsonPath)) {
      fs.writeFileSync(
        this.jsonPath,
        JSON.stringify({ tokens: [], lastSync: Date.now() }, null, 2),
        'utf-8'
      );
    }
  }

  /**
   * Read tokens from JSON file with caching
   * @returns {Array} - Array of token objects
   */
  readTokens() {
    const now = Date.now();

    // Return cached data if still valid
    if (this.cache && (now - this.cacheTimestamp) < this.CACHE_TTL) {
      return this.cache;
    }

    try {
      const data = fs.readFileSync(this.jsonPath, 'utf-8');
      const parsed = JSON.parse(data);
      this.cache = parsed.tokens || [];
      this.cacheTimestamp = now;
      return this.cache;
    } catch (error) {
      console.error('[TokenManagerServer] Error reading tokens:', error);
      return [];
    }
  }

  /**
   * Validate a token
   * @param {string} tokenValue - The token string to validate
   * @returns {{valid: boolean, reason?: string, token?: Object}} - Validation result
   */
  validateToken(tokenValue) {
    // Format validation
    if (!tokenValue || typeof tokenValue !== 'string') {
      return { valid: false, reason: 'INVALID_FORMAT' };
    }

    // Check token format (64 hex characters)
    if (!/^[a-f0-9]{64}$/i.test(tokenValue)) {
      return { valid: false, reason: 'INVALID_FORMAT' };
    }

    const tokens = this.readTokens();
    const token = tokens.find(t => t.token === tokenValue);

    if (!token) {
      return { valid: false, reason: 'TOKEN_NOT_FOUND' };
    }

    if (!token.active) {
      return { valid: false, reason: 'TOKEN_REVOKED' };
    }

    if (token.expiresAt < Date.now()) {
      return { valid: false, reason: 'TOKEN_EXPIRED' };
    }

    return { valid: true, token };
  }

  /**
   * Force refresh the cache
   * Call this when tokens are modified (e.g., after revocation)
   * @returns {Array} - Array of token objects
   */
  refreshCache() {
    this.cacheTimestamp = 0;
    return this.readTokens();
  }

  /**
   * Get all tokens (for debugging/monitoring)
   * @returns {Array} - Array of token objects
   */
  getAllTokens() {
    return this.readTokens();
  }

  /**
   * Get active tokens count
   * @returns {number} - Number of active tokens
   */
  getActiveTokenCount() {
    const tokens = this.readTokens();
    const now = Date.now();
    return tokens.filter(t => t.active && t.expiresAt > now).length;
  }
}

// Export singleton instance
export default new DeviceTokenManagerServer();
