/* global console */
/**
 * OTP Secret Generator
 *
 * Generates a Base32-encoded secret for TOTP authentication.
 * Use this to create TOTP_SECRET environment variable.
 *
 * Usage: node scripts/generate-otp-secret.js
 */
import { generateSecret } from 'otplib';

// Generate a 20-byte Base32-encoded secret
const secret = generateSecret();

console.log('Generated OTP Secret:', secret);
console.log('\nAdd to your .env file:');
console.log(`TOTP_SECRET=${secret}`);
