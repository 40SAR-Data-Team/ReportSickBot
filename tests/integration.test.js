// Calls the handler directly with fetch mocked to the dummy backend.
import { afterAll, beforeEach, expect, test } from 'bun:test';
import handler from '../api/webhook.js';
import { ADMINS, APPT_FLOW, ENV, MC_FLOW, SICK_FLOW, USER, adminTap, doc, fakeBackend, groupText, photo, tap, text } from './fake.js';

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

test('sick flow sends the request to every admin', async () => {
  await sendAll(SICK_FLOW);
  const [post] = b.toAdmin(ADMINS[0]);
  expect(b.toAdmin(ADMINS[1])[0].text).toBe(post.text);
  expect(post.method).toBe('sendMessage');
  expect(post.text).toContain('REQUEST TO REPORT SICK');
  expect(post.text).toContain('PTE Tan Ah Kow');
  expect(post.text).toContain('Medical Condition: Fever and sore throat');
  expect(post.text).toContain('Clinic: Kranji Medical Centre');
  expect(post.text).toContain(`Time: ${new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Singapore' })} 0830`);
  expect(post.text).toContain("I will wait for my commander's approval");
  expect(post.text).toContain('@pte_tan');
  expect(b.toUser().at(-1)).toContain('Submitted');
  expect(b.store.has('form:111')).toBe(false);
});

test('submit deletes the whole form thread and leaves one summary', async () => {
  const flow = [...SICK_FLOW.slice(0, 6), text('tomorrow'), ...SICK_FLOW.slice(6)];
  await sendAll(flow);
  const dels = b.calls.filter((c) => c.method === 'deleteMessages');
  expect(dels).toHaveLength(1);
  expect(dels[0].chat_id).toBe(USER.id);
  const bot = b.calls.filter((c) => c.chat_id === USER.id && c.method === 'sendMessage').slice(0, -1);
  const expected = [...flow.filter((u) => u.message).map((u) => u.message.message_id), ...bot.map((c) => c.result.message_id)];
  expect(dels[0].message_ids.toSorted()).toEqual(expected.toSorted());
  expect(b.toUser().at(-1)).toContain('REQUEST TO REPORT SICK');
  expect(b.toUser().at(-1)).toEndWith('Submitted ✅ Send /start to submit another.');
});

const button = (admin) => b.toAdmin(admin)[0].reply_markup.inline_keyboard[0][0];
const edits = () => b.calls.filter((c) => c.method === 'editMessageText' && ADMINS.includes(c.chat_id));

test('approve marks every admin copy and tells the soldier', async () => {
  await sendAll(SICK_FLOW);
  const { text: label, callback_data } = button(ADMINS[0]);
  expect(label).toBe('✅ Approve');
  expect(button(ADMINS[1]).callback_data).toBe(callback_data);
  const before = b.calls.length;
  await send(adminTap(ADMINS[1], callback_data));
  const done = edits();
  expect(done.map((c) => [c.chat_id, c.message_id]))
    .toEqual(ADMINS.map((a) => [a, b.toAdmin(a)[0].result.message_id]));
  for (const e of done) {
    expect(e.text).toBe('✅ PTE Tan Ah Kow, sick request approved by Admin B');
    expect(e.reply_markup).toBeUndefined();
  }
  expect(b.toUser().at(-1)).toContain('REQUEST TO REPORT SICK');
  expect(b.toUser().at(-1)).toEndWith('✅ Admin B has approved');
  const after = b.calls.length;
  expect(after).toBeGreaterThan(before);
  await send(adminTap(ADMINS[0], callback_data)); // second tap
  expect(b.calls.slice(after).map((c) => c.method)).toEqual(['answerCallbackQuery']);
});

test('non-admin cannot approve', async () => {
  await sendAll(SICK_FLOW);
  await send(adminTap(USER.id, button(ADMINS[0]).callback_data));
  expect(edits()).toHaveLength(0);
});

test('added to BatSys marks every admin copy, keeps file copies, soldier not messaged', async () => {
  await sendAll([...MC_FLOW, photo()]);
  const { text: label, callback_data } = button(ADMINS[0]);
  expect(label).toBe('Added to BatSys?');
  const userMsgs = b.toUser().length;
  await send(adminTap(ADMINS[0], callback_data));
  expect(edits()).toHaveLength(2);
  expect(edits().every((e) => e.text === '✅ CPL Lim Bee Hoon, MC 10/10/2026 to 12/10/2026 added to BatSys by Admin A')).toBe(true);
  expect(b.calls.filter((c) => c.method === 'deleteMessage' && ADMINS.includes(c.chat_id))).toHaveLength(0); // file copies kept
  expect(b.toUser()).toHaveLength(userMsgs);
});

test('appointment flow sends summary + screenshot; approve shrinks copies and tells the soldier', async () => {
  await sendAll([...APPT_FLOW.slice(0, -2), doc('application/pdf')]);
  expect(b.toUser().at(-1)).toContain('Please send an image');
  await sendAll([photo(), tap('pledge:yes')]);
  for (const admin of ADMINS) {
    const [post, copy] = b.toAdmin(admin);
    expect(post.text).toContain('REQUEST TO ATTEND MEDICAL APPOINTMENT');
    expect(post.text).toContain('Reason: Eczema');
    expect(post.text).toContain('Time: 20/10/2026 1400');
    expect(post.text).toContain('Clinic: SGH Dermatology');
    expect(post.text).toContain("I will seek my commander's approval");
    expect(copy.method).toBe('copyMessage');
  }
  const { text: label, callback_data } = button(ADMINS[0]);
  expect(label).toBe('✅ Approve');
  await send(adminTap(ADMINS[0], callback_data));
  expect(edits().every((e) => e.text === '✅ PTE Tan Ah Kow, medical appointment 20/10/2026 1400 approved by Admin A')).toBe(true);
  expect(b.toUser().at(-1)).toEndWith('✅ Admin A has approved');
});

test('rank question offers all ranks with the new wording', async () => {
  await send(text('/start'));
  const q = b.calls.find((c) => c.method === 'sendMessage');
  expect(q.text).toBe('What is your Rank?');
  expect(q.reply_markup.inline_keyboard.flat().map((k) => k.text))
    .toEqual(['REC', 'PTE', 'LCP', 'CPL', 'CFC', '3SG', '2SG', '2LT', 'LTA']);
});

test.each([['PDF', () => doc('application/pdf')], ['photo', photo], ['image document', () => doc('image/jpeg')]])(
  'mc flow forwards a %s to every admin',
  async (_, file) => {
    const f = file();
    await sendAll([...MC_FLOW, f]);
    for (const admin of ADMINS) {
      const [post, copy] = b.toAdmin(admin);
      expect(post.text).toContain('MC / STATUS');
      expect(post.text).toContain('CPL Lim Bee Hoon');
      expect(post.text).toContain('Reason / Status: Sprained ankle, light duty');
      expect(post.text).toContain('From 10/10/2026 to 12/10/2026');
      expect(copy).toMatchObject({ method: 'copyMessage', from_chat_id: 111, message_id: f.message.message_id });
      expect(copy.reply_parameters.message_id).toBe(post.result.message_id);
    }
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

test('invalid time is re-asked without advancing', async () => {
  await sendAll(SICK_FLOW.slice(0, 6));
  await send(text('tomorrow morning'));
  expect(b.toUser().at(-1)).toContain('Invalid time');
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
  expect(JSON.parse(b.store.get('form:111'))).toMatchObject({ step: 'name', rank: 'PTE' });
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
  expect(ADMINS.flatMap(b.toAdmin)).toHaveLength(0);
});

test('one unreachable admin does not block the others', async () => {
  b.failFor.add(ADMINS[0]);
  await sendAll(SICK_FLOW);
  expect(b.toAdmin(ADMINS[1])[0].text).toContain('REQUEST TO REPORT SICK');
  expect(b.toUser().at(-1)).toContain('Submitted');
});

test('all admins unreachable tells the user and allows retry', async () => {
  ADMINS.forEach((a) => b.failFor.add(a));
  await sendAll(SICK_FLOW);
  expect(b.toUser().at(-1)).toContain('Failed to send');
  expect(JSON.parse(b.store.get('form:111')).step).toBe('ack');
  b.failFor.clear();
  await send(tap('ack:yes'));
  expect(b.toUser().at(-1)).toContain('Submitted');
});

test('/cancel clears the form; next message restarts', async () => {
  await sendAll([text('/start'), tap('rank:PTE')]);
  await send(text('/cancel'));
  expect(b.store.size).toBe(0);
  expect(b.toUser().at(-1)).toContain('Cancelled');
  await send(text('hello'));
  expect(b.toUser().at(-1)).toContain('What is your Rank?');
});

test('backend errors still return 200', async () => {
  globalThis.fetch = async () => Response.json({ error: 'redis down' });
  expect(await send(text('/start'))).toBe(200);
});
