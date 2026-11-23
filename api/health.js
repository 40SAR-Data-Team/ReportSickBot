import { redis } from '../src/store.js';
import { admins, tg } from '../src/telegram.js';

/** Runs a check; any throw or falsy result counts as down, and is logged. */
const check = async (name, fn) => {
  try {
    if (await fn()) return true;
    console.error(`health ${name}: failed`);
  } catch (e) {
    console.error(`health ${name}:`, e);
  }
  return false;
};

// Public and unauthenticated, yet every fresh check spends a Redis command and a Telegram getWebhookInfo call.
// Telegram rate-limits per bot token, so a flood here could also throttle the bot's real replies. Reuse one
// result for 30s per warm instance; concurrent requests share the in-flight check.
// ponytail: per-instance cache, so each cold start still runs one check; add a Vercel Firewall rate-limit rule on /api/health if floods matter.
const TTL_MS = 30_000;
let cached = { at: -Infinity, result: null };
export const resetHealthCache = () => { cached = { at: -Infinity, result: null }; }; // tests only

const runChecks = async () => {
  const [redisOk, webhook, adminsOk] = await Promise.all([
    check('redis', async () => (await redis('PING')) === 'PONG'),
    check('webhook', async () => {
      const w = await tg('getWebhookInfo', {});
      return w.url && !(w.last_error_date > Date.now() / 1000 - 600);
    }),
    check('admins', () => admins().length > 0),
  ]);
  return { ok: redisOk && webhook && adminsOk, redis: redisOk, webhook, admins: adminsOk };
};

/**
 * GET /api/health: 200 if Redis answers, the Telegram webhook is set with no error in the last 10 minutes,
 * and ADMINS is configured; else 503. Booleans only, no IDs or error text, so it is safe to leave public.
 */
export default async function health(req, res) {
  if (!(Date.now() - cached.at < TTL_MS)) cached = { at: Date.now(), result: runChecks() };
  const result = await cached.result; // never rejects: check() turns every throw into false
  res.status(result.ok ? 200 : 503).json(result);
}
