// Dummy Telegram + Upstash backend and update builders shared by integration and e2e tests.

export const GROUP = '-100999';
export const USER = { id: 111, username: 'pte_tan' };

export const ENV = {
  BOT_TOKEN: 'dummy-token',
  GROUP_CHAT_ID: GROUP,
  WEBHOOK_SECRET: 'dummy-secret',
  KV_REST_API_TOKEN: 'dummy-kv-token',
};

/** In-memory fake: records Telegram calls, stores Redis keys. Set `fail` to a method name to make group calls fail. */
export function fakeBackend() {
  const b = { store: new Map(), calls: [], fail: null, nextId: 1000 };
  b.respond = (url, body) => {
    if (url.includes('/bot')) {
      const method = url.split('/').pop();
      const call = { method, ...body };
      b.calls.push(call);
      if (method === b.fail && body.chat_id === GROUP) return { ok: false, description: 'dummy failure' };
      call.result = method === 'sendMessage' ? { message_id: ++b.nextId } : true;
      return { ok: true, result: call.result };
    }
    const [cmd, key, val] = body;
    if (cmd === 'GET') return { result: b.store.get(key) ?? null };
    if (cmd === 'SET') return b.store.set(key, val), { result: 'OK' };
    if (cmd === 'DEL') return { result: +b.store.delete(key) };
    return { error: `unknown command ${cmd}` };
  };
  b.toGroup = () => b.calls.filter((c) => c.chat_id === GROUP);
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
export const groupText = (t) => ({ update_id: ++id, message: { message_id: ++id, chat: { id: -1, type: 'group' }, from: USER, text: t } });

export const SICK_FLOW = [text('/start'), tap('rank:PTE'), text('Tan Ah Kow'), tap('type:sick'),
  text('Fever and sore throat'), text('Kranji Medical Centre'), text('10/10/2026 0830'), tap('ack:yes')];
export const MC_FLOW = [text('/start'), tap('rank:CPL'), text('Lim Bee Hoon'), tap('type:mc'),
  text('Sprained ankle, light duty'), text('10/10/2026'), text('12/10/2026')];
