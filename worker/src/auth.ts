/**
 * Simple JWT implementation using Web Crypto API (available in Workers).
 * Uses HMAC-SHA256 for signing.
 */

interface JWTPayload {
  code: string;
  tier: string;
  deviceHash: string;
  exp: number;
  iat: number;
  source?: string;
}

function base64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createJWT(payload: JWTPayload, secret: string): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const data = `${header}.${body}`;

  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));

  return `${data}.${base64url(sig)}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, sig] = parts;
    const data = `${header}.${body}`;

    const key = await getKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64urlDecode(sig),
      new TextEncoder().encode(data)
    );

    if (!valid) return null;

    const payload: JWTPayload = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}
