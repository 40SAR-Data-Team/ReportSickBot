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

/**
 * GET /api/health: 200 if Redis answers, the Telegram webhook is set with no error in the last 10 minutes,
 * and ADMINS is configured; else 503. Booleans only, no IDs or error text, so it is safe to leave public.
 */
export default async function health(req, res) {
  const [redisOk, webhook, adminsOk] = await Promise.all([
    check('redis', async () => (await redis('PING')) === 'PONG'),
    check('webhook', async () => {
      const w = await tg('getWebhookInfo', {});
      return w.url && !(w.last_error_date > Date.now() / 1000 - 600);
    }),
    check('admins', () => admins().length > 0),
  ]);
  const ok = redisOk && webhook && adminsOk;
  res.status(ok ? 200 : 503).json({ ok, redis: redisOk, webhook, admins: adminsOk });
}
