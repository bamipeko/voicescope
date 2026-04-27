import type { Context } from 'hono';
import type { Env } from '../index';
import { createJWT } from '../auth';

interface CodeInfo {
  tier: string;
  days: number;
  source: string;
  maxActivations: number;
  enabled: boolean;
}

/**
 * POST /verify — Validate activation code and return JWT.
 *
 * Body: { code: string, deviceHash: string }
 * Returns: { token, tier, expiry, days, source }
 */
export async function verify(c: Context<{ Bindings: Env }>) {
  try {
    const { code, deviceHash } = await c.req.json();
    const normalizedCode = (code || '').trim().toUpperCase();

    if (!normalizedCode || !deviceHash) {
      return c.json({ error: 'コードとデバイス情報が必要です' }, 400);
    }

    // Validate deviceHash format (must be hex, 8-64 chars)
    if (!/^[a-f0-9]{8,64}$/i.test(deviceHash)) {
      return c.json({ error: 'デバイス情報が不正です' }, 400);
    }

    // Look up code in KV
    const codeData = await c.env.CODES.get(`code:${normalizedCode}`, 'json') as CodeInfo | null;
    if (!codeData || !codeData.enabled) {
      return c.json({ error: '無効なコードです' }, 400);
    }

    // Check max activations
    const countStr = await c.env.CODES.get(`activationCount:${normalizedCode}`);
    const count = parseInt(countStr || '0', 10);
    if (codeData.maxActivations > 0 && count >= codeData.maxActivations) {
      // Check if this device already activated (allow re-activation)
      const existing = await c.env.CODES.get(`activation:${normalizedCode}:${deviceHash}`);
      if (!existing) {
        return c.json({ error: 'このコードの有効化回数が上限に達しています' }, 400);
      }
    }

    // Calculate expiry
    const now = Math.floor(Date.now() / 1000);
    const expirySeconds = codeData.days * 24 * 60 * 60;
    const exp = now + expirySeconds;
    const expiryISO = new Date(exp * 1000).toISOString();

    // Create JWT
    const token = await createJWT({
      code: normalizedCode,
      tier: codeData.tier,
      deviceHash,
      exp,
      iat: now,
      source: codeData.source,
    }, c.env.JWT_SECRET);

    // Check if this is a new device activation (before writing)
    const existingActivation = await c.env.CODES.get(`activation:${normalizedCode}:${deviceHash}`);
    const isNewDevice = !existingActivation;

    // Record activation
    await c.env.CODES.put(
      `activation:${normalizedCode}:${deviceHash}`,
      JSON.stringify({ activatedAt: new Date().toISOString(), expiresAt: expiryISO, tier: codeData.tier }),
      { expirationTtl: expirySeconds }
    );

    // Increment activation count only for genuinely new devices
    if (isNewDevice) {
      await c.env.CODES.put(`activationCount:${normalizedCode}`, String(count + 1));
    }

    return c.json({
      success: true,
      token,
      tier: codeData.tier,
      expiry: expiryISO,
      days: codeData.days,
      source: codeData.source,
    });
  } catch (err: any) {
    return c.json({ error: 'コード検証に失敗しました: ' + err.message }, 500);
  }
}
