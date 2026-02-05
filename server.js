import express from 'express';
import https from 'https';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import crypto from 'crypto';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import photoPathsManager from './photo-paths-manager-server.js';
import SocketIOServer from './server/SocketIOServer.js';
import WebRTCManager from './WebRTCManager.js';

// Load environment variables
dotenv.config();

const fsPromises = fs.promises;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const HTTP_PORT = 3000;
const HTTPS_PORT = 3001;

// Configuration
const CACHE_DIRECTORY = path.join(__dirname, '.cache');

// In-memory storage
let photosDatabase = [];
let compressionCache = new Map();
let photoDb; // PhotoDatabase wrapper - initialized after scanPhotos()
let previousPhotoCount = 0; // Track for manifest change detection
let wsServerInstance = null; // WebSocket server reference for broadcasting updates
let webrtcManager = null; // WebRTC manager instance
let webrtcReady = false; // Track if WebRTC is connected to signaling server
let webrtcReadyPromise = null; // Promise that resolves when WebRTC is ready

/**
 * PhotoDatabase wrapper class
 * Provides abstraction over the photosDatabase array
 */
class PhotoDatabase {
  constructor() {
    this.database = photosDatabase;
  }

  /**
   * Get all photos
   * @returns {Array<Object>} Array of photo objects
   */
  getAllPhotos() {
    console.log(`[PhotoDatabase] getAllPhotos() called - returning ${this.database.length} photos`);
    console.log(`[PhotoDatabase] Global photosDatabase has ${photosDatabase.length} photos`);
    console.log(`[PhotoDatabase] Are they the same reference? ${this.database === photosDatabase}`);
    return this.database;
  }

  /**
   * Get single photo by ID
   * @param {string} id - Photo ID (16-char hex)
   * @returns {Object|null} Photo object or null if not found
   */
  getPhoto(id) {
    return this.database.find(p => p.id === id) || null;
  }

  /**
   * Get single photo by ID (alias for WebRTC compatibility)
   * @param {string} id - Photo ID (16-char hex)
   * @returns {Object|null} Photo object or null if not found
   */
  getPhotoById(id) {
    return this.getPhoto(id);
  }

  /**
   * Get photo count
   * @returns {number}
   */
  getCount() {
    return this.database.length;
  }

  /**
   * Check if photo exists
   * @param {string} id - Photo ID
   * @returns {boolean}
   */
  hasPhoto(id) {
    return this.database.some(p => p.id === id);
  }

  /**
   * Get folder structure
   * @returns {Object} Folder tree structure
   */
  getFolderStructure() {
    const folderMap = new Map();

    // Helper function to ensure a folder exists in the map
    const ensureFolderExists = (rootPath, folderPath) => {
      const key = `${rootPath}::${folderPath}`;

      if (!folderMap.has(key)) {
        folderMap.set(key, {
          id: crypto.createHash('md5').update(key).digest('hex').substring(0, 16),
          rootPath: rootPath,
          folderPath: folderPath,
          displayName: folderPath === '' ? path.basename(rootPath) : path.basename(folderPath),
          fullPath: folderPath === '' ? rootPath : path.join(rootPath, folderPath.split('/').join(path.sep)),
          photoCount: 0,
          subfolders: []
        });
      }

      return folderMap.get(key);
    };

    // Collect all unique folders and ensure all ancestor folders exist
    this.database.forEach(photo => {
      // Ensure root folder exists
      ensureFolderExists(photo.rootPath, '');

      // Create all ancestor folders in the path
      if (photo.folderPath !== '') {
        const pathParts = photo.folderPath.split('/');

        // Create each level of the folder hierarchy
        for (let i = 0; i < pathParts.length; i++) {
          const ancestorPath = pathParts.slice(0, i + 1).join('/');
          ensureFolderExists(photo.rootPath, ancestorPath);
        }
      }

      // Increment photo count only for the actual folder containing the photo
      const key = `${photo.rootPath}::${photo.folderPath}`;
      const folder = folderMap.get(key);
      folder.photoCount++;
    });

    // Build hierarchical structure
    const rootFolders = [];
    const folders = Array.from(folderMap.values());

    console.log(`[PhotoDatabase] Building folder hierarchy from ${folders.length} unique folders`);

    folders.forEach(folder => {
      if (folder.folderPath === '') {
        // This is a root folder
        rootFolders.push(folder);
      } else {
        // Find parent folder
        const parentPath = folder.folderPath.split('/').slice(0, -1).join('/');
        const parentKey = `${folder.rootPath}::${parentPath}`;
        const parent = folderMap.get(parentKey);

        if (parent && !parent.subfolders.find(sf => sf.id === folder.id)) {
          parent.subfolders.push(folder);
        } else if (!parent) {
          console.warn(`[PhotoDatabase] Parent folder not found for "${folder.folderPath}" (parent: "${parentPath}")`);
        }
      }
    });

    // Calculate recursive photo counts and filter empty folders
    const calculateRecursiveCount = (folder) => {
      let totalPhotos = folder.photoCount;

      // Recursively process subfolders
      folder.subfolders = folder.subfolders.filter(subfolder => {
        const subfolderCount = calculateRecursiveCount(subfolder);
        totalPhotos += subfolderCount;
        return subfolderCount > 0; // Only keep subfolders with photos
      });

      folder.totalPhotoCount = totalPhotos;
      return totalPhotos;
    };

    // Filter root folders to only show those with photos
    const filteredRootFolders = rootFolders.filter(folder => {
      return calculateRecursiveCount(folder) > 0;
    });

    console.log(`[PhotoDatabase] Created ${filteredRootFolders.length} root folders (${rootFolders.length - filteredRootFolders.length} empty folders filtered)`);

    return { folders: filteredRootFolders, totalPhotos: this.database.length };
  }

  /**
   * Get photos in a specific folder
   * @param {string} folderId - Folder ID
   * @param {boolean} recursive - Include subfolders
   * @returns {Array<Object>} Array of photo objects
   */
  getPhotosInFolder(folderId, recursive = false) {
    if (folderId === 'all') {
      return this.database;
    }

    return this.database.filter(photo => {
      const photoFolderId = crypto.createHash('md5').update(`${photo.rootPath}::${photo.folderPath}`).digest('hex').substring(0, 16);

      if (recursive) {
        return photoFolderId === folderId || photoFolderId.startsWith(folderId);
      } else {
        return photoFolderId === folderId;
      }
    });
  }
}

/**
 * Generate a unique ID for a photo based on its path and modified time
 * @param {string} filePath
 * @param {number} modified
 * @returns {string}
 */
function generatePhotoId(filePath, modified) {
  return crypto
    .createHash('md5')
    .update(`${filePath}:${modified}`)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Check if file is an image
 * @param {string} filename
 * @returns {boolean}
 */
function isImageFile(filename) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.heif'];
  return imageExtensions.includes(path.extname(filename).toLowerCase());
}

/**
 * Get image dimensions using Sharp
 * @param {string} filePath
 * @returns {Promise<{width: number, height: number}>}
 */
async function getImageDimensions(filePath) {
  try {
    const metadata = await sharp(filePath).metadata();
    return {
      width: metadata.width,
      height: metadata.height
    };
  } catch (error) {
    console.error(`Error getting dimensions for ${filePath}:`, error.message);
    return { width: 0, height: 0 };
  }
}

/**
 * Recursively scan a directory for image files
 * @param {string} dirPath - Directory to scan
 * @param {Array} results - Array to collect photo objects
 * @param {string} rootPath - Root path being scanned
 * @returns {Promise<number>} - Number of photos found
 */
async function scanDirectoryRecursive(dirPath, results = [], rootPath = null) {
  let photoCount = 0;

  // If rootPath is not provided, this is the root
  if (!rootPath) {
    rootPath = dirPath;
  }

  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectory
        const subCount = await scanDirectoryRecursive(fullPath, results, rootPath);
        photoCount += subCount;
      } else if (entry.isFile() && isImageFile(entry.name)) {
        // Process image file
        try {
          const stats = await fsPromises.stat(fullPath);
          const id = generatePhotoId(fullPath, stats.mtimeMs);
          const dimensions = await getImageDimensions(fullPath);

          // Calculate relative folder path from root
          const relativePath = path.relative(rootPath, dirPath);
          const folderPath = relativePath === '' ? '' : relativePath.split(path.sep).join('/');

          results.push({
            id,
            filename: entry.name,
            path: fullPath,
            size: stats.size,
            modified: stats.mtimeMs,
            width: dimensions.width,
            height: dimensions.height,
            rootPath: rootPath,
            folderPath: folderPath
          });

          photoCount++;
        } catch (error) {
          console.error(`Error processing ${fullPath}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error.message);
  }

  return photoCount;
}

/**
 * Scan configured directories for photos and populate database
 * @returns {Promise<void>}
 */
async function scanPhotos() {
  console.log('Scanning photos from configured paths...');
  photosDatabase.length = 0; // Clear array without breaking reference

  try {
    // Get enabled paths from store
    const enabledPaths = photoPathsManager.getEnabledPaths();

    if (enabledPaths.length === 0) {
      console.log('No photo paths configured. Please add directories using the UI.');
      return;
    }

    console.log(`Scanning ${enabledPaths.length} configured path(s)...`);

    // Scan each enabled path recursively
    for (const pathConfig of enabledPaths) {
      const dirPath = pathConfig.path;

      // Check if directory exists
      if (!fs.existsSync(dirPath)) {
        console.warn(`Directory not found: ${dirPath}`);
        continue;
      }

      try {
        const photoCount = await scanDirectoryRecursive(dirPath, photosDatabase);
        console.log(`  - ${dirPath}: ${photoCount} photos (recursive)`);
      } catch (error) {
        console.error(`Error scanning directory ${dirPath}:`, error.message);
      }
    }

    // Detect manifest changes and notify WebSocket clients
    const currentPhotoCount = photosDatabase.length;
    const manifestChanged = currentPhotoCount !== previousPhotoCount;

    console.log(`Total photos found: ${currentPhotoCount}`);

    // Notify Socket.IO clients if manifest changed
    if (manifestChanged && wsServerInstance) {
      console.log(`[BROADCAST] Photo count changed: ${previousPhotoCount} -> ${currentPhotoCount}`);
      wsServerInstance.broadcastToAuthenticated('manifest:updated', {
        reason: 'PHOTO_SCAN_COMPLETE',
        previousCount: previousPhotoCount,
        currentCount: currentPhotoCount,
        timestamp: Date.now()
      });
    } else if (manifestChanged && !wsServerInstance) {
      console.log(`[WARN] Photo count changed (${previousPhotoCount} -> ${currentPhotoCount}) but Socket.IO server not ready yet`);
    }

    previousPhotoCount = currentPhotoCount;
  } catch (error) {
    console.error('Error scanning photos:', error.message);
  }
}

/**
 * Calculate directory hash for sync status
 * @returns {string}
 */
function calculateDirectoryHash() {
  const ids = photosDatabase.map(p => p.id).sort().join('');
  return crypto.createHash('md5').update(ids).digest('hex');
}

/**
 * Get cache key for compressed photo
 * @param {string} id
 * @param {number} quality
 * @param {number} maxDimension
 * @returns {string}
 */
function getCacheKey(id, quality, maxDimension) {
  return `${id}_${quality}_${maxDimension}`;
}

/**
 * Compress image with Sharp
 * @param {string} filePath
 * @param {number} quality
 * @param {number} maxDimension
 * @param {string} id - Photo ID for cache key
 * @returns {Promise<Buffer>}
 */
async function compressImage(filePath, quality, maxDimension, id) {
  const cacheKey = getCacheKey(id, quality, maxDimension);

  // Check memory cache
  if (compressionCache.has(cacheKey)) {
    return compressionCache.get(cacheKey);
  }

  // Check disk cache
  const cacheFilePath = path.join(CACHE_DIRECTORY, `${cacheKey}.jpg`);
  if (fs.existsSync(cacheFilePath)) {
    const buffer = await fsPromises.readFile(cacheFilePath);
    compressionCache.set(cacheKey, buffer);
    return buffer;
  }

  // Compress image
  const buffer = await sharp(filePath)
    .resize(maxDimension, maxDimension, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality })
    .toBuffer();

  // Cache to memory and disk
  compressionCache.set(cacheKey, buffer);
  await fsPromises.mkdir(CACHE_DIRECTORY, { recursive: true });
  await fsPromises.writeFile(cacheFilePath, buffer);

  return buffer;
}

// ===== API ENDPOINTS =====

/**
 * 1. Health Check
 * GET /health
 */
app.get('/health', (req, res) => {
  const lastModified = photosDatabase.length > 0
    ? Math.max(...photosDatabase.map(p => p.modified))
    : Date.now();

  res.json({
    status: 'ok',
    photoCount: photosDatabase.length,
    timestamp: lastModified
  });
});

/**
 * 2. Get All Photos
 * GET /api/photos
 */
app.get('/api/photos', (req, res) => {
  try {
    res.json(photosDatabase);
  } catch (error) {
    console.error('Error fetching photos:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 3. Get Compressed Photo
 * GET /api/photo/:id
 */
app.get('/api/photo/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const quality = parseInt(req.query.quality) || 50;
    const maxDimension = parseInt(req.query.maxDimension) || 1920;

    // Validate parameters
    if (quality < 1 || quality > 100) {
      return res.status(400).json({ error: 'Quality must be between 1 and 100' });
    }

    if (maxDimension < 1 || maxDimension > 10000) {
      return res.status(400).json({ error: 'maxDimension must be between 1 and 10000' });
    }

    // Find photo
    const photo = photosDatabase.find(p => p.id === id);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    // Check if file exists
    if (!fs.existsSync(photo.path)) {
      return res.status(404).json({ error: 'Photo file not found on disk' });
    }

    // Compress and return
    const buffer = await compressImage(photo.path, quality, maxDimension, id);
    const etag = crypto.createHash('md5').update(buffer).digest('hex');

    res.set({
      'Content-Type': 'image/jpeg',
      'ETag': `"${etag}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Content-Length': buffer.length
    });

    res.send(buffer);
  } catch (error) {
    console.error('Error compressing photo:', error);
    res.status(500).json({ error: 'Compression failed' });
  }
});

/**
 * 4. Get Original Photo
 * GET /api/photo/:id/original
 */
app.get('/api/photo/:id/original', async (req, res) => {
  try {
    const { id } = req.params;

    // Find photo
    const photo = photosDatabase.find(p => p.id === id);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    // Check if file exists
    if (!fs.existsSync(photo.path)) {
      return res.status(404).json({ error: 'Photo file not found on disk' });
    }

    // Stream original file
    const stat = await fsPromises.stat(photo.path);
    const ext = path.extname(photo.path).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' :
                       ext === '.gif' ? 'image/gif' :
                       ext === '.webp' ? 'image/webp' :
                       'image/jpeg';

    res.set({
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const stream = fs.createReadStream(photo.path);
    stream.pipe(res);
  } catch (error) {
    console.error('Error serving original photo:', error);
    res.status(500).json({ error: 'Failed to read photo' });
  }
});

/**
 * 5. Get Sync Status
 * GET /api/sync-status
 */
app.get('/api/sync-status', (req, res) => {
  try {
    const lastModified = photosDatabase.length > 0
      ? Math.max(...photosDatabase.map(p => p.modified))
      : Date.now();

    res.json({
      photoCount: photosDatabase.length,
      lastModified,
      directoryHash: calculateDirectoryHash()
    });
  } catch (error) {
    console.error('Error getting sync status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 6. Get Configured Photo Paths
 * GET /api/paths
 */
app.get('/api/paths', (req, res) => {
  try {
    const paths = photoPathsManager.getAllPaths();
    res.json(paths);
  } catch (error) {
    console.error('Error getting paths:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get WebRTC Connection Info
 * GET /api/webrtc-info
 * Returns WebRTC connection information for QR code generation
 * Room ID is available immediately, no need to wait for signaling server
 */
app.get('/api/webrtc-info', async (req, res) => {
  try {
    if (!webrtcManager) {
      return res.status(503).json({
        error: 'WebRTC manager not initialized yet. Please wait a moment.',
        available: false
      });
    }

    // Room ID is available immediately after WebRTCManager creation
    const connectionInfo = webrtcManager.getConnectionInfo();
    res.json({
      ...connectionInfo,
      available: true,
      ready: webrtcReady, // Indicates if signaling server is connected
      stats: webrtcManager.getStats()
    });
  } catch (error) {
    console.error('Error getting WebRTC info:', error);
    res.status(500).json({ error: 'Failed to get WebRTC info' });
  }
});

/**
 * Network Info Endpoint
 * GET /network-info
 * Returns all network interfaces and IPs to help discover the server address
 */
app.get('/network-info', (req, res) => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({
          interface: name,
          address: iface.address,
          httpsUrl: `https://${iface.address}:${HTTPS_PORT}`
        });
      }
    }
  }

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>PhotoSync Network Info</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; }
          h1 { color: #333; }
          .address { background: #f0f0f0; padding: 15px; margin: 10px 0; border-radius: 8px; }
          .url { font-family: monospace; font-size: 16px; color: #0066cc; word-break: break-all; }
          a { display: inline-block; margin-top: 10px; padding: 10px 15px; background: #0066cc; color: white; text-decoration: none; border-radius: 5px; }
          a:hover { background: #0052a3; }
        </style>
      </head>
      <body>
        <h1>PhotoSync Server Addresses</h1>
        <p>Use any of these addresses to access the HTTPS server from iOS:</p>
        ${addresses.map(addr => `
          <div class="address">
            <strong>${addr.interface}</strong><br>
            <div class="url">${addr.httpsUrl}</div>
            <a href="${addr.httpsUrl}">Open HTTPS Server</a>
          </div>
        `).join('')}
        <p style="margin-top: 30px; color: #666; font-size: 14px;">
          Note: You'll need to install the certificate profile first.
          Visit <a href="/ios-certificate" style="display: inline; padding: 0; background: none; color: #0066cc;">/ios-certificate</a> to set it up.
        </p>
      </body>
    </html>
  `);
});

/**
 * 7. Get Path Statistics
 * GET /api/paths/stats
 */
app.get('/api/paths/stats', (req, res) => {
  try {
    const stats = photoPathsManager.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting path stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Helper: Build folder structure from photos database
 * @returns {Object} Folder tree structure
 */
function buildFolderStructure() {
  const folderMap = new Map();

  // Helper function to ensure a folder exists in the map
  const ensureFolderExists = (rootPath, folderPath) => {
    const key = `${rootPath}::${folderPath}`;

    if (!folderMap.has(key)) {
      folderMap.set(key, {
        id: crypto.createHash('md5').update(key).digest('hex').substring(0, 16),
        rootPath: rootPath,
        folderPath: folderPath,
        displayName: folderPath === '' ? path.basename(rootPath) : path.basename(folderPath),
        fullPath: folderPath === '' ? rootPath : path.join(rootPath, folderPath.split('/').join(path.sep)),
        photoCount: 0,
        subfolders: []
      });
    }

    return folderMap.get(key);
  };

  // Collect all unique folders and ensure all ancestor folders exist
  photosDatabase.forEach(photo => {
    // Ensure root folder exists
    ensureFolderExists(photo.rootPath, '');

    // Create all ancestor folders in the path
    if (photo.folderPath !== '') {
      const pathParts = photo.folderPath.split('/');

      // Create each level of the folder hierarchy
      for (let i = 0; i < pathParts.length; i++) {
        const ancestorPath = pathParts.slice(0, i + 1).join('/');
        ensureFolderExists(photo.rootPath, ancestorPath);
      }
    }

    // Increment photo count only for the actual folder containing the photo
    const key = `${photo.rootPath}::${photo.folderPath}`;
    const folder = folderMap.get(key);
    folder.photoCount++;
  });

  // Build hierarchical structure
  const rootFolders = [];
  const folders = Array.from(folderMap.values());

  console.log(`[Server] Building folder hierarchy from ${folders.length} unique folders`);

  folders.forEach(folder => {
    if (folder.folderPath === '') {
      // This is a root folder
      rootFolders.push(folder);
    } else {
      // Find parent folder
      const parentPath = folder.folderPath.split('/').slice(0, -1).join('/');
      const parentKey = `${folder.rootPath}::${parentPath}`;
      const parent = folderMap.get(parentKey);

      if (parent && !parent.subfolders.find(sf => sf.id === folder.id)) {
        parent.subfolders.push(folder);
      } else if (!parent) {
        console.warn(`[Server] Parent folder not found for "${folder.folderPath}" (parent: "${parentPath}")`);
      }
    }
  });

  // Calculate recursive photo counts and filter empty folders
  const calculateRecursiveCount = (folder) => {
    let totalPhotos = folder.photoCount;

    // Recursively process subfolders
    folder.subfolders = folder.subfolders.filter(subfolder => {
      const subfolderCount = calculateRecursiveCount(subfolder);
      totalPhotos += subfolderCount;
      return subfolderCount > 0; // Only keep subfolders with photos
    });

    folder.totalPhotoCount = totalPhotos;
    return totalPhotos;
  };

  // Filter root folders to only show those with photos
  const filteredRootFolders = rootFolders.filter(folder => {
    return calculateRecursiveCount(folder) > 0;
  });

  console.log(`[Server] Created ${filteredRootFolders.length} root folders (${rootFolders.length - filteredRootFolders.length} empty folders filtered)`);

  return { folders: filteredRootFolders, totalPhotos: photosDatabase.length };
}

/**
 * 8. Get Folder Structure
 * GET /api/folders
 */
app.get('/api/folders', (req, res) => {
  try {
    const structure = buildFolderStructure();
    res.json(structure);
  } catch (error) {
    console.error('Error building folder structure:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 9. Get Photos in Folder
 * GET /api/folders/:folderId
 */
app.get('/api/folders/:folderId', (req, res) => {
  try {
    const { folderId } = req.params;
    const recursive = req.query.recursive === 'true';

    // Special case: "all" returns all photos
    if (folderId === 'all') {
      return res.json(photosDatabase);
    }

    // Find photos in the specified folder
    const photos = photosDatabase.filter(photo => {
      const photoFolderId = crypto.createHash('md5').update(`${photo.rootPath}::${photo.folderPath}`).digest('hex').substring(0, 16);

      if (recursive) {
        // Include this folder and all subfolders
        return photoFolderId === folderId || photoFolderId.startsWith(folderId);
      } else {
        // Only this folder
        return photoFolderId === folderId;
      }
    });

    res.json(photos);
  } catch (error) {
    console.error('Error getting folder photos:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Clear disk cache directory
 * @returns {Promise<void>}
 */
async function clearDiskCache() {
  try {
    if (fs.existsSync(CACHE_DIRECTORY)) {
      const files = await fsPromises.readdir(CACHE_DIRECTORY);
      console.log(`Deleting ${files.length} cached files...`);

      for (const file of files) {
        const filePath = path.join(CACHE_DIRECTORY, file);
        await fsPromises.unlink(filePath);
      }

      console.log('Disk cache cleared successfully');
    }
  } catch (error) {
    console.error('Error clearing disk cache:', error.message);
  }
}

/**
 * 8. Trigger Manual Photo Rescan
 * POST /api/rescan
 */
app.post('/api/rescan', async (req, res) => {
  try {
    console.log('Manual rescan triggered');

    // Clear in-memory cache for fresh loading
    console.log('Clearing in-memory compression cache...');
    compressionCache.clear();

    // Clear disk cache to remove photos from deleted paths
    await clearDiskCache();

    // Rescan photos
    await scanPhotos();

    res.json({
      success: true,
      photoCount: photosDatabase.length,
      message: 'Photos rescanned successfully'
    });
  } catch (error) {
    console.error('Error rescanning photos:', error);
    res.status(500).json({ error: 'Rescan failed' });
  }
});

// Start server
async function startServer() {
  // Clear cache on startup to remove orphaned files
  console.log('Cleaning up cache on startup...');
  await clearDiskCache();

  // Serve iOS configuration profile for certificate installation
  app.get('/ios-profile', (req, res) => {
    const profilePath = path.join(__dirname, 'certificates', 'PhotoSync-CA.mobileconfig');

    if (fs.existsSync(profilePath)) {
      console.log(`[HTTP] Serving iOS configuration profile to ${req.ip}`);
      res.setHeader('Content-Type', 'application/x-apple-asconfig');
      res.setHeader('Content-Disposition', 'attachment; filename="PhotoSync-CA.mobileconfig"');
      res.sendFile(profilePath);
    } else {
      console.warn(`[HTTP] iOS profile requested but not found: ${profilePath}`);
      res.status(404).send(`
        <html>
          <body style="font-family: Arial; padding: 20px;">
            <h2>❌ iOS Profile Not Found</h2>
            <p>The iOS configuration profile has not been generated yet.</p>
            <p><strong>To generate it:</strong></p>
            <ol>
              <li>On the server computer, run: <code>npm run generate-ca</code></li>
              <li>Restart the PhotoSync app</li>
              <li>Try downloading the profile again</li>
            </ol>
          </body>
        </html>
      `);
    }
  });

  // Serve setup page with installation instructions
  app.get('/setup', (req, res) => {
    const profilePath = path.join(__dirname, 'certificates', 'PhotoSync-CA.mobileconfig');
    const profileExists = fs.existsSync(profilePath);
    const serverIP = req.headers.host?.split(':')[0] || 'localhost';

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>PhotoSync iOS Setup</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
              max-width: 600px;
              margin: 40px auto;
              padding: 20px;
              background: #f5f5f5;
            }
            .container {
              background: white;
              border-radius: 12px;
              padding: 30px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 {
              color: #007AFF;
              margin-top: 0;
            }
            h2 {
              color: #333;
              border-bottom: 2px solid #007AFF;
              padding-bottom: 10px;
            }
            .step {
              margin: 20px 0;
              padding: 15px;
              background: #f8f9fa;
              border-left: 4px solid #007AFF;
              border-radius: 4px;
            }
            .step-number {
              display: inline-block;
              background: #007AFF;
              color: white;
              width: 28px;
              height: 28px;
              border-radius: 50%;
              text-align: center;
              line-height: 28px;
              font-weight: bold;
              margin-right: 10px;
            }
            .download-btn {
              display: inline-block;
              background: #007AFF;
              color: white;
              padding: 15px 30px;
              border-radius: 8px;
              text-decoration: none;
              font-weight: bold;
              margin: 20px 0;
              text-align: center;
              font-size: 18px;
            }
            .download-btn:hover {
              background: #0051D5;
            }
            .download-btn:disabled {
              background: #ccc;
              cursor: not-allowed;
            }
            .warning {
              background: #fff3cd;
              border: 1px solid #ffc107;
              padding: 15px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .success {
              background: #d4edda;
              border: 1px solid #28a745;
              padding: 15px;
              border-radius: 8px;
              margin: 20px 0;
            }
            code {
              background: #f4f4f4;
              padding: 2px 6px;
              border-radius: 3px;
              font-family: 'Courier New', monospace;
            }
            .note {
              font-size: 14px;
              color: #666;
              font-style: italic;
              margin-top: 10px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 PhotoSync iOS Certificate Setup</h1>

            ${profileExists ? `
              <div class="success">
                <strong>✅ Certificate Profile Ready!</strong><br>
                Follow the steps below to install it on your iOS device.
              </div>

              <h2>Step 1: Download Profile</h2>
              <p>Tap the button below to download the certificate profile:</p>
              <a href="/ios-profile" class="download-btn">📥 Download Certificate Profile</a>
              <p class="note">You should see a prompt asking if you want to allow downloading a configuration profile.</p>

              <h2>Step 2: Install Profile</h2>
              <div class="step">
                <span class="step-number">1</span>
                <strong>Open Settings</strong> on your iPhone/iPad
              </div>
              <div class="step">
                <span class="step-number">2</span>
                Look for <strong>"Profile Downloaded"</strong> near the top
              </div>
              <div class="step">
                <span class="step-number">3</span>
                Tap on <strong>"PhotoSync Local CA"</strong>
              </div>
              <div class="step">
                <span class="step-number">4</span>
                Tap <strong>"Install"</strong> (top right)
              </div>
              <div class="step">
                <span class="step-number">5</span>
                Enter your device <strong>passcode</strong>
              </div>
              <div class="step">
                <span class="step-number">6</span>
                Tap <strong>"Install"</strong> again to confirm
              </div>

              <h2>Step 3: Trust Certificate</h2>
              <div class="warning">
                <strong>⚠️ Important:</strong> You must complete this step for the certificate to work!
              </div>
              <div class="step">
                <span class="step-number">1</span>
                Go to <strong>Settings → General → About</strong>
              </div>
              <div class="step">
                <span class="step-number">2</span>
                Scroll to the bottom and tap <strong>"Certificate Trust Settings"</strong>
              </div>
              <div class="step">
                <span class="step-number">3</span>
                Enable the switch for <strong>"PhotoSync Local CA"</strong>
              </div>
              <div class="step">
                <span class="step-number">4</span>
                Tap <strong>"Continue"</strong> to confirm
              </div>

              <h2>✨ Done!</h2>
              <div class="success">
                <p><strong>Your iOS device is now set up!</strong></p>
                <p>You can now connect to PhotoSync without any certificate warnings. The certificate is valid for 10 years.</p>
                <p>Open the PhotoSync PWA and scan the QR code to connect.</p>
              </div>

              <h2>Troubleshooting</h2>
              <p><strong>If you see certificate warnings:</strong></p>
              <ul>
                <li>Make sure you completed Step 3 (Certificate Trust Settings)</li>
                <li>Try restarting the PhotoSync PWA</li>
                <li>Make sure you're connected to the same WiFi network as the server</li>
              </ul>
            ` : `
              <div class="warning">
                <strong>⚠️ Certificate Not Generated</strong><br>
                The iOS certificate profile has not been created yet.
              </div>

              <h2>Server Setup Required</h2>
              <p>On the computer running PhotoSync Electron, run:</p>
              <code>npm run generate-ca</code>
              <p class="note">Then restart the PhotoSync server and refresh this page.</p>
            `}

            <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">

            <p style="text-align: center; color: #666; font-size: 14px;">
              PhotoSync v1.0.0 • Server: ${serverIP}
            </p>
          </div>
        </body>
      </html>
    `);
  });

  // Initialize PhotoDatabase wrapper (before scanning, so API endpoints work immediately)
  photoDb = new PhotoDatabase();

  // Start HTTP server for API FIRST - this allows health checks to pass immediately
  app.listen(HTTP_PORT, '0.0.0.0', () => {
    const stats = photoPathsManager.getStats();
    console.log(`\n========================================`);
    console.log(`PhotoSync Server is running`);
    console.log(`========================================`);
    console.log(`HTTP API: http://localhost:${HTTP_PORT}`);
    console.log(`Paths:    ${stats.enabled} enabled, ${stats.total} total`);
    console.log(`Cache:    ${CACHE_DIRECTORY}`);
    console.log(`========================================\n`);
  });

  // Initial photo scan (after HTTP server starts, so frontend can connect immediately)
  // Photos will appear in the gallery once the scan completes
  console.log('Starting initial photo scan...');
  await scanPhotos();
  console.log('Initial photo scan complete');

  // Rescan every 5 minutes
  setInterval(scanPhotos, 5 * 60 * 1000);

  // Check for SSL certificates (required for WSS)
  // Prefer CA-signed certificates, fall back to self-signed
  let certPath = path.join(__dirname, 'certificates', 'server-cert.pem');
  let keyPath = path.join(__dirname, 'certificates', 'server-key.pem');
  let usingCA = true;

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    // Fall back to old self-signed certificates
    certPath = path.join(__dirname, 'cert.pem');
    keyPath = path.join(__dirname, 'key.pem');
    usingCA = false;
    console.log('[HTTPS] CA-signed certificates not found, using self-signed certificates');
    console.log('[HTTPS] 💡 Run "npm run generate-ca" for better iOS support\n');
  } else {
    console.log('[HTTPS] ✅ Using CA-signed certificates');
    console.log('[HTTPS] iOS devices can install the certificate profile for trusted connections\n');
  }

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.error('[ERROR] No SSL certificates found!');
    console.error('[ERROR] Run "npm run generate-cert" or "npm run generate-ca" to create certificates');
    console.error('[ERROR] Certificates are required for secure WebSocket (WSS)\n');
    process.exit(1);
  }

  // Create HTTPS server
  let httpsServer;
  try {
    const httpsOptions = {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    };

    httpsServer = https.createServer(httpsOptions, app);
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`[HTTPS] Secure server listening on port ${HTTPS_PORT}`);
      console.log(`[HTTPS] Local:   https://localhost:${HTTPS_PORT}`);
      console.log(`[WSS]   Secure WebSocket enabled\n`);
    });
  } catch (error) {
    console.error('[ERROR] Failed to start HTTPS server:', error.message);
    process.exit(1);
  }

  // Start Socket.IO server
  const wsServer = new SocketIOServer(
    httpsServer,
    photoDb,
    compressImage,
    CACHE_DIRECTORY
  );
  wsServer.start();

  // Store Socket.IO instance for manifest update broadcasts
  wsServerInstance = wsServer;

  // Initialize WebRTC Manager
  const signalingServer = process.env.SIGNALING_SERVER || 'ws://localhost:3002';

  // Get room ID from environment variable OR device-config.json
  let roomId = process.env.WEBRTC_ROOM_ID;

  // Fallback: Read from device-config.json if env var not provided
  if (!roomId) {
    try {
      const deviceConfigPath = path.join(__dirname, 'device-config.json');
      if (fs.existsSync(deviceConfigPath)) {
        const configData = JSON.parse(fs.readFileSync(deviceConfigPath, 'utf-8'));
        roomId = configData.roomId;
        console.log(`[WebRTC] Read persistent Room ID from device-config.json: ${roomId}`);
      } else {
        console.log(`[WebRTC] No device-config.json found, will generate new Room ID`);
      }
    } catch (error) {
      console.error('[WebRTC] Error reading device-config.json:', error);
    }
  } else {
    console.log(`[WebRTC] Using Room ID from environment variable: ${roomId}`);
  }

  console.log(`\n[WebRTC] Initializing WebRTC Manager...`);
  console.log(`[WebRTC] Signaling server: ${signalingServer}`);
  console.log(`[WebRTC] Room ID: ${roomId || 'Will generate new'}`);

  // Create promise that resolves when WebRTC is ready
  webrtcReadyPromise = new Promise((resolve, reject) => {
    webrtcManager = new WebRTCManager(photoDb, signalingServer, roomId);

    // Save room ID to file so main.js can read it for QR generation
    // This ensures both processes use the same room ID
    const roomIdFilePath = path.join(__dirname, '.webrtc-room-id');
    const webrtcConfig = {
      roomId: webrtcManager.roomId,
      signalingServer: signalingServer,
      timestamp: Date.now()
    };

    try {
      fs.writeFileSync(roomIdFilePath, JSON.stringify(webrtcConfig, null, 2));
      console.log(`[WebRTC] Saved room ID to file: ${roomIdFilePath}`);
    } catch (error) {
      console.error('[WebRTC] Failed to save room ID to file:', error);
    }

    webrtcManager.on('signaling-connected', ({ roomId }) => {
      webrtcReady = true;
      console.log(`[WebRTC] ✅ Connected to signaling server`);
      console.log(`[WebRTC] Room ID: ${roomId}`);
      console.log(`\n========================================`);
      console.log(`WEBRTC CONNECTION INFO FOR QR CODE:`);
      console.log(`========================================`);
      console.log(JSON.stringify(webrtcManager.getConnectionInfo(), null, 2));
      console.log(`========================================\n`);
      resolve(); // Signal that WebRTC is ready
    });

    webrtcManager.on('error', (error) => {
      console.error('[WebRTC] Connection error:', error);
      // Don't reject - WebRTC will keep retrying
    });

    // Timeout after 30 seconds if connection fails
    setTimeout(() => {
      if (!webrtcReady) {
        console.warn('[WebRTC] Warning: Signaling server connection taking longer than expected');
        console.warn('[WebRTC] This is normal if the signaling server is starting up');
        console.warn('[WebRTC] WebRTC will continue trying to connect in the background');
      }
    }, 30000);
  });

    webrtcManager.on('room-created', ({ roomId }) => {
      console.log(`[WebRTC] Room ready for connections: ${roomId}`);
    });

    webrtcManager.on('peer-connected', ({ clientId }) => {
      console.log(`[WebRTC] ✅ Client connected via P2P: ${clientId}`);
    });

    webrtcManager.on('peer-disconnected', ({ clientId }) => {
      console.log(`[WebRTC] ❌ Client disconnected: ${clientId}`);
    });

    webrtcManager.on('peer-error', ({ clientId, error }) => {
      console.error(`[WebRTC] Peer error with ${clientId}:`, error.message);
    });

    webrtcManager.on('signaling-disconnected', () => {
      webrtcReady = false;
      console.log(`[WebRTC] ❌ Disconnected from signaling server, attempting to reconnect...`);
    });
  };


// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Shutdown] Shutting down gracefully...');
  if (webrtcManager) {
    webrtcManager.destroy();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Shutdown] Shutting down gracefully...');
  if (webrtcManager) {
    webrtcManager.destroy();
  }
  process.exit(0);
});

startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
