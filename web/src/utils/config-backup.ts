/**
 * 配置备份与恢复
 * 仅备份 UI 偏好类 localStorage 键，不涉及任何敏感数据
 * （token、user_info、user_permissions 等已显式排除）
 */

export const BACKUP_VERSION = 1
export const BACKUP_KIND = 'qq-farm-bot-config'

/** 可备份的 localStorage 键白名单 */
export const BACKUP_KEYS = [
  'ui_theme',
  'ui_bottom_nav',
  'ui_bottom_nav_style',
] as const

export type BackupKey = typeof BACKUP_KEYS[number]

export interface ConfigBackup {
  kind: typeof BACKUP_KIND
  version: number
  exportedAt: string
  data: Partial<Record<BackupKey, unknown>>
}

function isBackupKey(key: string): key is BackupKey {
  return (BACKUP_KEYS as readonly string[]).includes(key)
}

function readAll(): Partial<Record<BackupKey, unknown>> {
  const out: Partial<Record<BackupKey, unknown>> = {}
  for (const key of BACKUP_KEYS) {
    const raw = localStorage.getItem(key)
    if (raw == null)
      continue
    try {
      out[key] = JSON.parse(raw)
    }
    catch {
      // 非 JSON 字符串（理论上不会出现），原样保存
      out[key] = raw
    }
  }
  return out
}

function writeAll(data: Partial<Record<BackupKey, unknown>>) {
  for (const [key, value] of Object.entries(data)) {
    if (!isBackupKey(key))
      continue
    if (value == null) {
      localStorage.removeItem(key)
      continue
    }
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
    }
    catch {
      // 单个 key 写入失败不影响其他 key
    }
  }
}

export function buildBackup(): ConfigBackup {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: readAll(),
  }
}

export function downloadBackup(filename?: string) {
  const backup = buildBackup()
  const json = JSON.stringify(backup, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const ts = backup.exportedAt.replace(/[:.]/g, '-').slice(0, 19)
  a.href = url
  a.download = filename || `qq-farm-config-${ts}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export interface ImportResult {
  ok: boolean
  message: string
  applied: string[]
  skipped: string[]
}

export function parseBackup(text: string): { ok: true, backup: ConfigBackup } | { ok: false, error: string } {
  let parsed: any
  try {
    parsed = JSON.parse(text)
  }
  catch {
    return { ok: false, error: '文件不是有效的 JSON' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: '文件格式错误' }
  }
  if (parsed.kind !== BACKUP_KIND) {
    return { ok: false, error: '不是 QQ 农场助手的配置文件' }
  }
  if (typeof parsed.version !== 'number' || parsed.version > BACKUP_VERSION) {
    return { ok: false, error: `备份版本过高（v${parsed.version}），请更新面板后再导入` }
  }
  if (!parsed.data || typeof parsed.data !== 'object') {
    return { ok: false, error: '备份数据缺失' }
  }
  return { ok: true, backup: parsed as ConfigBackup }
}

export function applyBackup(backup: ConfigBackup): ImportResult {
  const applied: string[] = []
  const skipped: string[] = []
  for (const [key, value] of Object.entries(backup.data)) {
    if (!isBackupKey(key)) {
      skipped.push(key)
      continue
    }
    applied.push(key)
  }
  writeAll(backup.data)
  return {
    ok: true,
    message: `已应用 ${applied.length} 项配置${skipped.length ? `，跳过 ${skipped.length} 项未知项` : ''}`,
    applied,
    skipped,
  }
}

export function resetToDefaults(): string[] {
  const removed: string[] = []
  for (const key of BACKUP_KEYS) {
    if (localStorage.getItem(key) != null) {
      localStorage.removeItem(key)
      removed.push(key)
    }
  }
  return removed
}
