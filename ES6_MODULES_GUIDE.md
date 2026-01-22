# ES6 Modules in PhotoSync

## Overview

PhotoSync uses ES6 modules (`import/export`) throughout the codebase while maintaining compatibility with Electron's preload script requirements.

## Configuration

### package.json
```json
{
  "type": "module"
}
```

This tells Node.js to treat `.js` files as ES6 modules by default.

## File Extensions

### ES6 Modules (`.js`)
- `main.js` - Electron main process
- `server.js` - HTTP server
- `photo-paths-manager.js` - Path management
- `renderer.js` - UI logic
- `types.js` - Type definitions

### CommonJS (`.cjs`)
- `preload.cjs` - Electron preload script

## Why `.cjs` for Preload?

Electron's preload scripts run in a special sandboxed context with limited ES6 module support. Using the `.cjs` extension:

1. **Explicit CommonJS**: The `.cjs` extension explicitly tells Node.js to use CommonJS syntax even when `"type": "module"` is set
2. **Full Compatibility**: Ensures 100% compatibility with Electron's preload API
3. **No Configuration**: Works without additional webpack/babel setup
4. **Best Practice**: Recommended by Electron team for preload scripts

## Preload Script Setup

**preload.cjs:**
```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  photoPaths: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    getAll: () => ipcRenderer.invoke('paths:getAll'),
    // ... more methods
  }
});
```

**main.js:**
```javascript
import { app, BrowserWindow } from 'electron';
import path from 'path';

const mainWindow = new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'), // Note: .cjs extension
    contextIsolation: true,
    sandbox: false
  }
});
```

## ES6 Features Used

- `import/export` statements
- Template literals
- Arrow functions
- Async/await
- Destructuring
- Spread operator
- `const`/`let` instead of `var`

## Handling `__dirname` in ES6

ES6 modules don't have `__dirname` by default. We recreate it:

```javascript
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

## Benefits

✅ Modern JavaScript syntax
✅ Better code organization
✅ Improved tree-shaking
✅ Native browser support
✅ Cleaner imports/exports
✅ Full Electron compatibility

## Troubleshooting

### Error: "Cannot use import statement outside a module"
- Check that `"type": "module"` is in `package.json`
- Ensure file uses `.js` extension (not `.cjs`)

### Error: "require is not defined"
- Make sure preload script uses `.cjs` extension
- Use `const { } = require()` syntax in `.cjs` files

### Error: "__dirname is not defined"
- Use the `fileURLToPath` pattern shown above
- Only needed in ES6 modules (`.js` files)

## Migration Checklist

- [x] Added `"type": "module"` to package.json
- [x] Converted all files to ES6 imports
- [x] Renamed preload to `.cjs` extension
- [x] Added `__dirname` polyfill where needed
- [x] Updated all require() to import statements
- [x] Tested Electron app loads correctly
- [x] Verified IPC communication works

## Summary

PhotoSync successfully uses ES6 modules everywhere except the preload script, which uses CommonJS (`.cjs`) for maximum Electron compatibility. This hybrid approach gives you modern JavaScript features while maintaining full Electron functionality.
