import { EventEmitter } from 'events';
import SimplePeer from 'simple-peer';
import wrtc from '@roamhq/wrtc';
import { io } from 'socket.io-client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

/**
 * WebRTC Manager for Desktop
 * Manages P2P connections with mobile clients via WebRTC
 */
class WebRTCManager extends EventEmitter {
  constructor(photoDb, signalingServerUrl, roomId = null) {
    super();

    this.photoDb = photoDb;
    this.signalingServerUrl = signalingServerUrl;
    // Use provided room ID or generate a new one
    this.roomId = roomId || this.generateRoomId();
    this.peers = new Map(); // clientId -> peer connection
    this.peerHeartbeats = new Map(); // clientId -> heartbeat interval
    this.signalingSocket = null;
    this.connected = false;
    this.heartbeatInterval = null; // Signaling keep-alive timer

    console.log(`[WebRTCManager] Room ID: ${this.roomId}`);
    this.setupSignalingConnection();
  }

  /**
   * Generate unique room ID for this desktop instance
   */
  generateRoomId() {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Connect to signaling server
   */
  setupSignalingConnection() {
    console.log(`[WebRTC] Connecting to signaling server: ${this.signalingServerUrl}`);

    this.signalingSocket = io(this.signalingServerUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity
    });

    this.signalingSocket.on('connect', () => {
      console.log('[WebRTC] Connected to signaling server');
      this.connected = true;

      // Create room
      this.signalingSocket.emit('create-room', {
        roomId: this.roomId,
        deviceToken: this.roomId // Use roomId as device token
      });

      // Start heartbeat to keep signaling connection alive
      this.startHeartbeat();

      this.emit('signaling-connected', { roomId: this.roomId });
    });

    this.signalingSocket.on('room-created', ({ roomId }) => {
      console.log(`[WebRTC] Room created: ${roomId}`);
      this.emit('room-created', { roomId });
    });

    this.signalingSocket.on('client-joined', ({ clientId, clientCount }) => {
      console.log(`[WebRTC] Client joined: ${clientId}, total clients: ${clientCount}`);
      this.createPeerConnection(clientId);
    });

    this.signalingSocket.on('client-disconnected', ({ clientId, clientCount }) => {
      console.log(`[WebRTC] Client disconnected: ${clientId}, remaining: ${clientCount}`);
      this.closePeerConnection(clientId);
    });

    this.signalingSocket.on('signal', ({ from, signal, type }) => {
      console.log(`[WebRTC] Received signal from ${from}: ${type || 'unknown'}`);
      const peer = this.peers.get(from);
      if (peer) {
        peer.signal(signal);
      }
    });

    this.signalingSocket.on('offer', ({ from, offer }) => {
      console.log(`[WebRTC] Received offer from ${from}`);
      // If we receive an offer, we're not the initiator
      if (!this.peers.has(from)) {
        this.createPeerConnection(from, false);
      }
      const peer = this.peers.get(from);
      if (peer) {
        peer.signal(offer);
      }
    });

    this.signalingSocket.on('answer', ({ from, answer }) => {
      console.log(`[WebRTC] Received answer from ${from}`);
      const peer = this.peers.get(from);
      if (peer) {
        peer.signal(answer);
      }
    });

    this.signalingSocket.on('ice-candidate', ({ from, candidate }) => {
      console.log(`[WebRTC] Received ICE candidate from ${from}`);
      const peer = this.peers.get(from);
      if (peer) {
        peer.signal({ candidate });
      }
    });

    this.signalingSocket.on('disconnect', () => {
      console.log('[WebRTC] Disconnected from signaling server');
      this.connected = false;
      this.stopHeartbeat();
      this.emit('signaling-disconnected');
    });

    this.signalingSocket.on('error', (error) => {
      console.error('[WebRTC] Signaling error:', error);
      this.emit('error', error);
    });

    // Listen for pong responses
    this.signalingSocket.on('pong', ({ timestamp }) => {
      const latency = Date.now() - timestamp;
      console.log(`[WebRTC] Received heartbeat pong - Latency: ${latency}ms`);
      if (latency > 5000) {
        console.warn(`[WebRTC] High signaling latency: ${latency}ms`);
      }
    });
  }

  /**
   * Start heartbeat to keep signaling connection alive
   */
  startHeartbeat() {
    // Clear any existing heartbeat
    this.stopHeartbeat();

    console.log('[WebRTC] Starting signaling heartbeat (30s interval)');

    // Send ping every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.signalingSocket?.connected) {
        console.log('[WebRTC] Sending heartbeat ping to signaling server');
        this.signalingSocket.emit('ping');
      } else {
        console.warn('[WebRTC] Heartbeat skipped - signaling socket not connected');
      }
    }, 30000);

    // Send first ping immediately
    if (this.signalingSocket?.connected) {
      console.log('[WebRTC] Sending initial heartbeat ping');
      this.signalingSocket.emit('ping');
    }
  }

  /**
   * Stop heartbeat timer
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      console.log('[WebRTC] Stopping signaling heartbeat');
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Start P2P data channel heartbeat for a specific peer
   */
  startPeerHeartbeat(clientId) {
    // Clear any existing heartbeat for this peer
    this.stopPeerHeartbeat(clientId);

    console.log(`[WebRTC] Starting P2P heartbeat for ${clientId} (20s interval)`);

    // Send ping every 20 seconds to keep data channel alive
    const interval = setInterval(() => {
      const peer = this.peers.get(clientId);
      if (peer && peer.connected && !peer.destroyed) {
        this.sendToPeer(clientId, { type: 'ping', timestamp: Date.now() });
      } else {
        // Peer disconnected, stop heartbeat
        this.stopPeerHeartbeat(clientId);
      }
    }, 20000);

    this.peerHeartbeats.set(clientId, interval);

    // Send first ping immediately
    this.sendToPeer(clientId, { type: 'ping', timestamp: Date.now() });
  }

  /**
   * Stop P2P heartbeat for a specific peer
   */
  stopPeerHeartbeat(clientId) {
    const interval = this.peerHeartbeats.get(clientId);
    if (interval) {
      console.log(`[WebRTC] Stopping P2P heartbeat for ${clientId}`);
      clearInterval(interval);
      this.peerHeartbeats.delete(clientId);
    }
  }

  /**
   * Create peer connection with a client
   */
  createPeerConnection(clientId, initiator = true) {
    console.log(`[WebRTC] Creating peer connection with ${clientId}, initiator: ${initiator}`);

    const peer = new SimplePeer({
      initiator,
      wrtc,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      },
      // Allow large data transfers
      channelConfig: {
        maxPacketLifeTime: 30000,
      },
      // Optimize for large file transfers
      offerOptions: {
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      }
    });

    peer.on('signal', (signal) => {
      console.log(`[WebRTC] Sending signal to ${clientId}`);

      // Determine signal type for better logging
      let type = 'unknown';
      if (signal.type === 'offer') type = 'offer';
      else if (signal.type === 'answer') type = 'answer';
      else if (signal.candidate) type = 'ice-candidate';

      if (signal.type === 'offer') {
        this.signalingSocket.emit('offer', { to: clientId, offer: signal });
      } else if (signal.type === 'answer') {
        this.signalingSocket.emit('answer', { to: clientId, answer: signal });
      } else if (signal.candidate) {
        this.signalingSocket.emit('ice-candidate', { to: clientId, candidate: signal.candidate });
      } else {
        this.signalingSocket.emit('signal', { to: clientId, signal, type });
      }
    });

    peer.on('connect', () => {
      console.log(`[WebRTC] P2P connection established with ${clientId}`);
      this.emit('peer-connected', { clientId });

      // Start P2P heartbeat to keep data channel alive
      this.startPeerHeartbeat(clientId);

      // Send initial manifest
      this.sendManifest(clientId);
    });

    peer.on('data', (data) => {
      this.handlePeerMessage(clientId, data);
    });

    peer.on('error', (err) => {
      console.error(`[WebRTC] Peer error with ${clientId}:`, err);
      console.error(`[WebRTC] Error details:`, {
        message: err.message,
        code: err.code,
        peerConnected: peer.connected,
        peerDestroyed: peer.destroyed
      });
      this.emit('peer-error', { clientId, error: err });
    });

    peer.on('close', () => {
      console.log(`[WebRTC] P2P connection closed with ${clientId}`);
      console.log(`[WebRTC] Close details:`, {
        wasConnected: peer.connected,
        destroyed: peer.destroyed,
        signalingConnected: this.signalingSocket?.connected
      });
      this.closePeerConnection(clientId);
    });

    this.peers.set(clientId, peer);
    return peer;
  }

  /**
   * Close peer connection
   */
  closePeerConnection(clientId) {
    // Stop P2P heartbeat
    this.stopPeerHeartbeat(clientId);

    const peer = this.peers.get(clientId);
    if (peer) {
      peer.destroy();
      this.peers.delete(clientId);
      this.emit('peer-disconnected', { clientId });
    }
  }

  /**
   * Handle message from peer
   */
  handlePeerMessage(clientId, data) {
    try {
      const message = JSON.parse(data.toString());
      console.log(`[WebRTC] Message from ${clientId}:`, message.type);

      switch (message.type) {
        case 'request-manifest':
          this.sendManifest(clientId);
          break;

        case 'request-photo':
          this.sendPhoto(clientId, message.photoId, message.quality, message.maxDimension);
          break;

        case 'ping':
          // Respond to P2P ping
          this.sendToPeer(clientId, { type: 'pong', timestamp: message.timestamp });
          break;

        case 'pong':
          // P2P pong received - calculate latency
          const latency = Date.now() - message.timestamp;
          if (latency > 1000) {
            console.warn(`[WebRTC] High P2P latency with ${clientId}: ${latency}ms`);
          }
          break;

        default:
          console.log(`[WebRTC] Unknown message type: ${message.type}`);
      }
    } catch (e) {
      console.error('[WebRTC] Error parsing message:', e);
    }
  }

  /**
   * Send manifest to peer
   */
  sendManifest(clientId) {
    const photos = this.photoDb.getAllPhotos();
    const manifest = photos.map(photo => ({
      id: photo.id,
      name: photo.name,
      size: photo.size,
      width: photo.width,
      height: photo.height,
      modified: photo.modified,
      created: photo.created
    }));

    this.sendToPeer(clientId, {
      type: 'manifest',
      photos: manifest,
      count: manifest.length
    });

    console.log(`[WebRTC] Sent manifest to ${clientId}: ${manifest.length} photos`);
  }

  /**
   * Send photo to peer
   */
  async sendPhoto(clientId, photoId, quality = 60, maxDimension = 1920) {
    try {
      const photo = this.photoDb.getPhotoById(photoId);
      if (!photo) {
        this.sendToPeer(clientId, {
          type: 'error',
          photoId,
          error: 'Photo not found'
        });
        return;
      }

      const requestType = maxDimension <= 300 ? 'thumbnail' : maxDimension <= 1920 ? 'preview' : 'full-size';
      console.log(`[WebRTC] Sending ${requestType} photo ${photo.name} to ${clientId} (quality: ${quality}, maxDim: ${maxDimension}px)`);

      // Read and resize photo file
      let photoBuffer;

      try {
        // Determine output format based on original file and quality needs
        const ext = path.extname(photo.path).toLowerCase();
        const isPNG = ext === '.png';
        const isHEIC = ext === '.heic' || ext === '.heif';

        // Build sharp pipeline
        let sharpInstance = sharp(photo.path)
          .resize(maxDimension, maxDimension, {
            fit: 'inside',
            withoutEnlargement: true
          });

        // Convert to JPEG for better compression (preserves quality while reducing size)
        // For PNG with transparency, we add a white background first
        if (isPNG) {
          sharpInstance = sharpInstance.flatten({ background: { r: 255, g: 255, b: 255 } });
        }

        photoBuffer = await sharpInstance
          .jpeg({ quality })
          .toBuffer();

        const originalSize = fs.statSync(photo.path).size;
        const compressionRatio = ((1 - photoBuffer.length / originalSize) * 100).toFixed(1);
        console.log(`[WebRTC] Compressed photo from ${originalSize} to ${photoBuffer.length} bytes (${compressionRatio}% reduction)`);
      } catch (err) {
        console.log(`[WebRTC] Image processing failed, sending original:`, err.message);
        // Fallback to original file if processing fails
        photoBuffer = fs.readFileSync(photo.path);
      }

      // Determine MIME type (after processing, always JPEG for better compatibility and compression)
      const mimeType = 'image/jpeg';

      // Send photo metadata first
      this.sendToPeer(clientId, {
        type: 'photo-start',
        photoId,
        name: photo.name,
        size: photoBuffer.length,
        mimeType
      });

      // Send photo in chunks (64KB chunks for faster transfer)
      const chunkSize = 64 * 1024;
      let offset = 0;

      while (offset < photoBuffer.length) {
        const chunk = photoBuffer.slice(offset, offset + chunkSize);
        const peer = this.peers.get(clientId);

        // Check if peer is still connected
        if (!peer || peer.destroyed || !peer.connected) {
          console.warn(`[WebRTC] Peer ${clientId} disconnected during transfer (destroyed: ${peer?.destroyed}, connected: ${peer?.connected})`);
          return;
        }

        try {
          peer.send(chunk);
        } catch (err) {
          console.error(`[WebRTC] Error sending chunk to ${clientId}:`, err.message);
          console.warn(`[WebRTC] Transfer aborted - connection error during send`);
          // Don't force close - let the connection close naturally
          return;
        }

        offset += chunkSize;

        // Minimal delay to prevent overwhelming (WebRTC has built-in flow control)
        if (offset < photoBuffer.length) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }

      // Send completion message
      this.sendToPeer(clientId, {
        type: 'photo-complete',
        photoId,
        totalBytes: photoBuffer.length
      });

      console.log(`[WebRTC] Photo ${photoId} sent to ${clientId}: ${photoBuffer.length} bytes`);
    } catch (error) {
      console.error(`[WebRTC] Error sending photo:`, error);

      // Only try to send error message if peer is still connected
      const peer = this.peers.get(clientId);
      if (peer && !peer.destroyed && peer.connected) {
        this.sendToPeer(clientId, {
          type: 'error',
          photoId,
          error: error.message
        });
      }
    }
  }

  /**
   * Send JSON message to peer
   */
  sendToPeer(clientId, message) {
    const peer = this.peers.get(clientId);
    if (peer && !peer.destroyed && peer.connected) {
      try {
        peer.send(JSON.stringify(message));
      } catch (err) {
        console.error(`[WebRTC] Error sending message to ${clientId}:`, err.message);
        // Don't close connection - let it close naturally if truly dead
        // The 'close' event handler will clean up
      }
    } else if (peer) {
      console.warn(`[WebRTC] Cannot send to ${clientId} - peer not connected (destroyed: ${peer.destroyed}, connected: ${peer.connected})`);
    }
  }

  /**
   * Get MIME type from file path
   */
  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.heic': 'image/heic',
      '.heif': 'image/heif'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Get connection info for QR code
   */
  getConnectionInfo() {
    return {
      type: 'webrtc',
      signalingServer: this.signalingServerUrl,
      roomId: this.roomId,
      version: '1.0'
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      roomId: this.roomId,
      signalingConnected: this.connected,
      activePeers: this.peers.size,
      signalingServer: this.signalingServerUrl
    };
  }

  /**
   * Cleanup and disconnect
   */
  destroy() {
    console.log('[WebRTC] Destroying WebRTC manager');

    // Stop signaling heartbeat
    this.stopHeartbeat();

    // Stop all P2P heartbeats
    for (const clientId of this.peerHeartbeats.keys()) {
      this.stopPeerHeartbeat(clientId);
    }

    // Close all peer connections
    for (const [clientId, peer] of this.peers) {
      peer.destroy();
    }
    this.peers.clear();

    // Disconnect from signaling server
    if (this.signalingSocket) {
      this.signalingSocket.disconnect();
      this.signalingSocket = null;
    }

    this.emit('destroyed');
  }
}

export default WebRTCManager;
