export const RANKS =['REC', 'PTE', 'LCP', 'CPL', 'CFC', '3SG', '2SG', '2LT', 'LTA'];
export const TYPES = {
  sick: 'Request Permission to Report Sick',
  appt: 'Request Permission to attend upcoming Medical Appointment',
  mc: 'Send MC / Status from the Doctor / MO',
};
export const ACK = "I will wait for my commander's approval before I report sick";
export const PLEDGE = "I will seek my commander's approval before heading for my Medical Appointment";
export const WEEK = 604800; // seconds
export const UNLINKED = '📄 Not for any request above';
export const HTML = { parse_mode: 'HTML' };
export const FORM = '(<a href="https://go.gov.sg/medicalforms-40sar">40 SAR Report Sick Form</a>)';
export const EG = '6ad8500b1d0ae72f026cfa75'; // example FormSG Response ID

export const FOR_ADMIN = '[For Admin]'; // prefix on everything the bot sends to admins
export const btn = (text, data) => ({ text, callback_data: data });
export const who = (s) => `${s.rank} ${s.name}`;
export const replyTo = (message_id) => message_id && { message_id, allow_sending_without_reply: true };
