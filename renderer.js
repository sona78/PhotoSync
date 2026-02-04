// DOM Elements
const pathsListEl = document.getElementById('paths-list');
const addPathBtn = document.getElementById('add-path-btn');
const statusEl = document.getElementById('status');
const pathCountEl = document.getElementById('path-count');
const photoCountEl = document.getElementById('photo-count');
const galleryEl = document.getElementById('gallery');
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

// Device Pairing Elements
const generateQrBtn = document.getElementById('generate-qr-btn');
const qrCodeContainer = document.getElementById('qr-code-container');
const devicesListEl = document.getElementById('devices-list');

// State
let paths = [];
let photos = [];
let serverRunning = false;
let devices = [];
let currentQrData = null;

// Initialize
async function init() {
  console.log('[Init] Starting initialization...');
  console.log('[Init] Gallery element:', galleryEl);

  setupTabs();
  await loadPaths();

  // Wait for server to start with retry logic
  await waitForServerAndLoadPhotos();

  // Setup device pairing
  if (generateQrBtn) {
    generateQrBtn.addEventListener('click', handleGenerateQR);
    await loadDevices();
  }

  addPathBtn.addEventListener('click', handleAddPath);
  updateStatus('IDLE');

  console.log('[Init] Initialization complete');

  // Auto-refresh photos every 30 seconds
  setInterval(loadPhotos, 30000);
}

// Wait for server to start with retry mechanism
async function waitForServerAndLoadPhotos() {
  console.log('[Init] Waiting for server to start...');
  const maxRetries = 10;
  const retryDelay = 1000; // 1 second

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch('http://localhost:3000/health');
      if (response.ok) {
        // Server is ready, load photos
        console.log(`[Init] Server ready after ${i + 1} attempt(s)`);
        await loadPhotos();
        return;
      }
    } catch (error) {
      // Server not ready yet, wait and retry
      console.log(`[Init] Waiting for server... attempt ${i + 1}/${maxRetries}`);
    }

    await new Promise(resolve => setTimeout(resolve, retryDelay));
  }

  // After max retries, try loading photos anyway (will show appropriate error)
  console.log('[Init] Max retries reached, attempting to load photos anyway');
  await loadPhotos();
}

// Setup tab navigation
function setupTabs() {
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchTab(tabName);
    });
  });
}

// Switch tab
function switchTab(tabName) {
  // Update tab buttons
  tabs.forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

  // Update tab content
  tabContents.forEach(content => content.classList.remove('active'));
  document.getElementById(`tab-${tabName}`).classList.add('active');

  // Reload photos when switching to gallery
  if (tabName === 'gallery') {
    loadPhotos();
  }
}

// Update status bar
function updateStatus(status) {
  statusEl.textContent = status.toUpperCase();
}

// Load all paths
async function loadPaths() {
  try {
    paths = await window.electronAPI.photoPaths.getAll();
    pathCountEl.textContent = paths.length;
    renderPaths();
  } catch (error) {
    console.error('Failed to load paths:', error);
  }
}

// Load photos from server
async function loadPhotos() {
  try {
    console.log('[Gallery] Loading photos from server...');
    // Add cache busting to ensure fresh data
    const response = await fetch(`http://localhost:3000/api/photos?_t=${Date.now()}`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`);
    }

    photos = await response.json();
    console.log(`[Gallery] Loaded ${photos.length} photos from server`);
    photoCountEl.textContent = photos.length;
    serverRunning = true;
    renderGallery();
  } catch (error) {
    console.error('[Gallery] Error loading photos:', error);
    photoCountEl.textContent = '-';
    serverRunning = false;
    renderGallery();
  }
}

// Render photo gallery
function renderGallery() {
  console.log(`[Gallery] Rendering gallery - serverRunning: ${serverRunning}, photos: ${photos.length}`);

  // Always clear gallery first
  galleryEl.innerHTML = '';

  if (!serverRunning) {
    console.log('[Gallery] Server not running, showing loading message');
    galleryEl.innerHTML = '<div class="gallery-empty">LOADING SERVER...<br>PLEASE WAIT</div>';
    return;
  }

  if (photos.length === 0) {
    console.log('[Gallery] No photos found, showing empty message');
    galleryEl.innerHTML = '<div class="gallery-empty">NO PHOTOS FOUND<br>CONFIGURE DIRECTORIES IN SETTINGS</div>';
    return;
  }

  // Add timestamp to bust browser cache
  const cacheBuster = Date.now();

  console.log(`[Gallery] Rendering ${photos.length} photos`);
  galleryEl.innerHTML = photos.map(photo => `
    <div class="photo-item" data-id="${photo.id}">
      <img
        src="http://localhost:3000/api/photo/${photo.id}?quality=60&maxDimension=400&t=${photo.modified}&cb=${cacheBuster}"
        alt="${photo.filename}"
        loading="lazy"
      />
    </div>
  `).join('');

  // Add click handlers to photos
  document.querySelectorAll('.photo-item').forEach(item => {
    item.addEventListener('click', handlePhotoClick);
  });

  console.log('[Gallery] Gallery rendered successfully');
}

// Handle photo click
function handlePhotoClick(event) {
  const photoId = event.currentTarget.dataset.id;
  const photo = photos.find(p => p.id === photoId);

  if (photo) {
    openPhotoViewer(photo);
  }
}

// Open photo viewer modal
function openPhotoViewer(photo) {
  // Create modal HTML
  const modal = document.createElement('div');
  modal.className = 'photo-viewer';
  modal.innerHTML = `
    <div class="photo-viewer-content">
      <div class="photo-viewer-header">
        <span>${photo.filename}</span>
        <button class="close-btn">CLOSE</button>
      </div>
      <div class="photo-viewer-image">
        <img src="http://localhost:3000/api/photo/${photo.id}?t=${photo.modified}" alt="${photo.filename}" />
      </div>
    </div>
  `;

  // Add modal to body
  document.body.appendChild(modal);

  // Get elements
  const closeBtn = modal.querySelector('.close-btn');

  // Close on button click
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePhotoViewer(modal);
  });

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closePhotoViewer(modal);
    }
  });

  // Close on Escape key
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      closePhotoViewer(modal);
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

// Close photo viewer modal
function closePhotoViewer(modal) {
  modal.remove();
}

// Render paths list
function renderPaths() {
  if (paths.length === 0) {
    pathsListEl.innerHTML = '<p>NO DIRECTORIES</p>';
    return;
  }

  pathsListEl.innerHTML = '<ul>' + paths.map(path => `
    <li>
      <span>${path.path}</span>
      <button data-id="${path.id}">REMOVE</button>
    </li>
  `).join('') + '</ul>';

  // Attach event listeners
  document.querySelectorAll('button[data-id]').forEach(button => {
    button.addEventListener('click', handleRemovePath);
  });
}

// Handle add path
async function handleAddPath() {
  try {
    updateStatus('SELECTING');
    const result = await window.electronAPI.photoPaths.openDirectory();

    if (result.canceled) {
      updateStatus('CANCELLED');
      setTimeout(() => updateStatus('IDLE'), 2000);
      return;
    }

    updateStatus('ADDING');
    const dirPath = result.filePaths[0];
    const response = await window.electronAPI.photoPaths.add(dirPath);

    if (response.success) {
      updateStatus('SUCCESS');
      await loadPaths();

      // Wait for server rescan to complete
      updateStatus('SCANNING');
      const rescanResult = await triggerRescan();

      if (rescanResult.success) {
        await loadPhotos();
        console.log(`Loaded ${rescanResult.photoCount} photos`);
      }

      updateStatus('IDLE');
    } else {
      updateStatus('ERROR');
      showAlertDialog(response.message);
      setTimeout(() => updateStatus('IDLE'), 2000);
    }
  } catch (error) {
    updateStatus('ERROR');
    showAlertDialog('Failed to add path: ' + error.message);
    setTimeout(() => updateStatus('IDLE'), 2000);
  }
}

// Handle remove path
async function handleRemovePath(event) {
  const id = event.target.dataset.id;
  const path = paths.find(p => p.id === id);

  showConfirmDialog(`Remove "${path.path}"?`, async (confirmed) => {
    if (!confirmed) {
      return;
    }

    try {
      updateStatus('REMOVING');
      const response = await window.electronAPI.photoPaths.remove(id);

      if (response.success) {
        updateStatus('SUCCESS');
        await loadPaths();

        // Clear gallery immediately to show feedback
        photos = [];
        renderGallery();

        // Wait for server rescan to complete
        updateStatus('SCANNING');
        const rescanResult = await triggerRescan();

        if (rescanResult.success) {
          await loadPhotos();
          console.log(`Loaded ${rescanResult.photoCount} photos`);
        }

        updateStatus('IDLE');
      } else {
        updateStatus('ERROR');
        showAlertDialog(response.message);
        setTimeout(() => updateStatus('IDLE'), 2000);
      }
    } catch (error) {
      updateStatus('ERROR');
      showAlertDialog('Failed to remove path: ' + error.message);
      setTimeout(() => updateStatus('IDLE'), 2000);
    }
  });
}

// Trigger server rescan
async function triggerRescan() {
  if (!serverRunning) {
    return { success: false };
  }

  try {
    const response = await fetch('http://localhost:3000/api/rescan', {
      method: 'POST'
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`Rescan complete: ${result.photoCount} photos found`);
      return { success: true, photoCount: result.photoCount };
    }

    return { success: false };
  } catch (error) {
    console.log('Server not running');
    return { success: false };
  }
}

// Device Pairing Functions

// Load all device tokens
async function loadDevices() {
  try {
    const response = await window.electronAPI.devicePairing.getAll();
    if (response.success) {
      devices = response.tokens;
      renderDevices();
    }
  } catch (error) {
    console.error('Failed to load devices:', error);
  }
}

// Render devices list
function renderDevices() {
  if (!devicesListEl) return;

  if (devices.length === 0) {
    devicesListEl.innerHTML = '<p class="no-devices">NO PAIRED DEVICES</p>';
    return;
  }

  const now = Date.now();

  devicesListEl.innerHTML = '<table class="devices-table"><thead><tr><th>DEVICE NAME</th><th>CREATED</th><th>LAST USED</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>' +
    devices.map(device => {
      const isExpired = device.expiresAt < now;
      const isActive = device.active && !isExpired;
      const status = !device.active ? 'REVOKED' : isExpired ? 'EXPIRED' : 'ACTIVE';
      const statusClass = status.toLowerCase();

      return `
        <tr>
          <td>${escapeHtml(device.deviceName)}</td>
          <td>${formatDate(device.createdAt)}</td>
          <td>${device.lastUsed ? formatDate(device.lastUsed) : 'NEVER'}</td>
          <td><span class="status-badge ${statusClass}">${status}</span></td>
          <td>
            ${isActive ? `<button class="revoke-btn" data-token="${device.token}">REVOKE</button>` : `<button class="delete-btn" data-token="${device.token}">DELETE</button>`}
          </td>
        </tr>
      `;
    }).join('') + '</tbody></table>';

  // Attach event listeners
  document.querySelectorAll('.revoke-btn').forEach(button => {
    button.addEventListener('click', handleRevokeDevice);
  });

  document.querySelectorAll('.delete-btn').forEach(button => {
    button.addEventListener('click', handleDeleteDevice);
  });
}

// Handle generate QR code
async function handleGenerateQR() {
  try {
    updateStatus('GENERATING');

    // Show custom input dialog
    showInputDialog('Enter Device Name', 'Web Device', async (deviceName) => {
      if (!deviceName) {
        updateStatus('CANCELLED');
        setTimeout(() => updateStatus('IDLE'), 1000);
        return;
      }

      const response = await window.electronAPI.devicePairing.generateQR({
        deviceName: deviceName,
        userId: 'local',
        userEmail: 'local@device'
      });

      if (response.success) {
        updateStatus('SUCCESS');
        currentQrData = response;
        displayQRCode(response);
        await loadDevices();
        setTimeout(() => updateStatus('IDLE'), 1000);
      } else {
        updateStatus('ERROR');
        showAlertDialog('Failed to generate QR code: ' + response.error);
        setTimeout(() => updateStatus('IDLE'), 2000);
      }
    });
  } catch (error) {
    updateStatus('ERROR');
    showAlertDialog('Failed to generate QR code: ' + error.message);
    setTimeout(() => updateStatus('IDLE'), 2000);
  }
}

// Display QR code
function displayQRCode(qrData) {
  if (!qrCodeContainer) return;

  // Persistence indicator (if QR code is persistent)
  const persistenceInfo = qrData.persistent ? `
    <div class="persistence-info" style="background: #f0fff0; border: 3px solid #28a745; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
      <h4 style="color: #28a745; margin: 0 0 15px 0; font-size: 18px;">🔒 Persistent QR Code</h4>
      <p style="font-size: 14px; margin-bottom: 12px; line-height: 1.6;">
        This QR code is <strong>permanent</strong> and will not change when you restart the app.
      </p>
      <div class="qr-details" style="background: white; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
        <p style="margin: 8px 0; font-size: 13px;">
          <strong>Room ID:</strong>
          <code id="room-id-code" style="background: #f5f5f5; padding: 4px 8px; border-radius: 3px; user-select: all;">${escapeHtml(qrData.roomId)}</code>
          <button id="copy-room-id-btn" style="background: #007AFF; color: white; border: none; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 12px; margin-left: 8px;">
            Copy
          </button>
        </p>
        <p style="margin: 8px 0; font-size: 13px;"><strong>Signaling Server:</strong> <code style="background: #f5f5f5; padding: 4px 8px; border-radius: 3px; font-size: 11px; user-select: all;">${escapeHtml(qrData.signalingServer)}</code></p>
        <p style="margin: 8px 0; font-size: 13px;"><strong>Device:</strong> ${escapeHtml(qrData.deviceName)}</p>
        ${qrData.createdAt ? `<p style="margin: 8px 0; font-size: 13px;"><strong>Created:</strong> ${new Date(qrData.createdAt).toLocaleString()}</p>` : ''}
        ${qrData.lastUsed ? `<p style="margin: 8px 0; font-size: 13px;"><strong>Last Used:</strong> ${new Date(qrData.lastUsed).toLocaleString()}</p>` : ''}
        <p style="margin: 12px 0 0 0; padding: 10px; background: #f8f9fa; border-radius: 4px; font-size: 12px; color: #666;">
          💡 <strong>Manual Entry:</strong> Use these details to connect from your PWA if QR scanning doesn't work.
        </p>
      </div>
      <button id="regenerate-qr-btn" style="background: #ffc107; color: #333; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: bold;">
        Regenerate QR Code
      </button>
      <p class="warning-text" style="display:none; margin-top: 10px; padding: 10px; background: #fff3cd; border: 2px solid #ffc107; border-radius: 5px; font-size: 13px;" id="regenerate-warning">
        ⚠️ This will invalidate the current QR code. Previously paired mobile devices will need to re-scan the new QR code.
        <br><br>
        <button id="confirm-regenerate-btn" style="background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-right: 10px;">
          Confirm Regeneration
        </button>
        <button id="cancel-regenerate-btn" style="background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
          Cancel
        </button>
      </p>
    </div>
  ` : '';

  // WebRTC connection info
  const connectionInfo = `
    <div class="webrtc-info" style="background: #e7f3ff; border: 3px solid #007AFF; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
      <h4 style="color: #007AFF; margin: 0 0 15px 0; font-size: 18px;">🔗 WebRTC P2P Connection</h4>
      <p style="font-size: 14px; margin-bottom: 12px; line-height: 1.6;">
        <strong>Connection Type:</strong> Peer-to-Peer (WebRTC)<br>
        <strong>Signaling Server:</strong> ${escapeHtml(qrData.signalingServer)}<br>
        <strong>Room ID:</strong> <code style="background: white; padding: 4px 8px; border-radius: 3px;">${escapeHtml(qrData.roomId)}</code>
      </p>
      <p style="font-size: 13px; color: #0066cc; margin: 0;">
        ✅ No firewall configuration needed<br>
        ✅ Works through VPNs and restrictive networks<br>
        ✅ Direct P2P after initial handshake
      </p>
    </div>
  `;

  qrCodeContainer.innerHTML = `
    <div class="qr-code-display">
      <h3>SCAN QR CODE TO PAIR DEVICE</h3>
      <img src="${qrData.qrDataUrl}" alt="QR Code" class="qr-code-image" />

      ${persistenceInfo}

      ${connectionInfo}

      <div class="qr-info">
        <p><strong>DEVICE NAME:</strong> ${escapeHtml(qrData.deviceName)}</p>
        <p><strong>CONNECTION:</strong> ${qrData.connectionType || 'WebRTC P2P'}</p>
        ${qrData.stats ? `<p><strong>ACTIVE PEERS:</strong> ${qrData.stats.activePeers}</p>` : ''}
      </div>

      <div class="instructions" style="background: #f0f0f0; padding: 20px; border-radius: 8px; margin-top: 20px;">
        <h4 style="margin: 0 0 12px 0;">📱 How to Connect:</h4>
        <ol style="text-align: left; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
          <li>Open the PhotoSync PWA on your mobile device</li>
          <li>Tap "PAIR NEW DEVICE" in Settings</li>
          <li>Scan this QR code with your camera</li>
          <li>Wait for the P2P connection to establish</li>
        </ol>
        <p style="font-size: 13px; color: #666; margin: 15px 0 0 0; font-style: italic;">
          No certificate setup needed! Works through firewalls and VPNs.
        </p>
      </div>

      <button id="close-qr-btn">CLOSE</button>
    </div>
  `;

  // Add close handler
  document.getElementById('close-qr-btn').addEventListener('click', () => {
    qrCodeContainer.innerHTML = '';
    currentQrData = null;
  });

  // Add regenerate QR code handler (if persistent QR)
  if (qrData.persistent) {
    const regenerateBtn = document.getElementById('regenerate-qr-btn');
    const warningText = document.getElementById('regenerate-warning');
    const confirmBtn = document.getElementById('confirm-regenerate-btn');
    const cancelBtn = document.getElementById('cancel-regenerate-btn');

    if (regenerateBtn) {
      regenerateBtn.addEventListener('click', () => {
        // First click: Show warning
        warningText.style.display = 'block';
        regenerateBtn.style.display = 'none';
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        await handleRegenerateQR(qrData.deviceName);
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        warningText.style.display = 'none';
        regenerateBtn.style.display = 'inline-block';
      });
    }

    // Add copy Room ID button handler
    const copyBtn = document.getElementById('copy-room-id-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const roomId = qrData.roomId;
        navigator.clipboard.writeText(roomId).then(() => {
          // Visual feedback
          const originalText = copyBtn.textContent;
          copyBtn.textContent = '✓ Copied!';
          copyBtn.style.background = '#28a745';
          setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.style.background = '#007AFF';
          }, 2000);
        }).catch(err => {
          console.error('Failed to copy Room ID:', err);
          copyBtn.textContent = '✗ Failed';
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
          }, 2000);
        });
      });
    }
  }
}

// Handle regenerate QR code (manual user action)
async function handleRegenerateQR(deviceName) {
  try {
    updateStatus('REGENERATING');

    // Call the regenerateQR API
    const response = await window.electronAPI.devicePairing.regenerateQR('user_requested');

    if (response.success) {
      updateStatus('SUCCESS');

      // Show success message
      showAlertDialog(
        `QR code regenerated successfully!\n\n` +
        `New Room ID: ${response.config.roomId}\n\n` +
        `Please restart the app for changes to take full effect.`
      );

      // Generate and display the new QR code immediately
      const qrResponse = await window.electronAPI.devicePairing.generateQR({
        deviceName: deviceName || 'Web Device',
        userId: 'local',
        userEmail: 'local@device'
      });

      if (qrResponse.success) {
        currentQrData = qrResponse;
        displayQRCode(qrResponse);
      }

      setTimeout(() => updateStatus('IDLE'), 1000);
    } else {
      updateStatus('ERROR');
      showAlertDialog('Failed to regenerate QR code: ' + response.error);
      setTimeout(() => updateStatus('IDLE'), 2000);
    }
  } catch (error) {
    updateStatus('ERROR');
    showAlertDialog('Failed to regenerate QR code: ' + error.message);
    setTimeout(() => updateStatus('IDLE'), 2000);
  }
}

// Regenerate QR code with different IP address
async function regenerateQRWithAddress(ipAddress, deviceName) {
  try {
    updateStatus('GENERATING');

    const response = await window.electronAPI.devicePairing.generateQRWithIP(ipAddress, {
      deviceName: deviceName,
      userId: 'local',
      userEmail: 'local@device'
    });

    if (response.success) {
      updateStatus('SUCCESS');
      currentQrData = response;

      // Get network addresses to pass to display
      const addressesResponse = await window.electronAPI.devicePairing.getNetworkAddresses();
      if (addressesResponse.success) {
        response.availableAddresses = addressesResponse.addresses;
      }

      displayQRCode(response);
      await loadDevices();
      setTimeout(() => updateStatus('IDLE'), 1000);
    } else {
      updateStatus('ERROR');
      showAlertDialog('Failed to generate QR code: ' + response.error);
      setTimeout(() => updateStatus('IDLE'), 2000);
    }
  } catch (error) {
    updateStatus('ERROR');
    showAlertDialog('Failed to generate QR code: ' + error.message);
    setTimeout(() => updateStatus('IDLE'), 2000);
  }
}

// Handle revoke device
async function handleRevokeDevice(event) {
  const token = event.target.dataset.token;
  const device = devices.find(d => d.token === token);

  showConfirmDialog(`Revoke device "${device.deviceName}"?\n\nThis will disconnect the device immediately.`, async (confirmed) => {
    if (!confirmed) {
      return;
    }

    try {
      updateStatus('REVOKING');
      const response = await window.electronAPI.devicePairing.revoke(token);

      if (response.success) {
        updateStatus('SUCCESS');
        await loadDevices();
        setTimeout(() => updateStatus('IDLE'), 1000);
      } else {
        updateStatus('ERROR');
        showAlertDialog('Failed to revoke device: ' + response.message);
        setTimeout(() => updateStatus('IDLE'), 2000);
      }
    } catch (error) {
      updateStatus('ERROR');
      showAlertDialog('Failed to revoke device: ' + error.message);
      setTimeout(() => updateStatus('IDLE'), 2000);
    }
  });
}

// Handle delete device
async function handleDeleteDevice(event) {
  const token = event.target.dataset.token;
  const device = devices.find(d => d.token === token);

  showConfirmDialog(`Permanently delete device "${device.deviceName}"?\n\nThis action cannot be undone.`, async (confirmed) => {
    if (!confirmed) {
      return;
    }

    try {
      updateStatus('DELETING');
      const response = await window.electronAPI.devicePairing.delete(token);

      if (response.success) {
        updateStatus('SUCCESS');
        await loadDevices();
        setTimeout(() => updateStatus('IDLE'), 1000);
      } else {
        updateStatus('ERROR');
        showAlertDialog('Failed to delete device: ' + response.message);
        setTimeout(() => updateStatus('IDLE'), 2000);
      }
    } catch (error) {
      updateStatus('ERROR');
      showAlertDialog('Failed to delete device: ' + error.message);
      setTimeout(() => updateStatus('IDLE'), 2000);
    }
  });
}

// Helper: Format timestamp
function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Helper: Show custom input dialog
function showInputDialog(title, defaultValue, callback) {
  // Create modal
  const modal = document.createElement('div');
  modal.className = 'custom-dialog-overlay';
  modal.innerHTML = `
    <div class="custom-dialog">
      <div class="custom-dialog-header">${escapeHtml(title)}</div>
      <div class="custom-dialog-body">
        <input type="text" id="dialog-input" class="custom-dialog-input" value="${escapeHtml(defaultValue || '')}" />
      </div>
      <div class="custom-dialog-footer">
        <button id="dialog-ok" class="custom-dialog-btn">OK</button>
        <button id="dialog-cancel" class="custom-dialog-btn">CANCEL</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const input = document.getElementById('dialog-input');
  const okBtn = document.getElementById('dialog-ok');
  const cancelBtn = document.getElementById('dialog-cancel');

  input.focus();
  input.select();

  const cleanup = () => {
    document.body.removeChild(modal);
  };

  okBtn.addEventListener('click', () => {
    const value = input.value.trim();
    cleanup();
    callback(value || defaultValue);
  });

  cancelBtn.addEventListener('click', () => {
    cleanup();
    callback(null);
  });

  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const value = input.value.trim();
      cleanup();
      callback(value || defaultValue);
    } else if (e.key === 'Escape') {
      cleanup();
      callback(null);
    }
  });
}

// Helper: Show custom confirm dialog
function showConfirmDialog(message, callback) {
  const modal = document.createElement('div');
  modal.className = 'custom-dialog-overlay';
  modal.innerHTML = `
    <div class="custom-dialog">
      <div class="custom-dialog-header">CONFIRM</div>
      <div class="custom-dialog-body">
        <p class="custom-dialog-message">${escapeHtml(message)}</p>
      </div>
      <div class="custom-dialog-footer">
        <button id="dialog-yes" class="custom-dialog-btn">YES</button>
        <button id="dialog-no" class="custom-dialog-btn">NO</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const yesBtn = document.getElementById('dialog-yes');
  const noBtn = document.getElementById('dialog-no');

  const cleanup = () => {
    document.body.removeChild(modal);
  };

  yesBtn.addEventListener('click', () => {
    cleanup();
    callback(true);
  });

  noBtn.addEventListener('click', () => {
    cleanup();
    callback(false);
  });
}

// Helper: Show custom alert dialog
function showAlertDialog(message) {
  const modal = document.createElement('div');
  modal.className = 'custom-dialog-overlay';
  modal.innerHTML = `
    <div class="custom-dialog">
      <div class="custom-dialog-header">ALERT</div>
      <div class="custom-dialog-body">
        <p class="custom-dialog-message">${escapeHtml(message)}</p>
      </div>
      <div class="custom-dialog-footer">
        <button id="dialog-ok" class="custom-dialog-btn">OK</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const okBtn = document.getElementById('dialog-ok');

  const cleanup = () => {
    document.body.removeChild(modal);
  };

  okBtn.addEventListener('click', cleanup);
}

// Start
init();
