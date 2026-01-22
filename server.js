import express from 'express';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import photoPathsManager from './photo-paths-manager-server.js';

const fsPromises = fs.promises;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Configuration
const CACHE_DIRECTORY = path.join(__dirname, '.cache');

// In-memory storage
let photosDatabase = [];
let compressionCache = new Map();

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
 * Scan configured directories for photos and populate database
 * @returns {Promise<void>}
 */
async function scanPhotos() {
  console.log('Scanning photos from configured paths...');
  photosDatabase = [];

  try {
    // Get enabled paths from store
    const enabledPaths = photoPathsManager.getEnabledPaths();

    if (enabledPaths.length === 0) {
      console.log('No photo paths configured. Please add directories using the UI.');
      return;
    }

    console.log(`Scanning ${enabledPaths.length} configured path(s)...`);

    // Scan each enabled path
    for (const pathConfig of enabledPaths) {
      const dirPath = pathConfig.path;

      // Check if directory exists
      if (!fs.existsSync(dirPath)) {
        console.warn(`Directory not found: ${dirPath}`);
        continue;
      }

      try {
        const files = await fsPromises.readdir(dirPath);
        let photoCount = 0;

        for (const filename of files) {
          if (!isImageFile(filename)) continue;

          const filePath = path.join(dirPath, filename);

          try {
            const stats = await fsPromises.stat(filePath);

            // Skip if it's a directory
            if (stats.isDirectory()) continue;

            const modified = stats.mtimeMs;
            const size = stats.size;
            const id = generatePhotoId(filePath, modified);
            const dimensions = await getImageDimensions(filePath);

            photosDatabase.push({
              id,
              filename,
              path: filePath,
              size,
              modified,
              dimensions
            });

            photoCount++;
          } catch (error) {
            console.error(`Error processing ${filePath}:`, error.message);
          }
        }

        console.log(`  - ${dirPath}: ${photoCount} photos`);
      } catch (error) {
        console.error(`Error scanning directory ${dirPath}:`, error.message);
      }
    }

    console.log(`Total photos found: ${photosDatabase.length}`);
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

  // Initial photo scan
  await scanPhotos();

  // Rescan every 5 minutes
  setInterval(scanPhotos, 5 * 60 * 1000);

  app.listen(PORT, '0.0.0.0', () => {
    const stats = photoPathsManager.getStats();
    console.log(`\n========================================`);
    console.log(`PhotoSync Server is running`);
    console.log(`========================================`);
    console.log(`Local:   http://localhost:${PORT}`);
    console.log(`Network: http://192.168.1.5:${PORT}`);
    console.log(`Paths:   ${stats.enabled} enabled, ${stats.total} total`);
    console.log(`Cache:   ${CACHE_DIRECTORY}`);
    console.log(`========================================\n`);
  });
}

startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
