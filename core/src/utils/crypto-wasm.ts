export {};
/**
 * crypto-wasm.ts
 *
 * ACE 反作弊 WASM 加密引擎 — 增强版
 *
 * 基于 tsdk.wasm (QQ农场 appid: 1112386029) 逆向分析:
 *   - 加载真实 tsdk.wasm 二进制
 *   - 解密 17 个加密数据段 (XOR key = 0x6F892DE1)
 *   - 从 WASM 内存地址 14976 提取 AES S-box
 *   - 用 JS 复现 func 195 加密算法 (S-box → ROL3 → +7 → XOR LCG → ×9)
 *
 * 兼容原接口:
 *   initWasm()          → Promise<void>
 *   encryptBuffer(buf)  → Promise<Buffer>
 *   decryptBuffer(buf)  → Promise<Buffer>  (新增)
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// 常量定义 (来自 WAT 逆向分析)
// ============================================================================

/** AES S-box 在 WASM 线性内存中的地址 */
const SBOX_ADDR = 14976;

/** 数据段 XOR 解密密钥 (同 LCG 初始状态) */
const XOR_KEY = 0x6f892de1;

/** 段 16 地址 (运行时 call_indirect 密钥) */
const SEG16_ADDR = 67371008;
/** 段 16 大小 */
const SEG16_SIZE = 404;

/** LCG 乘数 (glibc rand) */
const LCG_MUL = 1103515245;
/** LCG 增量 (glibc rand) */
const LCG_INC = 12345;
/** LCG 初始状态 (= XOR key) */
const LCG_INIT = 0x6f892de1;

/** ×9 的模 256 乘法逆元 (9 × 57 = 513 ≡ 1 mod 256) */
const MUL9_INV = 57;

// ============================================================================
// AES S-box (标准 Rijndael)
// ============================================================================

const AES_SBOX: Uint8Array = new Uint8Array([
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

/** AES 逆 S-box */
const AES_SBOX_INV: Uint8Array = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    AES_SBOX_INV[AES_SBOX[i]] = i;
}

// ============================================================================
// WASM 导入对象
// ============================================================================

/**
 * 创建 WASM 导入对象。
 * tsdk.wasm 从 env "a" 导入 22 个函数 (a-v)。
 * 大多数是 stub (返回 0)，仅 emscripten_get_now / clock 需要返回时间。
 */
function createImportObject(): WebAssembly.Imports {
    const noop = () => {};
    const zero = () => 0;
    const now32 = () => Date.now() & 0xffffffff;
    const now64 = () => Date.now();

    return {
        a: {
            a: noop,  // emscripten_memcpy_big
            b: zero,  // emscripten_get_now_res
            c: zero,  // abortOnCannotGrowMemory
            d: zero,  // growMemory
            e: zero,  // invoke_* (vi)
            f: noop,  // invoke_* (v)
            g: zero,  // invoke_* (ii)
            h: zero,  // invoke_* (iii)
            i: zero,  // invoke_* (iiii)
            j: zero,  // invoke_* (iiiii)
            k: zero,  // invoke_* (iiiiii)
            l: now32, // emscripten_get_now (i32)
            m: zero,  // invoke_* (vii)
            n: zero,  // invoke_* (viiii)
            o: noop,  // invoke_* (v)
            p: zero,  // invoke_* (vi)
            q: zero,  // invoke_* (vii)
            r: zero,  // invoke_* (viii)
            s: now64, // clock_gettime / clock
            t: zero,  // invoke_* (viiiiii)
            u: noop,  // invoke_* (viiii)
            v: zero,  // invoke_* (viiiii)
        },
    };
}

// ============================================================================
// WASM 导出类型
// ============================================================================

/** tsdk.wasm 导出接口 */
interface TsdkWasmExports extends WebAssembly.Exports {
    /** 线性内存 */
    w: WebAssembly.Memory;
    /** SdkInitEx (func 211) */
    x: (gameId: number, appkey: number) => void;
    /** AnoUserLogin (func 167) */
    M: (accountType: number, openidPtr: number) => void;
    /** create_buffer (func 163) */
    V: (size: number) => number;
    /** encrypt_data (func 109) — 原地加密 */
    G: (ptr: number, len: number) => number;
    /** decrypt_data (func 115) — 原地解密 */
    ba: (ptr: number, len: number) => number;
    /** destroy_buffer (func 187) */
    $: (ptr: number) => void;
    /** get_data_to_server (func 170) */
    N: (lenPtr: number) => number;
    /** send_data_from_server (func 39) */
    ca: (ptr: number, len: number) => void;
    /** generate_token (func 53) */
    aa: (ptr: number, len: number) => number;
    /** __wasm_call_ctors (func 236) */
    __wasm_call_ctors: () => void;
    /** 解密段 16 (纯 XOR) */
    __mergewasm_shared____wasm_decrypt_strings: (
        base: number,
        size: number,
        key: number
    ) => void;
    /** 解密段 0-15 */
    decrypt_all_data: () => void;
    /** __heap_base */
    __heap_base: WebAssembly.Global;
    /** __data_end */
    __data_end: WebAssembly.Global;
}

// ============================================================================
// 内部状态
// ============================================================================

let wasmInstance: WebAssembly.Instance | null = null;
let wasmExports: TsdkWasmExports | null = null;
let memory: WebAssembly.Memory | null = null;
let heapU8: Uint8Array | null = null;

/** 是否使用 WASM 原生加密（WASM 加载成功时为 true，降级为 JS 实现时为 false） */
let useWasmNative = false;

/** 堆内存分配指针 (bump allocator) */
let heapPtr = 0;

/** 从 WASM 内存提取的 S-box (如果 WASM 加载成功) */
let sboxFromWasm: Uint8Array | null = null;

/** 初始化 Promise */
let initPromise: Promise<void> | null = null;

/** 使用的 S-box（优先从 WASM 提取，否则使用内置标准 AES S-box） */
function getSbox(): Uint8Array {
    return sboxFromWasm || AES_SBOX;
}

/** 使用的逆 S-box */
function getSboxInv(): Uint8Array {
    return AES_SBOX_INV;
}

// ============================================================================
// WASM 初始化
// ============================================================================

/**
 * 解析 WASM 路径 (兼容编译模式和源码模式)。
 */
function resolveWasmPath(): string {
    let wasmDir = __dirname;
    // 编译模式: __dirname 是 dist/utils/，wasm 在 src/utils/
    if (path.basename(wasmDir) === 'utils' && path.basename(path.join(wasmDir, '..')) === 'dist') {
        wasmDir = path.join(wasmDir, '..', '..', 'src', 'utils');
    }
    return path.join(wasmDir, 'tsdk.wasm');
}

/**
 * 在 WASM 堆中分配内存 (bump allocator)。
 */
function alloc(size: number): number {
    const aligned = (heapPtr + 15) & ~15; // 16 字节对齐
    heapPtr = aligned + size;
    // 如果超出当前内存, 自动扩容
    if (heapPtr > memory!.buffer.byteLength) {
        const need = Math.ceil((heapPtr - memory!.buffer.byteLength) / 65536);
        memory!.grow(need);
        refreshMemory();
    }
    return aligned;
}

/** 刷新内存视图 (grow 后必须调用) */
function refreshMemory(): void {
    heapU8 = new Uint8Array(memory!.buffer);
}

/**
 * 初始化 WASM 加密引擎。
 *
 * 流程:
 *   1. 编译并实例化 tsdk.wasm
 *   2. 调用 __wasm_call_ctors (C++ 静态构造函数)
 *   3. 解密段 16 (call_indirect 运行时密钥, 纯 XOR)
 *   4. 解密段 0-15 (decrypt_all_data, 依赖段 16 已解密)
 *   5. 验证 S-box 并提取
 *
 * 如果 WASM 加载失败, 降级为 JS 原生加解密实现 (使用内置 AES S-box)。
 */
function initWasm(): Promise<void> {
    if (initPromise) return initPromise;

    initPromise = new Promise<void>((resolve, reject) => {
        try {
            const wasmPath = resolveWasmPath();
            const wasmBuffer = fs.readFileSync(wasmPath);

            WebAssembly.compile(wasmBuffer).then((module) => {
                const instance = new WebAssembly.Instance(module, createImportObject());
                wasmInstance = instance;
                wasmExports = instance.exports as TsdkWasmExports;
                memory = wasmExports.w;
                heapU8 = new Uint8Array(memory.buffer);

                try {
                    // 1. 调用 C++ 静态构造函数
                    wasmExports.__wasm_call_ctors();

                    // 2. 解密段 16 (纯 XOR)
                    wasmExports.__mergewasm_shared____wasm_decrypt_strings(
                        SEG16_ADDR,
                        SEG16_SIZE,
                        XOR_KEY
                    );

                    // 3. 解密段 0-15 (内部用 call_indirect)
                    wasmExports.decrypt_all_data();
                    refreshMemory();

                    // 4. 验证 S-box
                    const sboxFirst = heapU8![SBOX_ADDR];
                    const sboxSecond = heapU8![SBOX_ADDR + 1];
                    if (sboxFirst === 0x63 && sboxSecond === 0x7c) {
                        // 提取 S-box
                        sboxFromWasm = new Uint8Array(256);
                        for (let i = 0; i < 256; i++) {
                            sboxFromWasm[i] = heapU8![SBOX_ADDR + i];
                        }
                        useWasmNative = true;
                        console.log('[crypto-wasm] WASM 初始化成功, S-box 已从内存地址 14976 提取');
                    } else {
                        console.warn(`[crypto-wasm] S-box 验证失败: 期望 63 7c, 实际 ${sboxFirst.toString(16)} ${sboxSecond.toString(16)}, 降级为 JS 原生实现`);
                        useWasmNative = false;
                    }

                    // 初始化堆指针
                    heapPtr = (wasmExports.__heap_base as any).value;

                } catch (e) {
                    console.warn('[crypto-wasm] WASM 数据段解密失败, 降级为 JS 原生实现:', e);
                    useWasmNative = false;
                }

                resolve();
            }).catch((e) => {
                console.warn('[crypto-wasm] WASM 编译/实例化失败, 降级为 JS 原生实现:', e);
                useWasmNative = false;
                resolve(); // 降级模式不 reject, 保证系统可用
            });
        } catch (e) {
            console.warn('[crypto-wasm] WASM 文件加载失败, 降级为 JS 原生实现:', e);
            useWasmNative = false;
            resolve();
        }
    });

    return initPromise;
}

// ============================================================================
// JS 原生加解密 (基于 func 195 算法复现, 始终可用)
// ============================================================================

/**
 * ACE 加密 (func 195 正向) — JS 原生实现
 *
 * 算法: S-box → ROL3 → +7 → XOR(LCG keystream) → ×9 mod 256
 *
 * @param data - 明文 (Uint8Array)
 * @returns 密文 (Uint8Array, 长度与输入相同)
 */
function encryptBufferJS(data: Uint8Array): Uint8Array {
    const sbox = getSbox();
    const result = new Uint8Array(data.length);
    let lcgState = LCG_INIT >>> 0;

    for (let i = 0; i < data.length; i++) {
        const byte = data[i];
        // 1. AES S-box 查找
        const lookup = sbox[byte];
        // 2. ROL3 (循环左移 3 位, 8 位)
        const rotated = ((lookup << 3) | (lookup >> 5)) & 0xff;
        // 3. +7 (mod 256)
        const valueA = (rotated + 7) & 0xff;
        // 4. LCG keystream
        lcgState = (Math.imul(lcgState, LCG_MUL) + LCG_INC) >>> 0;
        const ks = ((i & 15) ^ (lcgState >>> 16)) & 0xff;
        // 5. XOR keystream
        const valueE = (valueA ^ ks) & 0xff;
        // 6. ×9 (mod 256)
        result[i] = (Math.imul(valueE, 9)) & 0xff;
    }

    return result;
}

/**
 * ACE 解密 (func 195 逆向) — JS 原生实现
 *
 * 算法: ×57 mod 256 → XOR(LCG ks) → -7 mod 256 → ROR3 → S-box 逆查找
 *
 * @param data - 密文 (Uint8Array)
 * @returns 明文 (Uint8Array, 长度与输入相同)
 */
function decryptBufferJS(data: Uint8Array): Uint8Array {
    const sboxInv = getSboxInv();
    const result = new Uint8Array(data.length);
    let lcgState = LCG_INIT >>> 0;

    for (let i = 0; i < data.length; i++) {
        const byte = data[i];
        // 1. ×57 mod 256 (×9 的乘法逆元: 9×57=513≡1)
        const valueE = (Math.imul(byte, MUL9_INV)) & 0xff;
        // 2. LCG keystream (与加密相同)
        lcgState = (Math.imul(lcgState, LCG_MUL) + LCG_INC) >>> 0;
        const ks = ((i & 15) ^ (lcgState >>> 16)) & 0xff;
        // 3. XOR keystream
        const valueA = (valueE ^ ks) & 0xff;
        // 4. -7 (mod 256)
        const rotated = (valueA - 7 + 256) & 0xff;
        // 5. ROR3 (循环右移 3 位)
        const lookup =
            ((rotated >>> 3) | ((rotated << 5) & 0xff)) & 0xff;
        // 6. 逆 S-box 查找
        result[i] = sboxInv[lookup];
    }

    return result;
}

// ============================================================================
// WASM 原生加解密 (WASM 加载成功时使用)
// ============================================================================

/**
 * WASM 原生加密 — 通过 WASM 导出函数 encrypt_data (func 109)。
 * 使用 create_buffer / destroy_buffer 管理内存。
 */
function encryptBufferWASM(buffer: Buffer): Buffer {
    const wasm = wasmExports!;

    // 分配 WASM 堆内存
    refreshMemory();
    const ptr = wasm.V(buffer.length);
    heapU8!.set(buffer, ptr);

    // 原地加密
    wasm.G(ptr, buffer.length);

    // 读取加密结果
    refreshMemory();
    const output = Buffer.from(heapU8!.subarray(ptr, ptr + buffer.length));

    // 释放内存
    wasm.$(ptr);

    return Buffer.from(output);
}

/**
 * WASM 原生解密 — 通过 WASM 导出函数 decrypt_data (func 115)。
 */
function decryptBufferWASM(buffer: Buffer): Buffer {
    const wasm = wasmExports!;

    refreshMemory();
    const ptr = wasm.V(buffer.length);
    heapU8!.set(buffer, ptr);

    // 原地解密
    wasm.ba(ptr, buffer.length);

    refreshMemory();
    const output = Buffer.from(heapU8!.subarray(ptr, ptr + buffer.length));

    wasm.$(ptr);

    return Buffer.from(output);
}

// ============================================================================
// 对外接口 (兼容原 crypto-wasm.ts 的导出)
// ============================================================================

/**
 * 加密缓冲区。
 *
 * - WASM 加载成功: 优先使用 WASM 原生 encrypt_data (func 109)
 * - WASM 加载失败: 自动降级为 JS 原生实现 (func 195 算法复现)
 *
 * @param buffer - 明文 Buffer
 * @returns 密文 Buffer
 */
async function encryptBuffer(buffer: Buffer): Promise<Buffer> {
    // 确保已初始化
    if (!initPromise) {
        await initWasm();
    } else {
        await initPromise;
    }

    const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    if (useWasmNative && wasmExports) {
        try {
            return encryptBufferWASM(input);
        } catch (e) {
            console.warn('[crypto-wasm] WASM 原生加密失败, 降级为 JS 实现:', e);
        }
    }

    // JS 原生实现
    return Buffer.from(encryptBufferJS(new Uint8Array(input)));
}

/**
 * 解密缓冲区。
 *
 * @param buffer - 密文 Buffer
 * @returns 明文 Buffer
 */
async function decryptBuffer(buffer: Buffer): Promise<Buffer> {
    if (!initPromise) {
        await initWasm();
    } else {
        await initPromise;
    }

    const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    if (useWasmNative && wasmExports) {
        try {
            return decryptBufferWASM(input);
        } catch (e) {
            console.warn('[crypto-wasm] WASM 原生解密失败, 降级为 JS 实现:', e);
        }
    }

    // JS 原生实现
    return Buffer.from(decryptBufferJS(new Uint8Array(input)));
}

/**
 * 同步加密 (不等待 WASM 初始化, 使用 JS 原生实现)。
 * 适用于初始化阶段已知 S-box 的场景。
 */
function encryptBufferSync(buffer: Buffer): Buffer {
    return Buffer.from(encryptBufferJS(new Uint8Array(buffer)));
}

/**
 * 同步解密 (不等待 WASM 初始化, 使用 JS 原生实现)。
 */
function decryptBufferSync(buffer: Buffer): Buffer {
    return Buffer.from(decryptBufferJS(new Uint8Array(buffer)));
}

/**
 * 获取 WASM 初始化状态。
 */
function isWasmReady(): boolean {
    return useWasmNative;
}

/**
 * 从 WASM 获取待上报的反作弊数据。
 * 需要先调用 sdkInitEx() 和 anoUserLogin()。
 */
function getDataToServer(): Buffer | null {
    if (!wasmExports || !useWasmNative) return null;

    try {
        refreshMemory();
        const lenPtr = alloc(4);
        const dataPtr = wasmExports!.N(lenPtr);
        refreshMemory();

        const view = new DataView(memory!.buffer);
        const dataLen = view.getUint32(lenPtr, true);

        if (dataPtr === 0 || dataLen <= 0) return null;

        refreshMemory();
        return Buffer.from(heapU8!.subarray(dataPtr, dataPtr + dataLen)).slice();
    } catch {
        return null;
    }
}

/**
 * 将服务端下发数据写入 WASM。
 */
function sendDataFromServer(data: Buffer): void {
    if (!wasmExports || !useWasmNative) return;

    try {
        refreshMemory();
        const ptr = alloc(data.length);
        heapU8!.set(data, ptr);
        wasmExports!.ca(ptr, data.length);
    } catch {
        // ignore
    }
}

/**
 * SDK 初始化。
 */
function sdkInitEx(gameId: number, appkey: number): void {
    if (!wasmExports || !useWasmNative) return;
    try {
        wasmExports!.x(gameId, appkey);
    } catch {
        // ignore
    }
}

/**
 * 匿名用户登录。
 */
function anoUserLogin(accountType: number, openid: string): void {
    if (!wasmExports || !useWasmNative) return;
    try {
        refreshMemory();
        const openidBytes = Buffer.from(openid, 'utf-8');
        const ptr = alloc(openidBytes.length + 1);
        heapU8!.set(openidBytes, ptr);
        heapU8![ptr + openidBytes.length] = 0;
        wasmExports!.M(accountType, ptr);
    } catch {
        // ignore
    }
}

/**
 * 生成认证 token。
 */
function generateToken(input: string): string {
    if (!wasmExports || !useWasmNative) return '';

    try {
        refreshMemory();
        const inputBytes = Buffer.from(input, 'utf-8');
        const ptr = alloc(inputBytes.length);
        heapU8!.set(inputBytes, ptr);
        const tokenPtr = wasmExports!.aa(ptr, inputBytes.length);
        refreshMemory();

        let token = '';
        for (let i = 0; i < 256; i++) {
            const b = heapU8![tokenPtr + i];
            if (b === 0) break;
            token += String.fromCharCode(b);
        }
        return token;
    } catch {
        return '';
    }
}

module.exports = {
    // 兼容原接口
    initWasm,
    encryptBuffer,

    // 新增接口
    decryptBuffer,
    encryptBufferSync,
    decryptBufferSync,
    isWasmReady,
    getDataToServer,
    sendDataFromServer,
    sdkInitEx,
    anoUserLogin,
    generateToken,
};
