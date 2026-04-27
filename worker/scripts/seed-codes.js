/**
 * Seed activation codes into Cloudflare KV.
 *
 * Usage:
 *   cd worker
 *   npx wrangler kv namespace list   # get your KV namespace ID
 *   node scripts/seed-codes.js       # outputs wrangler commands
 *
 * Then run the output commands to seed the data.
 */

const CODES = {
  'VSTEST2026': {
    tier: 'trial',
    days: 14,
    source: 'VoiceScope',
    maxActivations: 100,
    enabled: true,
  },
  'VSFRIEND2026': {
    tier: 'trial',
    days: 14,
    source: 'VoiceScope',
    maxActivations: 50,
    enabled: true,
  },
  // Add partner codes here:
  // 'PTN_SALON_2026Q2': {
  //   tier: 'trial',
  //   days: 60,
  //   source: 'オンラインサロン名',
  //   maxActivations: 200,
  //   enabled: true,
  // },
};

// Output wrangler commands
console.log('# Run these commands to seed activation codes:\n');
for (const [code, data] of Object.entries(CODES)) {
  const json = JSON.stringify(data).replace(/"/g, '\\"');
  console.log(`npx wrangler kv key put --binding CODES "code:${code}" "${json}"`);
}
console.log('\n# Done! Verify with:');
console.log('npx wrangler kv key list --binding CODES');
