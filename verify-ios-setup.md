# iOS Certificate Installation Verification Guide

You've installed the certificate but still seeing errors. Let's verify everything step by step.

## Step 1: Verify Profile Installation on iOS

On your iPhone/iPad:

1. **Go to Settings → General → VPN & Device Management**
2. **Look for "PhotoSync Local CA"** under Configuration Profiles
3. **Tap on it** - you should see:
   ```
   Profile Name: PhotoSync Certificate
   Organization: PhotoSync
   Verified: ✅ (green checkmark)
   ```

**If you DON'T see it:**
- The profile wasn't installed correctly
- Download again from: https://10.160.144.218:3001/ios-profile (use Wi-Fi IP)
- Install it again

**If you DO see it but no green checkmark:**
- The profile is installed but not verified
- This is OK, continue to Step 2

## Step 2: Verify Certificate Trust Settings

This is the MOST COMMONLY MISSED step!

1. **Go to Settings → General → About**
2. **Scroll to the very bottom**
3. **Tap "Certificate Trust Settings"**
4. **Look for "PhotoSync Local CA"**
5. **The switch MUST be ON (green)**

⚠️ **CRITICAL:** If the switch is OFF, the certificate won't work! Turn it ON.

You'll see a warning saying "This will install a certificate...". Tap "Continue".

## Step 3: Verify Correct IP Address

The certificate ONLY works with these IP addresses:
- `10.0.6.79` (VPN interface - may not work if VPN is running)
- `10.160.144.218` (Wi-Fi - RECOMMENDED)
- `127.0.0.1` / `localhost` (only works on desktop)

**To check which IP you're using:**

1. Open PhotoSync PWA
2. Go to Settings tab
3. Look at "Connection Diagnostics" or error messages
4. It should show something like `wss://[IP]:3001`

**If using wrong IP:**
- Scan the QR code again from the Electron app
- Use the Wi-Fi IP (10.160.144.218) instead of VPN IP

## Step 4: Clear PWA Cache

iOS may be caching old code that doesn't handle certificates correctly.

**On iOS:**
1. Close PhotoSync PWA completely (swipe up from app switcher)
2. Go to Settings → Safari
3. Scroll down to "Advanced"
4. Tap "Website Data"
5. Find PhotoSync or your server's domain
6. Swipe left and Delete
7. Go back to Settings → Safari → "Clear History and Website Data"
8. Open PhotoSync PWA again

## Step 5: Test Certificate in Safari First

Before trying the PWA:

1. Open **Safari** (not PWA) on your iPhone
2. Go to: `https://10.160.144.218:3001/setup`
   - Use the Wi-Fi IP address
3. **What happens?**

**If you see certificate warning:**
- ❌ Certificate not trusted
- Go back to Step 2 - the trust settings are not enabled
- OR you're using a different IP than what's in the certificate

**If page loads without warning:**
- ✅ Certificate is trusted correctly!
- The issue is with the PWA connection logic, not the certificate

**If you see "Can't establish secure connection":**
- ❌ Certificate doesn't include this IP address
- Check which IP you're using - it must be 10.160.144.218 or 10.0.6.79

## Step 6: Check Debug Logs

1. Open PhotoSync PWA
2. Go to Settings tab
3. Expand "Connection Diagnostics"
4. Try to connect
5. **Look at the debug logs** - scroll to the bottom

**What to look for:**

```
❌ WebSocket CLOSE event (code: 1006)
   Likely SSL/TLS certificate rejection
```
= Certificate not trusted (go back to Step 2)

```
❌ Connection timeout - no response from server
```
= Wrong IP address or network issue (go to Step 3)

```
❌ WebSocket ERROR event
   Not a secure context
```
= PWA not loaded via HTTPS

## Step 7: Restart Everything

Sometimes iOS just needs a fresh start:

1. **On iOS:**
   - Close PhotoSync PWA completely
   - Restart Safari (close all tabs)
   - Restart iPhone (power off, power on)

2. **On Desktop:**
   - Stop Electron app
   - Run: `npm start`
   - Verify server logs show "Using CA-signed certificates"

3. **Try connecting again**

## Step 8: Verify Network

Make sure iPhone and computer are on the **SAME WiFi network**:

**On iPhone:**
- Settings → WiFi → Note the network name

**On Computer:**
- Check WiFi settings
- Make sure it's the same network
- NOT using VPN or guest network

## Common Issues & Solutions

### "Certificate is not trusted"
**Cause:** Certificate Trust Settings not enabled
**Fix:** Settings → General → About → Certificate Trust Settings → Enable PhotoSync Local CA

### "Can't establish secure connection to server"
**Cause:** Wrong IP address or IP not in certificate
**Fix:** Use 10.160.144.218 (Wi-Fi IP), regenerate certs if needed

### "Connection timeout"
**Cause:** Network issue or firewall
**Fix:** Verify same WiFi, check firewall on desktop

### "Certificate is for a different domain"
**Cause:** Connecting to IP not in certificate
**Fix:** Use exact IP from QR code (10.160.144.218)

## Still Not Working?

If you've completed ALL steps above and it still doesn't work:

1. **Copy your PWA debug logs:**
   - Connection Diagnostics → Copy Logs button
   - Send the logs to the developer

2. **Check server logs:**
   - Look at Electron app console
   - Does it show any connection attempts?

3. **Try the manual certificate method instead:**
   - In Safari, visit: `https://10.160.144.218:3001`
   - Accept the certificate warning manually
   - Return to PWA and try connecting

4. **Regenerate everything:**
   ```bash
   cd PhotoSync-Electron
   npm run generate-ca
   npm start
   ```
   - Download and install profile again
   - Enable trust settings again
