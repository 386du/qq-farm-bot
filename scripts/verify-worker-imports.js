// Verify the worker IPC layer correctly references the activity/mall service functions.
// Loads the actual activity service to make sure the destructure names line up.

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(path.join(ROOT, 'core'));

// Load the real activity service
const activityService = require(path.join(ROOT, 'core/dist/services/activity'));
const mallService = require(path.join(ROOT, 'core/dist/services/mall'));

// These are the names worker.ts expects to destructure
const expected = {
    getActivityOverview: 'getActivityOverview',
    drawLottery: 'drawLottery',
    drawActivity: 'drawActivity',
    exchangeShopGoods: 'exchangeShopGoods',
    claimDailySignin: 'claimDailySignin',
    claimBattlePassRewards: 'claimBattlePassRewards',
    claimActivityTasks: 'claimActivityTasks',
    getMallCatalog: 'getMallCatalog',
    purchaseCatalogGoods: 'purchaseCatalogGoods',
};

const sources = { activity: activityService, mall: mallService };

let pass = 0, fail = 0;
for (const [key, fnName] of Object.entries(expected)) {
    // Find which module has it
    let found = null;
    for (const [modName, mod] of Object.entries(sources)) {
        if (typeof mod[fnName] === 'function') {
            found = { modName, type: 'function' };
            break;
        }
        if (mod[fnName] !== undefined) {
            found = { modName, type: typeof mod[fnName] };
            break;
        }
    }
    const ok = found && found.type === 'function';
    const tag = ok ? 'PASS' : 'FAIL';
    if (ok) pass++; else fail++;
    console.log(`[${tag}] ${key.padEnd(28)} = ${fnName.padEnd(28)} ${found ? '→ ' + found.modName + ' (' + found.type + ')' : 'NOT FOUND'}`);
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);

// Also test the actual destructuring pattern that worker.ts uses
const {
    getActivityOverview: getActivityOverviewImpl,
    drawLottery: drawActivityLotteryImpl,
    drawActivity: drawActivitySimpleImpl,
    exchangeShopGoods: exchangeActivityGoodsImpl,
    claimDailySignin: claimActivityDailySigninImpl,
    claimBattlePassRewards: claimBattlePassRewardsImpl,
    claimActivityTasks: claimActivityTasksImpl,
} = activityService;

const {
    getMallCatalog: getMallCatalogImpl,
    purchaseCatalogGoods: pcg,
} = mallService;

const aliases = {
    getActivityOverviewImpl,
    drawActivityLotteryImpl,
    drawActivitySimpleImpl,
    exchangeActivityGoodsImpl,
    claimActivityDailySigninImpl,
    claimBattlePassRewardsImpl,
    claimActivityTasksImpl,
    getMallCatalogImpl,
    purchaseCatalogGoodsImpl: pcg,
};

console.log('\n--- worker.ts destructure pattern ---');
let dpass = 0, dfail = 0;
for (const [name, fn] of Object.entries(aliases)) {
    const ok = typeof fn === 'function';
    const tag = ok ? 'PASS' : 'FAIL';
    if (ok) dpass++; else dfail++;
    console.log(`[${tag}] ${name.padEnd(36)} ${ok ? 'is function' : 'is ' + typeof fn}`);
}
console.log(`\n=== Destructure: ${dpass} passed, ${dfail} failed ===`);

process.exit(fail + dfail === 0 ? 0 : 1);
