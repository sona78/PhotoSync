# PhotoSync

A photo synchronization app that serves photos from your computer to your iPhone over the local network.

## Overview

PhotoSync consists of two parts:
1. **Electron App** - Manage photo directories with a visual interface
2. **HTTP Server** - Serve photos via REST API for network access

## Getting Started

### Prerequisites

- Node.js (v16 or higher recommended)
- npm or yarn

### Installation

Install dependencies:
```bash
npm install
```

### Running PhotoSync

**Start the app:**
```bash
npm start
```

This will:
- Open the PhotoSync UI
- Automatically start the HTTP server on port 3000
- Scan all enabled photo directories
- Serve photos via REST API

The app includes:
- **Gallery Tab**: View all your photos in a grid layout
- **Settings Tab**: Add/remove photo directories using the file explorer
- **Auto-refresh**: Gallery updates every 30 seconds
- **Integrated Server**: No need to run server separately!

### Quick Start

1. Run `npm start`
2. Go to Settings tab and add your photo directories
3. Switch to Gallery tab to see your photos
4. Access the API at `http://localhost:3000`

## Features

### Path Management
- **Native File Picker** - Select directories using your OS's file browser
- **Multiple Directories** - Add unlimited photo directories
- **Enable/Disable** - Toggle paths without removing them
- **Persistent Storage** - Paths saved using electron-store

### HTTP Server
- **Health Check** - Monitor server status
- **Photo List** - Get metadata for all photos
- **Compressed Photos** - Adjustable quality and size
- **Original Photos** - Full-resolution streaming
- **Sync Status** - Detect new/modified photos
- **Smart Caching** - Memory + disk caching for performance

### Security
- Context isolation enabled
- Preload script for secure IPC communication
- No direct file system access from renderer

## API Endpoints

- `GET /health` - Server health check
- `GET /api/photos` - Get all photos with metadata
- `GET /api/photo/:id?quality=50&maxDimension=1920` - Get compressed photo
- `GET /api/photo/:id/original` - Get original photo
- `GET /api/sync-status` - Check for photo changes
- `GET /api/paths` - Get configured directories
- `GET /api/paths/stats` - Get path statistics
- `POST /api/rescan` - Trigger manual rescan

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for complete API reference.

## Project Structure

```
PhotoSync/
├── main.js                  # Electron main process (ES6)
├── preload.cjs              # Preload script (CommonJS for Electron compatibility)
├── index.html               # Path management UI
├── renderer.js              # UI logic (ES6)
├── server.js                # HTTP server (ES6)
├── photo-paths-manager.js   # Path management (ES6)
├── types.js                 # Type definitions (ES6)
└── .cache/                  # Compressed photo cache
```

**Note:** PhotoSync uses ES6 modules (`import/export`) throughout except for `preload.cjs`, which uses CommonJS (`require`) for Electron compatibility. See [ES6_MODULES_GUIDE.md](./ES6_MODULES_GUIDE.md) for details.

## Supported Image Formats

- JPEG (.jpg, .jpeg)
- PNG (.png)
- GIF (.gif)
- WebP (.webp)
- BMP (.bmp)
- HEIC (.heic)
- HEIF (.heif)

## Building

Build the application for distribution:
```bash
npm run build
```

## License

MIT
