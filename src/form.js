import { HTML, btn, who } from './consts.js';
import { today } from './dates.js';
import { json } from './store.js';
import { send } from './telegram.js';

/** Selectable ranks, lowest to highest. */
const RANKS = ['REC', 'PTE', 'LCP', 'CPL', 'CFC', '3SG', '2SG', '2LT', 'LTA'];
/** Request type key -> menu label. */
export const TYPES = {
  sick: 'Request Permission to Report Sick',
  appt: 'Request Permission to attend upcoming Medical Appointment',
  mc: 'Send MC / Status from the Doctor / MO',
};
/** Pledge a soldier acknowledges before reporting sick. */
const ACK = "I will wait for my commander's approval before I report sick";
/** Pledge a soldier acknowledges before going for an appointment. */
const PLEDGE = "I will seek my commander's approval before heading for my Medical Appointment";
/** Link-step button for an MC that belongs to no request. */
export const UNLINKED = '📄 Not for any request above';
/** HTML link to the FormSG report-sick form. */
export const FORM = '(<a href="https://go.gov.sg/medicalforms-40sar">40 SAR Report Sick Form</a>)';
export const EG = '6ad8500b1d0ae72f026cfa75'; // example FormSG Response ID

/** Step -> [question text, inline keyboard?, send options?], or a function of the form state returning that. */
const QUESTIONS = {
  profile: (s) => [`Continue as ${who(s)}?`, [[btn('✅ Yes', 'profile:yes'), btn('Change', 'profile:no')]]],
  rank: ['What is your Rank?',
    [0, 3, 6].map((i) => RANKS.slice(i, i + 3).map((r) => btn(r, `rank:${r}`)))],
  name: ['What is your Name?'],
  type: ['How may I help you?', Object.entries(TYPES).map(([k, t]) => [btn(t, `type:${k}`)])],
  condition: ['What symptoms are you experiencing? Please be as detailed as possible: what you feel, how severe, any fever / temperature, and anything else the doctor should know. (e.g. Fever 38.5, sore throat, cough, worse at night)'],
  onset: ['When did you start experiencing these symptoms? (DDMMYY)'],
  body: ['Which side of your body is experiencing these symptoms? (e.g. Rash on LEFT Hand, RIGHT Shin Pain)',
    [['Left', 'Right', 'Both', 'NA'].map((v) => btn(v, `body:${v}`))]],
  clinic: ['Which clinic will you visit?'],
  time: ['What time will you visit the doctor? (24h format, e.g. 0830)'],
  ack: [`${ACK}.`, [[btn('✅ I acknowledge', 'ack:yes')]]],
  purpose: ['Reason for Medical Appointment? (e.g Eczema, Spine Surgery)'],
  when: ['When is your Medical Appointment? (DD/MM/YYYY HHMM)'],
  venue: ['Which clinic is your Medical Appointment?'],
  shot: ['Attach a screenshot / image of your Medical Appointment.'],
  pledge: [`${PLEDGE}.`, [[btn('✅ I acknowledge', 'pledge:yes')]]],
  link: (s) => ['Which request is this MC / Status for?',
    [...s.grants.map(([id, g]) => [btn(g.label, `link:${id}`)]), [btn(UNLINKED, 'link:none')]]],
  formsg: [`Complete the ${FORM}, and send the FormSG's Response ID e.g. ${EG}`, undefined, HTML],
  reason: ['What new status are you given / What is your reason for MC?'],
  start: () => ['Start Date of MC / Status? (DD/MM/YYYY)', [[btn(`Today (${today()})`, 'today')]]],
  end: ['End Date of MC / Status? (DD/MM/YYYY)'],
  file: ['Attach your MC / Memo. (one photo or PDF)'],
  review: (s) => [`Please check your details:\n\n${details(s).join('\n')}`,
    [[btn('✅ Submit', 'review:yes'), btn('🔄 Start over', 'review:no')]]],
};
/** Steps asked per request type after rank, name and type. After the last step, submit. */
export const FLOWS = {
  sick: ['condition', 'onset', 'body', 'clinic', 'time', 'ack', 'review'],
  appt: ['purpose', 'when', 'venue', 'shot', 'pledge', 'review'],
  mc: ['formsg', 'link', 'reason', 'start', 'end', 'file', 'review'],
};
/** Steps answered by tapping a button instead of typing. */
export const BUTTON_STEPS = new Set(['profile', 'rank', 'type', 'body', 'ack', 'pledge', 'link', 'review']);

/**
 * Sends the question for `step`.
 *
 * @param {number} chat Chat id.
 * @param {string} step Step to ask.
 * @param {string=} prefix Text shown above the question, e.g. an error.
 * @param {object} s Form state, for questions that depend on it.
 * @return {Promise<object>} The sent Telegram message.
 */
export function ask(chat, step, prefix, s) {
  const q = QUESTIONS[step];
  const [text, keyboard, extra] = typeof q === 'function' ? q(s) : q;
  return send(chat, prefix ? `${prefix}\n\n${text}` : text, { reply_markup: keyboard && { inline_keyboard: keyboard }, ...extra });
}

/** Summary lines of a filled form, shown for review and sent to admins. */
export function details(s) {
  return {
    sick: ['🤒 REQUEST TO REPORT SICK', who(s), `Medical Condition: ${s.condition}`, s.onset && `Symptoms since: ${s.onset}`, s.body && `Laterality: ${s.body}`, `Clinic: ${s.clinic}`, `Time: ${s.time}`, `✅ ${ACK}`],
    appt: ['🏥 REQUEST TO ATTEND MEDICAL APPOINTMENT', who(s), `Reason: ${s.purpose}`, `Time: ${s.when}`, `Clinic: ${s.venue}`, `✅ ${PLEDGE}`],
    mc: ['📄 MC / STATUS', who(s), s.grant && `For: ${s.grant.label}`, s.formsg && `FormSG Response ID: ${s.formsg}`,`Reason / Status: ${s.reason}`, `From ${s.start} to ${s.end}`],
  }[s.type].filter(Boolean);
}

/** A new form: offers the saved profile, or asks the rank. */
export async function blank(chat) {
  const profile = await json('GET', `profile:${chat}`);
  return profile ? { step: 'profile', ...profile } : { step: 'rank' };
}
