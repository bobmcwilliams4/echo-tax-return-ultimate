// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — PII Encryption (AES-256-GCM)
// Field-level encryption for SSN, bank accounts, and other PII
// ═══════════════════════════════════════════════════════════════════════════

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'echo-tax-return-ultimate-dev-key-32b!';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKeyBuffer(): Uint8Array {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(ENCRYPTION_KEY);
  // Ensure 32 bytes for AES-256
  const key = new Uint8Array(32);
  key.set(keyData.slice(0, 32));
  return key;
}

export function encryptField(plaintext: string): Buffer {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = getKeyBuffer();
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // Use Node.js crypto for AES-256-GCM
  const { createCipheriv } = require('crypto');
  const cipher = createCipheriv(ALGORITHM, Buffer.from(key), Buffer.from(iv));
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: [iv (12)] [tag (16)] [ciphertext]
  return Buffer.concat([Buffer.from(iv), tag, encrypted]);
}

export function decryptField(encrypted: Buffer): string {
  const iv = encrypted.subarray(0, IV_LENGTH);
  const tag = encrypted.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = encrypted.subarray(IV_LENGTH + TAG_LENGTH);
  const key = getKeyBuffer();

  const { createDecipheriv } = require('crypto');
  const decipher = createDecipheriv(ALGORITHM, Buffer.from(key), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('utf-8');
}

export function extractLast4(value: string): string {
  return value.slice(-4);
}

export function hashForLookup(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}
