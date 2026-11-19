// Dummy Telegram + Upstash backend and update builders shared by the tests.

export const ADMINS = [901, 902];
export const USER = { id: 111, username: 'pte_tan' };

export const ENV = {
  BOT_TOKEN: 'dummy-token',
  WEBHOOK_SECRET: 'dummy-secret',
  ADMINS: JSON.stringify({ 'Admin A': ADMINS[0], 'Admin B': ADMINS[1] }),
  KV_REST_API_TOKEN: 'dummy-kv-token',
};

/** In-memory fake: records Telegram calls, stores Redis keys. Add chat ids to `failFor` to make calls to them fail. */
export function fakeBackend() {
  const b = { store: new Map(), calls: [], failFor: new Set(), nextId: 1000 };
  b.respond = (url, body) => {
    if (url.includes('/bot')) {
      const method = url.split('/').pop();
      const call = { method, ...body };
      b.calls.push(call);
      if (b.failFor.has(body.chat_id)) return { ok: false, description: 'dummy failure' };
      call.result = method === 'sendMessage' || method === 'copyMessage' ? { message_id: ++b.nextId }
        : method === 'getWebhookInfo' ? { url: 'https://dummy/api/webhook', pending_update_count: 0, ...b.webhookInfo } : true;
      return { ok: true, result: call.result };
    }
    const [cmd, key, val, val2] = body;
    if (cmd === 'PING') return { result: 'PONG' };
    if (cmd === 'HSET') return b.store.set(key, new Map(b.store.get(key)).set(val, val2)), { result: 1 };
    if (cmd === 'HSETNX') {
      if (b.store.get(key)?.has(val)) return { result: 0 };
      return b.store.set(key, new Map(b.store.get(key)).set(val, val2)), { result: 1 };
    }
    if (cmd === 'HGET') return { result: b.store.get(key)?.get(val) ?? null };
    if (cmd === 'HDEL') return { result: +(b.store.get(key)?.delete(val) ?? 0) };
    if (cmd === 'HGETALL') return { result: [...(b.store.get(key) ?? [])].flat() };
    if (cmd === 'EXPIRE') return { result: +b.store.has(key) };
    if (cmd === 'GET') return { result: b.store.get(key) ?? null };
    if (cmd === 'SET') {
      if (body.includes('NX') && b.store.has(key)) return { result: null };
      return b.store.set(key, val), { result: 'OK' };
    }
    if (cmd === 'DEL') return { result: body.slice(1).filter((k) => b.store.delete(k)).length };
    return { error: `unknown command ${cmd}` };
  };
  b.toAdmin = (admin) => b.calls.filter((c) => c.chat_id === admin);
  b.toUser = () => b.calls.filter((c) => c.chat_id === USER.id && c.method === 'sendMessage').map((c) => c.text);
  /** Last edit of the soldier's summary message (the only user-chat edit that isn't a "✔ choice" tap). */
  b.userEdit = () => b.calls.findLast((c) => c.chat_id === USER.id && c.method === 'editMessageText' && !c.text.includes('✔'))?.text;
  return b;
}

let id = 0;
const chat = { id: USER.id, type: 'private' };
const message = (extra) => ({ update_id: ++id, message: { message_id: ++id, chat, from: USER, ...extra } });

export const text = (t) => message({ text: t });
export const photo = () => message({ photo: [{ file_id: 'dummy-photo' }] });
export const doc = (mime_type) => message({ document: { file_id: 'dummy-doc', mime_type } });
export const tap = (data) => ({
  update_id: ++id,
  callback_query: { id: `cb${id}`, from: USER, data, message: { message_id: 5, chat, text: 'question' } },
});
/** Button tap by `admin` on a submission in their own DM with the bot. */
export const adminTap = (admin, data) => ({
  update_id: ++id,
  callback_query: { id: `cb${id}`, from: { id: admin }, data, message: { message_id: 7, chat: { id: admin, type: 'private' }, text: 'summary' } },
});
/** Text message from `admin` in their own DM with the bot. */
export const adminText = (admin, t) => ({
  update_id: ++id,
  message: { message_id: ++id, chat: { id: admin, type: 'private' }, from: { id: admin }, text: t },
});
export const groupText =(t) => ({ update_id: ++id, message: { message_id: ++id, chat: { id: -1, type: 'group' }, from: USER, text: t } });

/** Yesterday in Singapore as DDMMYY, a valid symptom start date whenever the suite runs. */
export const YESTERDAY = new Date(Date.now() - 864e5).toLocaleDateString('en-GB', { timeZone: 'Asia/Singapore' }).replace(/\/\d\d(\d\d)$/, '$1').replace(/\//g, '');
/** Tomorrow as DDMMYY, a future symptom start date. */
export const TOMORROW = new Date(Date.now() + 864e5).toLocaleDateString('en-GB', { timeZone: 'Asia/Singapore' }).replace(/\/\d\d(\d\d)$/, '$1').replace(/\//g, '');
export const SICK_FLOW = [text('/start'), tap('rank:PTE'), text('Tan Ah Kow'), tap('type:sick'),
  text('Fever and sore throat'), text(YESTERDAY), tap('body:Left'), text('Kranji Medical Centre'), text('0830'), tap('ack:yes'), tap('review:yes')];
/** MC after an earlier request: its saved profile is reused. With an open grant, a link tap goes after the first 3. Add the file, then `SUBMIT`. */
export const MC_FLOW = [text('/start'), tap('profile:yes'), tap('type:mc'), text('6ad8500b1d0ae72f026cfa75'),
  text('Sprained ankle, light duty'), text('10/10/2026'), text('12/10/2026')];
/** Tomorrow in Singapore, a valid appointment date whenever the suite runs. */
export const APPT_DAY = new Date(Date.now() + 864e5).toLocaleDateString('en-GB', { timeZone: 'Asia/Singapore' });
export const SUBMIT = tap('review:yes');
export const APPT_FLOW = [text('/start'), tap('rank:PTE'), text('Tan Ah Kow'), tap('type:appt'),
  text('Eczema'), text(`${APPT_DAY} 1400`), text('SGH Dermatology'), photo(), tap('pledge:yes'), tap('review:yes')];
