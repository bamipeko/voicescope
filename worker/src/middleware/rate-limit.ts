import type { Env } from '../index';

const RATE_LIMITS: Record<string, number> = {
  free: 30,    // 30 requests/hour (limited testing)
  trial: 60,   // 60 requests/hour
  pro: 120,    // 120 requests/hour
  heavy: 300,  // 300 requests/hour
};

/**
 * Check rate limit for the given code AND device. Both must be under limit.
 * This prevents a single code from being shared across many devices,
 * and also prevents a single device from excessive usage.
 */
export async function checkRateLimit(kv: KVNamespace, code: string, tier: string, deviceHash?: string): Promise<boolean> {
  const limit = RATE_LIMITS[tier] || 60;
  const hourKey = new Date().toISOString().slice(0, 13).replace(/[-T:]/g, ''); // yyyyMMddHH

  // Per-code limit
  const codeKey = `rateLimit:${code}:${hourKey}`;
  const codeCount = parseInt(await kv.get(codeKey) || '0', 10);
  if (codeCount >= limit) return false;

  // Per-device limit (stricter: same as per-code, so sharing a code doesn't multiply)
  if (deviceHash) {
    const deviceKey = `rateLimit:device:${deviceHash}:${hourKey}`;
    const deviceCount = parseInt(await kv.get(deviceKey) || '0', 10);
    if (deviceCount >= limit) return false;
    await kv.put(deviceKey, String(deviceCount + 1), { expirationTtl: 7200 });
  }

  await kv.put(codeKey, String(codeCount + 1), { expirationTtl: 7200 });
  return true;
}
