import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export interface BlacklistItem {
  gid: number
  name: string
  avatarUrl: string
}

export interface KnownFriendSettings {
  knownFriendGids: number[]
  knownFriendGidSyncCooldownSec: number
  friendsListCacheTtlSec: number
}

export interface FriendApplication {
  gid: number
  name: string
  avatarUrl: string
  level: number
  timeAt: number
  openId: string
}

export const useFriendStore = defineStore('friend', () => {
  const friends = ref<any[]>([])
  const loading = ref(false)
  const friendLands = ref<Record<string, any[]>>({})
  const friendLandsLoading = ref<Record<string, boolean>>({})
  const blacklist = ref<BlacklistItem[]>([])
  const guardDogFriends = ref<BlacklistItem[]>([])
  const guardDogBlacklist = ref<BlacklistItem[]>([])
  const guardDogWhitelist = ref<BlacklistItem[]>([])
  const interactRecords = ref<any[]>([])
  const interactLoading = ref(false)
  const interactError = ref('')

  const knownFriendGids = ref<number[]>([])
  const knownFriendGidSyncCooldownSec = ref(600)
  const friendsListCacheTtlSec = ref(60)
  const knownFriendSettingsLoading = ref(false)
  const knownFriendSettingsSaving = ref(false)

  const applications = ref<FriendApplication[]>([])
  const applicationsLoading = ref(false)
  const applicationsError = ref('')
  const blockApplications = ref(false)
  const applicationActionLoading = ref(false)

  function buildPlantSummaryFromDetail(lands: any[], summary: any) {
    let stealNum = 0
    let dryNum = 0
    let weedNum = 0
    let insectNum = 0

    const detailLands = Array.isArray(lands) ? lands : []
    if (detailLands.length > 0) {
      for (const land of detailLands) {
        if (!land || !land.unlocked)
          continue
        if (land.status === 'stealable')
          stealNum++
        if (land.needWater)
          dryNum++
        if (land.needWeed)
          weedNum++
        if (land.needBug)
          insectNum++
      }
    }
    else {
      stealNum = Array.isArray(summary?.stealable) ? summary.stealable.length : 0
      dryNum = Array.isArray(summary?.needWater) ? summary.needWater.length : 0
      weedNum = Array.isArray(summary?.needWeed) ? summary.needWeed.length : 0
      insectNum = Array.isArray(summary?.needBug) ? summary.needBug.length : 0
    }

    return {
      stealNum: Number(stealNum) || 0,
      dryNum: Number(dryNum) || 0,
      weedNum: Number(weedNum) || 0,
      insectNum: Number(insectNum) || 0,
    }
  }

  function syncFriendPlantSummary(friendId: string, lands: any[], summary: any) {
    const key = String(friendId)
    const idx = friends.value.findIndex(f => String(f?.gid || '') === key)
    if (idx < 0)
      return

    const nextPlant = buildPlantSummaryFromDetail(lands, summary)
    friends.value[idx] = {
      ...friends.value[idx],
      plant: nextPlant,
    }
  }

  async function fetchFriends(accountId: string, forceSync = false) {
    if (!accountId)
      return
    loading.value = true
    try {
      const res = await api.get('/api/friends', {
        headers: { 'x-account-id': accountId },
        params: forceSync ? { forceSync: 'true' } : {},
      })
      if (res.data.ok) {
        friends.value = res.data.data || []
      }
    }
    finally {
      loading.value = false
    }
  }
  async function fetchInteractRecords(accountId: string) {
    if (!accountId)
      return
    interactLoading.value = true
    interactError.value = ''
    interactRecords.value = []

    try {
      const res = await api.get('/api/interact-records', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        interactRecords.value = Array.isArray(res.data.data) ? res.data.data : []
      }
      else {
        interactError.value = res.data.error || '加载访客记录失败'
      }
    }
    catch (error: any) {
      interactError.value = error?.response?.data?.error || error?.message || '加载访客记录失败'
    }
    finally {
      interactLoading.value = false
    }
  }

  async function fetchBlacklist(accountId: string) {
    if (!accountId)
      return
    try {
      const res = await api.get('/api/friend-blacklist', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        blacklist.value = res.data.data || []
      }
    }
    catch { /* ignore */ }
  }

  async function toggleBlacklist(accountId: string, gid: number) {
    if (!accountId || !gid)
      return
    const res = await api.post('/api/friend-blacklist/toggle', { gid }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      blacklist.value = res.data.data || []
    }
  }

  async function batchAddBlacklist(accountId: string, gids: number[]) {
    if (!accountId || !gids || gids.length === 0)
      return { ok: false, count: 0 }
    try {
      const res = await api.post('/api/friend-blacklist/batch-add', { gids }, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        blacklist.value = res.data.data || []
      }
      return { ok: res.data.ok, count: (res.data.data || []).length }
    }
    catch (e: any) {
      return { ok: false, count: 0, error: e?.response?.data?.error || e?.message || '批量拉黑失败' }
    }
  }

  async function batchRemoveBlacklist(accountId: string, gids: number[]) {
    if (!accountId || !gids || gids.length === 0)
      return { ok: false, count: 0 }
    try {
      const res = await api.post('/api/friend-blacklist/batch-remove', { gids }, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        blacklist.value = res.data.data || []
      }
      return { ok: res.data.ok, count: (res.data.data || []).length }
    }
    catch (e: any) {
      return { ok: false, count: 0, error: e?.response?.data?.error || e?.message || '批量拉白失败' }
    }
  }

  async function fetchGuardDogFriends(accountId: string) {
    if (!accountId)
      return
    try {
      const res = await api.get('/api/friend-guard-dog-gids', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        guardDogFriends.value = res.data.data || []
      }
    }
    catch { /* ignore */ }
  }

  async function addGuardDogFriend(accountId: string, gid: number) {
    if (!accountId || !gid)
      return
    const res = await api.post('/api/friend-guard-dog-gids/add', { gid }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      guardDogFriends.value = res.data.data || []
    }
  }

  async function removeGuardDogFriend(accountId: string, gid: number) {
    if (!accountId || !gid)
      return
    const res = await api.post('/api/friend-guard-dog-gids/remove', { gid }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      guardDogFriends.value = res.data.data || []
    }
  }

  async function clearGuardDogFriends(accountId: string) {
    if (!accountId)
      return
    const res = await api.post('/api/friend-guard-dog-gids/clear', {}, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      guardDogFriends.value = []
    }
  }

  async function batchAddGuardDogFriends(accountId: string, gids: number[]) {
    if (!accountId || !gids || gids.length === 0)
      return
    const res = await api.post('/api/friend-guard-dog-gids/batch-add', { gids }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      guardDogFriends.value = res.data.data || []
    }
  }

  // ============ 护主犬帮忙黑/白名单 ============

  async function fetchGuardDogBlacklist(accountId: string) {
    if (!accountId)
      return
    try {
      const res = await api.get('/api/friend-guard-dog-blacklist', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        guardDogBlacklist.value = res.data.data || []
      }
    }
    catch { /* ignore */ }
  }

  async function toggleGuardDogBlacklist(accountId: string, gid: number) {
    if (!accountId || !gid)
      return
    const res = await api.post('/api/friend-guard-dog-blacklist/toggle', { gid }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      guardDogBlacklist.value = res.data.data || []
    }
  }

  async function batchAddGuardDogBlacklist(accountId: string, gids: number[]) {
    if (!accountId || !gids || gids.length === 0)
      return
    const res = await api.post('/api/friend-guard-dog-blacklist/batch-add', { gids }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      guardDogBlacklist.value = res.data.data || []
    }
  }

  async function batchRemoveGuardDogBlacklist(accountId: string, gids: number[]) {
    if (!accountId || !gids || gids.length === 0)
      return
    const res = await api.post('/api/friend-guard-dog-blacklist/batch-remove', { gids }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      guardDogBlacklist.value = res.data.data || []
    }
  }

  async function clearGuardDogBlacklist(accountId: string) {
    if (!accountId)
      return
    const res = await api.post('/api/friend-guard-dog-blacklist/clear', {}, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      guardDogBlacklist.value = []
    }
  }

  async function fetchGuardDogWhitelist(accountId: string) {
    if (!accountId)
      return
    try {
      const res = await api.get('/api/friend-guard-dog-whitelist', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        guardDogWhitelist.value = res.data.data || []
      }
    }
    catch { /* ignore */ }
  }

  async function toggleGuardDogWhitelist(accountId: string, gid: number) {
    if (!accountId || !gid)
      return
    const res = await api.post('/api/friend-guard-dog-whitelist/toggle', { gid }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      guardDogWhitelist.value = res.data.data || []
    }
  }

  async function batchAddGuardDogWhitelist(accountId: string, gids: number[]) {
    if (!accountId || !gids || gids.length === 0)
      return
    const res = await api.post('/api/friend-guard-dog-whitelist/batch-add', { gids }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      guardDogWhitelist.value = res.data.data || []
    }
  }

  async function batchRemoveGuardDogWhitelist(accountId: string, gids: number[]) {
    if (!accountId || !gids || gids.length === 0)
      return
    const res = await api.post('/api/friend-guard-dog-whitelist/batch-remove', { gids }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      guardDogWhitelist.value = res.data.data || []
    }
  }

  async function clearGuardDogWhitelist(accountId: string) {
    if (!accountId)
      return
    const res = await api.post('/api/friend-guard-dog-whitelist/clear', {}, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      guardDogWhitelist.value = []
    }
  }

  // ============ 护主犬扫描全局状态（脱离组件生命周期）============
  const scanningGuardDogAccountId = ref<string | null>(null)
  const scanGuardDogResult = ref<null | {
    accountId: string
    scanned: number
    guardDogCount: number
    newGids: number[]
    errorCount: number
    durationMs: number
    finishedAt: number
  }>(null)
  const scanGuardDogProgress = ref<null | {
    accountId: string
    status: 'running' | 'done' | 'error' | string
    index: number
    total: number
    friendName: string
    friendGid: number
    scanStatus: string
    message: string
    updatedAt: number
  }>(null)
  const scanGuardDogPollHandle = ref<number | null>(null)
  const scanGuardDogLastFetchAt = ref(0)

  function startScanStatusPoll(accountId: string) {
    stopScanStatusPoll()
    if (!accountId)
      return
    // 立即拉一次，再每 1s 拉一次
    void fetchScanStatus(accountId)
    scanGuardDogPollHandle.value = window.setInterval(() => {
      void fetchScanStatus(accountId)
    }, 1000)
  }

  function stopScanStatusPoll() {
    if (scanGuardDogPollHandle.value) {
      window.clearInterval(scanGuardDogPollHandle.value)
      scanGuardDogPollHandle.value = null
    }
  }

  async function fetchScanStatus(accountId: string) {
    if (!accountId)
      return null
    try {
      const res = await api.get('/api/friend-guard-dog-gids/scan-status', {
        headers: { 'x-account-id': accountId },
      })
      scanGuardDogLastFetchAt.value = Date.now()
      if (res.data && res.data.ok) {
        const status = res.data.data
        if (status) {
          // 只显示当前账号的进度
          scanGuardDogProgress.value = { accountId, ...status }
          // done / error / interrupted 都是终态：
          //   - done/error：正常结束
          //   - interrupted：被 worker 重启（应用宝自动重连等）打断
          if (status.status === 'done' || status.status === 'error' || status.status === 'interrupted') {
            if (status.result) {
              scanGuardDogResult.value = { accountId, ...status.result, finishedAt: Date.now() }
            }
            // 扫描已结束，停止轮询
            stopScanStatusPoll()
            scanningGuardDogAccountId.value = null
          }
        }
        else {
          // 后端没有进度记录 → 扫描不在进行中
          if (scanningGuardDogAccountId.value === accountId) {
            scanningGuardDogAccountId.value = null
          }
          stopScanStatusPoll()
        }
      }
      return res.data
    }
    catch { /* ignore */ }
    return null
  }

  async function clearScanResult() {
    scanningGuardDogAccountId.value = null
    scanGuardDogResult.value = null
    scanGuardDogProgress.value = null
    stopScanStatusPoll()
  }

  async function scanGuardDogFriends(accountId: string, options: Record<string, any> = {}) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    // 取消之前的轮询（如果存在）
    stopScanStatusPoll()
    scanningGuardDogAccountId.value = accountId
    scanGuardDogResult.value = null
    scanGuardDogProgress.value = { accountId, status: 'running', index: 0, total: 0, friendName: '', friendGid: 0, scanStatus: '', message: '', updatedAt: Date.now() }
    // 启动轮询（与本次 await 无关，能跨组件生命周期继续）
    startScanStatusPoll(accountId)
    try {
      const res = await api.post('/api/friend-guard-dog-gids/scan', options, {
        headers: { 'x-account-id': accountId },
        timeout: 150000,
      })
      if (res.data.ok) {
        guardDogFriends.value = res.data.data || []
        scanGuardDogResult.value = {
          accountId,
          ...(res.data.scan || { scanned: 0, guardDogCount: 0, newGids: [], errorCount: 0, durationMs: 0 }),
          finishedAt: Date.now(),
        }
        scanGuardDogProgress.value = { accountId, status: 'done', index: scanGuardDogProgress.value?.total || 0, total: scanGuardDogProgress.value?.total || 0, friendName: '', friendGid: 0, scanStatus: '', message: '', updatedAt: Date.now() }
      }
      return { ok: res.data.ok, scan: res.data.scan, data: res.data.data }
    }
    catch (e: any) {
      return { ok: false, error: e?.response?.data?.error || e?.message || '扫描失败' }
    }
    finally {
      // 终态：清理轮询（如果还活着）；scanningGuardDogAccountId 由 fetchScanStatus 在看到 done/error 时清掉，
      // 这里兜底如果整段 await 提前结束则也清掉
      setTimeout(() => {
        if (scanningGuardDogAccountId.value === accountId) {
          scanningGuardDogAccountId.value = null
        }
        stopScanStatusPoll()
      }, 500)
    }
  }

  async function fetchFriendLands(accountId: string, friendId: string) {
    if (!accountId || !friendId)
      return
    friendLandsLoading.value[friendId] = true
    try {
      const res = await api.get(`/api/friend/${friendId}/lands`, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        const lands = res.data.data.lands || []
        const summary = res.data.data.summary || null
        friendLands.value[friendId] = lands
        syncFriendPlantSummary(friendId, lands, summary)
      }
    }
    finally {
      friendLandsLoading.value[friendId] = false
    }
  }

  async function operate(accountId: string, friendId: string, opType: string) {
    if (!accountId || !friendId)
      return { ok: false, message: '参数无效' }
    try {
      const res = await api.post(`/api/friend/${friendId}/op`, { opType }, {
        headers: { 'x-account-id': accountId },
      })
      const result = res.data?.data || res.data || {}
      await fetchFriends(accountId)
      if (friendLands.value[friendId]) {
        await fetchFriendLands(accountId, friendId)
      }
      return result
    }
    catch (e: any) {
      return { ok: false, message: e?.response?.data?.error || e?.message || '操作失败' }
    }
  }

  function applyKnownFriendSettings(data: KnownFriendSettings | null | undefined) {
    if (!data)
      return
    knownFriendGids.value = Array.isArray(data.knownFriendGids) ? data.knownFriendGids : []
    knownFriendGidSyncCooldownSec.value = Number.isFinite(data.knownFriendGidSyncCooldownSec)
      ? Math.max(30, Math.min(86400, data.knownFriendGidSyncCooldownSec))
      : 600
    friendsListCacheTtlSec.value = Number.isFinite(data.friendsListCacheTtlSec)
      ? Math.max(10, Math.min(86400, data.friendsListCacheTtlSec))
      : 60
  }

  async function fetchKnownFriendSettings(accountId: string) {
    if (!accountId)
      return
    knownFriendSettingsLoading.value = true
    try {
      const res = await api.get('/api/friend-known-gids', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        applyKnownFriendSettings(res.data.data)
      }
    }
    finally {
      knownFriendSettingsLoading.value = false
    }
  }

  async function saveKnownFriendSettings(accountId: string, payload: Partial<KnownFriendSettings>) {
    if (!accountId)
      return
    knownFriendSettingsSaving.value = true
    try {
      const res = await api.post('/api/friend-known-gids', payload, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        applyKnownFriendSettings(res.data.data)
      }
    }
    finally {
      knownFriendSettingsSaving.value = false
    }
  }

  async function removeKnownFriendGid(accountId: string, gid: number) {
    if (!accountId || !gid)
      return
    knownFriendSettingsSaving.value = true
    try {
      const res = await api.post('/api/friend-known-gids/remove', { gid }, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        applyKnownFriendSettings(res.data.data)
      }
    }
    finally {
      knownFriendSettingsSaving.value = false
    }
  }

  async function batchAddKnownFriendGids(accountId: string, gids: number[]) {
    if (!accountId || !gids || gids.length === 0)
      return { ok: false, addedCount: 0 }
    knownFriendSettingsSaving.value = true
    try {
      const res = await api.post('/api/friend-known-gids/batch-add', { gids }, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        applyKnownFriendSettings(res.data.data)
      }
      return { ok: res.data.ok, addedCount: res.data.addedCount || 0 }
    }
    finally {
      knownFriendSettingsSaving.value = false
    }
  }

  async function removeUnsyncedKnownFriendGids(accountId: string, gids: number[]) {
    if (!accountId || !gids || gids.length === 0)
      return { ok: false, removedCount: 0 }
    knownFriendSettingsSaving.value = true
    try {
      const res = await api.post('/api/friend-known-gids/batch-remove', { gids }, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        applyKnownFriendSettings(res.data.data)
      }
      return { ok: res.data.ok, removedCount: res.data.removedCount || 0 }
    }
    finally {
      knownFriendSettingsSaving.value = false
    }
  }

  async function fetchApplications(accountId: string) {
    if (!accountId)
      return
    applicationsLoading.value = true
    applicationsError.value = ''
    try {
      const res = await api.get('/api/friend-applications', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        const data = res.data.data || {}
        applications.value = Array.isArray(data.applications) ? data.applications : []
        blockApplications.value = !!data.blockApplications
      }
      else {
        applicationsError.value = res.data.error || '加载好友申请失败'
        applications.value = []
      }
    }
    catch (e: any) {
      applicationsError.value = e?.response?.data?.error || e?.message || '加载好友申请失败'
      applications.value = []
    }
    finally {
      applicationsLoading.value = false
    }
  }

  async function acceptApplications(accountId: string, gids: number[]) {
    if (!accountId || !gids || gids.length === 0)
      return { ok: false, message: '参数无效' }
    applicationActionLoading.value = true
    try {
      const res = await api.post('/api/friend-applications/accept', { gids }, {
        headers: { 'x-account-id': accountId },
      })
      const data = res.data?.data || {}
      if (res.data.ok) {
        // 从列表中移除已处理的申请
        const processedSet = new Set(gids.map(Number))
        applications.value = applications.value.filter(app => !processedSet.has(Number(app.gid)))
      }
      return {
        ok: !!res.data.ok,
        message: data.message || (res.data.ok ? '已同意好友申请' : '操作失败'),
        accepted: data.accepted || 0,
      }
    }
    catch (e: any) {
      return { ok: false, message: e?.response?.data?.error || e?.message || '同意好友申请失败' }
    }
    finally {
      applicationActionLoading.value = false
    }
  }

  async function rejectApplications(accountId: string, gids: number[]) {
    if (!accountId || !gids || gids.length === 0)
      return { ok: false, message: '参数无效' }
    applicationActionLoading.value = true
    try {
      const res = await api.post('/api/friend-applications/reject', { gids }, {
        headers: { 'x-account-id': accountId },
      })
      const data = res.data?.data || {}
      if (res.data.ok) {
        // 从列表中移除已处理的申请
        const processedSet = new Set(gids.map(Number))
        applications.value = applications.value.filter(app => !processedSet.has(Number(app.gid)))
      }
      return {
        ok: !!res.data.ok,
        message: data.message || (res.data.ok ? '已拒绝好友申请' : '操作失败'),
        rejected: data.rejected || 0,
      }
    }
    catch (e: any) {
      return { ok: false, message: e?.response?.data?.error || e?.message || '拒绝好友申请失败' }
    }
    finally {
      applicationActionLoading.value = false
    }
  }

  return {
    friends,
    loading,
    friendLands,
    friendLandsLoading,
    blacklist,
    guardDogFriends,
    guardDogBlacklist,
    guardDogWhitelist,
    scanningGuardDogAccountId,
    scanGuardDogResult,
    scanGuardDogProgress,
    scanGuardDogLastFetchAt,
    interactRecords,
    interactLoading,
    interactError,
    knownFriendGids,
    knownFriendGidSyncCooldownSec,
    friendsListCacheTtlSec,
    knownFriendSettingsLoading,
    knownFriendSettingsSaving,
    applications,
    applicationsLoading,
    applicationsError,
    blockApplications,
    applicationActionLoading,
    fetchFriends,
    fetchBlacklist,
    toggleBlacklist,
    batchAddBlacklist,
    batchRemoveBlacklist,
    fetchGuardDogFriends,
    addGuardDogFriend,
    removeGuardDogFriend,
    clearGuardDogFriends,
    batchAddGuardDogFriends,
    fetchGuardDogBlacklist,
    toggleGuardDogBlacklist,
    batchAddGuardDogBlacklist,
    batchRemoveGuardDogBlacklist,
    clearGuardDogBlacklist,
    fetchGuardDogWhitelist,
    toggleGuardDogWhitelist,
    batchAddGuardDogWhitelist,
    batchRemoveGuardDogWhitelist,
    clearGuardDogWhitelist,
    scanGuardDogFriends,
    fetchScanStatus,
    startScanStatusPoll,
    stopScanStatusPoll,
    clearScanResult,
    fetchInteractRecords,
    fetchFriendLands,
    operate,
    fetchKnownFriendSettings,
    saveKnownFriendSettings,
    removeKnownFriendGid,
    batchAddKnownFriendGids,
    removeUnsyncedKnownFriendGids,
    fetchApplications,
    acceptApplications,
    rejectApplications,
  }
})
