/**
 * Generate Local Certificate Authority (CA) for PhotoSync
 *
 * This creates a local CA that can be trusted on iOS devices via
 * configuration profile installation. Once trusted, all certificates
 * signed by this CA are automatically trusted.
 *
 * Usage: node generate-ca.js
 */

import forge from 'node-forge';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CERT_DIR = path.join(__dirname, 'certificates');
const CA_KEY_FILE = path.join(CERT_DIR, 'ca-key.pem');
const CA_CERT_FILE = path.join(CERT_DIR, 'ca-cert.pem');
const SERVER_KEY_FILE = path.join(CERT_DIR, 'server-key.pem');
const SERVER_CERT_FILE = path.join(CERT_DIR, 'server-cert.pem');

// Ensure certificates directory exists
if (!fs.existsSync(CERT_DIR)) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
}

/**
 * Generate CA certificate (if doesn't exist)
 */
function generateCA() {
  console.log('[CA] Checking for existing Certificate Authority...');

  // Check if CA already exists
  if (fs.existsSync(CA_KEY_FILE) && fs.existsSync(CA_CERT_FILE)) {
    console.log('[CA] ✅ CA already exists, skipping generation');
    console.log(`[CA]    Location: ${CERT_DIR}`);
    return {
      privateKey: forge.pki.privateKeyFromPem(fs.readFileSync(CA_KEY_FILE, 'utf8')),
      certificate: forge.pki.certificateFromPem(fs.readFileSync(CA_CERT_FILE, 'utf8'))
    };
  }

  console.log('[CA] 🔨 Generating new Certificate Authority...');

  // Generate key pair for CA
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create CA certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10); // Valid for 10 years

  // CA attributes
  const attrs = [
    { name: 'commonName', value: 'PhotoSync Local CA' },
    { name: 'countryName', value: 'US' },
    { name: 'organizationName', value: 'PhotoSync' },
    { shortName: 'OU', value: 'PhotoSync Certificate Authority' }
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs); // Self-signed

  // CA extensions
  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: true, // This is a CA certificate
      critical: true
    },
    {
      name: 'keyUsage',
      keyCertSign: true,
      cRLSign: true,
      critical: true
    },
    {
      name: 'subjectKeyIdentifier'
    }
  ]);

  // Self-sign certificate
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Save CA certificate and key
  const pemKey = forge.pki.privateKeyToPem(keys.privateKey);
  const pemCert = forge.pki.certificateToPem(cert);

  fs.writeFileSync(CA_KEY_FILE, pemKey);
  fs.writeFileSync(CA_CERT_FILE, pemCert);

  console.log('[CA] ✅ Certificate Authority generated successfully!');
  console.log(`[CA]    Private Key: ${CA_KEY_FILE}`);
  console.log(`[CA]    Certificate: ${CA_CERT_FILE}`);
  console.log(`[CA]    Valid until: ${cert.validity.notAfter.toISOString()}`);

  return { privateKey: keys.privateKey, certificate: cert };
}

/**
 * Generate server certificate signed by CA
 */
function generateServerCert(ca, hostnames = []) {
  console.log('[Server] Generating server certificate...');

  // Generate key pair for server
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create server certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 2); // Valid for 2 years

  // Server attributes
  const attrs = [
    { name: 'commonName', value: hostnames[0] || 'localhost' },
    { name: 'countryName', value: 'US' },
    { name: 'organizationName', value: 'PhotoSync' },
    { shortName: 'OU', value: 'PhotoSync Server' }
  ];

  cert.setSubject(attrs);
  cert.setIssuer(ca.certificate.subject.attributes); // Issued by CA

  // Build Subject Alternative Names (SAN)
  const altNames = [
    { type: 2, value: 'localhost' }, // DNS
    { type: 7, ip: '127.0.0.1' } // IP
  ];

  // Add all provided hostnames/IPs
  hostnames.forEach(hostname => {
    // Check if it's an IP address
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
      altNames.push({ type: 7, ip: hostname });
    } else {
      altNames.push({ type: 2, value: hostname });
    }
  });

  // Server extensions
  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: false
    },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
      critical: true
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
      clientAuth: true
    },
    {
      name: 'subjectAltName',
      altNames: altNames
    },
    {
      name: 'subjectKeyIdentifier'
    }
  ]);

  // Sign with CA
  cert.sign(ca.privateKey, forge.md.sha256.create());

  // Save server certificate and key
  const pemKey = forge.pki.privateKeyToPem(keys.privateKey);
  const pemCert = forge.pki.certificateToPem(cert);

  fs.writeFileSync(SERVER_KEY_FILE, pemKey);
  fs.writeFileSync(SERVER_CERT_FILE, pemCert);

  console.log('[Server] ✅ Server certificate generated!');
  console.log(`[Server]    Private Key: ${SERVER_KEY_FILE}`);
  console.log(`[Server]    Certificate: ${SERVER_CERT_FILE}`);
  console.log(`[Server]    Valid until: ${cert.validity.notAfter.toISOString()}`);
  console.log(`[Server]    Hostnames/IPs: ${altNames.map(a => a.value || a.ip).join(', ')}`);

  return { privateKey: keys.privateKey, certificate: cert };
}

/**
 * Get local network IPs
 */
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4
      if (iface.internal || iface.family !== 'IPv4') continue;

      // Skip common virtual/VPN adapters
      const skipPatterns = ['VMware', 'VirtualBox', 'Hyper-V', 'vEthernet', 'docker', 'vboxnet'];
      if (skipPatterns.some(pattern => name.toLowerCase().includes(pattern.toLowerCase()))) {
        continue;
      }

      ips.push(iface.address);
    }
  }

  return ips;
}

/**
 * Main execution
 */
function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  PhotoSync - Certificate Authority Generator');
  console.log('═══════════════════════════════════════════════════════\n');

  // Generate or load CA
  const ca = generateCA();

  // Get local IPs for server certificate
  const localIPs = getLocalIPs();
  console.log(`\n[Network] Detected local IPs: ${localIPs.join(', ')}`);

  // Generate server certificate with all local IPs
  generateServerCert(ca, ['localhost', ...localIPs]);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ✅ Certificate generation complete!');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('📱 Next steps for iOS:');
  console.log('   1. Install CA certificate on iOS device');
  console.log('   2. Trust the certificate in Settings');
  console.log('   3. No more certificate warnings!\n');

  console.log('💡 To install on iOS:');
  console.log('   - Use the Electron app to generate an iOS profile');
  console.log('   - Or manually: Settings → General → VPN & Device Management\n');

  console.log('🔧 Files created:');
  console.log(`   CA Cert:     ${path.relative(process.cwd(), CA_CERT_FILE)}`);
  console.log(`   CA Key:      ${path.relative(process.cwd(), CA_KEY_FILE)}`);
  console.log(`   Server Cert: ${path.relative(process.cwd(), SERVER_CERT_FILE)}`);
  console.log(`   Server Key:  ${path.relative(process.cwd(), SERVER_KEY_FILE)}`);
  console.log('\n');
}

// Check if node-forge is installed
try {
  main();
} catch (error) {
  if (error.code === 'MODULE_NOT_FOUND' && error.message.includes('node-forge')) {
    console.error('\n❌ Error: node-forge is not installed\n');
    console.error('Please install it first:');
    console.error('  npm install node-forge\n');
    process.exit(1);
  }
  throw error;
}
