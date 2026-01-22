# PhotoSync Server API Documentation

## Getting Started

### Installation
```bash
npm install
```

### Running the Application

**1. Start the Electron App:**
```bash
npm start
```

This opens the PhotoSync UI where you can:
- Add photo directories using the file explorer
- Enable/disable specific paths
- View photo statistics

**2. Start the HTTP Server (in a separate terminal):**
```bash
npm run server
```

The server will start on port 3000 and scan all enabled photo directories.

### Photo Path Management

PhotoSync uses **electron-store** to manage photo directories. Instead of scanning a single folder, you can:
- Add multiple photo directories
- Enable/disable paths individually
- Paths are persisted across app restarts
- Use the built-in UI to manage paths with a native file picker

---

## API Endpoints

### 1. Health Check
**GET** `/health`

Check if server is running and responsive.

**Request:**
```http
GET /health HTTP/1.1
Host: 192.168.1.5:3000
```

**Response:**
```json
{
  "status": "ok",
  "photoCount": 5678,
  "timestamp": 1705334400000
}
```

**Status Codes:**
- `200 OK` - Server is healthy

---

### 2. Get All Photos
**GET** `/api/photos`

Get list of all available photos with metadata.

**Request:**
```http
GET /api/photos HTTP/1.1
Host: 192.168.1.5:3000
```

**Response:**
```json
[
  {
    "id": "abc123def456",
    "filename": "IMG_2024_01_15_001.jpg",
    "path": "/Users/kaustubh/Photos/IMG_2024_01_15_001.jpg",
    "size": 4523412,
    "modified": 1705334400000,
    "dimensions": {
      "width": 4032,
      "height": 3024
    }
  },
  {
    "id": "def456ghi789",
    "filename": "IMG_2024_01_15_002.jpg",
    "path": "/Users/kaustubh/Photos/IMG_2024_01_15_002.jpg",
    "size": 3892341,
    "modified": 1705334460000,
    "dimensions": {
      "width": 4032,
      "height": 3024
    }
  }
]
```

**Status Codes:**
- `200 OK` - Success
- `500 Internal Server Error` - Server error

**Notes:**
- Can return thousands of photos
- Server rescans photos directory every 5 minutes

---

### 3. Get Compressed Photo
**GET** `/api/photo/:id`

Get a compressed version of a photo with adjustable quality and size.

**Path Parameters:**
- `id` (string, required) - Photo ID from the photos list

**Query Parameters:**
- `quality` (number, optional, default: 50) - JPEG quality (1-100)
  - `30` = High compression, smaller file
  - `50` = Medium compression (default)
  - `70` = Light compression
  - `90` = Minimal compression, larger file
- `maxDimension` (number, optional, default: 1920) - Max width or height in pixels
  - Common values: `800`, `1280`, `1920`, `2560`, `4032`

**Request Examples:**
```http
# High compression for thumbnails
GET /api/photo/abc123?quality=30&maxDimension=800

# Medium compression for grid view
GET /api/photo/abc123?quality=50&maxDimension=1920

# Light compression for full screen
GET /api/photo/abc123?quality=70&maxDimension=2560

# Minimal compression
GET /api/photo/abc123?quality=90&maxDimension=4032
```

**Response:**
```
Content-Type: image/jpeg
ETag: "abc123def456789"
Cache-Control: public, max-age=31536000
Content-Length: 245678

[JPEG binary data]
```

**Status Codes:**
- `200 OK` - Photo returned successfully
- `400 Bad Request` - Invalid quality or dimension parameters
- `404 Not Found` - Photo ID doesn't exist
- `500 Internal Server Error` - Compression failed

**Notes:**
- Server caches compressed versions (cache key: `${id}_${quality}_${maxDimension}`)
- Cached to both memory and disk (`.cache` directory)
- ETag allows client-side caching
- Compression happens using Sharp library

---

### 4. Get Original Photo
**GET** `/api/photo/:id/original`

Get the full-resolution original photo (no compression).

**Path Parameters:**
- `id` (string, required) - Photo ID from the photos list

**Request:**
```http
GET /api/photo/abc123def456/original HTTP/1.1
Host: 192.168.1.5:3000
```

**Response:**
```
Content-Type: image/jpeg
Content-Length: 4523412

[JPEG binary data - full resolution]
```

**Status Codes:**
- `200 OK` - Photo returned successfully
- `404 Not Found` - Photo ID doesn't exist
- `500 Internal Server Error` - Failed to read photo

**Notes:**
- Used for exporting full-resolution photos
- No caching (files are large)
- Streaming response for large files
- Supports JPEG, PNG, GIF, WEBP formats

---

### 5. Get Sync Status
**GET** `/api/sync-status`

Check if new photos have been added since last sync.

**Request:**
```http
GET /api/sync-status HTTP/1.1
Host: 192.168.1.5:3000
```

**Response:**
```json
{
  "photoCount": 5678,
  "lastModified": 1705334400000,
  "directoryHash": "a3b5c7d9e1f2g4h6"
}
```

**Response Fields:**
- `photoCount` - Total number of photos available
- `lastModified` - Timestamp of most recently modified photo
- `directoryHash` - MD5 hash of all photo IDs (changes when photos added/removed)

**Status Codes:**
- `200 OK` - Success

**Notes:**
- Use `directoryHash` to detect when photos are added/removed
- Compare `lastModified` to detect when photos are updated

---

## Testing the API

### Using cURL

```bash
# Health check
curl http://localhost:3000/health

# Get all photos
curl http://localhost:3000/api/photos

# Get compressed photo
curl http://localhost:3000/api/photo/abc123?quality=50&maxDimension=1920 -o photo.jpg

# Get original photo
curl http://localhost:3000/api/photo/abc123/original -o original.jpg

# Get sync status
curl http://localhost:3000/api/sync-status
```

### Using Browser

Navigate to:
- http://localhost:3000/health
- http://localhost:3000/api/photos
- http://localhost:3000/api/sync-status

---

## Directory Structure

```
PhotoSync/
├── main.js                  # Electron main process
├── preload.js               # Electron preload script
├── index.html               # Path management UI
├── renderer.js              # UI logic
├── server.js                # HTTP server
├── photo-paths-manager.js   # Path management logic
├── types.js                 # Type definitions
├── .cache/                  # Compressed photo cache (auto-generated)
│   ├── abc123_50_1920.jpg
│   └── ...
└── [Your photo directories are configured via the UI]
```

## Using the UI

### Path Management Interface

The Electron app provides a visual interface for managing photo directories:

1. **Add Directory**: Click "Add Photo Directory" to open a native folder picker
2. **Enable/Disable**: Use checkboxes to enable or disable specific paths
3. **Remove**: Click the "Remove" button to delete a path
4. **Statistics**: View total paths, enabled paths, and total photos
5. **Refresh**: Manually refresh the photo count

### UI Features

- **Native File Picker**: Select directories using your OS's file browser
- **Real-time Stats**: Auto-updates photo count every 10 seconds
- **Visual Feedback**: Success/error messages for all operations
- **Persistent Storage**: Paths are saved using electron-store
- **Auto-Rescan**: Server automatically rescans when paths change

---

### 6. Get Configured Photo Paths
**GET** `/api/paths`

Get all configured photo directory paths.

**Request:**
```http
GET /api/paths HTTP/1.1
Host: 192.168.1.5:3000
```

**Response:**
```json
[
  {
    "id": "path_1705334400000_abc123",
    "path": "/Users/kaustubh/Photos",
    "enabled": true,
    "addedAt": 1705334400000
  },
  {
    "id": "path_1705334500000_def456",
    "path": "/Users/kaustubh/Pictures",
    "enabled": false,
    "addedAt": 1705334500000
  }
]
```

**Status Codes:**
- `200 OK` - Success
- `500 Internal Server Error` - Server error

---

### 7. Get Path Statistics
**GET** `/api/paths/stats`

Get statistics about configured paths.

**Request:**
```http
GET /api/paths/stats HTTP/1.1
Host: 192.168.1.5:3000
```

**Response:**
```json
{
  "total": 5,
  "enabled": 3,
  "disabled": 2
}
```

**Status Codes:**
- `200 OK` - Success
- `500 Internal Server Error` - Server error

---

### 8. Trigger Manual Photo Rescan
**POST** `/api/rescan`

Manually trigger a rescan of all enabled photo directories.

**Request:**
```http
POST /api/rescan HTTP/1.1
Host: 192.168.1.5:3000
```

**Response:**
```json
{
  "success": true,
  "photoCount": 5678,
  "message": "Photos rescanned successfully"
}
```

**Status Codes:**
- `200 OK` - Rescan successful
- `500 Internal Server Error` - Rescan failed

**Notes:**
- Automatically called when paths are added/removed/toggled via the UI
- Server auto-rescans every 5 minutes
- Use this to immediately reflect changes after adding photos to directories

---

## Supported Image Formats

- JPEG (.jpg, .jpeg)
- PNG (.png)
- GIF (.gif)
- WebP (.webp)
- BMP (.bmp)
- HEIC (.heic)
- HEIF (.heif)

---

## Performance Notes

- **Caching**: Compressed photos are cached in memory and disk for fast repeated access
- **Streaming**: Original photos are streamed for efficient memory usage
- **Auto-rescan**: Server automatically rescans the photos directory every 5 minutes
- **Compression**: Sharp library provides fast, high-quality image compression

---

## Error Handling

All endpoints return JSON error responses:

```json
{
  "error": "Description of the error"
}
```

Common errors:
- `400 Bad Request` - Invalid parameters
- `404 Not Found` - Photo not found
- `500 Internal Server Error` - Server-side error

---

## Electron Store

PhotoSync uses **electron-store** to persist photo directory paths.

### Storage Location

The store file is located at:
- **Windows**: `%APPDATA%\photosync\photo-paths.json`
- **macOS**: `~/Library/Application Support/photosync/photo-paths.json`
- **Linux**: `~/.config/photosync/photo-paths.json`

### Store Format

```json
{
  "paths": [
    {
      "id": "path_1705334400000_abc123",
      "path": "/Users/kaustubh/Photos",
      "enabled": true,
      "addedAt": 1705334400000
    }
  ]
}
```

### IPC API

The Electron app exposes these IPC methods via `window.electronAPI.photoPaths`:

- `openDirectory()` - Open native folder picker
- `getAll()` - Get all configured paths
- `getEnabled()` - Get only enabled paths
- `add(dirPath)` - Add a new path
- `remove(id)` - Remove a path
- `toggle(id, enabled)` - Enable/disable a path
- `clearAll()` - Remove all paths
- `getStats()` - Get path statistics
