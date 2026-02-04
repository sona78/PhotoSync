/**
 * Generate QR Code for ngrok Tunnel
 *
 * Usage: node generate-ngrok-qr.js <ngrok-url> <token>
 * Example: node generate-ngrok-qr.js abc123.ngrok-free.app 0123456789abcdef...
 */

import QRCode from 'qrcode';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Usage: node generate-ngrok-qr.js <ngrok-url> <token>');
  console.log('');
  console.log('Example:');
  console.log('  node generate-ngrok-qr.js abc123.ngrok-free.app 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  console.log('');
  console.log('Get your ngrok URL from: ngrok http https://localhost:3001');
  console.log('Get your token from: Electron app → Generate QR Code → Copy token');
  process.exit(1);
}

const ngrokUrl = args[0].replace(/^https?:\/\//, ''); // Remove protocol if present
const token = args[1];

// Validate token format
if (!/^[0-9a-f]{64}$/i.test(token)) {
  console.error('❌ Error: Token must be 64 hexadecimal characters');
  console.error(`   Received: ${token.substring(0, 20)}... (${token.length} chars)`);
  process.exit(1);
}

// Create QR code payload (same format as normal QR)
const payload = {
  v: 'v3',
  s: ngrokUrl,
  p: 443, // ngrok uses standard HTTPS port
  t: token,
  e: Date.now() + (90 * 24 * 60 * 60 * 1000) // 90 days expiry
};

const qrData = JSON.stringify(payload);

console.log('═══════════════════════════════════════════════════════');
console.log('  PhotoSync - ngrok QR Code Generator');
console.log('═══════════════════════════════════════════════════════\n');

console.log('Configuration:');
console.log(`  Server:  ${ngrokUrl}`);
console.log(`  Port:    443 (HTTPS)`);
console.log(`  Token:   ${token.substring(0, 16)}...${token.substring(48)}`);
console.log(`  Expires: ${new Date(payload.e).toISOString()}\n`);

// Generate QR code
QRCode.toDataURL(qrData, { width: 512, margin: 2 }, (err, url) => {
  if (err) {
    console.error('❌ Error generating QR code:', err);
    process.exit(1);
  }

  console.log('✅ QR Code generated!\n');
  console.log('📱 Scan this QR code with your PhotoSync PWA:\n');

  // Display as terminal QR code
  QRCode.toString(qrData, { type: 'terminal', small: true }, (err, qr) => {
    if (!err) {
      console.log(qr);
    }
  });

  console.log('\n💾 Or save as image:');
  console.log(`   Data URL: ${url.substring(0, 50)}...\n`);

  console.log('🌐 Manual Entry Alternative:');
  console.log(`   Server: ${ngrokUrl}`);
  console.log(`   Port:   443`);
  console.log(`   Token:  ${token}\n`);
});
