export {};
/**
 * ace.ts — ACE 反作弊通讯服务 (增强版)
 *
 * 基于 QQ农场 ACE 逆向分析:
 *   - 每 5 秒心跳上报反作弊数据 (gamepb.acepb.AceService / AntiData)
 *   - 支持从 WASM 获取真实反作弊数据 (getDataToServer)
 *   - 支持处理服务端下发的指令 (sendDataFromServer)
 *   - protobuf 编解码 (gatepb.Message / acepb.AntiDataRequest)
 *
 * 兼容原接口:
 *   startAntiDataLoop() → void
 *   stopAntiDataLoop()  → void
 *   sendAntiData()      → Promise<void>
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const cryptoWasm = require('../utils/crypto-wasm');

// ============================================================================
// 常量
// ============================================================================

/** 心跳间隔 (毫秒) */
const ANTI_DATA_INTERVAL = 5000;

/** QQ农场 ACE 游戏 ID */
const ACE_GAME_ID = 3167;

// ============================================================================
// 内部状态
// ============================================================================

let antiDataTimer: ReturnType<typeof setInterval> | null = null;
let aceInitialized = false;
let sdkInitialized = false;
let tokenCache = '';

// ============================================================================
// Protobuf 编码工具 (acepb.AntiDataRequest 手动编码, 确保正确性)
// ============================================================================

/**
 * 编码 varint (LEB128)。
 */
function encodeVarint(value: number): number[] {
    const bytes: number[] = [];
    let val = value >>> 0;
    do {
        let b = val & 0x7f;
        val = val >>> 7;
        if (val > 0) b |= 0x80;
        bytes.push(b);
    } while (val > 0);
    return bytes;
}

/**
 * 编码 length-delimited 字段。
 * 格式: tag(field_num<<3 | 2) + varint(len) + data
 */
function encodeLengthDelimited(fieldNumber: number, data: Uint8Array | string): number[] {
    const bytes = typeof data === 'string'
        ? Buffer.from(data, 'utf-8')
        : data;
    const tag = encodeVarint((fieldNumber << 3) | 2);
    const len = encodeVarint(bytes.length);
    return [...tag, ...len, ...Array.from(bytes)];
}

// ============================================================================
// WASM SDK 初始化
// ============================================================================

/**
 * 初始化 ACE SDK。
 * 在 startAntiDataLoop 之前调用 (可选, 有 WASM 时自动尝试初始化)。
 *
 * @param openid - 用户 openid (匿名登录)
 */
async function initAceSdk(openid?: string): Promise<void> {
    if (aceInitialized) return;

    try {
        // 确保 WASM 已初始化
        await cryptoWasm.initWasm();

        if (cryptoWasm.isWasmReady()) {
            // SDK 初始化: SdkInitEx(gameId, appkey)
            cryptoWasm.sdkInitEx(ACE_GAME_ID, 0);

            // 匿名用户登录
            if (openid) {
                cryptoWasm.anoUserLogin(0, openid);
            }

            sdkInitialized = true;
        }
    } catch {
        // 初始化失败不影响主流程, 使用 JS 降级模式
    }

    aceInitialized = true;
}

// ============================================================================
// 数据上报
// ============================================================================

/**
 * 发送一次 AntiData 心跳。
 *
 * 优先从 WASM 获取真实反作弊数据 (getDataToServer)。
 * 如果 WASM 不可用, 发送模拟数据 (空数据, 与原实现兼容)。
 */
async function sendAntiData(): Promise<void> {
    try {
        // 尝试从 WASM 获取真实反作弊数据
        let rawData: Buffer | null = null;
        if (cryptoWasm.isWasmReady() && sdkInitialized) {
            rawData = cryptoWasm.getDataToServer();
        }

        if (rawData && rawData.length > 0) {
            // 使用 WASM 真实数据: 编码为 AntiDataRequest protobuf
            // AntiDataRequest { bytes data = 1; }
            // → 0x0a <varint_len> <data...>
            const antiDataBytes = Buffer.from(encodeLengthDelimited(1, rawData));

            await sendMsgAsync('gamepb.acepb.AceService', 'AntiData', antiDataBytes, 5000);
        } else {
            // 降级: 发送空数据 (兼容原实现, 不影响主流程)
            const body: Uint8Array = types.AntiDataRequest.encode(
                types.AntiDataRequest.create({
                    data: Buffer.alloc(0),
                })
            ).finish();
            await sendMsgAsync('gamepb.acepb.AceService', 'AntiData', body, 5000);
        }
    } catch {
        // 静默失败，不影响主流程
    }
}

/**
 * 处理服务端下发的 AntiDataReply。
 * 将服务端指令数据写回 WASM (sendDataFromServer)。
 *
 * @param replyBody - AntiDataReply 的 body 字段 (解密后的 protobuf)
 */
function handleAntiDataReply(replyBody: Buffer): void {
    try {
        if (!cryptoWasm.isWasmReady() || !sdkInitialized) return;

        // 解析 AntiDataReply { bytes data = 1; }
        // 简单解析: 跳过 tag(0x0a) + varint(len), 读取 data
        const data = extractField1(replyBody);
        if (data && data.length > 0) {
            cryptoWasm.sendDataFromServer(data);
        }
    } catch {
        // ignore
    }
}

/**
 * 从 protobuf 数据中提取 field 1 (length-delimited)。
 * 简单解析, 不依赖 protobufjs。
 */
function extractField1(data: Buffer): Buffer | null {
    try {
        let pos = 0;
        // 读取 tag
        const tag = data[pos];
        pos++;
        const fieldNum = tag >> 3;
        const wireType = tag & 0x07;

        if (fieldNum !== 1 || wireType !== 2) return null;

        // 读取 varint length
        let len = 0;
        let shift = 0;
        while (pos < data.length) {
            const b = data[pos];
            pos++;
            len |= (b & 0x7f) << shift;
            shift += 7;
            if ((b & 0x80) === 0) break;
        }

        if (pos + len > data.length) return null;
        return data.subarray(pos, pos + len);
    } catch {
        return null;
    }
}

// ============================================================================
// 心跳控制
// ============================================================================

/**
 * 启动反作弊心跳循环。
 *
 * 每 5 秒调用一次 sendAntiData() 上报反作弊数据。
 * 启动时立即发送一次。
 *
 * @param openid - 用户 openid (可选, 用于 WASM SDK 初始化)
 */
function startAntiDataLoop(openid?: string): void {
    stopAntiDataLoop();

    // 尝试初始化 ACE SDK (异步, 不阻塞心跳启动)
    if (!aceInitialized) {
        initAceSdk(openid).catch(() => {});
    }

    antiDataTimer = setInterval(() => {
        sendAntiData();
    }, ANTI_DATA_INTERVAL);

    // 启动时立即发一次
    sendAntiData();
}

/**
 * 停止反作弊心跳循环。
 */
function stopAntiDataLoop(): void {
    if (antiDataTimer) {
        clearInterval(antiDataTimer);
        antiDataTimer = null;
    }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取 ACE 初始化状态。
 */
function isAceInitialized(): boolean {
    return aceInitialized;
}

/**
 * 获取 WASM SDK 初始化状态。
 */
function isSdkInitialized(): boolean {
    return sdkInitialized;
}

module.exports = {
    // 兼容原接口
    sendAntiData,
    startAntiDataLoop,
    stopAntiDataLoop,

    // 新增接口
    initAceSdk,
    handleAntiDataReply,
    isAceInitialized,
    isSdkInitialized,
};
