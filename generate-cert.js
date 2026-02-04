import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');

console.log('Checking for SSL certificates...');

// Check if certificates already exist
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  console.log('SSL certificates already exist:');
  console.log(`  - ${certPath}`);
  console.log(`  - ${keyPath}`);
  process.exit(0);
}

console.log('Generating self-signed SSL certificates for development...');

// Generate self-signed certificate using OpenSSL
const opensslArgs = [
  'req',
  '-x509',
  '-newkey', 'rsa:4096',
  '-keyout', keyPath,
  '-out', certPath,
  '-days', '365',
  '-nodes',
  '-subj', '/C=US/ST=State/L=City/O=PhotoSync/CN=localhost'
];

const openssl = spawn('openssl', opensslArgs, {
  stdio: 'inherit',
  shell: true
});

openssl.on('error', (error) => {
  console.error('\nError: OpenSSL not found or failed to execute.');
  console.error('Please install OpenSSL to generate certificates.');
  console.error('\nAlternatively, you can generate certificates manually:');
  console.error('  openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes');
  process.exit(1);
});

openssl.on('close', (code) => {
  if (code === 0) {
    console.log('\nCertificates generated successfully!');
    console.log(`  - ${certPath}`);
    console.log(`  - ${keyPath}`);
    console.log('\nNote: These are self-signed certificates for development only.');
    console.log('Clients will need to accept the certificate warning on first connection.');
  } else {
    console.error(`\nCertificate generation failed with code ${code}`);
    process.exit(1);
  }
});
