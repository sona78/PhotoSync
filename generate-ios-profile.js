/**
 * Generate iOS Configuration Profile for PhotoSync CA Certificate
 *
 * This creates a .mobileconfig file that can be installed on iOS devices
 * to trust the PhotoSync local Certificate Authority.
 *
 * Usage: node generate-ios-profile.js
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CERT_DIR = path.join(__dirname, 'certificates');
const CA_CERT_FILE = path.join(CERT_DIR, 'ca-cert.pem');
const PROFILE_FILE = path.join(CERT_DIR, 'PhotoSync-CA.mobileconfig');

/**
 * Generate UUID (v4)
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Convert PEM certificate to DER format (binary)
 */
function pemToDer(pemCert) {
  // Remove PEM header/footer and whitespace
  const base64 = pemCert
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s/g, '');

  // Convert to binary buffer
  return Buffer.from(base64, 'base64');
}

/**
 * Generate iOS configuration profile XML
 */
function generateProfile(caCertDer) {
  const payloadUUID = generateUUID();
  const certificateUUID = generateUUID();
  const now = new Date().toISOString();

  // Convert DER certificate to base64 for XML embedding
  const certBase64 = caCertDer.toString('base64');

  // Generate .mobileconfig XML
  const profileXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>PayloadContent</key>
\t<array>
\t\t<dict>
\t\t\t<key>PayloadCertificateFileName</key>
\t\t\t<string>PhotoSync-CA.pem</string>
\t\t\t<key>PayloadContent</key>
\t\t\t<data>
\t\t\t${certBase64}
\t\t\t</data>
\t\t\t<key>PayloadDescription</key>
\t\t\t<string>Installs the PhotoSync Certificate Authority certificate</string>
\t\t\t<key>PayloadDisplayName</key>
\t\t\t<string>PhotoSync Local CA</string>
\t\t\t<key>PayloadIdentifier</key>
\t\t\t<string>com.photosync.ca.${certificateUUID}</string>
\t\t\t<key>PayloadType</key>
\t\t\t<string>com.apple.security.root</string>
\t\t\t<key>PayloadUUID</key>
\t\t\t<string>${certificateUUID}</string>
\t\t\t<key>PayloadVersion</key>
\t\t\t<integer>1</integer>
\t\t</dict>
\t</array>
\t<key>PayloadDescription</key>
\t<string>This profile installs the PhotoSync Certificate Authority to enable secure connections between your iOS device and PhotoSync server.</string>
\t<key>PayloadDisplayName</key>
\t<string>PhotoSync Certificate</string>
\t<key>PayloadIdentifier</key>
\t<string>com.photosync.profile</string>
\t<key>PayloadRemovalDisallowed</key>
\t<false/>
\t<key>PayloadType</key>
\t<string>Configuration</string>
\t<key>PayloadUUID</key>
\t<string>${payloadUUID}</string>
\t<key>PayloadVersion</key>
\t<integer>1</integer>
\t<key>PayloadOrganization</key>
\t<string>PhotoSync</string>
</dict>
</plist>
`;

  return profileXML;
}

/**
 * Main execution
 */
function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  PhotoSync - iOS Configuration Profile Generator');
  console.log('═══════════════════════════════════════════════════════\n');

  // Check if CA certificate exists
  if (!fs.existsSync(CA_CERT_FILE)) {
    console.error('❌ Error: CA certificate not found!');
    console.error(`   Expected location: ${CA_CERT_FILE}`);
    console.error('\n💡 Run "node generate-ca.js" first to generate the CA certificate\n');
    process.exit(1);
  }

  console.log('[Profile] Reading CA certificate...');
  const caCertPem = fs.readFileSync(CA_CERT_FILE, 'utf8');

  console.log('[Profile] Converting PEM to DER format...');
  const caCertDer = pemToDer(caCertPem);

  console.log('[Profile] Generating iOS configuration profile...');
  const profileXML = generateProfile(caCertDer);

  console.log('[Profile] Writing profile to file...');
  fs.writeFileSync(PROFILE_FILE, profileXML, 'utf8');

  console.log('[Profile] ✅ iOS configuration profile generated successfully!');
  console.log(`[Profile]    File: ${PROFILE_FILE}`);
  console.log(`[Profile]    Size: ${(profileXML.length / 1024).toFixed(2)} KB`);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ✅ Profile generation complete!');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('📱 To install on iOS:');
  console.log('   1. Start PhotoSync Electron app');
  console.log('   2. Scan the iOS setup QR code with your iPhone/iPad');
  console.log('   3. Tap "Allow" to download the profile');
  console.log('   4. Go to Settings → Profile Downloaded → PhotoSync Local CA');
  console.log('   5. Tap "Install" and enter your passcode');
  console.log('   6. Go to Settings → General → About → Certificate Trust Settings');
  console.log('   7. Enable "PhotoSync Local CA"\n');

  console.log('🌐 Or download directly:');
  console.log(`   Visit: https://[server-ip]:3001/ios-profile\n`);

  console.log('✨ After installation:');
  console.log('   - All connections will work without certificate warnings');
  console.log('   - Valid for 10 years');
  console.log('   - Can be removed anytime from Settings → Profile\n');
}

// Run main
try {
  main();
} catch (error) {
  console.error('\n❌ Error generating iOS profile:', error.message);
  console.error(error.stack);
  process.exit(1);
}
