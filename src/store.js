/** POSTs `body` to the Upstash REST endpoint `path` ('' for one command, '/pipeline' for several). */
async function upstash(path, body) {
  const r = await fetch(`${process.env.KV_REST_API_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    body: JSON.stringify(body),
  });
  return r.json();
}

/**
 * Runs one Upstash Redis command over REST.
 *
 * @param {...(string|number)} cmd Command and arguments, e.g. 'GET', key.
 * @return {Promise<*>} The command result.
 * @throws {Error} If Redis returns an error.
 */
export async function redis(...cmd) {
  const j = await upstash('', cmd);
  if (j.error) throw new Error(`redis: ${j.error}`);
  return j.result;
}
/** A Redis read whose value is JSON; null if missing. */
export const json = async (...cmd) => JSON.parse((await redis(...cmd)) ?? 'null');
/** A flat Redis hash reply [k1, v1, k2, v2, ...] as an object. */
export const pairs = (flat) => Object.fromEntries(Array.from({ length: flat.length / 2 }, (_, i) => flat.slice(2 * i, 2 * i + 2)));
/** A Redis hash as an object. */
export const hash = async (key) => pairs((await redis('HGETALL', key)) ?? []);
/** Stores `value` as JSON at `key`, with a TTL in seconds if given. */
export const put = (key, value, ttl) => redis('SET', key, JSON.stringify(value), ...(ttl ? ['EX', ttl] : []));
/** HSET of a JSON value plus a TTL on the whole hash, pipelined: one round trip instead of two. */
export async function hput(key, field, value, ttl) {
  const out = await upstash('/pipeline', [['HSET', key, field, JSON.stringify(value)], ['EXPIRE', key, ttl]]);
  const err = out.find((r) => r.error);
  if (err) throw new Error(`redis: ${err.error}`);
}
