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

// State
let paths = [];
let photos = [];
let serverRunning = false;
let currentQrData = null;
let folders = [];
let currentFolderId = 'all'; // 'all' shows all photos, or folder ID
let breadcrumbs = [];

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

  // Reload photos and folders when switching to gallery (in case paths were added/removed)
  if (tabName === 'gallery') {
    loadPhotos(true);
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

// Load folder structure from server
async function loadFolders() {
  try {
    console.log('[Gallery] Loading folder structure from server...');
    const response = await fetch(`http://localhost:3000/api/folders?_t=${Date.now()}`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`);
    }

    const data = await response.json();
    folders = data.folders || [];
    console.log(`[Gallery] Loaded ${folders.length} root folders`);
    return true;
  } catch (error) {
    console.error('[Gallery] Error loading folders:', error);
    folders = [];
    return false;
  }
}

// Load photos from server (for current folder)
async function loadPhotos(forceReloadFolders = false) {
  try {
    console.log('[Gallery] Loading photos from server...');

    // Load folder structure (force reload if requested or not loaded yet)
    if (forceReloadFolders || folders.length === 0) {
      await loadFolders();
    }

    // When viewing "all", don't load photos (just show folders)
    // When viewing a specific folder, load only photos in that folder
    if (currentFolderId === 'all') {
      photos = [];
      console.log('[Gallery] Viewing all folders, not loading individual photos');
    } else {
      const url = `http://localhost:3000/api/folders/${currentFolderId}?_t=${Date.now()}`;
      const response = await fetch(url, {
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`Server responded with status: ${response.status}`);
      }

      photos = await response.json();
      console.log(`[Gallery] Loaded ${photos.length} photos from folder ${currentFolderId}`);
    }

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

// Build breadcrumb for current folder
function buildBreadcrumb(folderId) {
  if (folderId === 'all') {
    return [];
  }

  const crumbs = [];
  let currentFolder = findFolderById(folderId);

  while (currentFolder) {
    crumbs.unshift({
      id: currentFolder.id,
      name: currentFolder.displayName
    });

    // Find parent folder
    if (currentFolder.folderPath === '') {
      break; // This is a root folder
    }

    const parentPath = currentFolder.folderPath.split('/').slice(0, -1).join('/');
    const parentKey = `${currentFolder.rootPath}::${parentPath}`;
    currentFolder = findFolderByKey(parentKey);
  }

  return crumbs;
}

// Find folder by ID
function findFolderById(folderId, folderList = folders) {
  for (const folder of folderList) {
    if (folder.id === folderId) {
      return folder;
    }
    if (folder.subfolders && folder.subfolders.length > 0) {
      const found = findFolderById(folderId, folder.subfolders);
      if (found) return found;
    }
  }
  return null;
}

// Find folder by key
function findFolderByKey(key) {
  // This is a simplified version - in practice, we'd need to iterate through all folders
  return null;
}

// Navigate to folder
async function navigateToFolder(folderId) {
  currentFolderId = folderId;
  breadcrumbs = buildBreadcrumb(folderId);
  await loadPhotos();
}

// Get subfolders for current folder
function getCurrentSubfolders() {
  if (currentFolderId === 'all') {
    return folders;
  }

  const currentFolder = findFolderById(currentFolderId);
  return currentFolder ? currentFolder.subfolders : [];
}

// Render photo gallery
function renderGallery() {
  console.log(`[Gallery] Rendering gallery - serverRunning: ${serverRunning}, photos: ${photos.length}, currentFolder: ${currentFolderId}`);

  // Always clear gallery first
  galleryEl.innerHTML = '';

  // Remove gallery class from container to prevent it from being a grid
  galleryEl.classList.remove('gallery');

  if (!serverRunning) {
    console.log('[Gallery] Server not running, showing loading message');
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'gallery-empty';
    emptyDiv.innerHTML = 'LOADING SERVER...<br>PLEASE WAIT';
    galleryEl.appendChild(emptyDiv);
    return;
  }

  // Create navigation bar with breadcrumb and All Photos button
  const navBar = document.createElement('div');
  navBar.style.cssText = 'margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;';

  // Breadcrumb navigation
  const breadcrumbEl = document.createElement('div');
  breadcrumbEl.style.cssText = 'display: flex; align-items: center; gap: 5px; font-family: "VT323", monospace; font-size: 18px;';

  if (currentFolderId === 'all') {
    breadcrumbEl.innerHTML = '<span style="font-weight: bold;">ALL PHOTOS</span>';
  } else {
    breadcrumbEl.innerHTML = `
      <span class="breadcrumb-item" data-folder="all" style="cursor: pointer; text-decoration: underline;">HOME</span>
      ${breadcrumbs.map(crumb => `
        <span> / </span>
        <span class="breadcrumb-item" data-folder="${crumb.id}" style="cursor: pointer; text-decoration: underline;">${crumb.name}</span>
      `).join('')}
    `;
  }

  // All Photos button
  const allPhotosBtn = document.createElement('button');
  allPhotosBtn.textContent = 'ALL PHOTOS';
  allPhotosBtn.style.cssText = 'padding: 8px 16px; background: #000; color: #fff; border: 3px solid #000; cursor: pointer; font-family: "VT323", monospace; font-size: 16px; text-transform: uppercase;';
  if (currentFolderId === 'all') {
    allPhotosBtn.style.background = '#666';
    allPhotosBtn.style.borderColor = '#666';
    allPhotosBtn.disabled = true;
  }
  allPhotosBtn.addEventListener('click', () => navigateToFolder('all'));

  navBar.appendChild(breadcrumbEl);
  navBar.appendChild(allPhotosBtn);
  galleryEl.appendChild(navBar);

  // Add breadcrumb click handlers
  document.querySelectorAll('.breadcrumb-item').forEach(item => {
    item.addEventListener('click', () => {
      const folderId = item.dataset.folder;
      navigateToFolder(folderId);
    });
  });

  if (photos.length === 0 && getCurrentSubfolders().length === 0) {
    console.log('[Gallery] No photos or folders found, showing empty message');
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'gallery-empty';
    emptyDiv.innerHTML = 'NO PHOTOS FOUND<br>CONFIGURE DIRECTORIES IN SETTINGS';
    galleryEl.appendChild(emptyDiv);
    return;
  }

  // Create grid container
  const gridEl = document.createElement('div');
  gridEl.className = 'gallery';

  // Add timestamp to bust browser cache
  const cacheBuster = Date.now();

  // Render subfolders first (only if we're not showing all photos)
  const subfolders = getCurrentSubfolders();
  console.log(`[Gallery] Rendering ${subfolders.length} subfolders`);
  subfolders.forEach(folder => {
    const folderItem = document.createElement('div');
    folderItem.className = 'folder-item';
    folderItem.dataset.folderId = folder.id;

    const photoCount = folder.totalPhotoCount !== undefined ? folder.totalPhotoCount : folder.photoCount;
    folderItem.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 10px;">📁</div>
      <div style="font-weight: bold; margin-bottom: 5px;">${folder.displayName}</div>
      <div style="font-size: 14px; opacity: 0.7;">${photoCount} PHOTOS</div>
    `;

    folderItem.addEventListener('mouseenter', () => {
      folderItem.style.background = '#000';
      folderItem.style.color = '#fff';
    });

    folderItem.addEventListener('mouseleave', () => {
      folderItem.style.background = '#f0f0f0';
      folderItem.style.color = '#000';
    });

    folderItem.addEventListener('click', () => {
      navigateToFolder(folder.id);
    });

    gridEl.appendChild(folderItem);
  });

  // Render photos (only if not viewing "all")
  if (currentFolderId !== 'all') {
    console.log(`[Gallery] Rendering ${photos.length} photos`);
    photos.forEach(photo => {
      const photoItem = document.createElement('div');
      photoItem.className = 'photo-item';
      photoItem.dataset.id = photo.id;

      const img = document.createElement('img');
      img.src = `http://localhost:3000/api/photo/${photo.id}?quality=60&maxDimension=400&t=${photo.modified}&cb=${cacheBuster}`;
      img.alt = photo.filename;
      img.loading = 'lazy';

      photoItem.appendChild(img);
      photoItem.addEventListener('click', handlePhotoClick);

      gridEl.appendChild(photoItem);
    });
  }

  galleryEl.appendChild(gridEl);

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
        // Navigate back to root view to show new folders
        currentFolderId = 'all';
        breadcrumbs = [];

        // Force reload folders after adding new path
        await loadPhotos(true);
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

        // Navigate back to root view
        currentFolderId = 'all';
        breadcrumbs = [];

        // Clear gallery immediately to show feedback
        photos = [];
        folders = [];
        renderGallery();

        // Wait for server rescan to complete
        updateStatus('SCANNING');
        const rescanResult = await triggerRescan();

        if (rescanResult.success) {
          // Force reload folders after removing path
          await loadPhotos(true);
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

// Handle show QR code
async function handleGenerateQR() {
  try {
    updateStatus('LOADING');

    const response = await window.electronAPI.devicePairing.generateQR({
      deviceName: 'PhotoSync Desktop',
      userId: 'local',
      userEmail: 'local@device'
    });

    if (response.success) {
      updateStatus('SUCCESS');
      currentQrData = response;
      displayQRCode(response);
      setTimeout(() => updateStatus('IDLE'), 500);
    } else {
      updateStatus('ERROR');
      showAlertDialog('Failed to load QR code: ' + response.error);
      setTimeout(() => updateStatus('IDLE'), 2000);
    }
  } catch (error) {
    updateStatus('ERROR');
    showAlertDialog('Failed to load QR code: ' + error.message);
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
