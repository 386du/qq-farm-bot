#!/usr/bin/env node
/**
 * bin-analyzer.mjs
 * ---------------------------------------------------------------------------
 * 用途: 不依赖任何 .proto 定义,直接按 protobuf wire format 盲拆 .bin 文件。
 *      用于 qqfarmws 抓出的 ws 帧,特别适合"3 分钟异常帧"分析:
 *      你的 core/src/proto/*.proto 里没有这个 message 也能看结构。
 *
 * 用法:
 *   node bin-analyzer.mjs <file.bin> [<file2.bin> ...]
 *   node bin-analyzer.mjs <dir/>                 (扫目录下所有 .bin)
 *   node bin-analyzer.mjs <file.bin> --json      (输出 JSON 树)
 *   node bin-analyzer.mjs <file.bin> --depth 8   (嵌套递归深度,默认 6)
 *   node bin-analyzer.mjs <file.bin> --strings   (只打印发现的字符串,适合扫 batch)
 *   node bin-analyzer.mjs <file.bin> --compare <other.bin>  (对比两个 .bin)
 *
 * 设计目标: 0 依赖(只用 Node 内置),Node 18+ 即可。
 * ---------------------------------------------------------------------------
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, extname, join, basename } from 'node:path';
import { argv, exit } from 'node:process';

const args = argv.slice(2);
if (args.length === 0) {
    console.error('用法: node bin-analyzer.mjs <file|dir>... [options]');
    console.error('选项:');
    console.error('  --json           输出 JSON 树');
    console.error('  --depth <N>      嵌套递归深度 (默认 6)');
    console.error('  --strings        只打印所有发现的字符串');
    console.error('  --hex            打印完整十六进制 dump');
    console.error('  --compare <f>    跟另一个 .bin 对比差异');
    console.error('  --no-tree        关闭树状打印');
    exit(2);
}

// ---- 参数解析 ----
const inputs = [];
let mode = 'tree';
let depth = 6;
let compareFile = null;
let showTree = true;
let showHex = false;
let stringsOnly = false;

for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') mode = 'json';
    else if (a === '--strings') { stringsOnly = true; mode = 'strings'; }
    else if (a === '--hex') showHex = true;
    else if (a === '--no-tree') showTree = false;
    else if (a === '--depth') { depth = parseInt(args[++i], 10) || 6; }
    else if (a === '--compare') { compareFile = args[++i]; }
    else if (a.startsWith('--')) {
        console.error(`未知选项: ${a}`);
        exit(2);
    } else {
        inputs.push(a);
    }
}

// ---- 收集 .bin 文件 ----
function collect(p) {
    const abs = resolve(p);
    let st;
    try { st = statSync(abs); } catch { return []; }
    if (st.isDirectory()) {
        return readdirSync(abs)
            .filter(f => extname(f).toLowerCase() === '.bin')
            .map(f => join(abs, f));
    }
    return [abs];
}

let files = [];
for (const p of inputs) files.push(...collect(p));
if (files.length === 0) {
    console.error('没找到 .bin 文件');
    exit(2);
}

// ---- protobuf wire 解析 ----
const WIRE = {
    0: 'varint',
    1: 'fixed64',
    2: 'length-delimited',
    3: 'startGroup',     // 协议里已废弃,但仍在协议中
    4: 'endGroup',
    5: 'fixed32',
};

function isPrintable(buf) {
    if (buf.length === 0) return false;
    let ok = 0;
    for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) ok++;
    }
    return ok / buf.length >= 0.95;
}

function tryParseAsNested(buf, maxDepth) {
    if (buf.length === 0 || maxDepth <= 0) return null;
    // 必须能完整 parse,否则就不是嵌套 message
    try {
        const tree = parseProto(buf, maxDepth - 1, 0);
        // 至少解析出一个字段才算
        if (tree.fields.length > 0) {
            // 必须消费完整 buffer
            let pos = 0;
            for (const f of tree.fields) pos = f.endOffset;
            if (pos === buf.length) return tree;
        }
    } catch { /* ignore */ }
    return null;
}

function parseProto(buf, maxDepth, startPos = 0) {
    const fields = [];
    let pos = startPos;
    while (pos < buf.length) {
        // 读 tag (varint)
        let tag = 0, shift = 0, ok = false, tagStart = pos;
        while (pos < buf.length) {
            const c = buf[pos++];
            tag |= (c & 0x7f) << shift;
            if ((c & 0x80) === 0) { ok = true; break; }
            shift += 7;
            if (shift > 28) break;
        }
        if (!ok) break;
        const fieldNum = tag >>> 3;
        const wireType = tag & 0x07;
        const wireName = WIRE[wireType] || `unknown(${wireType})`;
        const fieldStart = pos;
        let value = null;
        let extra = {};

        if (wireType === 0) {
            // varint
            let v = 0n, s = 0n, okV = false;
            while (pos < buf.length) {
                const c = buf[pos++];
                v |= BigInt(c & 0x7f) << s;
                if ((c & 0x80) === 0) { okV = true; break; }
                s += 7n;
                if (s > 63n) break;
            }
            value = okV ? v.toString() : '(truncated)';
            // 负数 (int32/int64 的 high bit): 经典 64-bit sign extension
            try {
                const big = BigInt(value);
                if (big >> 63n === -1n || (big & (1n << 63n)) !== 0n) {
                    const neg = big - (1n << 64n);
                    extra.signed = neg.toString();
                }
            } catch {}
        } else if (wireType === 1) {
            // fixed64
            if (pos + 8 > buf.length) { value = '(truncated)'; pos = buf.length; }
            else {
                value = '0x' + buf.slice(pos, pos + 8).toString('hex');
                extra.bytes = 8;
                pos += 8;
            }
        } else if (wireType === 5) {
            // fixed32
            if (pos + 4 > buf.length) { value = '(truncated)'; pos = buf.length; }
            else {
                value = '0x' + buf.slice(pos, pos + 4).toString('hex');
                extra.bytes = 4;
                pos += 4;
            }
        } else if (wireType === 2) {
            // length-delimited
            let len = 0, s = 0, okL = false;
            while (pos < buf.length) {
                const c = buf[pos++];
                len |= (c & 0x7f) << s;
                if ((c & 0x80) === 0) { okL = true; break; }
                s += 7;
                if (s > 28) break;
            }
            if (!okL || pos + len > buf.length) { value = '(truncated)'; pos = buf.length; }
            else {
                const chunk = buf.subarray(pos, pos + len);
                pos += len;
                if (len >= 2 && isPrintable(chunk)) {
                    value = JSON.stringify(chunk.toString('utf8'));
                    extra.kind = 'string';
                } else {
                    // 尝试作嵌套 message
                    const nested = maxDepth > 0 ? tryParseAsNested(chunk, maxDepth) : null;
                    if (nested) {
                        value = nested;
                        extra.kind = 'message';
                    } else {
                        // 再尝试 packed repeated varint (全部 byte < 0x80)
                        if (len > 0 && len <= 64) {
                            let allSimple = true, packed = [];
                            let p = 0;
                            while (p < chunk.length) {
                                if ((chunk[p] & 0x80) !== 0) { allSimple = false; break; }
                                packed.push(chunk[p]); p++;
                            }
                            if (allSimple && packed.length > 1) {
                                value = '[' + packed.join(',') + ']';
                                extra.kind = 'packed-varint';
                            }
                        }
                        if (value === null) {
                            value = '0x' + chunk.toString('hex');
                            extra.kind = 'bytes';
                        }
                    }
                }
            }
        } else if (wireType === 3 || wireType === 4) {
            value = `(${wireName})`;
        } else {
            value = '(unknown wire type)';
        }

        fields.push({
            fieldNum,
            wireType,
            wireName,
            offset: tagStart,
            endOffset: pos,
            length: pos - tagStart,
            value,
            extra,
        });
        if (wireType === 3 || wireType === 4) break;  // safety
    }
    return { fields, total: pos - startPos };
}

// ---- 打印树 ----
function pad(n) { return '  '.repeat(n); }

function printTree(node, indent = 0, prefix = '') {
    for (let i = 0; i < node.fields.length; i++) {
        const f = node.fields[i];
        let line = `${pad(indent)}${prefix}#${f.fieldNum} (${f.wireName}, offset=${f.offset}, len=${f.length}) `;
        if (f.extra.kind === 'message') {
            console.log(`${line}{`);
            printTree(f.value, indent + 1);
            console.log(`${pad(indent)}}`);
        } else {
            const v = f.extra.kind === 'string' ? f.value : (typeof f.value === 'string' && f.value.length > 80 ? f.value.slice(0, 80) + '...' : f.value);
            console.log(`${line}= ${v}`);
            if (f.extra.signed) console.log(`${pad(indent)}  (signed=${f.extra.signed})`);
        }
    }
}

function collectStrings(node, out, path = '') {
    for (const f of node.fields) {
        if (f.extra.kind === 'string') {
            out.push({ field: `${path}#${f.fieldNum}`, value: f.value });
        } else if (f.extra.kind === 'message') {
            collectStrings(f.value, out, `${path}#${f.fieldNum}.`);
        }
    }
}

// ---- 对比 ----
function compareTrees(a, b, path = '') {
    const diffs = [];
    const map = new Map();
    for (const f of a.fields) map.set(`${f.fieldNum}|${f.wireType}|${f.length}`, [...(map.get(`${f.fieldNum}|${f.wireType}|${f.length}`) || []), f]);
    for (const fb of b.fields) {
        const k = `${fb.fieldNum}|${fb.wireType}|${fb.length}`;
        if (map.has(k)) {
            const arr = map.get(k);
            arr.shift();
            if (arr.length === 0) map.delete(k);
        } else {
            diffs.push({ kind: 'added', path: `${path}#${fb.fieldNum}`, field: fb });
        }
    }
    for (const [k, arr] of map) {
        for (const fa of arr) diffs.push({ kind: 'removed', path: `${path}#${fa.fieldNum}`, field: fa });
    }
    // 嵌套 message 字段再深入对比
    for (const fa of a.fields) {
        if (fa.extra.kind !== 'message') continue;
        const fbMatch = b.fields.find(x => x.fieldNum === fa.fieldNum && x.extra.kind === 'message');
        if (fbMatch) {
            diffs.push(...compareTrees(fa.value, fbMatch.value, `${path}#${fa.fieldNum}.`).map(d => ({ ...d, path: d.path.replace(`${path}#${fa.fieldNum}.`, `${path}#${fa.fieldNum}.`) })));
        }
    }
    return diffs;
}

// ---- 单文件处理 ----
function analyzeOne(file) {
    const buf = readFileSync(file);
    const tree = parseProto(buf, depth, 0);

    if (mode === 'json') {
        console.log(JSON.stringify({ file, size: buf.length, fields: tree.fields }, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
        return;
    }
    if (mode === 'strings') {
        const out = [];
        collectStrings(tree, out);
        console.log(`\n=== ${file} (${buf.length}B, ${out.length} strings) ===`);
        for (const s of out) console.log(`  ${s.field.padEnd(8)} ${s.value}`);
        return;
    }

    console.log(`\n=== ${file} (${buf.length}B, ${tree.fields.length} top-level fields) ===`);
    if (showHex) console.log(buf.toString('hex').match(/.{1,64}/g)?.join('\n') || '');
    if (showTree) {
        printTree(tree, 0);
    }

    if (compareFile) {
        const otherBuf = readFileSync(resolve(compareFile));
        const other = parseProto(otherBuf, depth, 0);
        const diffs = compareTrees(tree, other);
        console.log(`\n--- diff vs ${compareFile} ---`);
        if (diffs.length === 0) console.log('  (无结构差异)');
        for (const d of diffs) {
            const f = d.field;
            const line = `  [${d.kind}] #${f.fieldNum} (${f.wireName}, len=${f.length}) = ${typeof f.value === 'object' ? '{...}' : f.value}`;
            console.log(line);
        }
    }
}

for (const f of files) analyzeOne(f);
