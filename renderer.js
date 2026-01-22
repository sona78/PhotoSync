// DOM Elements
const pathsListEl = document.getElementById('paths-list');
const addPathBtn = document.getElementById('add-path-btn');
const statusEl = document.getElementById('status');
const pathCountEl = document.getElementById('path-count');
const photoCountEl = document.getElementById('photo-count');
const galleryEl = document.getElementById('gallery');
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

// State
let paths = [];
let photos = [];
let serverRunning = false;

// Initialize
async function init() {
  setupTabs();
  await loadPaths();

  // Wait for server to start with retry logic
  await waitForServerAndLoadPhotos();

  addPathBtn.addEventListener('click', handleAddPath);
  updateStatus('IDLE');

  // Auto-refresh photos every 30 seconds
  setInterval(loadPhotos, 30000);
}

// Wait for server to start with retry mechanism
async function waitForServerAndLoadPhotos() {
  const maxRetries = 10;
  const retryDelay = 1000; // 1 second

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch('http://localhost:3000/health');
      if (response.ok) {
        // Server is ready, load photos
        await loadPhotos();
        return;
      }
    } catch (error) {
      // Server not ready yet, wait and retry
      console.log(`Waiting for server... attempt ${i + 1}/${maxRetries}`);
    }

    await new Promise(resolve => setTimeout(resolve, retryDelay));
  }

  // After max retries, try loading photos anyway (will show appropriate error)
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
    // Add cache busting to ensure fresh data
    const response = await fetch(`http://localhost:3000/api/photos?_t=${Date.now()}`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error('Server not available');
    }

    photos = await response.json();
    photoCountEl.textContent = photos.length;
    serverRunning = true;
    renderGallery();
  } catch (error) {
    console.log('Server not running or no photos available');
    photoCountEl.textContent = '-';
    serverRunning = false;
    renderGallery();
  }
}

// Render photo gallery
function renderGallery() {
  // Always clear gallery first
  galleryEl.innerHTML = '';

  if (!serverRunning) {
    galleryEl.innerHTML = '<div class="gallery-empty">LOADING SERVER...<br>PLEASE WAIT</div>';
    return;
  }

  if (photos.length === 0) {
    galleryEl.innerHTML = '<div class="gallery-empty">NO PHOTOS FOUND<br>CONFIGURE DIRECTORIES IN SETTINGS</div>';
    return;
  }

  // Add timestamp to bust browser cache
  const cacheBuster = Date.now();

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
}

// Handle photo click
function handlePhotoClick(event) {
  const photoId = event.currentTarget.dataset.id;
  const photo = photos.find(p => p.id === photoId);

  if (photo) {
    console.log('Clicked photo:', photo.filename);
    // TODO: Open photo in full screen or external viewer
  }
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
      alert(response.message);
      setTimeout(() => updateStatus('IDLE'), 2000);
    }
  } catch (error) {
    updateStatus('ERROR');
    alert('Failed to add path: ' + error.message);
    setTimeout(() => updateStatus('IDLE'), 2000);
  }
}

// Handle remove path
async function handleRemovePath(event) {
  const id = event.target.dataset.id;
  const path = paths.find(p => p.id === id);

  if (!confirm(`Remove "${path.path}"?`)) {
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
      alert(response.message);
      setTimeout(() => updateStatus('IDLE'), 2000);
    }
  } catch (error) {
    updateStatus('ERROR');
    alert('Failed to remove path: ' + error.message);
    setTimeout(() => updateStatus('IDLE'), 2000);
  }
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

// Start
init();
