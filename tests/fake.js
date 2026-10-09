// Dummy Telegram + Upstash backend and update builders shared by integration and e2e tests.

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
      call.result = method === 'sendMessage' || method === 'copyMessage' ? { message_id: ++b.nextId } : true;
      return { ok: true, result: call.result };
    }
    const [cmd, key, val] = body;
    if (cmd === 'GET') return { result: b.store.get(key) ?? null };
    if (cmd === 'SET') return b.store.set(key, val), { result: 'OK' };
    if (cmd === 'DEL') return { result: +b.store.delete(key) };
    if (cmd === 'GETDEL') {
      const v = b.store.get(key) ?? null;
      return b.store.delete(key), { result: v };
    }
    return { error: `unknown command ${cmd}` };
  };
  b.toAdmin = (admin) => b.calls.filter((c) => c.chat_id === admin);
  b.toUser = () => b.calls.filter((c) => c.chat_id === USER.id && c.method === 'sendMessage').map((c) => c.text);
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
export const groupText = (t) => ({ update_id: ++id, message: { message_id: ++id, chat: { id: -1, type: 'group' }, from: USER, text: t } });

export const SICK_FLOW = [text('/start'), tap('rank:PTE'), text('Tan Ah Kow'), tap('type:sick'),
  text('Fever and sore throat'), text('Kranji Medical Centre'), text('10/10/2026 0830'), tap('ack:yes')];
export const MC_FLOW = [text('/start'), tap('rank:CPL'), text('Lim Bee Hoon'), tap('type:mc'),
  text('Sprained ankle, light duty'), text('10/10/2026'), text('12/10/2026')];
