/**
 * 配置备份与恢复
 * - 备份 UI 偏好类 localStorage 键（白名单）
 * - 备份当前选中账号的 settings（通过后端 /api/settings/export）
 * 不涉及任何敏感数据（token、user_info、user_permissions 等已显式排除）
 */

import api from '@/api'
import type { AxiosError } from 'axios'

export const BACKUP_VERSION = 2
export const BACKUP_KIND = 'qq-farm-bot-config'

/** 可备份的 localStorage 键白名单 */
export const BACKUP_KEYS = [
  'ui_theme',
  'ui_bottom_nav',
  'ui_bottom_nav_style',
] as const

export type BackupKey = typeof BACKUP_KEYS[number]

export interface AccountSettingsBackup {
  accountId: string | null
  exportedAt: string
  /** 来自后端 store.getConfigSnapshot() 的完整 snapshot */
  settings: Record<string, any>
}

export interface ConfigBackup {
  kind: typeof BACKUP_KIND
  version: number
  exportedAt: string
  data: Partial<Record<BackupKey, unknown>>
  /** 账号级 settings（v2 起支持，缺失时按 v1 兼容处理） */
  accountSettings?: AccountSettingsBackup
}

function isBackupKey(key: string): key is BackupKey {
  return (BACKUP_KEYS as readonly string[]).includes(key)
}

function readLocalAll(): Partial<Record<BackupKey, unknown>> {
  const out: Partial<Record<BackupKey, unknown>> = {}
  for (const key of BACKUP_KEYS) {
    const raw = localStorage.getItem(key)
    if (raw == null)
      continue
    try {
      out[key] = JSON.parse(raw)
    }
    catch {
      out[key] = raw
    }
  }
  return out
}

function writeLocalAll(data: Partial<Record<BackupKey, unknown>>) {
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

export interface BuildOptions {
  /** 当前选中的账号 id；为 null/undefined 时跳过账号级 settings */
  accountId?: string | null
  /** 跳过账号配置（仅导出 UI 偏好） */
  skipAccountSettings?: boolean
}

export interface BuildResult {
  backup: ConfigBackup
  /** 账号配置是否包含 */
  hasAccountSettings: boolean
  /** 账号配置获取失败时的错误 */
  accountError?: string
}

export async function buildBackup(options: BuildOptions = {}): Promise<BuildResult> {
  const result: BuildResult = {
    backup: {
      kind: BACKUP_KIND,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: readLocalAll(),
    },
    hasAccountSettings: false,
  }

  if (!options.skipAccountSettings && options.accountId) {
    try {
      const res = await api.get('/api/settings/export', {
        headers: { 'x-account-id': options.accountId },
      })
      if (res.data?.ok && res.data.data) {
        result.backup.accountSettings = {
          accountId: res.data.data.accountId || options.accountId,
          exportedAt: res.data.data.exportedAt || result.backup.exportedAt,
          settings: res.data.data.settings || {},
        }
        result.hasAccountSettings = true
      }
      else {
        result.accountError = res.data?.error || '后端未返回配置'
      }
    }
    catch (e) {
      const err = e as AxiosError<any>
      result.accountError = err.response?.data?.error || err.message || '网络错误'
    }
  }

  return result
}

export interface DownloadOptions extends BuildOptions {
  filename?: string
}

export async function downloadBackup(options: DownloadOptions = {}) {
  const { backup } = await buildBackup(options)
  const json = JSON.stringify(backup, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const ts = backup.exportedAt.replace(/[:.]/g, '-').slice(0, 19)
  a.href = url
  a.download = options.filename || `qq-farm-config-${ts}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return backup
}

export interface ImportResult {
  ok: boolean
  message: string
  localApplied: string[]
  localSkipped: string[]
  accountApplied: boolean
  accountError?: string
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

export interface ApplyOptions {
  /** 当前选中的账号 id；为 null/undefined 时跳过账号级导入 */
  accountId?: string | null
  /** 跳过账号级导入 */
  skipAccountSettings?: boolean
}

export async function applyBackup(backup: ConfigBackup, options: ApplyOptions = {}): Promise<ImportResult> {
  const localApplied: string[] = []
  const localSkipped: string[] = []
  for (const [key, value] of Object.entries(backup.data)) {
    if (!isBackupKey(key)) {
      localSkipped.push(key)
      continue
    }
    localApplied.push(key)
  }
  writeLocalAll(backup.data)

  let accountApplied = false
  let accountError: string | undefined
  if (!options.skipAccountSettings && backup.accountSettings && options.accountId) {
    try {
      const res = await api.post('/api/settings/import',
        { settings: backup.accountSettings.settings },
        { headers: { 'x-account-id': options.accountId } },
      )
      if (res.data?.ok) {
        accountApplied = true
      }
      else {
        accountError = res.data?.error || '后端未确认'
      }
    }
    catch (e) {
      const err = e as AxiosError<any>
      accountError = err.response?.data?.error || err.message || '网络错误'
    }
  }
  else if (backup.accountSettings && !options.accountId) {
    accountError = '未选择账号，已跳过账号级配置'
  }

  const localMsg = `本地 ${localApplied.length} 项${localSkipped.length ? `（跳过 ${localSkipped.length} 项未知）` : ''}`
  const accountMsg = accountApplied
    ? '；账号配置已写入'
    : (accountError ? `；账号配置未应用：${accountError}` : '')

  return {
    ok: true,
    message: localMsg + accountMsg,
    localApplied,
    localSkipped,
    accountApplied,
    accountError,
  }
}

export interface ResetOptions {
  accountId?: string | null
  /** 是否同时清空当前账号的 settings（恢复默认） */
  resetAccountSettings?: boolean
}

export interface ResetResult {
  localRemoved: string[]
  accountReset: boolean
  accountError?: string
}

export async function resetToDefaults(options: ResetOptions = {}): Promise<ResetResult> {
  const localRemoved: string[] = []
  for (const key of BACKUP_KEYS) {
    if (localStorage.getItem(key) != null) {
      localStorage.removeItem(key)
      localRemoved.push(key)
    }
  }

  let accountReset = false
  let accountError: string | undefined
  if (options.resetAccountSettings !== false && options.accountId) {
    try {
      const res = await api.get('/api/settings/default')
      if (res.data?.ok && res.data.data) {
        const importRes = await api.post('/api/settings/import',
          { settings: res.data.data },
          { headers: { 'x-account-id': options.accountId } },
        )
        accountReset = !!importRes.data?.ok
        if (!accountReset) {
          accountError = importRes.data?.error || '后端未确认'
        }
      }
      else {
        accountError = res.data?.error || '无法获取默认配置'
      }
    }
    catch (e) {
      const err = e as AxiosError<any>
      accountError = err.response?.data?.error || err.message || '网络错误'
    }
  }

  return { localRemoved, accountReset, accountError }
}
