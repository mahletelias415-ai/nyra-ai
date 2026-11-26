import { timingSafeEqual } from 'node:crypto';

export function validWebhookSecret(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function telegramCommand(update, username) {
  const m = update?.message;
  if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0 ||
      m?.chat?.type !== 'private' || m?.from?.is_bot ||
      !Number.isSafeInteger(m?.from?.id) || m.from.id <= 0 ||
      m.from.id !== m.chat.id || typeof m.text !== 'string') return null;
  const match = m.text.trim().match(/^\/([a-z]+)(?:@([a-z0-9_]+))?(?:\s+(.{1,200}))?$/i);
  if (match?.[2] && match[2].toLowerCase() !== username.toLowerCase()) return null;
  return { id: update.update_id, chatId: String(m.chat.id), command: match?.[1]?.toLowerCase() || (m.text.trim().startsWith('/')?'help':'text'), argument: match?.[3]?.trim() || '',text:m.text.trim() };
}

export const botHelp = (linked = false) => linked
  ? 'Nyra is connected.\n\nDescribe a project search in a message. Review the conditions before starting; follow up to refine them. Preparation uses your existing AI allowance.\n\n/status — connection and last server check\n/watches — your saved watches\n/missions — choose a Scout mission to edit\n/new — a separate Scout draft\n/scoutbrief — saved Scout changes from the last 24h\n/daily — daily Scout recap settings\n/brief — today’s saved research\n/stop — disconnect Telegram\n\nManage research and watches at https://nyraagent.online/#desk'
  : 'Meet Nyra, your AI desk for Robinhood Chain.\n\nTo receive private alerts, sign in with your wallet at https://nyraagent.online/#desk and choose Connect Telegram. Open the one-use link here.\n\nYour wallet key and seed phrase are never needed in this chat.';

export function statusText(profile, active, finishedAt) {
  const wallet = profile.wallet ? profile.wallet.slice(0, 6) + '…' + profile.wallet.slice(-4) : 'verified wallet';
  return `Connected to ${wallet}.\nActive watches: ${active}.\nChecks: every hour.\nLast completed check: ${finishedAt ? new Date(Number(finishedAt)).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'not recorded yet'}.\n\n/stop disconnects Telegram; your watches remain in Nyra.`;
}

export function watchesText(watches) {
  if (!watches.length) return 'No saved watches yet. Create one at https://nyraagent.online/#desk';
  return 'Your watches\n\n' + watches.map((w, i) => {
    let plan; try { plan = JSON.parse(w.plan); } catch { plan = {}; }
    return `${i + 1}. ${String(plan.order || plan.description || 'Saved watch').slice(0, 220)}\n${w.paused ? 'Paused' : 'Active'} · ${w.checks} checks${w.error ? ' · last source read failed' : ''}`;
  }).join('\n\n') + '\n\nManage: https://nyraagent.online/#desk';
}

export const clipTelegram = text => Array.from(String(text)).slice(0, 3900).join('');
