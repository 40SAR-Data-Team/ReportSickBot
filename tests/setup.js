// Replace the real admin list with dummy IDs before any test imports the bot.
import { mock } from 'bun:test';
import { ADMINS } from './fake.js';

mock.module('../config.json', () => ({ default: { admins: ADMINS } }));
