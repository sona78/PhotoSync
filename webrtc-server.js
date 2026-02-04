/**
 * WebRTC-enabled PhotoSync Server
 *
 * This server uses WebRTC for P2P connections instead of direct HTTP/HTTPS.
 * Benefits:
 * - No firewall configuration needed (both sides connect out)
 * - Works through VPNs
 * - Direct P2P after handshake (private, fast)
 * - No certificate complexity
 */

import dotenv from 'dotenv';
import photoPathsManager from './photo-paths-manager-server.js';
import WebRTCManager from './WebRTCManager.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env file
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const SIGNALING_SERVER = process.env.SIGNALING_SERVER || 'ws://localhost:3002';

console.log(`\n========================================`);
console.log(`PhotoSync WebRTC Server`);
console.log(`========================================`);

/**
 * PhotoDatabase wrapper class
 * Same as in server.js for compatibility
 */
class PhotoDatabase {
  constructor() {
    this.database = [];
  }

  getAllPhotos() {
    return this.database;
  }

  getPhotoById(id) {
    return this.database.find(p => p.id === id);
  }

  setPhotos(photos) {
    this.database = photos;
  }
}

// Initialize photo database
const photoDb = new PhotoDatabase();

/**
 * Scan photos from configured directories
 */
async function scanPhotos() {
  console.log('[Scan] Starting photo scan...');

  const enabledPaths = photoPathsManager.getEnabledPaths();
  if (enabledPaths.length === 0) {
    console.log('[Scan] No enabled paths configured');
    photoDb.setPhotos([]);
    return;
  }

  const photos = [];
  const supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif'];

  for (const pathObj of enabledPaths) {
    try {
      const files = await scanDirectory(pathObj.path, supportedExtensions);
      photos.push(...files);
    } catch (error) {
      console.error(`[Scan] Error scanning ${pathObj.path}:`, error.message);
    }
  }

  photoDb.setPhotos(photos);
  console.log(`[Scan] Found ${photos.length} photos`);
}

/**
 * Recursively scan directory for photos
 */
async function scanDirectory(dirPath, extensions) {
  const photos = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectory
        const subPhotos = await scanDirectory(fullPath, extensions);
        photos.push(...subPhotos);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          const stats = fs.statSync(fullPath);

          // Generate photo ID from path
          const photoId = crypto
            .createHash('md5')
            .update(fullPath)
            .digest('hex');

          photos.push({
            id: photoId,
            name: entry.name,
            path: fullPath,
            size: stats.size,
            modified: stats.mtimeMs,
            created: stats.birthtimeMs || stats.ctimeMs,
            // Note: width/height require image processing, skipped for now
            width: null,
            height: null
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning ${dirPath}:`, error.message);
  }

  return photos;
}

// Initialize WebRTC Manager
console.log(`[WebRTC] Initializing WebRTC Manager...`);
console.log(`[WebRTC] Signaling server: ${SIGNALING_SERVER}`);

const webrtcManager = new WebRTCManager(photoDb, SIGNALING_SERVER);

webrtcManager.on('signaling-connected', ({ roomId }) => {
  console.log(`[WebRTC] ✅ Connected to signaling server`);
  console.log(`[WebRTC] Room ID: ${roomId}`);
  console.log(`\n========================================`);
  console.log(`CONNECTION INFO FOR QR CODE:`);
  console.log(`========================================`);
  console.log(JSON.stringify(webrtcManager.getConnectionInfo(), null, 2));
  console.log(`========================================\n`);
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
  console.log(`[WebRTC] ❌ Disconnected from signaling server, attempting to reconnect...`);
});

webrtcManager.on('error', (error) => {
  console.error('[WebRTC] Error:', error);
});

// Initial photo scan
await scanPhotos();

// Rescan photos every 5 minutes
setInterval(async () => {
  await scanPhotos();
}, 5 * 60 * 1000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[WebRTC] Shutting down...');
  webrtcManager.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[WebRTC] Shutting down...');
  webrtcManager.destroy();
  process.exit(0);
});

console.log(`[WebRTC] Server running and waiting for connections`);
console.log(`[WebRTC] Active peers: ${webrtcManager.getStats().activePeers}`);
console.log(`========================================\n`);
