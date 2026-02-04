import { Server } from 'socket.io';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PhotoWorker from './PhotoWorker.js';
import deviceTokenManager from '../device-token-manager-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Socket.IO server for PhotoSync with native binary support
 * Handles photo manifest requests, batch transfers, and streaming
 */
export default class SocketIOServer {
  constructor(httpsServer, photoDatabase, compressImageFn, cacheDirectory) {
    this.httpsServer = httpsServer;
    this.photoDatabase = photoDatabase;
    this.io = null;

    // Configuration constants
    this.MAX_BATCH_SIZE = 500;

    // Authentication & rate limiting
    this.authAttempts = new Map(); // ip => { count, resetAt }
    this.MAX_AUTH_ATTEMPTS = 10;
    this.AUTH_WINDOW = 15 * 60 * 1000; // 15 minutes
    this.tokenFileWatcher = null;

    // Create shared worker (one for all connections)
    this.photoWorker = new PhotoWorker(
      photoDatabase,
      compressImageFn,
      cacheDirectory
    );
  }

  /**
   * Start Socket.IO server
   */
  start() {
    // Initialize Socket.IO server
    this.io = new Server(this.httpsServer, {
      // Binary support (no MessagePack needed)
      transports: ['websocket', 'polling'],

      // Performance tuning
      pingInterval: 25000, // 25 seconds
      pingTimeout: 60000,  // 60 seconds

      // Increase max payload for large photos
      maxHttpBufferSize: 10 * 1024 * 1024, // 10MB

      // Connection timeout
      connectTimeout: 30000, // 30 seconds

      // CORS
      cors: {
        origin: true,
        credentials: true
      }
    });

    // Authentication middleware
    this.io.use(this.authMiddleware.bind(this));

    // Connection handler
    this.io.on('connection', this.handleConnection.bind(this));

    // Start watching token file for revocations
    this.startTokenFileWatcher();

    console.log('[Socket.IO] Server started');
  }

  /**
   * Authentication middleware - validates before connection completes
   * @param {Socket} socket - Socket.IO socket
   * @param {Function} next - Continue callback
   */
  async authMiddleware(socket, next) {
    const authStartTime = Date.now();
    const ip = socket.handshake.address;
    const userAgent = socket.handshake.headers['user-agent'] || 'Unknown';

    // Detect device type from User-Agent
    const isIOS = /iPhone|iPad|iPod/.test(userAgent);
    const isAndroid = /Android/.test(userAgent);
    const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);

    console.log('[Socket.IO] ========== AUTH ATTEMPT ==========');
    console.log('[Socket.IO] IP:', ip);
    console.log('[Socket.IO] User-Agent:', userAgent);
    console.log('[Socket.IO] Device:', isIOS ? 'iOS' : isAndroid ? 'Android' : 'Other', isSafari ? '(Safari)' : '');

    // Rate limiting
    const rateCheck = this.checkRateLimit(ip);
    if (!rateCheck.allowed) {
      console.log(`[Socket.IO] ❌ Auth rejected: Rate limit exceeded (${rateCheck.retryAfter}s remaining)`);
      return next(new Error(`RATE_LIMIT_EXCEEDED:${rateCheck.retryAfter}`));
    }

    // Extract auth data
    const { token, deviceName, version } = socket.handshake.auth;

    console.log('[Socket.IO] Auth details:', {
      hasToken: !!token,
      tokenLength: token?.length,
      deviceName: deviceName || 'not provided',
      clientVersion: version || 'not provided'
    });

    // Validate token
    if (!token || typeof token !== 'string' || token.length !== 64) {
      console.log('[Socket.IO] ❌ Auth rejected: Invalid token format');
      return next(new Error('INVALID_TOKEN'));
    }

    // Validate token format (64-char hex)
    if (!/^[0-9a-f]+$/i.test(token)) {
      console.log('[Socket.IO] ❌ Auth rejected: Token not hexadecimal');
      return next(new Error('INVALID_TOKEN'));
    }

    // Validate with token manager
    console.log('[Socket.IO] Validating token with device token manager...');
    const validation = deviceTokenManager.validateToken(token);

    if (!validation.valid) {
      const authTime = Date.now() - authStartTime;
      console.log(`[Socket.IO] ❌ Auth FAILED: ${validation.reason}`);
      console.log(`[Socket.IO] Auth time: ${authTime}ms`);
      console.log(`[Socket.IO] Token (first 16 chars): ${token.substring(0, 16)}...`);
      return next(new Error(validation.reason));
    }

    // Authentication successful - attach data to socket
    const authTime = Date.now() - authStartTime;
    socket.data = {
      authenticated: true,
      authToken: token,
      userId: validation.token.userId,
      deviceName: deviceName || validation.token.deviceName,
      deviceId: validation.token.deviceId,
      expiresAt: validation.token.expiresAt,
      userEmail: validation.token.userEmail,
      // Connection metadata
      ip,
      userAgent,
      isIOS,
      isAndroid,
      isSafari,
      connectedAt: new Date().toISOString()
    };

    console.log('[Socket.IO] ✅ Auth SUCCESS!');
    console.log('[Socket.IO] Device:', socket.data.deviceName);
    console.log('[Socket.IO] User:', socket.data.userEmail);
    console.log('[Socket.IO] Device ID:', socket.data.deviceId);
    console.log('[Socket.IO] Token expires:', new Date(socket.data.expiresAt).toISOString());
    console.log('[Socket.IO] Auth time:', authTime + 'ms');
    console.log('[Socket.IO] iOS client:', socket.data.isIOS ? 'YES' : 'NO');
    console.log('[Socket.IO] ==========================================');

    next(); // Allow connection
  }

  /**
   * Handle new client connection
   * @param {Socket} socket - Socket.IO socket
   */
  handleConnection(socket) {
    const { deviceName, userId, deviceId } = socket.data;

    console.log('[Socket.IO] ========== CLIENT CONNECTED ==========');
    console.log('[Socket.IO] Socket ID:', socket.id);
    console.log('[Socket.IO] Device:', deviceName);
    console.log('[Socket.IO] User ID:', userId);
    console.log('[Socket.IO] Device ID:', deviceId);
    console.log('[Socket.IO] Total clients:', this.io.sockets.sockets.size);
    console.log('[Socket.IO] ===========================================');

    // Join rooms
    socket.join('authenticated');
    socket.join(`user:${userId}`);
    socket.join(`device:${deviceId}`);

    console.log('[Socket.IO] Joined rooms:', ['authenticated', `user:${userId}`, `device:${deviceId}`]);

    // Register event handlers
    socket.on('manifest:request', this.handleManifestRequest.bind(this, socket));
    socket.on('photos:request-batch', this.handleBatchRequest.bind(this, socket));
    socket.on('photos:request-originals', this.handleOriginalBatchRequest.bind(this, socket));

    // Disconnect handler
    socket.on('disconnect', (reason) => {
      const sessionDuration = Date.now() - new Date(socket.data.connectedAt).getTime();

      console.log('[Socket.IO] ========== CLIENT DISCONNECTED ==========');
      console.log('[Socket.IO] Socket ID:', socket.id);
      console.log('[Socket.IO] Device:', deviceName);
      console.log('[Socket.IO] Reason:', reason);
      console.log('[Socket.IO] Session Duration:', Math.round(sessionDuration / 1000) + 's');
      console.log('[Socket.IO] Remaining clients:', this.io.sockets.sockets.size);
      console.log('[Socket.IO] ============================================');
    });

    // Error handler
    socket.on('error', (error) => {
      console.error('[Socket.IO] ❌ Socket error:', {
        socketId: socket.id,
        device: deviceName,
        error: error.message
      });
    });
  }

  /**
   * Handle manifest request - send all photos metadata
   * @param {Socket} socket
   * @param {Object} data - Request data
   * @param {Function} ack - Acknowledgment callback
   */
  handleManifestRequest(socket, data, ack) {
    const photos = this.photoDatabase.getAllPhotos();

    console.log(`[Socket.IO] Manifest request from ${socket.data.deviceName} - ${photos.length} photos`);

    // Build manifest (exclude 'path' for security)
    const manifest = photos.map(photo => ({
      id: photo.id,
      filename: photo.filename,
      size: photo.size,
      modified: photo.modified,
      width: photo.width,
      height: photo.height
    }));

    // Calculate manifest hash
    const ids = photos.map(p => p.id).sort().join('');
    const hash = crypto.createHash('md5').update(ids).digest('hex');

    console.log(`[Socket.IO] Sending manifest with ${manifest.length} photos to ${socket.data.deviceName}`);

    // Send via acknowledgment callback
    if (ack) {
      ack({
        count: manifest.length,
        hash,
        photos: manifest,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle batch request - compressed photos with quality/dimension params
   * @param {Socket} socket
   * @param {Object} data - Request data with photoIds, quality, maxDimension
   * @param {Function} ack - Acknowledgment callback
   */
  async handleBatchRequest(socket, data, ack) {
    const { photoIds, quality = 50, maxDimension = 1920 } = data;

    console.log(`[Socket.IO] Batch request from ${socket.data.deviceName}:`, {
      photoCount: photoIds?.length,
      quality,
      maxDimension
    });

    // Validate photoIds
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      console.log('[Socket.IO] ❌ Invalid batch request: photoIds must be non-empty array');
      return ack?.({ error: { code: 'INVALID_REQUEST', message: 'photoIds must be non-empty array' } });
    }

    if (photoIds.length > this.MAX_BATCH_SIZE) {
      console.log(`[Socket.IO] ❌ Batch too large: ${photoIds.length} > ${this.MAX_BATCH_SIZE}`);
      return ack?.({ error: { code: 'BATCH_TOO_LARGE', message: `Maximum batch size is ${this.MAX_BATCH_SIZE}` } });
    }

    // Validate quality
    if (quality < 1 || quality > 100) {
      return ack?.({ error: { code: 'INVALID_QUALITY', message: 'Quality must be 1-100' } });
    }

    // Validate maxDimension
    if (maxDimension < 1 || maxDimension > 10000) {
      return ack?.({ error: { code: 'INVALID_DIMENSION', message: 'maxDimension must be 1-10000' } });
    }

    // Send batch started event
    socket.emit('photos:batch-started', {
      totalPhotos: photoIds.length,
      estimatedTime: photoIds.length * 0.05
    });

    // Process each photo
    for (const photoId of photoIds) {
      try {
        await this.photoWorker.queueJob({
          type: 'compressed',
          photoId,
          quality,
          maxDimension,
          socket // Pass socket reference
        });
      } catch (error) {
        console.error(`[Socket.IO] Error processing photo ${photoId}:`, error.message);
        socket.emit('photo:error', {
          photoId,
          code: 'PROCESSING_FAILED',
          message: error.message,
          timestamp: Date.now()
        });
      }
    }

    ack?.({ success: true });
  }

  /**
   * Handle original batch request - original photos without compression
   * @param {Socket} socket
   * @param {Object} data - Request data with photoIds
   * @param {Function} ack - Acknowledgment callback
   */
  async handleOriginalBatchRequest(socket, data, ack) {
    const { photoIds } = data;

    console.log(`[Socket.IO] Original batch request from ${socket.data.deviceName}:`, {
      photoCount: photoIds?.length
    });

    // Validate photoIds
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return ack?.({ error: { code: 'INVALID_REQUEST', message: 'photoIds must be non-empty array' } });
    }

    if (photoIds.length > this.MAX_BATCH_SIZE) {
      return ack?.({ error: { code: 'BATCH_TOO_LARGE', message: `Maximum batch size is ${this.MAX_BATCH_SIZE}` } });
    }

    // Check which photos exist
    const foundIds = [];
    const notFoundIds = [];
    let totalSize = 0;

    for (const photoId of photoIds) {
      const photo = this.photoDatabase.getPhoto(photoId);
      if (photo) {
        foundIds.push(photoId);
        totalSize += photo.size;
      } else {
        notFoundIds.push(photoId);
      }
    }

    // Send batch response
    socket.emit('photos:originals-started', {
      found: foundIds.length,
      notFound: notFoundIds.length,
      totalSize,
      estimatedTime: Math.ceil(totalSize / (1024 * 1024)),
      timestamp: Date.now()
    });

    let completedCount = 0;

    // Process each photo
    for (const photoId of foundIds) {
      try {
        await this.photoWorker.queueJob({
          type: 'original',
          photoId,
          socket // Pass socket reference
        });

        // Progress updates every 10 photos
        completedCount++;
        if (completedCount % 10 === 0 || completedCount === foundIds.length) {
          socket.emit('photos:batch-progress', {
            completed: completedCount,
            total: foundIds.length,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        console.error(`[Socket.IO] Error processing photo ${photoId}:`, error.message);
        socket.emit('photo:error', {
          photoId,
          code: 'PROCESSING_FAILED',
          message: error.message,
          timestamp: Date.now()
        });
      }
    }

    // Report not found photos as errors
    for (const photoId of notFoundIds) {
      socket.emit('photo:error', {
        photoId,
        code: 'PHOTO_NOT_FOUND',
        message: 'Photo not found in database',
        timestamp: Date.now()
      });
    }

    ack?.({ success: true });
  }

  /**
   * Broadcast event to all authenticated clients
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  broadcastToAuthenticated(event, data) {
    this.io.to('authenticated').emit(event, data);
    const clientCount = this.io.sockets.adapter.rooms.get('authenticated')?.size || 0;
    console.log(`[Socket.IO] Broadcast ${event} to ${clientCount} authenticated client(s)`);
  }

  /**
   * Check rate limiting for authentication attempts
   * @param {string} ip - Client IP address
   * @returns {{allowed: boolean, retryAfter?: number}}
   */
  checkRateLimit(ip) {
    const now = Date.now();

    let attempts = this.authAttempts.get(ip);
    if (!attempts || attempts.resetAt < now) {
      attempts = { count: 0, resetAt: now + this.AUTH_WINDOW };
      this.authAttempts.set(ip, attempts);
    }

    attempts.count++;

    if (attempts.count > this.MAX_AUTH_ATTEMPTS) {
      return {
        allowed: false,
        retryAfter: Math.ceil((attempts.resetAt - now) / 1000)
      };
    }

    return { allowed: true };
  }

  /**
   * Start watching token file for changes (revocations)
   */
  startTokenFileWatcher() {
    const tokenFilePath = path.join(__dirname, '..', 'device-tokens.json');

    try {
      this.tokenFileWatcher = fs.watch(tokenFilePath, (eventType) => {
        if (eventType === 'change') {
          console.log('[Socket.IO] Token file changed, refreshing cache and checking connections');
          deviceTokenManager.refreshCache();
          this.checkAuthenticatedConnections();
        }
      });

      console.log('[Socket.IO] Token file watcher started');
    } catch (error) {
      console.error('[Socket.IO] Error starting token file watcher:', error);
    }
  }

  /**
   * Check all authenticated connections for revoked tokens
   */
  checkAuthenticatedConnections() {
    for (const [socketId, socket] of this.io.sockets.sockets.entries()) {
      if (socket.data.authenticated) {
        const validation = deviceTokenManager.validateToken(socket.data.authToken);

        if (!validation.valid) {
          console.log(`[Socket.IO] Disconnecting socket ${socketId}: ${validation.reason}`);

          socket.emit('auth:revoked', {
            reason: validation.reason,
            message: 'Your device token has been revoked',
            timestamp: Date.now()
          });

          socket.disconnect(true); // Force disconnect
        }
      }
    }
  }

  /**
   * Stop server
   */
  stop() {
    if (this.tokenFileWatcher) {
      this.tokenFileWatcher.close();
      console.log('[Socket.IO] Token file watcher stopped');
    }

    if (this.io) {
      this.io.close();
      console.log('[Socket.IO] Server stopped');
    }
  }
}
