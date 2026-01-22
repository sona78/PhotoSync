import Store from 'electron-store';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @typedef {Object} PhotoPath
 * @property {string} id - Unique identifier for the path
 * @property {string} path - Absolute path to the directory
 * @property {boolean} enabled - Whether this path is currently active
 * @property {number} addedAt - Timestamp when path was added
 */

class PhotoPathsManager {
  constructor() {
    // Use project directory for storage so server can access the same file
    this.store = new Store({
      name: 'photo-paths',
      cwd: __dirname,
      defaults: {
        paths: []
      }
    });
  }

  /**
   * Get all configured photo paths
   * @returns {PhotoPath[]}
   */
  getAllPaths() {
    return this.store.get('paths', []);
  }

  /**
   * Get only enabled photo paths
   * @returns {PhotoPath[]}
   */
  getEnabledPaths() {
    return this.getAllPaths().filter(p => p.enabled);
  }

  /**
   * Add a new photo path
   * @param {string} dirPath - Absolute path to directory
   * @returns {{success: boolean, message: string, path?: PhotoPath}}
   */
  addPath(dirPath) {
    // Validate path
    const absolutePath = path.resolve(dirPath);

    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        message: 'Directory does not exist'
      };
    }

    const stats = fs.statSync(absolutePath);
    if (!stats.isDirectory()) {
      return {
        success: false,
        message: 'Path is not a directory'
      };
    }

    // Check if path already exists
    const paths = this.getAllPaths();
    const existing = paths.find(p => p.path === absolutePath);

    if (existing) {
      return {
        success: false,
        message: 'Path already exists',
        path: existing
      };
    }

    // Add new path
    const newPath = {
      id: this.generateId(),
      path: absolutePath,
      enabled: true,
      addedAt: Date.now()
    };

    paths.push(newPath);
    this.store.set('paths', paths);

    return {
      success: true,
      message: 'Path added successfully',
      path: newPath
    };
  }

  /**
   * Remove a photo path by ID
   * @param {string} id - Path ID
   * @returns {{success: boolean, message: string}}
   */
  removePath(id) {
    const paths = this.getAllPaths();
    const index = paths.findIndex(p => p.id === id);

    if (index === -1) {
      return {
        success: false,
        message: 'Path not found'
      };
    }

    paths.splice(index, 1);
    this.store.set('paths', paths);

    return {
      success: true,
      message: 'Path removed successfully'
    };
  }

  /**
   * Toggle path enabled/disabled
   * @param {string} id - Path ID
   * @param {boolean} enabled - Enable or disable
   * @returns {{success: boolean, message: string, path?: PhotoPath}}
   */
  togglePath(id, enabled) {
    const paths = this.getAllPaths();
    const pathObj = paths.find(p => p.id === id);

    if (!pathObj) {
      return {
        success: false,
        message: 'Path not found'
      };
    }

    pathObj.enabled = enabled;
    this.store.set('paths', paths);

    return {
      success: true,
      message: `Path ${enabled ? 'enabled' : 'disabled'} successfully`,
      path: pathObj
    };
  }

  /**
   * Clear all paths
   * @returns {{success: boolean, message: string}}
   */
  clearAllPaths() {
    this.store.set('paths', []);
    return {
      success: true,
      message: 'All paths cleared'
    };
  }

  /**
   * Generate a unique ID
   * @returns {string}
   */
  generateId() {
    return `path_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get statistics about configured paths
   * @returns {{total: number, enabled: number, disabled: number}}
   */
  getStats() {
    const paths = this.getAllPaths();
    return {
      total: paths.length,
      enabled: paths.filter(p => p.enabled).length,
      disabled: paths.filter(p => !p.enabled).length
    };
  }
}

// Export singleton instance
export default new PhotoPathsManager();
