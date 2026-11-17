import { EG, FOR_ADMIN, FORM, HTML, btn, replyTo } from './consts.js';
import { today } from './dates.js';
import { hash, json, redis } from './store.js';
import { apply, buttons, grant } from './submissions.js';
import { send, tg } from './telegram.js';

const SECTIONS = [['sick', '🤒 Report sick'], ['appt', '🏥 Medical appointment'], ['mc', '📄 MC / Status']];
const ICONS = { approved: '✅', rejected: '❌', seen: '👍', wait: '⏳' };

/** Sends an admin today's counts, who is still waiting, and each submission's status. */
export async function overview(chat) {
  const day = today();
  const rows = Object.values(await hash(`day:${day}`)).map((v) => JSON.parse(v)).sort((a, b) => a.at.localeCompare(b.at));
  const state = (r) => (r.type === 'mc' ? r.seen && 'seen' : r.decided?.v) || 'wait';
  const status = (r) => (r.type === 'mc'
    ? [r.seen ? `👍 acknowledged by ${r.seen}` : '⏳ not yet acknowledged', r.batsys && `✅ BatSys by ${r.batsys}`].filter(Boolean).join(' · ')
    : [r.decided ? `${ICONS[r.decided.v]} ${r.decided.v} by ${r.decided.by}` : '⏳ waiting', r.batsys && `✅ BatSys by ${r.batsys}`].filter(Boolean).join(' · '));
  const list = (title, rs, more) => `${title}\n${rs.map((r) => `${r.at} ${r.label}${more ? ` – ${more(r)}` : ''}`).join('\n') || 'None'}`;
  const counts = SECTIONS.map(([type, title]) => {
    const rs = rows.filter((r) => r.type === type);
    const tally = Object.entries(ICONS).map(([k, icon]) => [rs.filter((r) => state(r) === k).length, icon]).filter(([n]) => n);
    return `${title}: ${rs.length}${tally.length ? ` (${tally.map(([n, icon]) => `${n} ${icon}`).join(', ')})` : ''}`;
  });
  const parts = [
    counts.join('\n'),
    list('⏳ Waiting', rows.filter((r) => state(r) === 'wait')),
    list('📄 Awaiting MC', rows.filter((r) => r.decided?.v === 'approved' && !r.mc)),
    ...SECTIONS.map(([type, title]) => list(title, rows.filter((r) => r.type === type), status)),
  ];
  return send(chat, `${FOR_ADMIN} Overview for ${day}\n\n${parts.join('\n\n')}`);
}

/** Admin tapped Reject: ask for an optional reason; their next text (or Skip) finishes it. */
async function askReason(chat, id, copy) {
  const f = await hash(`sub:${id}`);
  if (!f.data || f.decided) return;
  const prompt = await send(chat, `${FOR_ADMIN} Reason for rejecting ${JSON.parse(f.data).label}? Type it, or tap Skip.`, {
    reply_parameters: replyTo(copy),
    reply_markup: { inline_keyboard: [[btn('Skip', `rejskip:${id}`), btn('Cancel', `rejcancel:${id}`)]] },
  });
  await redis('SET', `rej:${chat}`, JSON.stringify({ id, prompt: prompt.message_id }), 'EX', 600);
}

/** Finishes this admin's pending reject. Returns false if none is pending (or `id` is not the pending one). */
export async function finishReject(chat, name, reason, id) {
  const p = await json('GET', `rej:${chat}`);
  if (!p || (id && p.id !== id)) return false;
  if (reason?.length > 500) {
    await send(chat, `${FOR_ADMIN} Too long, please keep it under 500 characters.`);
    return true;
  }
  await redis('DEL', `rej:${chat}`);
  const notify = `❌ ${name} has rejected your request.${reason ? `\nReason: ${reason}` : ''}\n\nSend /start to submit a new request.`;
  const sub = await apply(p.id, 'decided', JSON.stringify({ v: 'rejected', by: name, reason }), notify);
  const d = !sub && await json('HGET', `sub:${p.id}`, 'decided');
  const text = sub ? '✔ Rejection sent' : d ? `Already ${d.v} by ${d.by}` : 'This request has expired.';
  await tg('editMessageText', { chat_id: chat, message_id: p.prompt, text: `${FOR_ADMIN} ${text}` });
  return true;
}

/** 'own' for an admin acting on their own submission, false for a button the submission no longer offers (stale / replayed tap). */
async function allowed(chat, id, action) {
  const f = await hash(`sub:${id}`);
  if (!f.data) return true; // expired: apply / askReason say so
  const sub = JSON.parse(f.data);
  if (sub.user === chat) return 'own';
  return buttons(sub, f).some((b) => b.callback_data === `${action}:${id}`);
}

/** Admin tapped a button on a submission (or on a reject prompt). */
export async function decide(cb, name) {
  if (!name) return;
  const [action, id] = cb.data.split(':');
  const chat = cb.message.chat.id;
  if (/^(approve|reject|seen|batsys)$/.test(action)) {
    const ok = await allowed(chat, id, action);
    if (ok === 'own') return send(chat, `${FOR_ADMIN} You cannot act on your own request. Another admin must.`);
    if (!ok) return;
  }
  if (action === 'reject') return askReason(chat, id, cb.message.message_id);
  if (action === 'rejskip') return finishReject(chat, name, null, id);
  if (action === 'rejcancel') {
    if ((await json('GET', `rej:${chat}`))?.id === id) await redis('DEL', `rej:${chat}`);
    return tg('editMessageText', { chat_id: chat, message_id: cb.message.message_id, text: `${FOR_ADMIN} Rejection cancelled.` });
  }
  if (action === 'approve') {
    const notify = `✅ Approved by ${name}\n\nAfter your visit, tap below to send your MC / Status.`;
    const sub = await apply(id, 'decided', JSON.stringify({ v: 'approved', by: name }), notify,
      { inline_keyboard: [[btn('📄 Send MC / Status', `mcfor:${id}`)]] });
    if (sub?.type === 'sick') await send(sub.user, `Reminder: After visiting the doctor, complete the ${FORM}, and keep the FormSG's Response ID e.g. ${EG}`, HTML);
    return sub && grant(sub);
  }
  return apply(id, action, name, action === 'seen' && `👍 Acknowledged by ${name}`);
}
