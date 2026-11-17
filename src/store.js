/**
 * Runs one Upstash Redis command over REST.
 *
 * @param {...(string|number)} cmd Command and arguments, e.g. 'GET', key.
 * @return {Promise<*>} The command result.
 * @throws {Error} If Redis returns an error.
 */
export async function redis(...cmd) {
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(`redis: ${j.error}`);
  return j.result;
}
/** A Redis read whose value is JSON; null if missing. */
export const json = async (...cmd) => JSON.parse((await redis(...cmd)) ?? 'null');
/** A Redis hash as an object. HGETALL returns a flat [k1, v1, k2, v2, ...]. */
export async function hash(key) {
  const flat = (await redis('HGETALL', key)) ?? [];
  return Object.fromEntries(Array.from({ length: flat.length / 2 }, (_, i) => flat.slice(2 * i, 2 * i + 2)));
}
/** Stores `value` as JSON at `key`, with a TTL in seconds if given. */
export const put = (key, value, ttl) => redis('SET', key, JSON.stringify(value), ...(ttl ? ['EX', ttl] : []));
/** HSET of a JSON value plus a TTL on the whole hash. */
export async function hput(key, field, value, ttl) {
  await redis('HSET', key, field, JSON.stringify(value));
  await redis('EXPIRE', key, ttl);
}
