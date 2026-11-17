// ADMINS env var: JSON {"name": telegramId}. Unset means no admins, so the submit fails loudly.
export const admins = () => Object.entries(JSON.parse(process.env.ADMINS ?? '{}'));
export const adminName = (id) => admins().find(([, a]) => a === id)?.[0];
