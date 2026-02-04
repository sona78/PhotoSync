import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

const fsPromises = fs.promises;

/**
 * PhotoWorker - Sequential photo processing with socket.io-stream
 * Handles compression and streaming for both compressed and original photos
 */
export default class PhotoWorker {
  constructor(photoDatabase, compressImageFn, cacheDirectory) {
    this.photoDatabase = photoDatabase;
    this.compressImageFn = compressImageFn;
    this.cacheDirectory = cacheDirectory;

    // Queue management
    this.queue = [];
    this.busy = false;
  }

  /**
   * Queue a photo processing job
   * @param {Object} job - Job configuration
   * @returns {Promise<void>}
   */
  async queueJob(job) {
    return new Promise((resolve, reject) => {
      this.queue.push({ ...job, resolve, reject });
      if (!this.busy) {
        this.processQueue();
      }
    });
  }

  /**
   * Process jobs sequentially from queue
   */
  async processQueue() {
    if (this.busy || this.queue.length === 0) return;

    this.busy = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();

      try {
        if (job.type === 'compressed') {
          await this.processCompressedPhoto(job);
        } else if (job.type === 'original') {
          await this.processOriginalPhoto(job);
        }
        job.resolve();
      } catch (error) {
        console.error(`[PhotoWorker] Error processing job:`, error.message);
        job.reject(error);
      }
    }

    this.busy = false;
  }

  /**
   * Process compressed photo with Socket.IO native binary support
   * @param {Object} job - Job with photoId, quality, maxDimension, socket
   */
  async processCompressedPhoto(job) {
    const { photoId, quality, maxDimension, socket } = job;

    // Get photo metadata
    const photo = this.photoDatabase.getPhoto(photoId);
    if (!photo) {
      throw new Error(`Photo not found in database: ${photoId}`);
    }

    // Check file exists
    if (!fs.existsSync(photo.path)) {
      throw new Error(`Photo file not found on disk: ${photo.path}`);
    }

    // Compress (uses existing cache system)
    const compressedBuffer = await this.compressImageFn(
      photo.path,
      quality,
      maxDimension,
      photoId
    );

    // Calculate checksum
    const checksum = crypto.createHash('md5').update(compressedBuffer).digest('hex');

    // Send photo data (Socket.IO handles binary automatically)
    socket.emit('photo:data', {
      photoId,
      chunk: compressedBuffer,
      totalSize: compressedBuffer.length,
      checksum,
      mimeType: 'image/jpeg'
    });

    // Emit completion event
    socket.emit('photo:complete', {
      photoId,
      totalSize: compressedBuffer.length,
      checksum
    });
  }

  /**
   * Process original photo with Socket.IO native binary support
   * @param {Object} job - Job with photoId, socket
   */
  async processOriginalPhoto(job) {
    const { photoId, socket } = job;

    // Get photo metadata
    const photo = this.photoDatabase.getPhoto(photoId);
    if (!photo) {
      throw new Error(`Photo not found in database: ${photoId}`);
    }

    // Check file exists
    if (!fs.existsSync(photo.path)) {
      throw new Error(`Photo file not found on disk: ${photo.path}`);
    }

    // Read entire file
    const fullBuffer = await fsPromises.readFile(photo.path);

    // Calculate checksum
    const checksum = crypto.createHash('md5').update(fullBuffer).digest('hex');

    // Determine MIME type
    const ext = path.extname(photo.path).toLowerCase();
    const mimeType = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.heic': 'image/heic'
    }[ext] || 'image/jpeg';

    // Send photo data (Socket.IO handles binary automatically)
    socket.emit('photo:data', {
      photoId,
      chunk: fullBuffer,
      totalSize: fullBuffer.length,
      checksum,
      mimeType
    });

    // Emit completion event
    socket.emit('photo:complete', {
      photoId,
      totalSize: fullBuffer.length,
      checksum
    });
  }

  /**
   * Get queue status
   * @returns {Object} Status with busy flag and queue length
   */
  getStatus() {
    return {
      busy: this.busy,
      queueLength: this.queue.length
    };
  }
}
