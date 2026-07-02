import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

/**
 * 版本更新弹窗（changelog）的全局状态
 *
 * - `showModal`     是否显示弹窗
 * - `open()` / `close()`  手动打开 / 关闭
 * - `checkForNewVersion()` 首次访问时若发现新版本，自动弹一次
 *
 * 触发条件优先用 `updatedAt`（每次保存都会刷新），旧数据 fallback 到 `version`。
 * - `lastSeenUpdatedAt` 持久化在 `changelog:last_seen_updatedAt`
 * - `lastSeenVersion`   持久化在 `changelog:last_seen_version`（兼容旧版）
 *
 * 关闭弹窗时通过 `markSeen(version, updatedAt)` 同步写入。
 */
export const useChangelogStore = defineStore('changelog', () => {
  const showModal = ref(false)
  const lastSeenVersion = useStorage<string>('changelog:last_seen_version', '')
  const lastSeenUpdatedAt = useStorage<string>('changelog:last_seen_updatedAt', '')

  function open() {
    showModal.value = true
  }

  function close() {
    showModal.value = false
  }

  /**
   * 标记当前版本为已读
   * 由 ChangelogModal 在关闭时调用，确保自动弹窗只会出现一次
   * 接受 version 和 updatedAt 两个参数,任一变化都记录
   */
  function markSeen(version?: string, updatedAt?: string) {
    if (version)
      lastSeenVersion.value = version
    if (updatedAt)
      lastSeenUpdatedAt.value = updatedAt
  }

  /**
   * 检查是否有新版本,若有则自动打开弹窗
   * - 拉取失败时静默不弹
   * - 优先比较 updatedAt(每次保存都会变),fallback 到 version
   * - 首次访问(lastSeen 都为空)时弹一次
   */
  async function checkForNewVersion() {
    try {
      const res = await api.get('/api/changelog', { skipErrorToast: true } as any)
      const data = res.data?.data
      if (!data)
        return
      const updatedAt = String(data.updatedAt || '')
      const version = String(data.version || '')
      if (!updatedAt && !version)
        return

      // 首次访问,弹一次
      if (!lastSeenUpdatedAt.value && !lastSeenVersion.value) {
        if (updatedAt) lastSeenUpdatedAt.value = updatedAt
        if (version) lastSeenVersion.value = version
        showModal.value = true
        return
      }

      // 优先比较 updatedAt(任何保存都会刷新时间戳)
      if (updatedAt && updatedAt !== lastSeenUpdatedAt.value) {
        showModal.value = true
        return
      }

      // fallback:比较 version(旧数据兼容)
      if (version && version !== lastSeenVersion.value) {
        showModal.value = true
      }
    }
    catch {
      // 静默失败
    }
  }

  return {
    showModal,
    lastSeenVersion,
    lastSeenUpdatedAt,
    open,
    close,
    markSeen,
    checkForNewVersion,
  }
})
