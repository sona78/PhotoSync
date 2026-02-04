import WebSocket from 'ws';
import { encode, decode } from '@msgpack/msgpack';
import fs from 'fs';
import crypto from 'crypto';

const WS_URL = 'ws://localhost:3001';
const OUTPUT_DIR = './test-output';

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Photo reassembly buffers
const photoBuffers = new Map(); // photoId => { chunks: [], expectedChunks: 0, receivedChunks: 0 }

let manifestPhotos = [];

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✓ Connected to WebSocket server');
  console.log('');

  // Test 1: Request manifest
  console.log('📋 Requesting photo manifest...');
  send({
    type: 'REQUEST_MANIFEST',
    requestId: 1,
    timestamp: Date.now()
  });
});

ws.on('message', (data) => {
  try {
    const message = decode(data);
    handleMessage(message);
  } catch (error) {
    console.error('❌ Error decoding message:', error);
  }
});

function handleMessage(message) {
  const { type } = message;

  switch (type) {
    case 'MANIFEST_RESPONSE':
      handleManifest(message);
      break;

    case 'BATCH_RESPONSE':
      handleBatchResponse(message);
      break;

    case 'PHOTO_DATA':
      handlePhotoChunk(message);
      break;

    case 'PHOTO_COMPLETE':
      handlePhotoComplete(message);
      break;

    case 'PHOTO_ERROR':
      console.error(`❌ Photo error: ${message.photoId} - ${message.error}`);
      break;

    case 'ORIGINAL_BATCH_RESPONSE':
      handleOriginalBatchResponse(message);
      break;

    case 'ORIGINAL_BATCH_PROGRESS':
      handleOriginalBatchProgress(message);
      break;

    case 'PONG':
      handlePong(message);
      break;

    case 'ERROR':
      console.error(`❌ Server error: ${message.code} - ${message.message}`);
      break;

    default:
      console.log('⚠️  Unknown message type:', type);
  }
}

function handleManifest(message) {
  console.log(`✓ Received manifest: ${message.count} photos (hash: ${message.hash})`);
  manifestPhotos = message.photos;

  if (message.photos.length > 0) {
    console.log(`\nFirst 3 photos:`);
    message.photos.slice(0, 3).forEach((photo, index) => {
      console.log(`  ${index + 1}. ${photo.filename} (${photo.width}x${photo.height}, ${(photo.size / 1024).toFixed(1)}KB)`);
    });
  }

  // Test 2: Request compressed batch (first 5 photos)
  if (message.photos.length > 0) {
    const photosToRequest = message.photos.slice(0, Math.min(5, message.photos.length));
    const photoIds = photosToRequest.map(p => p.id);

    console.log(`\n📦 Requesting compressed batch of ${photoIds.length} photos...`);
    console.log(`   Quality: 70, Max Dimension: 1920px`);

    send({
      type: 'REQUEST_BATCH',
      requestId: 2,
      timestamp: Date.now(),
      photoIds,
      quality: 70,
      maxDimension: 1920
    });
  }
}

function handleBatchResponse(message) {
  console.log(`✓ Batch started: ${message.totalPhotos} photos (estimated: ${message.estimatedTime.toFixed(1)}s)`);
  console.log('');
}

function handlePhotoChunk(message) {
  const { photoId, chunkSeq, totalChunks, totalSize, data } = message;

  if (!photoBuffers.has(photoId)) {
    photoBuffers.set(photoId, {
      chunks: new Array(totalChunks),
      expectedChunks: totalChunks,
      receivedChunks: 0,
      totalSize
    });
    console.log(`📸 [${photoId.substring(0, 8)}] Receiving photo (${totalChunks} chunks, ${(totalSize / 1024).toFixed(1)}KB)`);
  }

  const photoBuffer = photoBuffers.get(photoId);
  photoBuffer.chunks[chunkSeq] = Buffer.from(data);
  photoBuffer.receivedChunks++;

  // Show progress for larger photos
  if (totalChunks > 5 && chunkSeq % 5 === 0) {
    const progress = Math.round((photoBuffer.receivedChunks / totalChunks) * 100);
    console.log(`   Progress: ${progress}% (${photoBuffer.receivedChunks}/${totalChunks} chunks)`);
  }
}

function handlePhotoComplete(message) {
  const { photoId, totalSize, checksum } = message;

  const photoBuffer = photoBuffers.get(photoId);

  if (!photoBuffer) {
    console.error(`❌ Photo ${photoId} completed but no buffer found`);
    return;
  }

  // Concatenate chunks
  const fullBuffer = Buffer.concat(photoBuffer.chunks);

  // Verify size
  if (fullBuffer.length !== totalSize) {
    console.error(`❌ Size mismatch for ${photoId}! Expected: ${totalSize}, Got: ${fullBuffer.length}`);
    return;
  }

  // Verify checksum
  const actualChecksum = crypto.createHash('md5').update(fullBuffer).digest('hex');

  if (actualChecksum !== checksum) {
    console.error(`❌ Checksum mismatch for ${photoId}!`);
    console.error(`   Expected: ${checksum}`);
    console.error(`   Got: ${actualChecksum}`);
    return;
  }

  // Find filename from manifest
  const photoInfo = manifestPhotos.find(p => p.id === photoId);
  const filename = photoInfo ? photoInfo.filename : `${photoId}.jpg`;

  // Save to disk
  const outputPath = `${OUTPUT_DIR}/${filename}`;
  fs.writeFileSync(outputPath, fullBuffer);

  console.log(`✓ [${photoId.substring(0, 8)}] Complete! Size: ${(totalSize / 1024).toFixed(1)}KB, Checksum: OK`);
  console.log(`   Saved to: ${outputPath}`);
  console.log('');

  // Cleanup
  photoBuffers.delete(photoId);
}

function handleOriginalBatchResponse(message) {
  console.log(`✓ Original batch started: ${message.found} found, ${message.notFound} not found`);
  console.log(`   Total size: ${(message.totalSize / (1024 * 1024)).toFixed(1)}MB`);
  console.log(`   Estimated time: ${message.estimatedTime}s`);
  console.log('');
}

function handleOriginalBatchProgress(message) {
  const progress = Math.round((message.completed / message.total) * 100);
  console.log(`📊 Progress: ${progress}% (${message.completed}/${message.total} photos)`);
}

function handlePong(message) {
  console.log(`🏓 PONG received at ${new Date(message.timestamp).toLocaleTimeString()}`);
}

function send(message) {
  const encoded = encode(message);
  ws.send(encoded);
}

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', () => {
  console.log('\n✓ Disconnected from server');
  console.log(`\n📁 Photos saved to: ${OUTPUT_DIR}/`);
  process.exit(0);
});

// Test 3: Ping test every 30 seconds
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    console.log('\n🏓 Sending PING...');
    send({
      type: 'PING',
      requestId: Date.now(),
      timestamp: Date.now()
    });
  }
}, 30000);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  ws.close();
});

console.log(`\n========================================`);
console.log(`PhotoSync WebSocket Test Client`);
console.log(`========================================`);
console.log(`Connecting to: ${WS_URL}`);
console.log(`Output directory: ${OUTPUT_DIR}`);
console.log(`========================================\n`);
