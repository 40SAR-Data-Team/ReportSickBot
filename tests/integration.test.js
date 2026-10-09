// Calls the handler directly with fetch mocked to the dummy backend.
import { afterAll, beforeEach, expect, test } from 'bun:test';
import handler from '../api/webhook.js';
import { ENV, GROUP, MC_FLOW, SICK_FLOW, doc, fakeBackend, groupText, photo, tap, text } from './fake.js';

const realFetch = globalThis.fetch;
let b;
beforeEach(() => {
  Object.assign(process.env, ENV, { KV_REST_API_URL: 'https://kv.dummy' });
  delete process.env.TELEGRAM_API;
  b = fakeBackend();
  globalThis.fetch = async (url, init) => Response.json(b.respond(String(url), JSON.parse(init.body)));
});
afterAll(() => { globalThis.fetch = realFetch; });

async function send(update, secret = ENV.WEBHOOK_SECRET) {
  let status;
  const res = { status(c) { status = c; return this; }, end() {} };
  await handler({ headers: { 'x-telegram-bot-api-secret-token': secret }, body: update }, res);
  return status;
}
const sendAll = async (updates) => { for (const u of updates) await send(u); };

test('sick flow posts the request to the group', async () => {
  await sendAll(SICK_FLOW);
  const [post] = b.toGroup();
  expect(post.method).toBe('sendMessage');
  expect(post.text).toContain('REQUEST TO REPORT SICK');
  expect(post.text).toContain('PTE Tan Ah Kow');
  expect(post.text).toContain('Medical Condition: Fever and sore throat');
  expect(post.text).toContain('Clinic: Kranji Medical Centre');
  expect(post.text).toContain('Time: 10/10/2026 0830');
  expect(post.text).toContain("I will wait for my commander's permission");
  expect(post.text).toContain('@pte_tan');
  expect(b.toUser().at(-1)).toContain('Submitted');
  expect(b.store.size).toBe(0);
});

test('rank question offers all ranks and mentions PTEs', async () => {
  await send(text('/start'));
  const q = b.calls.find((c) => c.method === 'sendMessage');
  expect(q.text).toContain('most of you are PTEs');
  expect(q.reply_markup.inline_keyboard.flat().map((k) => k.text))
    .toEqual(['REC', 'PTE', 'LCP', 'CPL', 'CFC', '3SG', '2SG', '2LT', 'LTA']);
});

test.each([['PDF', () => doc('application/pdf')], ['photo', photo], ['image document', () => doc('image/jpeg')]])(
  'mc flow forwards a %s to the group',
  async (_, file) => {
    const f = file();
    await sendAll([...MC_FLOW, f]);
    const [post, copy] = b.toGroup();
    expect(post.text).toContain('MC / STATUS');
    expect(post.text).toContain('CPL Lim Bee Hoon');
    expect(post.text).toContain('Reason / Status: Sprained ankle, light duty');
    expect(post.text).toContain('From 10/10/2026 to 12/10/2026');
    expect(copy).toMatchObject({ method: 'copyMessage', from_chat_id: 111, message_id: f.message.message_id });
    expect(copy.reply_parameters.message_id).toBe(post.result.message_id);
  },
);

test('rejects wrong or missing secret', async () => {
  expect(await send(text('/start'), 'wrong')).toBe(401);
  expect(await send(text('/start'), '')).toBe(401);
  expect(b.calls).toHaveLength(0);
});

test('rejects all requests when WEBHOOK_SECRET is unset', async () => {
  delete process.env.WEBHOOK_SECRET;
  expect(await send(text('/start'), '')).toBe(401);
});

test('ignores group chats', async () => {
  expect(await send(groupText('/start'))).toBe(200);
  expect(b.calls).toHaveLength(0);
});

test('invalid date/time is re-asked without advancing', async () => {
  await sendAll(SICK_FLOW.slice(0, 6));
  await send(text('tomorrow morning'));
  expect(b.toUser().at(-1)).toContain('Invalid date/time');
  expect(JSON.parse(b.store.get('form:111')).step).toBe('time');
});

test('end date before start date is rejected', async () => {
  await sendAll(MC_FLOW.slice(0, 6));
  await send(text('09/10/2026'));
  expect(b.toUser().at(-1)).toContain('cannot be before');
  await send(text('31/02/2026'));
  expect(b.toUser().at(-1)).toContain('Invalid date');
  expect(JSON.parse(b.store.get('form:111')).step).toBe('end');
});

test('text at a button step re-asks; stale taps are ignored', async () => {
  await send(text('/start'));
  await send(text('PTE'));
  expect(b.toUser().at(-1)).toContain('tap one of the buttons');
  const before = b.calls.length;
  await send(tap('type:sick')); // wrong step
  expect(b.calls.slice(before).map((c) => c.method)).toEqual(['answerCallbackQuery']);
  await send(tap('rank:PTE'));
  await send(tap('rank:PTE')); // double tap on an old keyboard
  expect(JSON.parse(b.store.get('form:111'))).toEqual({ step: 'name', rank: 'PTE' });
});

test('overlong answer is rejected', async () => {
  await sendAll([text('/start'), tap('rank:PTE'), text('x'.repeat(501))]);
  expect(b.toUser().at(-1)).toContain('under 500 characters');
  expect(JSON.parse(b.store.get('form:111')).step).toBe('name');
});

test('non-text answer at a text step is re-asked', async () => {
  await sendAll([text('/start'), tap('rank:PTE'), photo()]);
  expect(b.toUser().at(-1)).toContain('Please type your answer');
});

test('file step rejects non-PDF documents and text', async () => {
  await sendAll(MC_FLOW);
  await send(doc('application/zip'));
  await send(text('here'));
  expect(b.toUser().slice(-2).every((t) => t.includes('photo or a PDF'))).toBe(true);
  expect(b.toGroup()).toHaveLength(0);
});

test('group send failure tells the user and allows retry', async () => {
  b.fail = 'sendMessage';
  await sendAll(SICK_FLOW);
  expect(b.toUser().at(-1)).toContain('Failed to send');
  expect(JSON.parse(b.store.get('form:111')).step).toBe('ack');
  b.fail = null;
  await send(tap('ack:yes'));
  expect(b.toUser().at(-1)).toContain('Submitted');
});

test('/cancel clears the form; next message restarts', async () => {
  await sendAll([text('/start'), tap('rank:PTE')]);
  await send(text('/cancel'));
  expect(b.store.size).toBe(0);
  expect(b.toUser().at(-1)).toContain('Cancelled');
  await send(text('hello'));
  expect(b.toUser().at(-1)).toContain('Select your rank');
});

test('backend errors still return 200', async () => {
  globalThis.fetch = async () => Response.json({ error: 'redis down' });
  expect(await send(text('/start'))).toBe(200);
});
