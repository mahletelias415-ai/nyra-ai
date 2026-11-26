import { renderResearch, askResearch, researchBusy, bindResearch } from './research.js';
import {createPortrait} from './portrait.js';
import { request, proveWallet, signIn } from './workspace-client.js';
import { presets, parseOrder, compareReading } from './plan-core.js';
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const emptyFeedMarkup = $('#feed-items').innerHTML;
const key = 'nyra-public-page-watches-v1';
let saved;
try {
    saved = JSON.parse(localStorage.getItem(key) || 'null');
}
catch { }
let watches = Array.isArray(saved?.watches) ? saved.watches.slice(0, 4).map(w => ({ ...w, paused: true, running: false })) : [], readings = Array.isArray(saved?.readings) ? saved.readings.slice(0, 30) : [], current = null, currentRead = null, busy = false;
let server = null, workspaceError = '', walletBusy = false;
function persist() { if (server?.signedIn)
    return; try {
    localStorage.setItem(key, JSON.stringify({ watches, readings }));
}
catch {
    toast('This browser could not save readings. Export them before closing.');
} }
function toast(s) { $('#toast').textContent = s; $('#toast').classList.add('show'); setTimeout(() => $('#toast').classList.remove('show'), 4000); }
const time = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }) + ' UTC';
async function read(plan) { if (server?.signedIn) {
    const d = await request('/api/workspace/read', { plan });
    return d.result;
} return request('/api/read', { tool: plan.tool, args: plan.args }); }
function summary(r) { const d = r.data; switch (r.tool) {
    case 'rh_stock': return { title: d.symbol + ' · $' + Number(d.ask).toFixed(2), text: 'Official ask price, adjusted for the stock-token multiplier. Quote: ' + time(d.quotedAt) };
    case 'rh_network': return { title: 'RH block ' + d.block.toLocaleString('en-US'), text: 'Chain 4663 · ' + (Number(d.gasWei) / 1e9).toFixed(5) + ' gwei · Block time ' + time(d.blockAt) };
    case 'rh_wallet': return { title: d.eth + ' ETH', text: d.address.slice(0, 8) + '…' + d.address.slice(-6) + ' · ' + d.stocks.filter(x => BigInt(x.raw) > 0n).length + ' non-zero supported stock balances.' };
    case 'rh_pons_launches': return { title: d.items.length + ' latest Pons launches', text: d.items.slice(0, 4).map(x => x.symbol).join(' · ') + ' · Newest indexed page.' };
    case 'rh_pons_token': return { title: d.symbol + ' · ' + d.stage, text: 'Curve ' + (d.progress * 100).toFixed(2) + '% · ' + d.tradeCount + ' indexed trades. Market metadata, not an audit.' };
    case 'rh_contract': return { title: d.codePresent ? 'Contract code present' : 'No contract code at this address', text: d.ownerStatus + '. Source verification: not checked.' };
    case 'rh_transaction': return { title: 'Transaction ' + d.status, text: d.hash.slice(0, 12) + '… · ' + (d.block ? 'Block ' + d.block : 'Not yet mined') };
} return { title: 'Reading saved', text: r.tool }; }
function addReading(result, plan, type = 'reading', message = '') { const item = { id: crypto.randomUUID(), result, plan: { ...plan }, type, message, at: result.readAt }; readings.unshift(item); readings = readings.slice(0, 30); persist(); renderFeed(); }
function renderFeed() { if (!readings.length) {
    $('#feed-items').innerHTML = emptyFeedMarkup;
    return;
} $('#feed-items').innerHTML = readings.slice(0, 4).map(x => { const s = summary(x.result); return `<article class="feed-card"><div class="meta"><span>${x.type === 'alert' ? 'Detected change' : x.type === 'baseline' ? 'Baseline' : 'Live reading'} · ${esc(x.plan.agent)}</span><span>RH</span></div><h3>${esc(s.title)}</h3><p>${esc(x.message || s.text)}</p><div class="card-foot"><span>${time(x.at)}</span><button class="text-button" data-report="${x.id}">Inspect reading</button></div></article>`; }).join(''); }
function details(item) { const r = item.result, s = summary(r); $('#detail-content').innerHTML = `<span class="kicker">${esc(item.type || 'Live reading')}</span><h2>${esc(s.title)}</h2><p style="margin-top:20px">${esc(item.message || s.text)}</p><p class="fine-print">Read at ${esc(new Date(r.readAt).toUTCString())}</p><a href="${esc(r.data.source)}" target="_blank" rel="noopener">Open the source</a><pre>${esc(JSON.stringify(r.data, null, 2))}</pre>`; $('#details').showModal(); }
function renderPlan() { if (!current)
    return; const p = current; $('#desk-status').textContent = 'Plan ready · ' + p.agent; $('#plan').innerHTML = `<p class="plan-order">“${esc(p.order)}”</p><div class="plan-title"><h3>${esc(p.title)}</h3><span class="tag green">${esc(p.agent)} · Read only</span></div><dl><dt>Watches</dt><dd>${p.kind === 'wallet' ? 'ETH and the supported stock balances of one public RH address.' : p.kind === 'curve' ? 'A public token launch indexed by Pons.' : p.kind === 'price' ? 'The official multiplier-adjusted stock-token ask price.' : p.kind === 'launches' ? 'The newest page of the Pons token index.' : 'Public Robinhood Chain data.'}</dd><dt>Trigger</dt><dd>${esc(p.trigger)}</dd><dt>Checks</dt><dd>${p.canWatch ? (server?.signedIn ? (server.runner.scheduleConfigured ? 'Saved on the server. Background checks are scheduled every hour.' : 'Saved on the server. The background schedule is not enabled yet.') : 'Every 60 seconds while this page is open. Sign in for server watches.') : 'One live read when you press the button.'}</dd><dt>Tool</dt><dd><code>${esc(p.tool)}</code></dd></dl><div class="plan-input">${['wallet', 'curve', 'contract', 'transaction'].includes(p.kind) ? `<input class="address" id="plan-address" aria-label="${p.kind === 'transaction' ? 'Transaction hash' : 'Public ' + (p.kind === 'wallet' ? 'wallet' : 'contract') + ' address'}" placeholder="${p.kind === 'transaction' ? '0x… transaction hash' : '0x… public address'}" value="${esc(p.args.address || p.args.hash || '')}">` : ''}${p.kind === 'price' ? `<label>Stock <select id="plan-symbol">${['NVDA', 'AAPL', 'TSLA', 'MSFT', 'GOOGL', 'AMZN', 'SPY', 'QQQ'].map(s => `<option ${p.args.symbol === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label>Alert when<select id="plan-direction"><option value="below" ${p.direction === 'below' ? 'selected' : ''}>Below</option><option value="above" ${p.direction === 'above' ? 'selected' : ''}>Above</option></select></label><label>Price in USD<input id="plan-threshold" type="number" inputmode="decimal" min="0.000001" max="1000000" step="any" placeholder="Any change" value="${p.threshold ?? ''}"></label>` : ''}</div><div class="plan-actions"><button class="solid" id="read-now">Take a live reading</button>${p.canWatch ? `<button class="line-button" id="start-watch">${server?.signedIn ? 'Start server watch' : 'Start page watch'}</button>` : ''}</div><div id="reading-result" aria-live="polite"></div>`; }
function planFromInputs() { const p = structuredClone(current); if ($('#plan-address')) {
    const value = $('#plan-address').value.trim();
    if (p.kind === 'transaction') {
        if (!/^0x[0-9a-fA-F]{64}$/.test(value))
            throw Error('Enter a complete transaction hash.');
        p.args.hash = value;
    }
    else {
        if (!/^0x[0-9a-fA-F]{40}$/.test(value))
            throw Error('Enter a complete public address before taking this reading.');
        p.args.address = value;
    }
} if ($('#plan-symbol')) {
    p.args.symbol = $('#plan-symbol').value;
    const raw = $('#plan-threshold').value.trim();
    p.threshold = raw === '' ? null : Number(raw);
    if (p.threshold !== null && (!Number.isFinite(p.threshold) || p.threshold <= 0 || p.threshold > 1000000))
        throw Error('Choose a price line greater than zero and no more than $1,000,000.');
    p.direction = $('#plan-direction').value;
    p.title = p.args.symbol + (p.threshold ? ' ' + p.direction + ' $' + p.threshold : ' price watch');
    p.trigger = p.threshold ? 'Ask price crosses ' + p.direction + ' $' + p.threshold + '. Alerts once per crossing.' : 'Report when the quoted ask price changes.';
} return p; }
function showResult(r, message = '') { const s = summary(r); $('#reading-result').innerHTML = `<div class="read-result"><strong>${esc(s.title)}</strong><p>${esc(message || s.text)}</p><p class="fine-print">${time(r.readAt)} · <a href="${esc(r.data.source)}" target="_blank" rel="noopener">Source</a></p></div>`; }
function showError(message) { $('#reading-result').innerHTML = `<div class="read-result error" role="alert">${esc(message)}</div>`; }
function syncPricePlan() { if (current?.kind !== 'price')
    return; try {
    const p = planFromInputs(), changed = JSON.stringify([p.args, p.direction, p.threshold]) !== JSON.stringify([current.args, current.direction, current.threshold]);
    p.order = 'Watch ' + p.args.symbol + (p.threshold ? ' ' + p.direction + ' ' + p.threshold : ' price');
    current = p;
    $('#plan .plan-title h3').textContent = p.title;
    $('#plan .plan-order').textContent = '“' + p.order + '”';
    $('#order-desk').value = p.order;
    $('#plan dl dd:nth-of-type(2)').textContent = p.trigger;
    if (changed) {
        currentRead = null;
        $('#reading-result').innerHTML = '';
        $('#desk-status').textContent = 'Plan ready · ' + p.agent;
    }
}
catch { } }
$('#plan').addEventListener('change', syncPricePlan);
$('#plan').addEventListener('input', syncPricePlan);
async function take(startWatch = false) { if (busy)
    return; busy = true; const button = $(startWatch ? '#start-watch' : '#read-now'); button.disabled = true; const text = button.textContent; button.textContent = 'Reading the source…'; $('#portrait-state').textContent = 'Reading public sources'; try {
    const plan = planFromInputs();
    if (startWatch && server?.signedIn) {
        if (!server.wallet)
            throw Error('Verify your wallet in the workspace panel before starting a server watch.');
        const saved = await request('/api/watches/create', { plan });
        applyServer(saved.workspace);
        currentRead = saved.baseline;
        showResult(saved.baseline, server.runner.scheduleConfigured ? 'Baseline saved on the server. Nyra will keep checking after you close this page.' : 'Baseline saved on the server. Background checks will begin when the schedule is enabled.');
        return;
    }
    if (startWatch && workspaceError)
        throw Error(workspaceError);
    if (startWatch && watches.length >= 4)
        throw Error('Four page watches are already saved. Remove one before adding another.');
    if (startWatch && watches.some(w => JSON.stringify([w.plan.tool, w.plan.args, w.plan.threshold]) === JSON.stringify([plan.tool, plan.args, plan.threshold])))
        throw Error('This watch is already saved. Resume it below.');
    const r = await read(plan);
    currentRead = r;
    current = plan;
    syncPricePlan();
    $('#desk-status').textContent = 'Read complete · ' + plan.agent;
    addReading(r, plan, startWatch ? 'baseline' : 'reading');
    if (startWatch) {
        watches.push({ id: crypto.randomUUID(), plan, previous: r, createdAt: r.readAt, lastAt: r.readAt, paused: false, running: false, error: '', nextAt: Date.now() + 60000, checks: 1 });
        persist();
        renderWatches();
        showResult(r, 'Baseline saved. The next check is in 60 seconds; keep this page open.');
    }
    else
        showResult(r);
}
catch (e) {
    showError(e.message);
}
finally {
    busy = false;
    button.disabled = false;
    button.textContent = text;
    $('#portrait-state').textContent = 'Ready at the desk';
} }
function renderWatches() { $('#watch-count').textContent = watches.length; $('#watch-heading-label').textContent = server?.signedIn ? 'Your server watches' : 'Your page watches'; $('#watch-list').innerHTML = watches.length ? watches.map(w => `<div class="watch-row"><div><h4>${esc(w.plan.title)}</h4><p>${w.running ? 'Reading now' : w.paused ? 'Paused' : w.error ? 'Last read failed' : server?.signedIn ? (server.runner.scheduleConfigured ? 'Server watch active' : 'Awaiting schedule') : 'Page watch active'} · ${w.checks} reads · Last ${time(w.lastAt)}${server?.signedIn && !w.paused ? ' · Next due ' + time(w.nextAt) : ''}${w.error ? ' · ' + esc(w.error) : ''}</p></div><button data-watch="${w.id}" data-op="toggle">${w.paused ? 'Resume' : 'Pause'}</button><button data-watch="${w.id}" data-op="remove">Remove</button></div>`).join('') : '<p class="small">No watches yet. Start from a reading, then keep watch.</p>'; }
async function tick(w) { if (server?.signedIn)
    return; if (w.running || w.paused || document.hidden || navigator.onLine === false)
    return; w.running = true; renderWatches(); try {
    const r = await read(w.plan), change = compareReading(w.plan, w.previous, r);
    if (change.alert) {
        addReading(r, w.plan, 'alert', change.summary);
        toast(change.summary);
    }
    w.previous = r;
    w.lastAt = r.readAt;
    w.checks++;
    w.error = '';
}
catch (e) {
    w.error = e.message;
}
finally {
    w.running = false;
    w.nextAt = Date.now() + 60000;
    persist();
    renderWatches();
} }
async function order(text) { await initialWorkspace; if (busy) {
    toast('Let Nyra finish the current reading first.');
    return;
} try {
    current = parseOrder(text);
    currentRead = null;
    $('#order-desk').value = text;
    renderPlan();
    $('#desk').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    if (!current.args.address && ['wallet', 'curve', 'contract'].includes(current.kind))
        $('#plan-address').focus();
    else
        await take();
}
catch (e) {
    toast(e.message);
} }
async function askOrPlan(text) { await initialWorkspace; if(/\b(watch|alert|notify|tell me when|let me know|keep an eye)\b/i.test(text)){try{if(parseOrder(text).canWatch){await order(text);return;}}catch{}} if(server?.ai.configured){$('#research-prompt').value=text;$('#research').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});await askResearch(text,loadWorkspace);}else await order(text); }
$('#hero-form').addEventListener('submit', e => { e.preventDefault(); void askOrPlan($('#order-top').value || presets.price); });
$('#desk-form').addEventListener('submit', e => { e.preventDefault(); void askOrPlan($('#order-desk').value); });
document.addEventListener('click', async (e) => { const preset = e.target.closest('[data-preset]'); if (preset) {
    void order(presets[preset.dataset.preset]);
    return;
} if (e.target.closest('#read-now')) {
    await take();
    return;
} if (e.target.closest('#start-watch')) {
    await take(true);
    return;
} const report = e.target.closest('[data-report]'); if (report) {
    const item = readings.find(r => r.id === report.dataset.report);
    if (item)
        details(item);
    return;
} const watch = e.target.closest('[data-watch]'); if (watch) {
    const w = watches.find(w => w.id === watch.dataset.watch);
    if (!w)
        return;
    if (server?.signedIn) {
        const button = watch;
        button.disabled = true;
        try {
            applyServer(await request('/api/watches/change', { id: w.id, revision: w.revision, op: watch.dataset.op === 'remove' ? 'remove' : w.paused ? 'resume' : 'pause' }));
        }
        catch (e) {
            toast(e.message);
            await loadWorkspace();
        }
        finally {
            button.disabled = false;
        }
        return;
    }
    if (watch.dataset.op === 'remove')
        watches = watches.filter(x => x.id !== w.id);
    else {
        w.paused = !w.paused;
        if (!w.paused)
            void tick(w);
    }
    persist();
    renderWatches();
    return;
} });
$('#details .close').onclick = () => $('#details').close();
$('#details').addEventListener('click', e => { if (e.target === $('#details'))
    $('#details').close(); });
let initialTheme = 'light';
try {
    initialTheme = localStorage.getItem('nyra-ai-theme') || localStorage.getItem('famulus-rh-theme') || 'light';
}
catch { }
document.body.classList.toggle('dark', initialTheme === 'dark');
function syncTheme() { const dark = document.body.classList.contains('dark'); $('.theme span').textContent = dark ? 'Light' : 'Dark'; $('.theme').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme'); }
syncTheme();
$('.theme').onclick = () => { document.body.classList.toggle('dark'); syncTheme(); try {
    localStorage.setItem('nyra-ai-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
}
catch { } draw(0); };
async function connectWallet() { await initialWorkspace; if(walletBusy)return; walletBusy = true; $('#wallet-button').disabled = true; try {
    await proveWallet();
    await loadWorkspace();
    toast('Wallet verified. Your server workspace is ready.');
}
catch (e) {
    toast(e.code === 4001 ? 'Wallet sign-in was cancelled.' : e.message);
}
finally {
    walletBusy = false;
    $('#wallet-button').disabled = false;
} }
$('#wallet-button').onclick = connectWallet;
$('#workspace-wallet').onclick = connectWallet;
const endpoint = location.origin + '/mcp';
$('#mcp-endpoint').textContent = endpoint;
$('#copy-mcp').onclick = async () => { try {
    await navigator.clipboard.writeText(endpoint);
    toast('MCP endpoint copied.');
}
catch {
    toast(endpoint);
} };
$('#export').onclick = () => { const b = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), watches, readings }, null, 2)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'nyra-ai-readings.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
const toolExamples = { rh_network: presets.network, rh_wallet: presets.wallet, rh_stock: presets.price, rh_pons_token: presets.curve, rh_pons_launches: presets.launches, rh_transaction: 'Read transaction 0x', rh_contract: presets.contract };
fetch('/api/tools').then(r => r.json()).then(d => { $('#tool-list').innerHTML = d.tools.map(t => `<div class="tool-row"><code>${esc(t.name)}</code><p>${esc(t.description)}</p><button class="text-button" data-tool="${esc(t.name)}">Try a reading</button></div>`).join(''); }).catch(() => $('#tool-list').textContent = 'The tool list could not load. Reload the page to retry.');
document.addEventListener('click', e => { const t = e.target.closest('[data-tool]'); if (t) {
    if (t.dataset.tool === 'rh_transaction') {
        current = { kind: 'transaction', tool: 'rh_transaction', args: { hash: '' }, title: 'Read a transaction', agent: 'Sentry', order: 'Read an RH transaction', trigger: 'One reading: receipt, sender, recipient and gas.', canWatch: false };
        renderPlan();
        $('#desk').scrollIntoView({ behavior: 'smooth' });
        $('#plan-address').focus();
    }
    else
        order(toolExamples[t.dataset.tool]);
} });
setInterval(() => { if (server?.signedIn)
    return; for (const w of watches)
    if (Date.now() >= w.nextAt)
        void tick(w); }, 10000);
setInterval(() => { if (server?.signedIn && !document.hidden && !busy && !walletBusy)
    void loadWorkspace(); }, 30000);
renderFeed();
renderWatches();
const initialWorkspace = loadWorkspace();
// A dense point portrait assembles on arrival; chapter changes keep the face intact.
const portraitRenderer = createPortrait($('#portrait'), '/assets/nyra-portrait.jpg');
function draw(time = 0) { portraitRenderer.render(time); }
const chapters = [['Meet Nyra.<br>Your eyes on<br>Robinhood Chain.', 'Give her a wallet, a stock or a launch to follow. Nyra brings back the reading, the change and the source. You decide what happens next.'], ['A plain order.<br><span>A precise<br>watch plan.</span>', 'Choose the address, the stock or the trigger. See the sources before you start watching.'], ['Read the source.<br><span>Keep the<br>evidence.</span>', 'Every result carries a source and a timestamp. An unknown check stays unknown.'], ['Keep one eye<br><span>on what<br>changes.</span>', 'Start from a baseline. Only detected changes become alerts. Page watches pause when this page closes.'], ['Your keys.<br><span>Your decision.<br>Always.</span>', 'No transaction requests. No private keys. Your sentry reports; the next move belongs to you.']];
for (const b of document.querySelectorAll('[data-chapter]'))
    b.onclick = () => { const chapter = Number(b.dataset.chapter); portraitRenderer.setChapter(chapter); document.querySelectorAll('[data-chapter]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); }); $('#hero-title').innerHTML = chapters[chapter][0]; $('#hero-description').innerHTML = chapters[chapter][1];  };

for(const b of document.querySelectorAll('[data-chapter]')) b.setAttribute('aria-pressed',String(b.classList.contains('active')));
function applyServer(data) { server = data; workspaceError = ''; watches = data.watches; readings = data.readings; renderFeed(); renderWatches(); renderAccount(); renderResearch(data); }
async function loadWorkspace() { try {
    applyServer(await request('/api/workspace'));
}
catch (e) {
    if (e.status === 401) {
        if (server?.signedIn) {
            watches = [];
            readings = [];
            renderFeed();
            renderWatches();
        }
        server = null;
        renderResearch(null);
        workspaceError = '';
        renderAccount();
    }
    else {
        workspaceError = e.message;
        $('#workspace-status').textContent = e.message;
        $('#workspace-wallet').textContent = 'Retry connection';
    }
} }
function renderAccount() { const connected = server?.signedIn; $('#workspace-status').textContent = connected ? (server.wallet ? 'Wallet verified · server workspace' : 'Signed in · verify your wallet to keep watch') : 'Sign a wallet message to save your watches across devices. No transaction or payment.'; $('#workspace-wallet').textContent = connected ? 'Switch wallet' : 'Sign in with wallet'; $('#wallet-button').textContent = connected && server.wallet ? server.wallet.slice(0, 6) + '…' + server.wallet.slice(-4) : 'Sign in with wallet'; $('#unlink-wallet').hidden = !connected;$('#unlink-wallet').textContent='Sign out'; $('#telegram-link').disabled = !connected || !server?.telegram.configured; $('#telegram-unlink').hidden = !server?.telegram.linked; $('#telegram-link').textContent = server?.telegram.linked ? 'Telegram connected' : server?.telegram.configured ? 'Connect Telegram' : 'Telegram · not configured'; $('#telegram-note').textContent = server?.telegram.linked ? 'Detected changes will be queued for your private chat.' : server?.telegram.configured ? 'Link your own chat with a one-time code.' : 'Delivery is prepared. A Nyra bot must be configured before messages can be sent.'; $('#build-brief').disabled = !connected; const heartbeat = server?.runner.lastFinishedAt; $('#runner-note').textContent = connected ? (heartbeat ? 'Last server check ' + time(heartbeat) + '. ' + (server.runner.scheduleConfigured ? 'Schedule: every hour.' : 'Background schedule not enabled yet.') : (server.runner.scheduleConfigured ? 'Waiting for the first background check. Schedule: every hour.' : 'Server storage ready. Background schedule not enabled yet.')) : 'Single readings work without a verified wallet.'; $('#watch-scope-note').textContent = connected ? 'These watches and readings are saved to your account. Pausing takes effect on the server. Readings keep their source and timestamp; delayed or failed source reads remain visible.' : 'Guest watches run every 60 seconds while this tab is open and online. Sign in and verify your wallet to save server watches that continue after the page closes.'; renderBrief(server?.brief); }
function renderBrief(brief) { if (!brief) {
    $('#brief-content').innerHTML = '<p class="small">Build a factual summary from your saved readings. No invented market commentary.</p>';
    return;
} $('#brief-content').innerHTML = `<div class="brief-title"><h3>${esc(brief.day)} · UTC</h3><span class="small">${brief.readingCount} readings · ${brief.alerts.length} changes</span></div>${brief.latest.length ? brief.latest.map(x => `<article class="brief-item"><strong>${esc(x.title)}</strong><p>${esc(x.summary)}</p><a href="${esc(x.source)}" target="_blank" rel="noopener">Source</a><span class="small">${time(x.readAt)}</span></article>`).join('') : '<p>No saved readings for this UTC day yet. Take a live reading to start.</p>'}${brief.errors.length ? '<p class="brief-error">' + brief.errors.map(x => esc(x.title + ': ' + x.error)).join('<br>') + '</p>' : ''}<p class="fine-print">${esc(brief.notice)}</p>`; }
$('#build-brief').onclick = async () => { const b = $('#build-brief'); b.disabled = true; try {
    renderBrief(await request('/api/brief', {}));
    toast('Summary saved on the server.');
}
catch (e) {
    toast(e.message);
}
finally {
    b.disabled = false;
} };
$('#telegram-link').onclick = async () => { try {
    const d = await request('/api/telegram/link', {});
    $('#telegram-start').href = d.url;
    $('#telegram-start').hidden = false;
    $('#telegram-note').textContent = 'Open the bot and press Start. Then return here and check the connection.';
    $('#telegram-confirm').hidden = false;
}
catch (e) {
    toast(e.message);
} };
$('#telegram-confirm').onclick = async () => { try {
    await request('/api/telegram/confirm', {});
    await loadWorkspace();
    toast(server?.telegram.linked ? 'Telegram connected.' : 'No link received yet. Press Start in the bot and check again.');
}
catch (e) {
    toast(e.message);
} };
$('#unlink-wallet').onclick = async () => { try {
    await request('/api/auth/logout', {});await loadWorkspace();toast('Signed out. Your saved workspace stays on the server.');
}
catch (e) {
    toast(e.message);
} };
$('#telegram-unlink').onclick = async () => { try {
    applyServer(await request('/api/telegram/unlink', {}));
    $('#telegram-start').hidden = true;
    $('#telegram-confirm').hidden = true;
    toast('Telegram disconnected.');
}
catch (e) {
    toast(e.message);
} };

$('#research-form').addEventListener('submit',async e=>{e.preventDefault();await initialWorkspace;if(!server?.signedIn){signIn();return;}if(researchBusy())return;await askResearch($('#research-prompt').value,loadWorkspace);});

bindResearch(loadWorkspace);
