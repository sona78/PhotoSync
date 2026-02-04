/**
 * Certificate Diagnostics Tool
 *
 * Checks certificate configuration and provides troubleshooting info
 */

import fs from 'fs';
import path from 'path';
import forge from 'node-forge';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('═══════════════════════════════════════════════════════');
console.log('  PhotoSync - Certificate Diagnostics');
console.log('═══════════════════════════════════════════════════════\n');

// Check for CA certificates
const caCertPath = path.join(__dirname, 'certificates', 'ca-cert.pem');
const caKeyPath = path.join(__dirname, 'certificates', 'ca-key.pem');
const serverCertPath = path.join(__dirname, 'certificates', 'server-cert.pem');
const serverKeyPath = path.join(__dirname, 'certificates', 'server-key.pem');
const profilePath = path.join(__dirname, 'certificates', 'PhotoSync-CA.mobileconfig');

// Check for fallback self-signed certificates
const selfSignedCertPath = path.join(__dirname, 'cert.pem');
const selfSignedKeyPath = path.join(__dirname, 'key.pem');

console.log('[1] Checking Certificate Files...\n');

const caExists = fs.existsSync(caCertPath) && fs.existsSync(caKeyPath);
const serverExists = fs.existsSync(serverCertPath) && fs.existsSync(serverKeyPath);
const profileExists = fs.existsSync(profilePath);
const selfSignedExists = fs.existsSync(selfSignedCertPath) && fs.existsSync(selfSignedKeyPath);

console.log(`CA Certificate:        ${caExists ? '✅ Found' : '❌ Missing'}`);
console.log(`Server Certificate:    ${serverExists ? '✅ Found' : '❌ Missing'}`);
console.log(`iOS Profile:           ${profileExists ? '✅ Found' : '❌ Missing'}`);
console.log(`Self-Signed Fallback:  ${selfSignedExists ? '✅ Found' : '❌ Missing'}`);

if (!serverExists && !selfSignedExists) {
  console.log('\n❌ ERROR: No certificates found!');
  console.log('Run: npm run generate-ca');
  process.exit(1);
}

// Determine which certificates the server will use
let certToCheck, keyToCheck, certType;
if (serverExists) {
  certToCheck = serverCertPath;
  keyToCheck = serverKeyPath;
  certType = 'CA-Signed';
} else {
  certToCheck = selfSignedCertPath;
  keyToCheck = selfSignedKeyPath;
  certType = 'Self-Signed';
}

console.log(`\n[2] Server Will Use: ${certType} Certificates\n`);

// Read and parse the server certificate
try {
  const certPem = fs.readFileSync(certToCheck, 'utf8');
  const cert = forge.pki.certificateFromPem(certPem);

  console.log('[3] Server Certificate Details:\n');

  // Subject
  const subject = cert.subject.attributes.map(attr => `${attr.shortName}=${attr.value}`).join(', ');
  console.log(`Subject: ${subject}`);

  // Issuer
  const issuer = cert.issuer.attributes.map(attr => `${attr.shortName}=${attr.value}`).join(', ');
  console.log(`Issuer:  ${issuer}`);

  // Validity
  const now = new Date();
  const notBefore = cert.validity.notBefore;
  const notAfter = cert.validity.notAfter;
  const isValid = now >= notBefore && now <= notAfter;

  console.log(`\nValidity:`);
  console.log(`  Not Before: ${notBefore.toISOString()}`);
  console.log(`  Not After:  ${notAfter.toISOString()}`);
  console.log(`  Status:     ${isValid ? '✅ Valid' : '❌ Expired or not yet valid'}`);

  // Check for Subject Alternative Names (SANs)
  console.log(`\n[4] Subject Alternative Names (SANs):\n`);

  let hasLocalhost = false;
  let sanIPs = [];
  let sanDNS = [];

  const extensions = cert.extensions || [];
  const sanExt = extensions.find(ext => ext.name === 'subjectAltName');

  if (sanExt && sanExt.altNames) {
    sanExt.altNames.forEach(alt => {
      if (alt.type === 2) { // DNS
        sanDNS.push(alt.value);
        if (alt.value === 'localhost') hasLocalhost = true;
      } else if (alt.type === 7) { // IP
        sanIPs.push(alt.ip);
      }
    });

    console.log('DNS Names:');
    sanDNS.forEach(dns => console.log(`  - ${dns}`));

    console.log('\nIP Addresses:');
    sanIPs.forEach(ip => console.log(`  - ${ip}`));
  } else {
    console.log('❌ No Subject Alternative Names found!');
    console.log('This will cause certificate validation errors on iOS.');
  }

  // Get current network IPs
  console.log(`\n[5] Current Network Interfaces:\n`);

  const interfaces = os.networkInterfaces();
  const currentIPs = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.internal || iface.family !== 'IPv4') continue;

      const skipPatterns = ['VMware', 'VirtualBox', 'Hyper-V', 'vEthernet', 'docker', 'vboxnet'];
      if (skipPatterns.some(pattern => name.toLowerCase().includes(pattern.toLowerCase()))) {
        continue;
      }

      const inCert = sanIPs.includes(iface.address);
      currentIPs.push({
        name,
        address: iface.address,
        inCert
      });

      console.log(`${inCert ? '✅' : '⚠️ '} ${name}: ${iface.address} ${inCert ? '' : '(NOT in certificate!)'}`);
    }
  }

  // Check for mismatches
  console.log(`\n[6] Certificate Validation:\n`);

  const issues = [];

  // Check if any current IPs are missing from cert
  const missingIPs = currentIPs.filter(ip => !ip.inCert);
  if (missingIPs.length > 0) {
    issues.push({
      severity: 'WARNING',
      issue: 'Current IP addresses not in certificate',
      detail: `The following IPs are active but not in the certificate: ${missingIPs.map(ip => ip.address).join(', ')}`,
      fix: 'Regenerate certificates with: npm run generate-ca'
    });
  }

  // Check if localhost is present
  if (!hasLocalhost) {
    issues.push({
      severity: 'WARNING',
      issue: 'localhost not in certificate',
      detail: 'The certificate does not include localhost as a DNS name',
      fix: 'Regenerate certificates with: npm run generate-ca'
    });
  }

  // Check if cert is about to expire
  const daysUntilExpiry = Math.floor((notAfter - now) / (1000 * 60 * 60 * 24));
  if (daysUntilExpiry < 30) {
    issues.push({
      severity: daysUntilExpiry < 7 ? 'ERROR' : 'WARNING',
      issue: 'Certificate expiring soon',
      detail: `Certificate expires in ${daysUntilExpiry} days`,
      fix: 'Regenerate certificates with: npm run generate-ca'
    });
  }

  if (issues.length === 0) {
    console.log('✅ No issues detected with certificate configuration');
  } else {
    console.log(`Found ${issues.length} issue(s):\n`);
    issues.forEach((issue, idx) => {
      console.log(`${idx + 1}. [${issue.severity}] ${issue.issue}`);
      console.log(`   ${issue.detail}`);
      console.log(`   Fix: ${issue.fix}\n`);
    });
  }

  // iOS-specific checks
  console.log(`\n[7] iOS Connection Checklist:\n`);

  console.log(`${certType === 'CA-Signed' ? '✅' : '❌'} Using CA-signed certificates (recommended for iOS)`);
  console.log(`${profileExists ? '✅' : '❌'} iOS configuration profile generated`);
  console.log(`${sanExt && sanExt.altNames ? '✅' : '❌'} Certificate has Subject Alternative Names`);
  console.log(`${isValid ? '✅' : '❌'} Certificate is currently valid`);
  console.log(`${sanIPs.length > 0 ? '✅' : '❌'} Certificate includes IP addresses`);

  console.log(`\n[8] Connection URLs:\n`);

  currentIPs.forEach(ip => {
    console.log(`iOS Setup Page:  https://${ip.address}:3001/setup`);
    console.log(`iOS Profile:     https://${ip.address}:3001/ios-profile`);
    console.log(`WebSocket:       wss://${ip.address}:3001`);
    console.log(``);
  });

  console.log(`[9] Recommended Actions:\n`);

  if (certType === 'Self-Signed') {
    console.log('⚠️  You are using self-signed certificates.');
    console.log('   For better iOS support, run: npm run generate-ca\n');
  }

  if (missingIPs.length > 0) {
    console.log('⚠️  Your network configuration has changed.');
    console.log('   Regenerate certificates: npm run generate-ca\n');
  }

  if (!profileExists && certType === 'CA-Signed') {
    console.log('⚠️  iOS profile not found.');
    console.log('   Generate it: node generate-ios-profile.js\n');
  }

  if (issues.length === 0 && certType === 'CA-Signed' && profileExists) {
    console.log('✅ Certificate configuration looks good!');
    console.log('   If you still have connection issues:');
    console.log('   1. Verify iOS profile is installed: Settings → General → VPN & Device Management');
    console.log('   2. Verify certificate is trusted: Settings → General → About → Certificate Trust Settings');
    console.log('   3. Check PWA debug logs in Connection Diagnostics');
    console.log('   4. Verify phone and server are on same WiFi network\n');
  }

} catch (error) {
  console.error('\n❌ Error reading certificate:', error.message);
  process.exit(1);
}

console.log('═══════════════════════════════════════════════════════');
console.log('  Diagnostics Complete');
console.log('═══════════════════════════════════════════════════════\n');
