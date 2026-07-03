#!/usr/bin/env node
/**
 * fixture-watch.mjs
 * ---------------------------------------------------------------------------
 * 用途: 把 qqfarmws 导出的 ws_frames 目录做成可版本化的"协议快照基线",
 *      之后每次腾讯更新,跑一次 diff 就能立刻看到:
 *        - 哪些 .bin 消失了(服务端不再下发)
 *        - 哪些 .bin 新增了(新协议帧)
 *        - 哪些 .bin 大小/哈希变了(协议微调,反作弊字段最常这样)
 *
 * 用法:
 *   # 1) 建立基线(以后每次腾讯更新前重新跑一次覆盖)
 *   node fixture-watch.mjs save --src ../ws_frames --baseline ./fixtures/baseline-2026-07-03
 *
 *   # 2) 跟基线对比当前 ws_frames
 *   node fixture-watch.mjs diff --src ../ws_frames --baseline ./fixtures/baseline-2026-07-03
 *
 *   # 3) 列出所有基线版本
 *   node fixture-watch.mjs list --root ./fixtures
 *
 *   # 4) 跟"上一个基线"自动对比(无需手填路径)
 *   node fixture-watch.mjs diff --src ../ws_frames --root ./fixtures
 *
 * 输出:
 *   - fixtures/baseline-<date>/manifest.json     (基线清单: 文件名/size/sha256/timestamp)
 *   - fixtures/baseline-<date>/bins/<name>.bin   (基线 .bin 副本,用于以后离线分析)
 *   - 控制台 + diff_report.txt                  (人类可读 diff 报告)
 * ---------------------------------------------------------------------------
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, join, basename, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { argv, exit } from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';

const args = argv.slice(2);
if (args.length === 0) usage();

let cmd = args[0];
let src = null, baseline = null, root = null;

for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--src') src = resolve(args[++i]);
    else if (a === '--baseline') baseline = resolve(args[++i]);
    else if (a === '--root') root = resolve(args[++i]);
    else if (a === '-h' || a === '--help') usage();
    else {
        console.error(`未知参数: ${a}`);
        usage();
    }
}

if (!root) root = resolve('./fixtures');

function usage() {
    console.log(`用法:
  node fixture-watch.mjs save   --src <ws_frames> --baseline <dir>
  node fixture-watch.mjs diff   --src <ws_frames> --baseline <dir> | --root <dir>
  node fixture-watch.mjs list   --root <dir>
  node fixture-watch.mjs prune  --root <dir> --keep <N>     保留最近 N 个基线`);
    exit(2);
}

// ---- 工具 ----
function sha256(buf) {
    return createHash('sha256').update(buf).digest('hex');
}

function listBins(dir) {
    if (!existsSync(dir)) return [];
    const out = [];
    for (const name of readdirSync(dir)) {
        if (name.startsWith('.')) continue;
        const full = join(dir, name);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isFile() && name.toLowerCase().endsWith('.bin')) {
            out.push({ path: full, name, size: st.size, mtimeMs: st.mtimeMs });
        } else if (st.isDirectory()) {
            out.push(...listBins(full).map(x => ({ ...x, name: join(name, x.name) })));
        }
    }
    return out;
}

function listFramesCsv(dir) {
    if (!existsSync(dir)) return null;
    for (const name of readdirSync(dir)) {
        if (name === 'frames.csv') return join(dir, name);
    }
    // 兼容子目录里也找一个
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        try { if (statSync(full).isDirectory()) {
            const inner = listFramesCsv(full);
            if (inner) return inner;
        }} catch {}
    }
    return null;
}

function dateStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function ensureDir(p) { mkdirSync(p, { recursive: true }); }

// ---- 建基线 ----
async function cmdSave() {
    if (!src) { console.error('save 需要 --src'); exit(2); }
    if (!baseline) {
        // 自动命名: fixtures/baseline-<date>
        baseline = join(root, `baseline-${dateStamp()}`);
    }
    ensureDir(baseline);
    const binsDir = join(baseline, 'bins');
    ensureDir(binsDir);

    const csv = listFramesCsv(src);
    const bins = listBins(src);
    const manifest = {
        created_at: new Date().toISOString(),
        source_dir: resolve(src),
        bin_count: bins.length,
        frames_csv: csv,
        files: [],
    };

    console.log(`[save] 扫描 ${src}`);
    console.log(`[save] 找到 frames.csv: ${csv || '(无)'}`);
    console.log(`[save] 找到 ${bins.length} 个 .bin`);

    // 复制 frames.csv 一并保存
    if (csv) {
        copyFileSync(csv, join(baseline, 'frames.csv'));
    }

    for (const b of bins) {
        const buf = await readFile(b.path);
        const hash = sha256(buf);
        const target = join(binsDir, b.name.replace(/[\\/]/g, '__'));
        ensureDir(dirname(target));
        await writeFile(target, buf);
        manifest.files.push({
            name: b.name,
            size: b.size,
            mtime: b.mtimeMs,
            sha256: hash,
        });
    }

    const manifestPath = join(baseline, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`[save] 完成 -> ${baseline}`);
    console.log(`[save] manifest: ${manifestPath}`);
    console.log(`[save] 基线 .bin: ${binsDir}`);
    console.log(`[save] 总文件: ${manifest.files.length}`);
}

// ---- diff ----
async function cmdDiff() {
    if (!src) { console.error('diff 需要 --src'); exit(2); }
    if (!baseline) {
        // 找最新的基线
        if (!existsSync(root)) { console.error(`基线目录不存在: ${root}`); exit(2); }
        const subs = readdirSync(root).filter(n => n.startsWith('baseline-')).sort();
        if (subs.length === 0) { console.error(`在 ${root} 找不到任何 baseline-*`); exit(2); }
        baseline = join(root, subs[subs.length - 1]);
        console.log(`[diff] 自动选择最新基线: ${baseline}`);
    }
    const manifestPath = join(baseline, 'manifest.json');
    if (!existsSync(manifestPath)) { console.error(`基线无 manifest: ${manifestPath}`); exit(2); }
    const baseManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const baseFiles = new Map(baseManifest.files.map(f => [f.name, f]));

    const curBins = listBins(src);
    const curFiles = new Map();
    for (const b of curBins) {
        const buf = await readFile(b.path);
        curFiles.set(b.name, { name: b.name, size: b.size, mtime: b.mtimeMs, sha256: sha256(buf) });
    }

    const added = [];
    const removed = [];
    const changed = [];
    const unchanged = [];

    for (const [n, f] of curFiles) {
        if (!baseFiles.has(n)) {
            added.push(f);
        } else {
            const b = baseFiles.get(n);
            if (b.sha256 !== f.sha256 || b.size !== f.size) {
                changed.push({ name: n, base: b, cur: f });
            } else {
                unchanged.push(n);
            }
        }
    }
    for (const n of baseFiles.keys()) {
        if (!curFiles.has(n)) removed.push(baseFiles.get(n));
    }

    added.sort((a, b) => b.size - a.size);
    removed.sort((a, b) => b.size - a.size);
    changed.sort((a, b) => Math.abs(b.cur.size - b.base.size) - Math.abs(a.cur.size - a.base.size));

    const report = [];
    const W = (s) => report.push(s);
    W(`========================================================`);
    W(`QQ Farm WS - 协议帧基线 diff 报告`);
    W(`========================================================`);
    W(`基线:     ${baseline}`);
    W(`基线时间: ${baseManifest.created_at}`);
    W(`当前目录: ${resolve(src)}`);
    W(`当前时间: ${new Date().toISOString()}`);
    W(``);
    W(`基线帧数:   ${baseManifest.bin_count}`);
    W(`当前帧数:   ${curFiles.size}`);
    W(`未变:       ${unchanged.length}`);
    W(`新增:       ${added.length}`);
    W(`消失:       ${removed.length}`);
    W(`变化(结构/大小): ${changed.length}`);
    W(``);

    if (changed.length > 0) {
        W(`---- 变化的帧(最可能含反作弊/Telemetry) ----`);
        for (const c of changed.slice(0, 30)) {
            W(`  ${c.name}`);
            W(`    size:    ${c.base.size}B  ->  ${c.cur.size}B  (Δ ${c.cur.size - c.base.size > 0 ? '+' : ''}${c.cur.size - c.base.size})`);
            W(`    sha256:  ${c.base.sha256.substring(0, 12)}..  ->  ${c.cur.sha256.substring(0, 12)}..`);
        }
        if (changed.length > 30) W(`  ... 还有 ${changed.length - 30} 个`);
        W(``);
        W(`  -> 用 bin-analyzer.mjs 对比结构:`);
        if (changed.length > 0) {
            const c = changed[0];
            const baseBin = join(baseline, 'bins', c.name.replace(/[\\/]/g, '__'));
            W(`     node bin-analyzer.mjs "${baseBin}" --compare "${join(resolve(src), c.name)}"`);
        }
    }

    if (added.length > 0) {
        W(`---- 新增的帧 ----`);
        for (const a of added.slice(0, 20)) {
            W(`  ${a.name}  (${a.size}B  ${a.sha256.substring(0, 12)}..)`);
        }
        if (added.length > 20) W(`  ... 还有 ${added.length - 20} 个`);
    }

    if (removed.length > 0) {
        W(`---- 消失的帧 ----`);
        for (const r of removed.slice(0, 20)) {
            W(`  ${r.name}  (${r.size}B)`);
        }
        if (removed.length > 20) W(`  ... 还有 ${removed.length - 20} 个`);
    }

    W(``);
    W(`--------------------------------------------------------`);
    W(`3 分钟异常检测建议:`);
    if (changed.length > 0) {
        W(`  重点看 changed 列表里出现在 2:50-3:10 窗口的帧:`);
        W(`  1. 用 bin-analyzer.mjs --compare 对比基线与当前`);
        W(`  2. 看新加的字段(常见: 操作计数 hash、时间戳、行为签名)`);
        W(`  3. 如果只多了几字节,大概率是反作弊 hash 字段`);
    } else {
        W(`  协议无变化,如果仍触发检测,问题在别处:`);
        W(`  - 服务端时钟偏移 / 累计行为数据已上报过`);
        W(`  - 当前账号的累计指标已超阈值`);
    }

    const text = report.join('\n');
    console.log(text);

    const outReport = join(resolve(src), 'diff_report.txt');
    await writeFile(outReport, text, 'utf8');
    console.log(`\n[diff] 报告已写入: ${outReport}`);
}

// ---- list ----
async function cmdList() {
    if (!existsSync(root)) { console.log(`基线根目录不存在: ${root}`); return; }
    const subs = readdirSync(root).filter(n => n.startsWith('baseline-')).sort();
    if (subs.length === 0) { console.log(`(在 ${root} 下没有基线)`); return; }
    console.log(`基线列表 (${root}):`);
    for (const s of subs) {
        const mp = join(root, s, 'manifest.json');
        if (existsSync(mp)) {
            const m = JSON.parse(await readFile(mp, 'utf8'));
            console.log(`  ${s}  bins=${m.bin_count}  ${m.created_at}`);
        } else {
            console.log(`  ${s}  (无 manifest)`);
        }
    }
}

// ---- prune ----
async function cmdPrune() {
    const keep = parseInt(args[args.indexOf('--keep') + 1], 10) || 5;
    if (!existsSync(root)) return;
    const subs = readdirSync(root).filter(n => n.startsWith('baseline-')).sort();
    const drop = subs.slice(0, Math.max(0, subs.length - keep));
    for (const d of drop) {
        const full = join(root, d);
        console.log(`[prune] 删除 ${full}`);
        // 递归删除
        const { rmSync } = await import('node:fs');
        rmSync(full, { recursive: true, force: true });
    }
    console.log(`[prune] 保留 ${Math.min(keep, subs.length)} 个,删除 ${drop.length} 个`);
}

// ---- main ----
(async () => {
    try {
        if (cmd === 'save') await cmdSave();
        else if (cmd === 'diff') await cmdDiff();
        else if (cmd === 'list') await cmdList();
        else if (cmd === 'prune') await cmdPrune();
        else { console.error(`未知命令: ${cmd}`); usage(); }
    } catch (e) {
        console.error(`[X] ${e.message}`);
        if (process.env.DEBUG) console.error(e.stack);
        exit(1);
    }
})();
