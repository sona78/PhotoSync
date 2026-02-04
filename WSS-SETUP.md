# WSS (Secure WebSocket) Setup Guide

PhotoSync uses WSS (Secure WebSocket) for all WebSocket connections, providing encrypted communication between clients and the server.

## Quick Start

### 1. Generate SSL Certificates (Required)

Run the certificate generation script:

```bash
npm run generate-cert
```

This will create:
- `cert.pem` - SSL certificate
- `key.pem` - Private key

**Note:** These are self-signed certificates for development only. For production, use certificates from a trusted Certificate Authority.

### 2. Start the Server

Once certificates are generated, start the server:

```bash
npm start
```

You should see:
```
[HTTPS] Secure server listening on port 3001
[HTTPS] Local:   https://localhost:3001
[WSS]   Secure WebSocket enabled
```

**Important:** The server will NOT start without valid SSL certificates. If certificates are missing, you'll see an error.

### 3. Accept Certificate Warning (First Time Only)

For iOS/PWA clients to connect via WSS:

1. Open Safari/browser on your device
2. Navigate to `https://[your-server-ip]:3001`
3. Accept the certificate warning (self-signed)
4. You may see a blank page - this is normal
5. Now your PWA can connect via WSS

## How It Works

### QR Code Protocol v3

The QR code contains secure connection information:

```json
{
  "v": 3,
  "s": "192.168.1.5",
  "p": 3001,
  "t": "device-token-here",
  "e": 1234567890
}
```

- `v`: Protocol version (3 for WSS-only)
- `s`: Server address
- `p`: Secure WebSocket port (WSS)
- `t`: Device authentication token
- `e`: Token expiration timestamp

### Client Connection

PWA clients should always use the `wss://` protocol:

```javascript
const ws = new WebSocket(`wss://${qrData.s}:${qrData.p}`);
```

## Ports

- `3000`: HTTP API server (read-only access)
- `3001`: HTTPS + Secure WebSocket (WSS)

## Security Notes

### Development Certificates

Self-signed certificates are:
- ✅ Good for development and local networks
- ✅ Provide encryption
- ❌ Not trusted by browsers (warning required)
- ❌ Not suitable for production

### Production Certificates

For production, use:
- [Let's Encrypt](https://letsencrypt.org/) (free, automated)
- Commercial Certificate Authority
- Cloud provider certificates

Replace `cert.pem` and `key.pem` with your production certificates.

## Troubleshooting

### Server won't start - certificates missing

Error: `SSL certificates not found!`

Solution:
```bash
npm run generate-cert
npm start
```

### iOS/PWA can't connect

1. Visit `https://[server-ip]:3001` in Safari first
2. Accept the certificate warning
3. Return to your PWA and try connecting

### Certificate expired

Self-signed certificates expire after 365 days. Generate new ones:

```bash
rm cert.pem key.pem
npm run generate-cert
```

## Manual Configuration

If QR scanning doesn't work, manually enter:

- Server: `192.168.1.5:3001`
- Token: [from QR display]
- Protocol: WSS (wss://)

**First-time setup:** Visit `https://192.168.1.5:3001` in browser to accept certificate

## Why WSS Only?

PhotoSync uses WSS exclusively because:
- ✅ All modern browsers support WSS
- ✅ PWAs require secure contexts (HTTPS/WSS)
- ✅ Encryption protects your photos in transit
- ✅ Simpler configuration (one port, one protocol)
- ✅ Certificate acceptance is one-time per device
