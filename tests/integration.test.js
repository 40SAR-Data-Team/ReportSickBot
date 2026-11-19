// Calls the handler directly with fetch mocked to the dummy backend.
import { afterAll, beforeEach, expect, test } from 'bun:test';
import handler, { today as day } from '../api/webhook.js';
import { ADMINS, APPT_DAY, TOMORROW, YESTERDAY, APPT_FLOW, ENV, MC_FLOW, SICK_FLOW, USER, adminTap, SUBMIT, adminText, doc, fakeBackend, groupText, photo, tap, text } from './fake.js';

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

/** Submission summaries sent to `admin` (not files, prompts or overviews). */
const posts = (admin) => b.toAdmin(admin).filter((c) => c.method === 'sendMessage' && /^\[For Admin\] (🤒|🏥|📄)/.test(c.text));
/** Buttons on `admin`'s n-th summary (default: latest). */
const keys = (admin, n = -1) => posts(admin).at(n).reply_markup.inline_keyboard[0];
const button = (admin) => keys(admin, 0)[0];
const edits = (from = 0) => b.calls.slice(from).filter((c) => c.method === 'editMessageText' && ADMINS.includes(c.chat_id));
const approveSick = async (admin = ADMINS[0]) => { await sendAll(SICK_FLOW); await send(adminTap(admin, keys(admin)[0].callback_data)); };
/** MC_FLOW (first `n` steps) linked to the first open request offered. */
const linkedMc = async (n = MC_FLOW.length) => {
  await sendAll(MC_FLOW.slice(0, 4));
  await send(tap(lastToUser().reply_markup.inline_keyboard[0][0].callback_data));
  await sendAll(MC_FLOW.slice(4, n));
};
const lastToUser = () => b.calls.findLast((c) => c.chat_id === USER.id && c.method === 'sendMessage' && !c.text.startsWith('Reminder:')); // the reminder follows the approval's button message
const summaryId = (needle) => b.calls.findLast((c) => c.chat_id === USER.id && c.text?.includes(needle) && c.text.endsWith('Submitted ✅')).result.message_id;

test('sick flow sends the request to every admin', async () => {
  await sendAll(SICK_FLOW);
  const [post] = b.toAdmin(ADMINS[0]);
  expect(b.toAdmin(ADMINS[1])[0].text).toBe(post.text);
  expect(post.method).toBe('sendMessage');
  expect(post.text).toStartWith('[For Admin] 🤒 REQUEST TO REPORT SICK');
  expect(post.text).toContain('PTE Tan Ah Kow');
  expect(post.text).toContain('Medical Condition: Fever and sore throat');
  expect(post.text).toContain('Clinic: Kranji Medical Centre');
  expect(post.text).toContain(`Time: ${day()} 0830`);
  expect(post.text).toContain("I will wait for my commander's approval");
  expect(post.text).toContain('@pte_tan');
  expect(post.reply_markup.inline_keyboard[0].map((k) => k.text)).toEqual(['✅ Approve', '❌ Reject']);
  expect(b.toUser().at(-1)).toContain('Submitted');
  expect(b.store.has('form:111')).toBe(false);
});

test('submit deletes the whole form thread and leaves one summary', async () => {
  const flow = [...SICK_FLOW.slice(0, 8), text('tomorrow'), ...SICK_FLOW.slice(8)];
  await sendAll(flow);
  const dels = b.calls.filter((c) => c.method === 'deleteMessages');
  expect(dels).toHaveLength(1);
  expect(dels[0].chat_id).toBe(USER.id);
  const bot = b.calls.filter((c) => c.chat_id === USER.id && c.method === 'sendMessage').slice(0, -1);
  const expected = [...flow.filter((u) => u.message).map((u) => u.message.message_id), ...bot.map((c) => c.result.message_id)];
  expect(dels[0].message_ids.toSorted()).toEqual(expected.toSorted());
  expect(b.toUser().at(-1)).toContain('REQUEST TO REPORT SICK');
  expect(b.toUser().at(-1)).toEndWith('Submitted ✅');
});

test('approve marks every admin copy, tells the soldier, offers the MC button', async () => {
  await sendAll(SICK_FLOW);
  const { callback_data } = button(ADMINS[0]);
  expect(button(ADMINS[1]).callback_data).toBe(callback_data);
  await send(adminTap(ADMINS[1], callback_data));
  const done = edits();
  expect(done.map((c) => [c.chat_id, c.message_id]))
    .toEqual(ADMINS.map((a) => [a, b.toAdmin(a)[0].result.message_id]));
  for (const e of done) {
    expect(e.text).toStartWith('[For Admin] 🤒 REQUEST TO REPORT SICK');
    expect(e.text).toContain('Medical Condition: Fever and sore throat');
    expect(e.text).toEndWith('\n\n✅ Approved by Admin B');
    expect(e.reply_markup.inline_keyboard[0]).toEqual([{ text: 'Added to BatSys?', callback_data: callback_data.replace('approve', 'batsys') }]);
  }
  expect(b.userEdit()).toEndWith('\n\n✅ Approved by Admin B');
  const summary = summaryId('REPORT SICK');
  expect(b.calls.findLast((c) => c.chat_id === USER.id && c.method === 'editMessageText').message_id).toBe(summary);
  const note = lastToUser();
  expect(note.text).toStartWith('✅ Approved by Admin B');
  expect(note.reply_to_message_id).toBe(summary);
  expect(note.reply_markup.inline_keyboard[0][0]).toMatchObject({ text: '📄 Send MC / Status', callback_data: callback_data.replace('approve', 'mcfor') });
  const after = b.calls.length;
  await send(adminTap(ADMINS[0], callback_data)); // second tap
  await send(adminTap(ADMINS[0], keys(ADMINS[0])[1].callback_data)); // late reject
  expect(b.calls.slice(after).map((c) => c.method)).toEqual(['answerCallbackQuery', 'answerCallbackQuery']);
});

test.each([['sick', SICK_FLOW], ['appt', APPT_FLOW]])('after approving a %s request, Added to BatSys? is admin-only and ends the buttons', async (_, flow) => {
  await sendAll(flow);
  const { callback_data } = button(ADMINS[0]);
  await send(adminTap(ADMINS[1], callback_data));
  const before = b.calls.length;
  await send(adminTap(ADMINS[0], callback_data.replace('approve', 'batsys')));
  for (const e of edits(before)) {
    expect(e.text).toEndWith('\n\n✅ Approved by Admin B\n✅ Added to BatSys by Admin A');
    expect(e.reply_markup).toBeUndefined();
  }
  expect(b.userEdit()).not.toContain('BatSys');
  expect(b.calls.slice(before).filter((c) => c.chat_id === USER.id && c.method === 'sendMessage')).toHaveLength(0);
});

test('non-admin cannot approve or reject', async () => {
  await sendAll(SICK_FLOW);
  await send(adminTap(USER.id, keys(ADMINS[0])[0].callback_data));
  await send(adminTap(USER.id, keys(ADMINS[0])[1].callback_data));
  expect(edits()).toHaveLength(0);
  expect(b.store.has('rej:111')).toBe(false);
});

test('reject with a reason updates every copy and tells the soldier', async () => {
  await sendAll(SICK_FLOW);
  await send(adminTap(ADMINS[0], keys(ADMINS[0])[1].callback_data));
  const prompt = b.toAdmin(ADMINS[0]).at(-1);
  expect(prompt.text).toBe('[For Admin] Reason for rejecting PTE Tan Ah Kow, sick request? Type it, or tap Skip.');
  expect(prompt.reply_parameters.message_id).toBe(7); // the tapped copy (adminTap's message)
  await send(adminText(ADMINS[0], 'Please see the MO in camp'));
  expect(edits().filter((e) => e.message_id !== prompt.result.message_id)
    .every((e) => e.text.endsWith('\n\n❌ Rejected by Admin A\nReason: Please see the MO in camp') && !e.reply_markup)).toBe(true);
  expect(edits().at(-1)).toMatchObject({ message_id: prompt.result.message_id, text: '[For Admin] ✔ Rejection sent' });
  expect(b.userEdit()).toEndWith('\n\n❌ Rejected by Admin A\nReason: Please see the MO in camp');
  expect(lastToUser().text).toBe('❌ Admin A has rejected your request.\nReason: Please see the MO in camp\n\nSend /start to submit a new request.');
  expect(b.store.has('grant:111')).toBe(false); // nothing to chain an MC to
  await send(adminText(ADMINS[0], 'hello')); // no longer pending: not taken as a reason
  expect(b.toAdmin(ADMINS[0]).at(-1).text).toBe('What is your Rank?');
});

test('reject Skip sends no reason; Cancel leaves the request open', async () => {
  await sendAll(SICK_FLOW);
  const [approve, reject] = keys(ADMINS[1]);
  await send(adminTap(ADMINS[1], reject.callback_data));
  const before = b.calls.length;
  await send(adminTap(ADMINS[1], `rejcancel:${reject.callback_data.slice(7)}`));
  expect(edits(before).map((e) => e.text)).toEqual(['[For Admin] Rejection cancelled.']);
  expect(b.store.has(`rej:${ADMINS[1]}`)).toBe(false);
  await send(adminTap(ADMINS[1], reject.callback_data));
  await send(adminTap(ADMINS[1], `rejskip:${reject.callback_data.slice(7)}`));
  expect(b.userEdit()).toEndWith('\n\n❌ Rejected by Admin B');
  expect(lastToUser().text).toBe('❌ Admin B has rejected your request.\n\nSend /start to submit a new request.');
  const after = b.calls.length;
  await send(adminTap(ADMINS[0], approve.callback_data));
  expect(b.calls.slice(after).map((c) => c.method)).toEqual(['answerCallbackQuery']);
});

test('reject loses to an approval made while the reason was being typed', async () => {
  await sendAll(SICK_FLOW);
  const [approve, reject] = keys(ADMINS[0]);
  await send(adminTap(ADMINS[0], reject.callback_data));
  await send(adminTap(ADMINS[1], approve.callback_data));
  const before = b.calls.length;
  await send(adminText(ADMINS[0], 'too late'));
  expect(b.calls.slice(before).map((c) => [c.method, c.text])).toEqual([['editMessageText', '[For Admin] Already approved by Admin B']]);
  expect(b.userEdit()).toEndWith('✅ Approved by Admin B');
});

test('MC threads under the approved request, then acknowledge, then BatSys tick', async () => {
  await approveSick();
  await linkedMc();
  await sendAll([photo(), SUBMIT]);
  for (const admin of ADMINS) {
    const [sick, mc] = posts(admin);
    expect(mc.text).toContain('📄 MC / STATUS\nPTE Tan Ah Kow\nFor: 🤒 ');
    expect(mc.text).toContain('sick request');
    expect(mc.reply_parameters).toEqual({ message_id: sick.result.message_id, allow_sending_without_reply: true });
    expect(mc.reply_markup.inline_keyboard[0].map((k) => k.text)).toEqual(['👍 Acknowledge']);
  }
  const mcSummary = lastToUser();
  expect(mcSummary.reply_parameters.message_id).toBe(summaryId('REPORT SICK'));
  expect(b.store.get('grant:111').size).toBe(0); // consumed
  const [seen] = keys(ADMINS[0]);
  const batsys = { callback_data: seen.callback_data.replace('seen:', 'batsys:') };

  let before = b.calls.length;
  await send(adminTap(ADMINS[1], seen.callback_data));
  expect(edits(before)).toHaveLength(2);
  for (const e of edits(before)) {
    expect(e.text).toEndWith('\n\n👍 Acknowledged by Admin B');
    expect(e.reply_markup.inline_keyboard[0].map((k) => k.text)).toEqual(['Added to BatSys?']);
  }
  expect(lastToUser()).toMatchObject({ text: '👍 Acknowledged by Admin B', reply_to_message_id: mcSummary.result.message_id });

  before = b.calls.length;
  await send(adminTap(ADMINS[0], batsys.callback_data));
  for (const e of edits(before)) {
    expect(e.text).toEndWith('\n\n👍 Acknowledged by Admin B\n✅ Added to BatSys by Admin A');
    expect(e.reply_markup).toBeUndefined();
  }
  expect(b.userEdit()).toContain('Reason / Status: Sprained ankle');
  expect(b.userEdit()).toEndWith('\n\n👍 Acknowledged by Admin B');
  expect(b.calls.slice(before).filter((c) => c.chat_id === USER.id)).toHaveLength(0); // BatSys is admin-only
  expect(b.calls.filter((c) => c.method === 'deleteMessage' && ADMINS.includes(c.chat_id))).toHaveLength(0); // file copies kept

  before = b.calls.length;
  await send(adminTap(ADMINS[0], seen.callback_data)); // already acknowledged
  expect(b.calls.slice(before).map((c) => c.method)).toEqual(['answerCallbackQuery']);
});

test('MC without any prior request goes straight to the questions, unlinked', async () => {
  await sendAll([text('/start'), tap('rank:CPL'), text('Lim Bee Hoon'), tap('type:mc')]);
  expect(b.toUser().at(-1)).toContain(`Complete the (<a href="https://go.gov.sg/medicalforms-40sar">40 SAR Report Sick Form</a>), and send the FormSG's Response ID e.g. 6ad8500b1d0ae72f026cfa75`);
  expect(lastToUser().parse_mode).toBe('HTML');
  await sendAll([...MC_FLOW.slice(3), photo(), SUBMIT]);
  const [mc] = posts(ADMINS[0]);
  expect(mc.text).toContain('📄 MC / STATUS\nCPL Lim Bee Hoon\nFormSG Response ID: 6ad8500b1d0ae72f026cfa75\nReason / Status: Sprained ankle');
  expect(mc.text).not.toContain('For:');
  expect(mc.reply_parameters).toBeUndefined();
  expect(b.store.has('grant:111')).toBe(false);
});

test('the MC is consumed: a second MC no longer offers that request', async () => {
  await approveSick();
  await linkedMc();
  await sendAll([photo(), SUBMIT]);
  await sendAll(MC_FLOW.slice(0, 4));
  expect(b.toUser().at(-1)).toBe('What new status are you given / What is your reason for MC?');
});

test('a second bad Response ID skips the question; the summary has no ID line', async () => {
  await sendAll([text('/start'), tap('rank:CPL'), text('Lim Bee Hoon'), tap('type:mc'), text('nope')]);
  expect(b.toUser().at(-1)).toContain('Invalid Response ID');
  await send(text('still nope'));
  expect(b.toUser().at(-1)).toBe('What new status are you given / What is your reason for MC?');
  await sendAll([...MC_FLOW.slice(4), photo(), SUBMIT]);
  expect(posts(ADMINS[0]).at(-1).text).not.toContain('FormSG');
});

test('approving a sick request reminds about the 40 SAR form; an appointment does not', async () => {
  await approveSick();
  const reminder = `Reminder: After visiting the doctor, complete the (<a href="https://go.gov.sg/medicalforms-40sar">40 SAR Report Sick Form</a>), and keep the FormSG's Response ID e.g. 6ad8500b1d0ae72f026cfa75`;
  expect(b.calls.some((c) => c.chat_id === USER.id && c.text === reminder && c.parse_mode === 'HTML')).toBe(true);
  const count = () => b.calls.filter((c) => c.text?.startsWith('Reminder:')).length;
  await sendAll([text('/start'), tap('profile:yes'), ...APPT_FLOW.slice(3)]);
  await send(adminTap(ADMINS[0], keys(ADMINS[0])[0].callback_data));
  expect(count()).toBe(1);
});

test('an open request can be skipped: "Not for any request above" sends an unlinked MC', async () => {
  await approveSick();
  await sendAll(MC_FLOW.slice(0, 4));
  const opts = lastToUser().reply_markup.inline_keyboard.map(([k]) => k);
  expect(opts.map((k) => k.text)).toEqual([expect.stringMatching(/^🤒 .* sick request$/), '📄 Not for any request above']);
  await sendAll([tap('link:none'), ...MC_FLOW.slice(4), photo(), SUBMIT]);
  const mc = posts(ADMINS[0]).at(-1);
  expect(mc.text).toContain('📄 MC / STATUS\nPTE Tan Ah Kow\nFormSG Response ID: 6ad8500b1d0ae72f026cfa75\nReason / Status:');
  expect(mc.reply_parameters).toBeUndefined();
  expect(b.store.get('grant:111').size).toBe(1); // still open
});

test('two open requests: soldier picks which one the MC is for', async () => {
  await approveSick();
  await sendAll([text('/start'), tap('profile:yes'), ...APPT_FLOW.slice(3)]);
  await send(adminTap(ADMINS[1], keys(ADMINS[1])[0].callback_data));
  await sendAll(MC_FLOW.slice(0, 4));
  const q = lastToUser();
  expect(q.text).toBe('Which request is this MC / Status for?');
  const opts = q.reply_markup.inline_keyboard.map(([k]) => k);
  expect(opts.map((k) => k.text)).toEqual([expect.stringMatching(/^🤒 .* sick request$/), expect.stringContaining(`medical appointment ${APPT_DAY} 1400`), '📄 Not for any request above']);
  await sendAll([tap(opts[1].callback_data), ...MC_FLOW.slice(4), photo(), SUBMIT]);
  const [, appt, mc] = posts(ADMINS[1]);
  expect(mc.text).toContain(`For: ${opts[1].text}`);
  expect(mc.reply_parameters.message_id).toBe(appt.result.message_id);
  expect([...b.store.get('grant:111').keys()]).toEqual([opts[0].callback_data.slice(5)]);
});

test('"Send MC / Status" under the approval starts a linked MC with only 5 questions', async () => {
  await approveSick();
  const mcfor = lastToUser().reply_markup.inline_keyboard[0][0].callback_data;
  await send(tap(mcfor));
  expect(b.toUser().at(-1)).toMatch(/^For: 🤒 .* sick request\n\nComplete the/);
  await send(text('6ad8500b1d0ae72f026cfa75'));
  expect(b.toUser().at(-1)).toBe('What new status are you given / What is your reason for MC?');
  await sendAll([text('Light duty'), tap('today')]);
  expect(JSON.parse(b.store.get('form:111')).start).toBe(day());
  await sendAll([text(APPT_DAY), photo(), SUBMIT]);
  expect(posts(ADMINS[0]).at(-1).text).toContain(`PTE Tan Ah Kow\nFor: 🤒`);
  expect(posts(ADMINS[0]).at(-1).text).toContain(`From ${day()} to ${APPT_DAY}`);
  await send(tap(mcfor)); // already used
  expect(b.toUser().at(-1)).toBe('This request already has an MC / Status, or it has expired.');
});

test('appointment grant stays open until a week after the appointment', async () => {
  const [d, m, y] = new Date(Date.now() + 100 * 864e5).toLocaleDateString('en-GB', { timeZone: 'Asia/Singapore' }).split('/').map(Number);
  await sendAll([...APPT_FLOW.slice(0, 5), text(`${d}/${m}/${y} 1400`), ...APPT_FLOW.slice(6)]);
  await send(adminTap(ADMINS[0], keys(ADMINS[0])[0].callback_data));
  const [g] = b.store.get('grant:111').values();
  expect(JSON.parse(g).until).toBe(Date.UTC(y, m - 1, d + 7, 14, 0) - 8 * 3600e3); // SGT wall clock to epoch
});

test('second request offers the saved profile; Change re-asks rank and name', async () => {
  await sendAll(SICK_FLOW);
  await send(text('/start'));
  expect(b.toUser().at(-1)).toBe('Continue as PTE Tan Ah Kow?');
  await send(tap('profile:yes'));
  expect(b.toUser().at(-1)).toBe('How may I help you?');
  await sendAll([text('/start'), tap('profile:no')]);
  expect(b.toUser().at(-1)).toBe('What is your Rank?');
  await sendAll([tap('rank:CPL'), text('Lim Bee Hoon')]);
  expect(JSON.parse(b.store.get('form:111'))).toMatchObject({ rank: 'CPL', name: 'Lim Bee Hoon', step: 'type' });
});

test('appointment flow sends summary + screenshot; approve updates copies and tells the soldier', async () => {
  await sendAll([...APPT_FLOW.slice(0, -3), doc('application/pdf')]);
  expect(b.toUser().at(-1)).toContain('Please send an image');
  await sendAll([photo(), tap('pledge:yes'), SUBMIT]);
  for (const admin of ADMINS) {
    const [post, copy] = b.toAdmin(admin);
    expect(post.text).toContain('REQUEST TO ATTEND MEDICAL APPOINTMENT');
    expect(post.text).toContain('Reason: Eczema');
    expect(post.text).toContain(`Time: ${APPT_DAY} 1400`);
    expect(post.text).toContain('Clinic: SGH Dermatology');
    expect(post.text).toContain("I will seek my commander's approval");
    expect(copy.method).toBe('copyMessage');
  }
  await send(adminTap(ADMINS[0], button(ADMINS[0]).callback_data));
  expect(edits().every((e) => e.text.includes('Reason: Eczema') && e.text.endsWith('\n\n✅ Approved by Admin A'))).toBe(true);
  expect(b.userEdit()).toEndWith('\n\n✅ Approved by Admin A');
});

test('/overview shows counts, who is waiting, and each status, for admins only', async () => {
  await approveSick(ADMINS[1]); // approved, then MC sent
  await linkedMc();
  await sendAll([photo(), SUBMIT]);
  await sendAll([text('/start'), tap('profile:yes'), ...SICK_FLOW.slice(3)]); // rejected
  await send(adminTap(ADMINS[0], keys(ADMINS[0])[1].callback_data));
  await send(adminText(ADMINS[0], 'secret medical reason'));
  await sendAll([text('/start'), tap('profile:yes'), ...SICK_FLOW.slice(3)]); // approved, no MC yet
  await send(adminTap(ADMINS[0], keys(ADMINS[0])[0].callback_data));
  await sendAll([text('/start'), tap('profile:yes'), ...APPT_FLOW.slice(3)]); // waiting
  await send(adminText(ADMINS[0], '/overview'));
  const out = b.toAdmin(ADMINS[0]).at(-1).text.replace(/\d\d:\d\d /g, '');
  expect(out).toBe([
    `[For Admin] Overview for ${day()}`,
    '',
    '🤒 Report sick: 3 (2 ✅, 1 ❌)',
    '🏥 Medical appointment: 1 (1 ⏳)',
    '📄 MC / Status: 1 (1 ⏳)',
    '',
    '⏳ Waiting',
    'PTE Tan Ah Kow, MC 10/10/2026 to 12/10/2026',
    `PTE Tan Ah Kow, medical appointment ${APPT_DAY} 1400`,
    '',
    '📄 Awaiting MC',
    'PTE Tan Ah Kow, sick request',
    '',
    '🤒 Report sick',
    'PTE Tan Ah Kow, sick request – ✅ approved by Admin B',
    'PTE Tan Ah Kow, sick request – ❌ rejected by Admin A',
    'PTE Tan Ah Kow, sick request – ✅ approved by Admin A',
    '',
    '🏥 Medical appointment',
    `PTE Tan Ah Kow, medical appointment ${APPT_DAY} 1400 – ⏳ waiting`,
    '',
    '📄 MC / Status',
    'PTE Tan Ah Kow, MC 10/10/2026 to 12/10/2026 – ⏳ not yet acknowledged',
  ].join('\n'));
  expect(out).not.toContain('Fever'); // no medical details
  expect(out).not.toContain('secret');
  await send(text('/overview')); // non-admin: starts a form instead
  expect(b.toUser().at(-1)).toBe('Continue as PTE Tan Ah Kow?');
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
    await approveSick();
    const f = file();
    await linkedMc();
    await sendAll([f, SUBMIT]);
    for (const admin of ADMINS) {
      const [post, copy] = b.toAdmin(admin).slice(-2);
      expect(post.text).toContain('MC / STATUS');
      expect(post.text).toContain('Reason / Status: Sprained ankle, light duty');
      expect(post.text).toContain('From 10/10/2026 to 12/10/2026');
      expect(copy).toMatchObject({ method: 'copyMessage', from_chat_id: 111, message_id: f.message.message_id, caption: '[For Admin]' });
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
  await sendAll(SICK_FLOW.slice(0, 8));
  await send(text('tomorrow morning'));
  expect(b.toUser().at(-1)).toContain('Invalid time');
  expect(JSON.parse(b.store.get('form:111')).step).toBe('time');
});

test('end date before start date is rejected', async () => {
  await approveSick();
  await linkedMc(6);
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
  await send(tap('today')); // not the start-date step
  expect(b.calls.slice(before).map((c) => c.method)).toEqual(['answerCallbackQuery', 'answerCallbackQuery']);
  await send(tap('rank:PTE'));
  await send(tap('rank:PTE')); // double tap on an old keyboard
  expect(JSON.parse(b.store.get('form:111'))).toMatchObject({ step: 'name', rank: 'PTE' });
});

test('overlong answer is rejected', async () => {
  await sendAll([text('/start'), tap('rank:PTE'), text('x'.repeat(501))]);
  expect(b.toUser().at(-1)).toContain('under 500 characters');
  expect(JSON.parse(b.store.get('form:111')).step).toBe('name');
});

test('a command as an answer is re-asked', async () => {
  await sendAll([text('/start'), tap('rank:PTE'), text('/help')]);
  expect(b.toUser().at(-1)).toContain('Commands are not valid answers');
  expect(JSON.parse(b.store.get('form:111')).step).toBe('name');
});

// Each typed step, reached through a real flow: [step, setup, bad answer, error]
const reach = {
  name: () => sendAll(SICK_FLOW.slice(0, 2)),
  condition: () => sendAll(SICK_FLOW.slice(0, 4)),
  onset: () => sendAll(SICK_FLOW.slice(0, 5)),
  clinic: () => sendAll(SICK_FLOW.slice(0, 7)),
  time: () => sendAll(SICK_FLOW.slice(0, 8)),
  purpose: () => sendAll(APPT_FLOW.slice(0, 4)),
  when: () => sendAll(APPT_FLOW.slice(0, 5)),
  venue: () => sendAll(APPT_FLOW.slice(0, 6)),
  formsg: async () => { await approveSick(); await sendAll(MC_FLOW.slice(0, 3)); },
  reason: async () => { await approveSick(); await linkedMc(4); },
  start: async () => { await approveSick(); await linkedMc(5); },
  end: async () => { await approveSick(); await linkedMc(6); },
};
test.each([
  ['name', 'Tan123', 'letters only'],
  ['name', '/overview', 'Commands are not valid answers'],
  ['condition', '...', 'in words'],
  ['onset', '151126x', 'Use DDMMYY'],
  ['onset', '311126', 'Invalid date'],
  ['onset', '010199', 'too far'],
  ['onset', TOMORROW, 'cannot be in the future'],
  ['clinic', '123', 'in words'],
  ['time', '2500', 'Invalid time'],
  ['purpose', '/cancelled', 'Commands are not valid answers'],
  ['when', APPT_DAY, 'Invalid date/time'],
  ['venue', '42', 'in words'],
  ['formsg', 'abc', 'Invalid Response ID'],
  ['reason', '!!!', 'in words'],
  ['start', '2026-10-10', 'Invalid date'],
  ['end', '09/10/2026', 'cannot be before'],
])('bad %s answer %p is re-asked without advancing', async (step, answer, err) => {
  await reach[step]();
  const question = b.toUser().at(-1).split('\n\n').at(-1);
  await send(text(answer));
  expect(b.toUser().at(-1)).toContain(err);
  expect(b.toUser().at(-1)).toEndWith(`\n\n${question}`);
  expect(JSON.parse(b.store.get('form:111'))).toMatchObject({ step });
  expect(JSON.parse(b.store.get('form:111'))[step]).toBeUndefined();
});

test.each(Object.keys(reach))('/start at the %s step restarts the form', async (step) => {
  await reach[step]();
  await send(text('/start'));
  const fresh = JSON.parse(b.store.get('form:111'));
  expect(fresh.step).toBe(step === 'formsg' || step === 'reason' || step === 'start' || step === 'end' ? 'profile' : 'rank');
  expect(fresh[step]).toBeUndefined();
});

test('non-text answer at a text step is re-asked', async () => {
  await sendAll([text('/start'), tap('rank:PTE'), photo()]);
  expect(b.toUser().at(-1)).toContain('Please type your answer');
});

test('file step rejects non-PDF documents and text', async () => {
  await approveSick();
  await linkedMc();
  await send(doc('application/zip'));
  await send(text('here'));
  expect(b.toUser().slice(-2).every((t) => t.includes('photo or a PDF'))).toBe(true);
  expect(posts(ADMINS[0])).toHaveLength(1); // only the sick request
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
  expect(JSON.parse(b.store.get('form:111')).step).toBe('review');
  b.failFor.clear();
  await send(SUBMIT);
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

test.each([['sick', SICK_FLOW, `Symptoms since: ${YESTERDAY}\nLaterality: Left`], ['appt', APPT_FLOW, 'Clinic: SGH Dermatology']])(
  '%s flow: review shows the answers before anything reaches admins',
  async (_, flow, line) => {
    await sendAll(flow.slice(0, -1));
    const q = lastToUser();
    expect(q.text).toStartWith('Please check your details:\n\n');
    expect(q.text).toContain('PTE Tan Ah Kow');
    expect(q.text).toContain(line);
    expect(q.reply_markup.inline_keyboard[0].map((k) => k.text)).toEqual(['✅ Submit', '🔄 Start over']);
    expect(posts(ADMINS[0])).toHaveLength(0);
  },
);

test('review Start over discards the answers; a stale Submit tap is ignored', async () => {
  await sendAll(SICK_FLOW.slice(0, -1));
  await send(tap('review:no'));
  expect(b.toUser().at(-1)).toBe('What is your Rank?');
  expect(JSON.parse(b.store.get('form:111'))).toEqual({ step: 'rank', ids: expect.any(Array) });
  await send(SUBMIT); // old review keyboard
  expect(posts(ADMINS[0])).toHaveLength(0);
  await sendAll(SICK_FLOW.slice(1));
  expect(posts(ADMINS[0])).toHaveLength(1);
  // the first attempt's messages are cleaned up too
  expect(b.calls.find((c) => c.method === 'deleteMessages').message_ids).toContain(SICK_FLOW[0].message.message_id);
});

test('double tap on Submit sends once and starts nothing', async () => {
  await sendAll([...SICK_FLOW, SUBMIT]);
  expect(posts(ADMINS[0])).toHaveLength(1);
  expect(b.toUser().at(-1)).toEndWith('Submitted ✅');
  expect(b.store.has('form:111')).toBe(false);
});

test('edited messages are ignored', async () => {
  await sendAll(SICK_FLOW.slice(0, 3));
  const before = b.calls.length;
  await send({ update_id: 0, edited_message: { ...SICK_FLOW[2].message, text: 'Tan Ah Beng' } });
  expect(b.calls.length).toBe(before);
  expect(JSON.parse(b.store.get('form:111')).name).toBe('Tan Ah Kow');
});

test('answers are trimmed; blank answers are re-asked', async () => {
  await sendAll([text('/start'), tap('rank:PTE'), text('   ')]);
  expect(b.toUser().at(-1)).toBe('Please type your answer.\n\nWhat is your Name?');
  await send(text('  Tan Ah Kow  '));
  expect(JSON.parse(b.store.get('form:111'))).toMatchObject({ step: 'type', name: 'Tan Ah Kow' });
});

// [step, setup, wrong kind of input, reply prefix]
test.each([
  ['rank', () => send(text('/start')), photo, 'Please tap one of the buttons.'],
  ['type', () => sendAll(SICK_FLOW.slice(0, 3)), () => text('sick'), 'Please tap one of the buttons.'],
  ['body', () => sendAll(SICK_FLOW.slice(0, 6)), () => text('left'), 'Please tap one of the buttons.'],
  ['ack', () => sendAll(SICK_FLOW.slice(0, 9)), () => text('ok'), 'Please tap one of the buttons.'],
  ['shot', () => sendAll(APPT_FLOW.slice(0, 7)), () => text('attached'), 'Please send an image.'],
  ['shot', () => sendAll(APPT_FLOW.slice(0, 7)), () => doc('application/pdf'), 'Please send an image.'],
  ['review', () => sendAll(SICK_FLOW.slice(0, -1)), () => text('yes'), 'Please tap one of the buttons.'],
])('wrong input at the %s step is re-asked', async (step, setup, input, err) => {
  await setup();
  await send(input());
  expect(b.toUser().at(-1)).toStartWith(`${err}\n\n`);
  expect(JSON.parse(b.store.get('form:111')).step).toBe(step);
});

test.each(['today', 'rank:PTE', 'review:yes', 'link:bogus', 'profile:yes', 'unknown'])(
  'stray tap %p at the name step is ignored',
  async (data) => {
    await sendAll(SICK_FLOW.slice(0, 2));
    const before = b.calls.length;
    await send(tap(data));
    expect(b.calls.slice(before).map((c) => c.method)).toEqual(['answerCallbackQuery']);
    expect(JSON.parse(b.store.get('form:111')).step).toBe('name');
  },
);

test('soldier without a username is identified by user id', async () => {
  const cq = SUBMIT.callback_query;
  await sendAll([...SICK_FLOW.slice(0, -1), { update_id: 0, callback_query: { ...cq, from: { id: USER.id } } }]);
  expect(posts(ADMINS[0])[0].text).toEndWith('Sent by: user id 111');
});

test('a caption on the MC file is forwarded to admins', async () => {
  await approveSick();
  const f = photo();
  f.message.caption = 'Page 1 of 1';
  await linkedMc();
  await sendAll([f, SUBMIT]);
  expect(b.toAdmin(ADMINS[0]).findLast((c) => c.method === 'copyMessage').caption).toBe('[For Admin] Page 1 of 1');
});

test('"Send MC / Status" mid-form replaces that form; an unknown id is refused', async () => {
  await approveSick();
  const mcfor = lastToUser().reply_markup.inline_keyboard[0][0].callback_data;
  await sendAll([text('/start'), tap('profile:yes'), tap('type:sick')]);
  await send(tap(mcfor));
  expect(JSON.parse(b.store.get('form:111'))).toMatchObject({ step: 'formsg', type: 'mc' });
  await send(tap('mcfor:bogus'));
  expect(b.toUser().at(-1)).toBe('This request already has an MC / Status, or it has expired.');
});

test.each([['Approve', 0], ['Reject', 1]])('%s on an expired request does nothing', async (_, i) => {
  await sendAll(SICK_FLOW);
  const data = keys(ADMINS[0])[i].callback_data;
  b.store.delete(`sub:${data.split(':')[1]}`);
  const before = b.calls.length;
  await send(adminTap(ADMINS[0], data));
  expect(b.calls.slice(before).map((c) => c.method)).toEqual(['answerCallbackQuery']);
});

test('reject reason typed after the request expired', async () => {
  await sendAll(SICK_FLOW);
  const reject = keys(ADMINS[0])[1].callback_data;
  await send(adminTap(ADMINS[0], reject));
  b.store.delete(`sub:${reject.slice(7)}`);
  await send(adminText(ADMINS[0], 'See MO'));
  expect(edits().at(-1).text).toBe('[For Admin] This request has expired.');
  expect(b.store.has(`rej:${ADMINS[0]}`)).toBe(false);
});

test('overlong reject reason is refused and the reject stays pending', async () => {
  await sendAll(SICK_FLOW);
  await send(adminTap(ADMINS[0], keys(ADMINS[0])[1].callback_data));
  await send(adminText(ADMINS[0], 'x'.repeat(501)));
  expect(b.toAdmin(ADMINS[0]).at(-1).text).toBe('[For Admin] Too long, please keep it under 500 characters.');
  expect(b.store.has(`rej:${ADMINS[0]}`)).toBe(true);
  await send(adminText(ADMINS[0], 'See MO'));
  expect(lastToUser().text).toContain('Reason: See MO');
});

test('admin sending /start drops their pending reject', async () => {
  await sendAll(SICK_FLOW);
  await send(adminTap(ADMINS[0], keys(ADMINS[0])[1].callback_data));
  await send(adminText(ADMINS[0], '/start'));
  expect(b.store.has(`rej:${ADMINS[0]}`)).toBe(false);
  expect(b.toAdmin(ADMINS[0]).at(-1).text).toBe('What is your Rank?');
  expect(b.userEdit()).toBeUndefined(); // request still undecided
});

test('/overview on a day with no submissions', async () => {
  await send(adminText(ADMINS[0], '/overview'));
  expect(b.toAdmin(ADMINS[0]).at(-1).text).toBe([
    `[For Admin] Overview for ${day()}`, '',
    '🤒 Report sick: 0', '🏥 Medical appointment: 0', '📄 MC / Status: 0', '',
    '⏳ Waiting\nNone', '', '📄 Awaiting MC\nNone', '',
    '🤒 Report sick\nNone', '', '🏥 Medical appointment\nNone', '', '📄 MC / Status\nNone',
  ].join('\n'));
});

test('backend errors still return 200', async () => {
  globalThis.fetch = async () => Response.json({ error: 'redis down' });
  expect(await send(text('/start'))).toBe(200);
});

test('a second Submit while the first is in flight sends nothing', async () => {
  await sendAll(SICK_FLOW.slice(0, -1));
  b.store.set('submit:111', '1');
  await send(SUBMIT);
  expect(posts(ADMINS[0])).toHaveLength(0);
});

test('a button the request no longer offers is ignored', async () => {
  await sendAll(SICK_FLOW);
  const id = button(ADMINS[0]).callback_data.split(':')[1];
  for (const action of ['seen', 'batsys']) await send(adminTap(ADMINS[0], `${action}:${id}`));
  expect(edits()).toHaveLength(0);
});

test('an admin tapping a button on their own request is told why', async () => {
  b.store.set('sub:own', new Map([['data', JSON.stringify({ id: 'own', user: ADMINS[0], type: 'sick', msgs: [] })]]));
  await send(adminTap(ADMINS[0], 'approve:own'));
  expect(b.toAdmin(ADMINS[0]).at(-1).text).toContain('cannot act on your own request');
});

test('Admin A taps approve but Admin B taps decline at the same time', async () => {
  const [A, B] = ADMINS;
  await sendAll(SICK_FLOW);
  const [approve, reject] = keys(B);
  const id = reject.callback_data.split(':')[1];
  await send(adminTap(B, reject.callback_data)); // B opens the reason prompt
  await Promise.all([
    send(adminTap(A, approve.callback_data)),
    send(adminTap(B, `rejskip:${id}`)),
  ]); //race to see which taps wins / which request gets sent first
  const decided = JSON.parse(b.store.get(`sub:${id}`).get('decided'));
  const told = b.toUser().filter((t) => t.startsWith('✅ Approved') || t.includes('has rejected'));
  expect(told).toHaveLength(1); // the soldier gets exactly one decision
  if (decided.v === 'approved') {
    expect(b.toAdmin(B).at(-1).text).toBe('[For Admin] Already approved by Admin A');
  } else {
    expect(decided.by).toBe('Admin B');
    expect(b.store.has('grant:111')).toBe(false); // no MC button for a rejected request
  }

test('user starts the form and selects a rank', async () => {
  // User starts the bot
  await send(text('/start'));

  // Check that the bot asks for rank
  expect(b.toUser().at(-1)).toBe('What is your Rank?');

  // User selects PTE
  await send(tap('rank:PTE'));

  // Check that the bot asks for name
  expect(b.toUser().at(-1)).toBe('What is your Name?');

  // Check that the backend saved the rank
  expect(JSON.parse(b.store.get('form:111')))
    .toMatchObject({
      step: 'name',
      rank: 'PTE'
    });
});
