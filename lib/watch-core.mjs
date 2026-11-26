import { parseOrder, compareReading } from '../public/plan-core.js';
export const CHECK_INTERVAL = 60 * 60 * 1000;
export const MAX_WATCHES = 5;
export function canonicalPlan(value, { requireWatch = true } = {}) {
    if (!value || typeof value.order !== 'string')
        throw Error('Choose a supported order.');
    const p = parseOrder(value.order);
    if (requireWatch && !p.canWatch)
        throw Error('This tool supports a single reading, not a standing watch.');
    if (p.kind === 'price') {
        const symbol = String(value.args?.symbol || p.args.symbol).toUpperCase();
        if (!['NVDA', 'AAPL', 'TSLA', 'MSFT', 'GOOGL', 'AMZN', 'SPY', 'QQQ'].includes(symbol))
            throw Error('Choose a supported Stock Token.');
        p.args = { symbol };
        const threshold = value.threshold === null ? null : value.threshold === undefined ? p.threshold : Number(value.threshold);
        if (threshold !== null && (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1000000))
            throw Error('Choose a positive price line up to $1,000,000.');
        p.threshold = threshold;
        p.direction = value.direction === undefined ? p.direction : value.direction;
        if (!['above', 'below'].includes(p.direction))
            throw Error('Choose above or below.');
        p.title = symbol + (threshold === null ? ' price watch' : ' ' + p.direction + ' $' + threshold);
        p.trigger = threshold === null ? 'Report when the quoted ask price changes.' : 'Ask price crosses ' + p.direction + ' $' + threshold + '. Alerts once per crossing.';
        p.order = 'Watch ' + symbol + (threshold === null ? ' price' : ' ' + p.direction + ' ' + threshold);
    }
    else if (['wallet', 'curve', 'contract'].includes(p.kind)) {
        const address = String(value.args?.address || p.args.address || '').toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(address))
            throw Error('Enter a complete public address.');
        p.args = { address };
        p.order = p.kind === 'wallet' ? 'Watch wallet ' + address : p.kind === 'contract' ? 'Check contract ' + address : 'Watch Pons token ' + address + ' graduate';
    }
    else if (p.kind === 'transaction') {
        const hash = String(value.args?.hash || p.args.hash || '');
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
            throw Error('Enter a complete transaction hash.');
        p.args = { hash };
    }
    return p;
}
export function fingerprint(plan) { return JSON.stringify([plan.tool, plan.args, plan.threshold ?? null, plan.direction ?? null]); }
export function summarize(result) {
    const d = result.data;
    if (result.tool === 'rh_stock')
        return d.symbol + ' ask $' + Number(d.ask).toLocaleString('en-US', { maximumFractionDigits: 4 });
    if (result.tool === 'rh_wallet')
        return d.address + ': ' + d.eth + ' ETH' + (d.failedBalances ? ' (partial stock balances)' : '');
    if (result.tool === 'rh_pons_token')
        return d.symbol + ': ' + d.stage + ', curve ' + (d.progress * 100).toFixed(2) + '%';
    if (result.tool === 'rh_pons_launches')
        return d.items.length + ' indexed launches: ' + d.items.slice(0, 5).map(x => x.symbol).join(', ');
    if (result.tool === 'rh_network')
        return 'RH block ' + d.block;
    return result.tool + ' reading';
}
export function makeBrief(rows, watches, day) {
    const latest = new Map(), alerts = [];
    for (const row of rows) {
        const result = typeof row.result === 'string' ? JSON.parse(row.result) : row.result;
        const plan = typeof row.plan === 'string' ? JSON.parse(row.plan) : row.plan;
        const key = fingerprint(plan);
        if (!latest.has(key))
            latest.set(key, { title: plan.title, summary: summarize(result), readAt: result.readAt, source: result.data.source });
        if (row.kind === 'alert')
            alerts.push({ message: row.message, readAt: result.readAt, source: result.data.source });
    }
    return { day, generatedAt: new Date().toISOString(), readingCount: rows.length, alerts: alerts.slice(0, 20), latest: [...latest.values()].slice(0, 10), watchCount: watches.length, errors: watches.filter(w => w.error).map(w => ({ title: JSON.parse(w.plan).title, error: w.error })), notice: 'A factual summary of saved readings for this UTC day; not a new live check or an AI recommendation.' };
}
export function telegramText(payload, kind) {
    if (kind === 'brief')
        return ('Nyra · Daily brief · ' + payload.day + '\n' + payload.readingCount + ' readings, ' + payload.alerts.length + ' detected changes.\n\n' + payload.latest.map(x => x.summary + '\n' + x.source).join('\n\n')).slice(0, 3800);
    return ('Nyra · Detected change\n' + payload.message + '\n\nRead: ' + payload.result.readAt + '\n' + payload.result.data.source).slice(0, 3800);
}
export { compareReading };

export function nextCheckAt(at=Date.now()){return Math.floor(at/CHECK_INTERVAL)*CHECK_INTERVAL+CHECK_INTERVAL;}
