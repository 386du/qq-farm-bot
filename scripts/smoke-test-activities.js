// End-to-end HTTP smoke test for /api/mall/* and /api/activity/*
// Mocks: dataProvider, callAccountMethod, no real game server connection.

const path = require('node:path');
const http = require('node:http');

// Use the compiled dist/ (TypeScript has been transpiled to CJS)
const ROOT = path.resolve(__dirname, '..');
process.chdir(path.join(ROOT, 'core')); // for runtime config paths

const express = require(path.join(ROOT, 'core/node_modules/express'));
const tokenStore = require(path.join(ROOT, 'core/dist/models/user-store/token-store'));

// --- Build mock dataProvider ---
const mockResults = {};
const callLog = [];

const mockProvider = {
    resolveAccountId: (ref) => String(ref || ''),
    callAccountMethod: (accountId, method, params) => {
        callLog.push({ accountId, method, params });
        // Default success response
        if (mockResults[method]) {
            const r = mockResults[method];
            return typeof r === 'function' ? r(params, accountId) : r;
        }
        return { ok: true, method, params };
    },
};

// Seed canned responses
mockResults.getMallCatalog = { goods: [{ id: 1001, name: '测试商品', price: 100, currency: 1 }] };
mockResults.purchaseMallGoods = { purchased: true, remain: 5 };
mockResults.getActivityOverview = {
    name: '荷风游记',
    currencies: [{ id: 1018, name: '荷叶', count: 10 }],
    crops: [{ id: 1001, name: '白菜', count: 3 }],
    items: [{ id: 2001, name: '肥料', count: 2 }],
    summary: { freeDraw: 1, paidDraw: 0, signinClaimed: false },
    live: {
        lottery: { freeRemaining: 1, paidRemaining: 0, preview: [] },
        shop: { items: [] },
        signin: { day: 3, claimedToday: false, total: 7 },
        battlePass: { level: 5, freeClaimable: 2, premiumClaimable: 1 },
    },
};
mockResults.drawActivityLottery = { results: [{ prizeId: 1, name: '荷叶x1' }], cost: 0 };
mockResults.drawActivitySimple = { results: [], cost: 0 };
mockResults.exchangeActivityGoods = { success: true, remain: 1 };
mockResults.claimActivityDailySignin = { claimed: true, day: 3 };
mockResults.claimBattlePass = { claimed: [{ level: 2 }, { level: 3 }] };
mockResults.claimActivityTasks = { claimed: [{ taskId: 't1' }] };

// --- Build admin context and app ---
const ctx = {
    tokens: new Set(),
    tokenUserMap: new Map(),
    app: null,
    server: null,
    io: null,
    provider: mockProvider,
};

// Seed a real token via tokenStore
const entry = tokenStore.addToken({ username: 'smoke-test', isAdmin: true });
ctx.tokens.add(entry.token);
ctx.tokenUserMap.set(entry.token, entry.user);

// Mount routes
const app = express();
app.use(express.json());
const { mountMallRoutes } = require(path.join(ROOT, 'core/dist/controllers/admin/mall-routes'));
const { mountActivityRoutes } = require(path.join(ROOT, 'core/dist/controllers/admin/activity-routes'));
mountMallRoutes(app, ctx);
mountActivityRoutes(app, ctx);

// Start server
const server = app.listen(0, '127.0.0.1', () => {
    _port = server.address().port;
    console.log(`[smoke] server listening on 127.0.0.1:${_port}`);
    runTests(_port, server).catch((e) => {
        console.error('TEST_RUNNER_ERROR', e);
        server.close();
        process.exit(2);
    });
});

const TOKEN = entry.token;
const ACC = 'fake-account-1';

let _port = 0;
function req(method, urlPath, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const r = http.request({
            host: '127.0.0.1',
            port: _port,
            method,
            path: encodeURI(urlPath),
            headers: {
                'Content-Type': 'application/json',
                'x-admin-token': TOKEN,
                'x-account-id': ACC,
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
            },
        }, (res) => {
            let chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = JSON.parse(text); } catch (_) {}
                resolve({ status: res.statusCode, body: json, raw: text });
            });
        });
        r.on('error', reject);
        if (data) r.write(data);
        r.end();
    });
}

async function runTests(port, server) {
    const cases = [
        { name: 'mall 列表', method: 'GET', path: '/api/mall/goods?slotType=1', expectMethod: 'getMallCatalog' },
        { name: 'mall 购买', method: 'POST', path: '/api/mall/purchase', body: { goodsId: 1001, count: 2 }, expectMethod: 'purchaseMallGoods' },
        { name: 'activity 概览', method: 'GET', path: '/api/activity/overview?name=荷风游记', expectMethod: 'getActivityOverview' },
        { name: 'activity 抽奖', method: 'POST', path: '/api/activity/draw', body: { activityName: '荷风游记', mode: 'free', count: 1 }, expectMethod: 'drawActivityLottery' },
        { name: 'activity 兑换', method: 'POST', path: '/api/activity/exchange', body: { activityName: '荷风游记', goodsId: 5001, count: 1 }, expectMethod: 'exchangeActivityGoods' },
        { name: 'activity 每日签到', method: 'POST', path: '/api/activity/daily-signin/claim', body: { activityName: '荷风游记' }, expectMethod: 'claimActivityDailySignin' },
        { name: 'activity 战令', method: 'POST', path: '/api/activity/battle-pass/claim', body: {}, expectMethod: 'claimBattlePass' },
        { name: 'activity 任务', method: 'POST', path: '/api/activity/tasks/claim', body: { activityName: '荷风游记' }, expectMethod: 'claimActivityTasks' },
    ];

    let pass = 0;
    let fail = 0;
    for (const c of cases) {
        const r = await req(c.method, c.path, c.body);
        const ok = r.status === 200 && r.body && r.body.ok === true;
        const called = callLog.find((x) => x.method === c.expectMethod);
        const tag = ok ? 'PASS' : 'FAIL';
        if (ok) pass++; else fail++;
        console.log(`[${tag}] ${c.name}  status=${r.status}  expectMethod=${c.expectMethod}  called=${!!called}`);
        if (!ok) {
            console.log('  -> body:', JSON.stringify(r.body));
        }
    }

    // Negative: missing token
    const noAuth = await new Promise((resolve) => {
        const r = http.request({ host: '127.0.0.1', port, method: 'GET', path: '/api/mall/goods' }, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve(res.statusCode));
        });
        r.end();
    });
    console.log(`[${noAuth === 401 ? 'PASS' : 'FAIL'}] 未授权 401  expected=401 got=${noAuth}`);
    if (noAuth === 401) pass++; else fail++;

    // Negative: missing goodsId on purchase
    const noId = await req('POST', '/api/mall/purchase', { count: 1 });
    const okNoId = noId.status === 400 && noId.body && noId.body.ok === false;
    console.log(`[${okNoId ? 'PASS' : 'FAIL'}] 缺 goodsId 400  status=${noId.status}`);
    if (okNoId) pass++; else fail++;

    console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);

    server.close();
    process.exit(fail === 0 ? 0 : 1);
}
