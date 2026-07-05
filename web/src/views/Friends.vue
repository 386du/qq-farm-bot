<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import LandCard from '@/components/LandCard.vue'
import { useAccountStore } from '@/stores/account'
import { useFriendStore } from '@/stores/friend'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const friendStore = useFriendStore()
const statusStore = useStatusStore()
const toast = useToastStore()
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const {
  friends,
  loading,
  friendsLoaded,
  friendLands,
  friendLandsLoading,
  blacklist,
  guardDogFriends,
  guardDogBlacklist,
  guardDogWhitelist,
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
  applicationActionLoading,
  deletedRecords,
  deletedRecordsLoading,
  deletedRecordsActionLoading,
} = storeToRefs(friendStore)
const { status, loading: statusLoading, realtimeConnected } = storeToRefs(statusStore)

const isQqAccount = computed(() => {
  const acc = currentAccount.value
  if (!acc)
    return false
  const platform = String(acc.platform || 'qq').toLowerCase()
  return platform === 'qq'
})

// ============ 空状态判断 ============
// 区分 4 种场景:未选账号 / 账号未启动 / 连接断开 / 真的没好友
const emptyState = computed(() => {
  if (!currentAccountId.value)
    return { kind: 'no-account' as const }
  const acc = currentAccount.value
  if (!acc)
    return { kind: 'no-account' as const }
  if (!acc.running)
    return { kind: 'not-running' as const }
  // 账号已启动,但还没拿到 connection.connected 状态(status 可能还在拉取)
  if (!status.value || status.value?.connection === undefined)
    return { kind: 'loading-status' as const }
  if (!status.value?.connection?.connected)
    return { kind: 'disconnected' as const }
  return null // 一切正常,业务层自行处理
})

const knownFriendGidCount = computed(() => knownFriendGids.value.length)
const knownFriendGidSet = computed(() => new Set(knownFriendGids.value.map(Number)))
const friendGidSet = computed(() => new Set(friends.value.map(f => Number(f.gid))))
const blacklistGidSet = computed(() => new Set(blacklist.value.map(item => Number(item.gid))))
const guardDogWhitelistGidSet = computed(() => new Set(guardDogWhitelist.value.map(item => Number(item.gid))))
const guardDogBlacklistGidSet = computed(() => new Set(guardDogBlacklist.value.map(item => Number(item.gid))))

const filteredKnownFriendGids = computed(() => {
  const keyword = gidSearchKeyword.value.trim().toLowerCase()
  const list = knownFriendGids.value.map(gid => ({
    gid: Number(gid),
    synced: friendGidSet.value.has(Number(gid)),
  }))
  if (!keyword)
    return list
  return list.filter(item => String(item.gid).includes(keyword))
})

const syncedGidCount = computed(() => filteredKnownFriendGids.value.filter(item => item.synced).length)
const unsyncedGidCount = computed(() => filteredKnownFriendGids.value.filter(item => !item.synced).length)

async function handleRemoveGidFromList(gid: number) {
  if (!currentAccountId.value)
    return
  await friendStore.removeKnownFriendGid(currentAccountId.value, gid)
}

async function handleRemoveUnsyncedGids() {
  if (!currentAccountId.value)
    return
  const unsyncedGids = filteredKnownFriendGids.value.filter(item => !item.synced).map(item => item.gid)
  if (unsyncedGids.length === 0) {
    toast.info('没有需要删除的未同步 GID')
    return
  }
  const result = await friendStore.removeUnsyncedKnownFriendGids(currentAccountId.value, unsyncedGids)
  if (result.ok && result.removedCount > 0) {
    toast.success(`已删除 ${result.removedCount} 个未同步的 GID`)
  }
}

function openGidListModal() {
  gidSearchKeyword.value = ''
  showGidListModal.value = true
}

const TABS = [
  { key: 'friends', label: '好友列表', short: '好友', icon: '👥' },
  { key: 'guardDog', label: '护主犬', short: '护主犬', icon: '🐶' },
  { key: 'applications', label: '好友申请', short: '申请', icon: '📨' },
  { key: 'blacklist', label: '黑名单', short: '黑名单', icon: '🚫' },
  { key: 'deleted', label: '被删记录', short: '被删', icon: '💔' },
  { key: 'visitors', label: '最近访客', short: '访客', icon: '👀' },
] as const

type TabKey = typeof TABS[number]['key']

const activeTab = ref<TabKey>('friends')

const showConfirm = ref(false)
const confirmMessage = ref('')
const confirmLoading = ref(false)
const pendingAction = ref<(() => Promise<any>) | null>(null)
const avatarErrorKeys = ref<Set<string>>(new Set())
const searchKeyword = ref('')
const localKnownFriendGidSyncCooldownSec = ref(300)
const localFriendsListCacheTtlSec = ref(60)
const showBatchAddGidModal = ref(false)
const batchGidInput = ref('')
const showGidListModal = ref(false)
const gidSearchKeyword = ref('')

const interactFilter = ref('all')
const interactFilters = [
  { key: 'all', label: '全部' },
  { key: 'steal', label: '偷菜' },
  { key: 'help', label: '帮忙' },
  { key: 'bad', label: '捣乱' },
]

// 护主犬子 Tab
const guardDogSubTab = ref<'friends' | 'blacklist' | 'whitelist'>('friends')
const guardDogSubTabs = [
  { key: 'friends' as const, label: '🐶 护主犬清单', color: 'amber' },
  { key: 'blacklist' as const, label: '🚫 帮忙黑名单', color: 'red' },
  { key: 'whitelist' as const, label: '✅ 帮忙白名单', color: 'green' },
]
const guardDogBatchInput = ref('')
const guardDogBatchSaving = ref(false)

function confirmAction(msg: string, action: () => Promise<any>) {
  confirmMessage.value = msg
  pendingAction.value = action
  showConfirm.value = true
}

async function onConfirm() {
  if (pendingAction.value) {
    try {
      confirmLoading.value = true
      await pendingAction.value()
    }
    catch (e: any) {
      toast.error(e?.message || '操作失败')
    }
    finally {
      confirmLoading.value = false
      pendingAction.value = null
      showConfirm.value = false
    }
  }
  else {
    showConfirm.value = false
  }
}

function handleBatchBlacklist() {
  if (!currentAccountId.value)
    return
  const gids = filteredSortedFriends.value
    .filter(f => !blacklistGidSet.value.has(Number(f.gid)))
    .map(f => Number(f.gid))
  if (gids.length === 0) {
    toast.info('没有可拉黑的好友')
    return
  }
  confirmAction(`确定将 ${gids.length} 名好友全部加入黑名单？`, async () => {
    const result = await friendStore.batchAddBlacklist(currentAccountId.value!, gids)
    if (result.ok)
      toast.success(`已拉黑 ${gids.length} 名好友`)
    else toast.error(result.error || '批量拉黑失败')
  })
}

function handleBatchWhitelist() {
  if (!currentAccountId.value)
    return
  const gids = friends.value
    .filter(f => blacklistGidSet.value.has(Number(f.gid)))
    .map(f => Number(f.gid))
  if (gids.length === 0) {
    toast.info('没有可拉白的好友')
    return
  }
  confirmAction(`确定将 ${gids.length} 名黑名单好友全部移出？`, async () => {
    const result = await friendStore.batchRemoveBlacklist(currentAccountId.value!, gids)
    if (result.ok)
      toast.success(`已移出 ${gids.length} 名黑名单好友`)
    else toast.error(result.error || '批量拉白失败')
  })
}

// ============ 多选模式批量操作 ============

async function handleMultiSelectBatchBlacklist() {
  if (!currentAccountId.value || selectedCount.value === 0) return
  // 过滤掉已在黑名单中的
  const gids: number[] = []
  for (const gid of selectedFriendGids.value) {
    if (!blacklistGidSet.value.has(Number(gid))) {
      gids.push(Number(gid))
    }
  }
  if (gids.length === 0) {
    toast.info('所选好友都已在黑名单中')
    return
  }
  confirmAction(`确定将所选 ${gids.length} 名好友加入黑名单？`, async () => {
    multiSelectBusy.value = true
    try {
      const result = await friendStore.batchAddBlacklist(currentAccountId.value!, gids)
      if (result.ok) {
        toast.success(`已拉黑 ${gids.length} 名好友`)
        // 拉黑的好友从选择中移除
        const next = new Set(selectedFriendGids.value)
        for (const gid of gids) next.delete(String(gid))
        selectedFriendGids.value = next
      }
      else {
        toast.error(result.error || '批量拉黑失败')
      }
    }
    finally {
      multiSelectBusy.value = false
    }
  })
}

async function handleMultiSelectBatchGuardBlack() {
  if (!currentAccountId.value || selectedCount.value === 0) return
  const gids: number[] = []
  for (const gid of selectedFriendGids.value) {
    if (!guardDogBlacklistGidSet.value.has(Number(gid))) {
      gids.push(Number(gid))
    }
  }
  if (gids.length === 0) {
    toast.info('所选好友都已在护主犬帮忙黑名单')
    return
  }
  confirmAction(`确定将所选 ${gids.length} 名好友加入护主犬帮忙黑名单？`, async () => {
    multiSelectBusy.value = true
    try {
      await friendStore.batchAddGuardDogBlacklist(currentAccountId.value!, gids)
      toast.success(`已加入 ${gids.length} 名好友到护主犬帮忙黑名单`)
    }
    catch (e: any) {
      toast.error(e?.message || '操作失败')
    }
    finally {
      multiSelectBusy.value = false
    }
  })
}

async function handleMultiSelectBatchGuardWhite() {
  if (!currentAccountId.value || selectedCount.value === 0) return
  const gids: number[] = []
  for (const gid of selectedFriendGids.value) {
    if (!guardDogWhitelistGidSet.value.has(Number(gid))) {
      gids.push(Number(gid))
    }
  }
  if (gids.length === 0) {
    toast.info('所选好友都已在护主犬帮忙白名单')
    return
  }
  confirmAction(`确定将所选 ${gids.length} 名好友加入护主犬帮忙白名单？`, async () => {
    multiSelectBusy.value = true
    try {
      await friendStore.batchAddGuardDogWhitelist(currentAccountId.value!, gids)
      toast.success(`已加入 ${gids.length} 名好友到护主犬帮忙白名单`)
    }
    catch (e: any) {
      toast.error(e?.message || '操作失败')
    }
    finally {
      multiSelectBusy.value = false
    }
  })
}

async function handleMultiSelectBatchRemoveFromKnownList() {
  if (!currentAccountId.value || selectedCount.value === 0) return
  if (!isQqAccount.value) {
    toast.warning('此功能仅 QQ 账号可用')
    return
  }
  // 只移除在已知 GID 列表中的
  const gids: number[] = []
  for (const gid of selectedFriendGids.value) {
    if (knownFriendGidSet.value.has(Number(gid))) {
      gids.push(Number(gid))
    }
  }
  if (gids.length === 0) {
    toast.info('所选好友都不在同步列表中')
    return
  }
  confirmAction(
    `确定将所选 ${gids.length} 名好友从同步列表移出？后续最近访客再次命中可自动同步回来。`,
    async () => {
      multiSelectBusy.value = true
      try {
        const result = await friendStore.batchRemoveKnownFriendGids(currentAccountId.value!, gids)
        if (result.ok) {
          toast.success(`已移出 ${result.removedCount || 0} 个 GID`)
          await friendStore.fetchFriends(currentAccountId.value!, true)
        }
        else {
          toast.error('移出失败')
        }
      }
      catch (e: any) {
        toast.error(e?.message || '操作失败')
      }
      finally {
        multiSelectBusy.value = false
      }
    },
  )
}

const expandedFriends = ref<Set<string>>(new Set())
const currentPage = ref(1)
const pageSize = 25

// ============ 多选模式 ============
const isMultiSelectMode = ref(false)
const selectedFriendGids = ref<Set<string>>(new Set())
const multiSelectBusy = ref(false)

const selectedCount = computed(() => selectedFriendGids.value.size)

// 当前页可见好友的 gid（用于"全选当前页"等操作）
const visibleFriendGids = computed(() => paginatedFriends.value.map(f => String(f.gid)))
const allVisibleSelected = computed(() => {
  if (visibleFriendGids.value.length === 0) return false
  return visibleFriendGids.value.every(gid => selectedFriendGids.value.has(gid))
})

function enterMultiSelectMode() {
  isMultiSelectMode.value = true
}

function exitMultiSelectMode() {
  isMultiSelectMode.value = false
  selectedFriendGids.value = new Set()
}

function toggleSelectFriend(gid: string) {
  const next = new Set(selectedFriendGids.value)
  if (next.has(gid)) {
    next.delete(gid)
  }
  else {
    next.add(gid)
  }
  selectedFriendGids.value = next
}

function toggleSelectAllVisible() {
  if (allVisibleSelected.value) {
    // 取消当前页所有
    const next = new Set(selectedFriendGids.value)
    for (const gid of visibleFriendGids.value) {
      next.delete(gid)
    }
    selectedFriendGids.value = next
  }
  else {
    // 全选当前页
    const next = new Set(selectedFriendGids.value)
    for (const gid of visibleFriendGids.value) {
      next.add(gid)
    }
    selectedFriendGids.value = next
  }
}

function clearSelection() {
  selectedFriendGids.value = new Set()
}

watch(currentAccountId, () => {
  // 切账号时清空多选状态
  selectedFriendGids.value = new Set()
  isMultiSelectMode.value = false
})

watch(activeTab, (newTab) => {
  // 切到非好友列表的 tab 时退出多选
  if (newTab !== 'friends') {
    isMultiSelectMode.value = false
    selectedFriendGids.value = new Set()
  }
})

// ============ 好友筛选 + 排序 ============

type FriendSortKey = 'level' | 'gold' | 'name' | 'lastActive'
type FriendFilterKey = 'hasGuardDog' | 'inBlacklist' | 'inGuardDogBlacklist' | 'inGuardDogWhitelist' | 'hasStealable'

const friendSortKey = ref<FriendSortKey>('level')
const friendSortOrder = ref<'desc' | 'asc'>('desc')
const friendFilters = ref<Record<FriendFilterKey, boolean>>({
  hasGuardDog: false,
  inBlacklist: false,
  inGuardDogBlacklist: false,
  inGuardDogWhitelist: false,
  hasStealable: false,
})
const friendLevelMin = ref<number | null>(null)
const friendLevelMax = ref<number | null>(null)
const showFilterPanel = ref(false) // 控制高级筛选（等级范围）的展开

// 护主犬 gid 集合（用于筛选）
const guardDogGidSet = computed(() => new Set(guardDogFriends.value.map(f => Number(f.gid))))

// 好友最后活跃时间（取自 interactRecords 中 serverTimeMs 最大值）
const lastActiveMap = computed(() => {
  const map = new Map<number, number>()
  for (const r of interactRecords.value || []) {
    const gid = Number(r?.visitorGid || r?.friendGid || r?.gid || 0)
    const ts = Number(r?.serverTimeMs || 0)
    if (!gid || !ts) continue
    const prev = map.get(gid) || 0
    if (ts > prev) map.set(gid, ts)
  }
  return map
})

// 排序的排序值取数（统一处理 null/undefined）
function getSortValue(friend: any, key: FriendSortKey): number | string {
  if (key === 'level') return Number(friend?.level || 0)
  if (key === 'gold') return Number(friend?.gold || 0)
  if (key === 'name') return String(friend?.name || '').toLowerCase()
  if (key === 'lastActive') return lastActiveMap.value.get(Number(friend?.gid)) || 0
  return 0
}

const filteredSortedFriends = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  const list = friends.value

  // 1. 搜索
  let result = list
  if (kw) {
    result = result.filter((f: any) => {
      const name = String(f?.name || '').toLowerCase()
      const gid = String(f?.gid || '')
      const uin = String(f?.uin || '')
      return name.includes(kw) || gid.includes(kw) || uin.includes(kw)
    })
  }

  // 2. 等级范围
  if (friendLevelMin.value != null) {
    const min = friendLevelMin.value
    result = result.filter((f: any) => Number(f?.level || 0) >= min)
  }
  if (friendLevelMax.value != null) {
    const max = friendLevelMax.value
    result = result.filter((f: any) => Number(f?.level || 0) <= max)
  }

  // 3. 状态筛选 chips
  const filters = friendFilters.value
  if (filters.hasGuardDog) {
    const set = guardDogGidSet.value
    result = result.filter((f: any) => set.has(Number(f.gid)))
  }
  if (filters.inBlacklist) {
    const set = blacklistGidSet.value
    result = result.filter((f: any) => set.has(Number(f.gid)))
  }
  if (filters.inGuardDogBlacklist) {
    const set = guardDogBlacklistGidSet.value
    result = result.filter((f: any) => set.has(Number(f.gid)))
  }
  if (filters.inGuardDogWhitelist) {
    const set = guardDogWhitelistGidSet.value
    result = result.filter((f: any) => set.has(Number(f.gid)))
  }
  if (filters.hasStealable) {
    result = result.filter((f: any) => Number(f?.plant?.stealNum || 0) > 0)
  }

  // 4. 排序
  const key = friendSortKey.value
  const order = friendSortOrder.value === 'desc' ? -1 : 1
  return [...result].sort((a: any, b: any) => {
    const va = getSortValue(a, key)
    const vb = getSortValue(b, key)
    if (va < vb) return -1 * order
    if (va > vb) return 1 * order
    return 0
  })
})

const totalPages = computed(() => Math.ceil(filteredSortedFriends.value.length / pageSize) || 1)

const paginatedFriends = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  const end = start + pageSize
  return filteredSortedFriends.value.slice(start, end)
})

// 是否有任何筛选生效（用于 UI 显示"重置"按钮）
const hasActiveFilter = computed(() => {
  return Boolean(searchKeyword.value.trim())
    || friendLevelMin.value != null
    || friendLevelMax.value != null
    || Object.values(friendFilters.value).some(Boolean)
})

// 排序配置（label + value）
const sortOptions: Array<{ key: FriendSortKey; label: string; defaultOrder: 'desc' | 'asc' }> = [
  { key: 'level', label: '等级', defaultOrder: 'desc' },
  { key: 'gold', label: '金币', defaultOrder: 'desc' },
  { key: 'name', label: '名字', defaultOrder: 'asc' },
  { key: 'lastActive', label: '最近活跃', defaultOrder: 'desc' },
]

const filterChips: Array<{ key: FriendFilterKey; label: string; activeClass: string }> = [
  { key: 'hasGuardDog', label: '🐶 护主犬', activeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300 dark:border-amber-700' },
  { key: 'hasStealable', label: '🥬 可偷菜', activeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-300 dark:border-blue-700' },
  { key: 'inBlacklist', label: '已屏蔽', activeClass: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600' },
  { key: 'inGuardDogBlacklist', label: '🚫 护黑', activeClass: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-300 dark:border-red-700' },
  { key: 'inGuardDogWhitelist', label: '✅ 护白', activeClass: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-green-300 dark:border-green-700' },
]

const levelPresets: Array<{ label: string; min: number | null; max: number | null }> = [
  { label: '不限', min: null, max: null },
  { label: '1-50', min: 1, max: 50 },
  { label: '51-100', min: 51, max: 100 },
  { label: '101-150', min: 101, max: 150 },
  { label: '151+', min: 151, max: null },
]

function toggleSort(key: FriendSortKey) {
  if (friendSortKey.value === key) {
    friendSortOrder.value = friendSortOrder.value === 'desc' ? 'asc' : 'desc'
  }
  else {
    friendSortKey.value = key
    const opt = sortOptions.find(o => o.key === key)
    friendSortOrder.value = opt?.defaultOrder || 'desc'
  }
  currentPage.value = 1
}

function toggleFilterChip(key: FriendFilterKey) {
  friendFilters.value[key] = !friendFilters.value[key]
  currentPage.value = 1
}

function resetFriendFilters() {
  searchKeyword.value = ''
  friendLevelMin.value = null
  friendLevelMax.value = null
  for (const k of Object.keys(friendFilters.value) as FriendFilterKey[]) {
    friendFilters.value[k] = false
  }
  currentPage.value = 1
}

function goToPage(page: number) {
  currentPage.value = Math.max(1, Math.min(page, totalPages.value))
}

watch(searchKeyword, () => {
  currentPage.value = 1
})

watch([friendLevelMin, friendLevelMax], () => {
  currentPage.value = 1
})

const filteredInteractRecords = computed(() => {
  if (interactFilter.value === 'all')
    return interactRecords.value

  const actionTypeMap: Record<string, number> = {
    steal: 1,
    help: 2,
    bad: 3,
  }
  const targetActionType = actionTypeMap[interactFilter.value] || 0
  return interactRecords.value.filter((record: any) => Number(record?.actionType) === targetActionType)
})

const visibleInteractRecords = computed(() => filteredInteractRecords.value.slice(0, 50))

async function loadData() {
  if (!currentAccountId.value)
    return
  const acc = currentAccount.value
  if (!acc)
    return

  // 拉一次最新状态（如果实时通道还没就绪就走 HTTP）
  if (!realtimeConnected.value) {
    try {
      await statusStore.fetchStatus(currentAccountId.value)
    }
    catch { /* ignore */ }
  }

  // 好友列表 / 黑名单 / 申请 / 互动记录 / 被删记录 这些数据
  // 即使 worker 还没起来或实时连接未就绪也应尽量拉取（后端有缓存），
  // 避免页面刷新后看到"暂无好友"但实际有数据。
  avatarErrorKeys.value.clear()
  const newDeletedCount = await friendStore.fetchFriends(currentAccountId.value)
  friendStore.fetchBlacklist(currentAccountId.value)
  friendStore.fetchGuardDogFriends(currentAccountId.value)
  friendStore.fetchGuardDogBlacklist(currentAccountId.value)
  friendStore.fetchGuardDogWhitelist(currentAccountId.value)
  friendStore.fetchInteractRecords(currentAccountId.value)
  friendStore.fetchApplications(currentAccountId.value)
  friendStore.fetchDeletedRecords(currentAccountId.value)
  if (newDeletedCount > 0) {
    toast.warning(`检测到 ${newDeletedCount} 位好友把你删了，可到「被删记录」页签查看`)
  }
  if (isQqAccount.value) {
    friendStore.fetchKnownFriendSettings(currentAccountId.value)
  }

  // 实时连接就绪后，如果某些依赖连接的接口失败，可以再重试一次
  if (acc.running && status.value?.connection?.connected) {
    friendStore.fetchInteractRecords(currentAccountId.value)
  }
}

useIntervalFn(() => {
  for (const gid in friendLands.value) {
    if (friendLands.value[gid]) {
      friendLands.value[gid] = friendLands.value[gid].map((l: any) =>
        l.matureInSec > 0 ? { ...l, matureInSec: l.matureInSec - 1 } : l,
      )
    }
  }
}, 1000)

onMounted(() => {
  // 优先用 localStorage 缓存秒渲染好友列表,避免刷新看到空白
  if (currentAccountId.value) {
    friendStore.hydrateFriendsFromCache(currentAccountId.value)
  }
  loadData()
  // 页面刷新时如果 worker 仍在扫描中（master 端保留状态 5min），
  // 这里拉一次续上轮询，避免 store 重置后丢失进度显示
  if (activeTab.value === 'guardDog') {
    void ensureScanStatusPolling()
  }
})

// 实时通道建立后若好友列表仍为空，补拉一次
// 修复:刷新页面时如果连接尚未就绪，首屏会看到"暂无好友"
watch(
  () => [realtimeConnected.value, status.value?.connection?.connected],
  ([connected, statusConnected]) => {
    if ((connected || statusConnected) && currentAccountId.value && friends.value.length === 0) {
      void loadData()
    }
  },
)

watch(currentAccountId, () => {
  expandedFriends.value.clear()
  // 切账号时重置筛选
  currentPage.value = 1
  searchKeyword.value = ''
  friendLevelMin.value = null
  friendLevelMax.value = null
  for (const k of Object.keys(friendFilters.value) as FriendFilterKey[]) {
    friendFilters.value[k] = false
  }
  // 切账号时清空上一个账号的好友相关状态(避免残留)
  friendStore.resetFriendsState()
  // 先用缓存秒渲染,再后台拉新数据
  if (currentAccountId.value) {
    friendStore.hydrateFriendsFromCache(currentAccountId.value)
  }
  loadData()
})

// 切到护主犬 Tab 时拉一次进度（用于页面刷新后恢复轮询 / 跨账号切回继续显示）
watch(activeTab, (newTab) => {
  if (newTab === 'guardDog') {
    void ensureScanStatusPolling()
  }
})

async function handleRefreshFriends() {
  if (!currentAccountId.value)
    return
  try {
    await api.post('/api/friends/clear-cache', {}, {
      headers: { 'x-account-id': currentAccountId.value },
    })
  }
  catch {
    // ignore
  }
  const newDeletedCount = await friendStore.fetchFriends(currentAccountId.value, true)
  if (newDeletedCount > 0) {
    friendStore.fetchDeletedRecords(currentAccountId.value)
    toast.warning(`检测到 ${newDeletedCount} 位好友把你删了，可到「被删记录」页签查看`)
  }
}

// 启动账号（用于"账号未启动"空状态的快捷入口）
async function handleStartAccount() {
  if (!currentAccountId.value)
    return
  try {
    await accountStore.startAccount(currentAccountId.value)
    toast.success('账号启动指令已发送')
    // 重新拉取状态,触发空状态切换
    await statusStore.fetchStatus(currentAccountId.value)
    loadData()
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '启动账号失败')
  }
}

// 重新拉取状态（用于"连接断开"空状态的快捷入口）
async function handleRecheckConnection() {
  if (!currentAccountId.value)
    return
  try {
    await statusStore.fetchStatus(currentAccountId.value)
    if (status.value?.connection?.connected) {
      // 状态恢复正常,顺手再拉一次好友列表
      void loadData()
    }
    else {
      toast.warning('账号仍未连接到游戏服务器')
    }
  }
  catch (e: any) {
    toast.error(e?.message || '状态拉取失败')
  }
}

function toggleFriend(friendId: string) {
  if (expandedFriends.value.has(friendId)) {
    expandedFriends.value.delete(friendId)
  }
  else {
    expandedFriends.value.clear()
    expandedFriends.value.add(friendId)
    if (currentAccountId.value && currentAccount.value?.running && status.value?.connection?.connected) {
      friendStore.fetchFriendLands(currentAccountId.value, friendId)
    }
  }
}

async function handleOp(friendId: string, type: string, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return

  const opNames: Record<string, string> = {
    steal: '偷取',
    farming: '一键务农',
    bad: '捣乱',
  }

  if (type === 'bad') {
    confirmAction('确定对好友执行捣乱操作吗?', async () => {
      toast.info('已在捣乱中，间隔较长，请稍后返回好友土地查看')
      friendStore.operate(currentAccountId.value!, friendId, type)
      return { ok: true }
    })
  }
  else {
    confirmAction(`确定对好友执行${opNames[type] || type}操作吗?`, async () => {
      const result = await friendStore.operate(currentAccountId.value!, friendId, type)
      if (result?.ok) {
        toast.success(result.message || `${opNames[type] || type}完成`)
      }
      else {
        toast.error(result?.message || `${opNames[type] || type}失败`)
      }
      return result
    })
  }
}

async function handleToggleBlacklist(friend: any, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return
  await friendStore.toggleBlacklist(currentAccountId.value, Number(friend.gid))
}

async function handleToggleGuardDogBlacklist(friend: any, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return
  const gid = Number(friend.gid)
  if (guardDogBlacklistGidSet.value.has(gid)) {
    await friendStore.batchRemoveGuardDogBlacklist(currentAccountId.value, [gid])
  }
  else {
    await friendStore.batchAddGuardDogBlacklist(currentAccountId.value, [gid])
  }
}

async function handleToggleGuardDogWhitelist(friend: any, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return
  const gid = Number(friend.gid)
  if (guardDogWhitelistGidSet.value.has(gid)) {
    await friendStore.batchRemoveGuardDogWhitelist(currentAccountId.value, [gid])
  }
  else {
    await friendStore.batchAddGuardDogWhitelist(currentAccountId.value, [gid])
  }
}

// ============ 游戏内拉黑好友（BlockFriend RPC，实测可用）============

async function handleBlockFriend(friend: any, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return
  const gid = Number(friend?.gid) || 0
  if (!gid)
    return
  const name = String(friend?.name || `GID:${gid}`).trim()
  confirmAction(
    `确定在游戏内拉黑 ${name} 吗？\n操作会调用游戏服务端的 BlockFriend 接口。`,
    async () => {
      const result = await friendStore.blockFriend(currentAccountId.value!, gid)
      if (result.ok) {
        toast.success(result.message || '已拉黑')
      }
      else {
        toast.error(result.message || '拉黑失败')
      }
      return result
    },
  )
}

async function handleToggleBlockApplications() {
  if (!currentAccountId.value)
    return
  const nextBlock = !friendStore.blockApplications
  const action = nextBlock ? '开启' : '关闭'
  confirmAction(
    `确定${action}"屏蔽加好友申请"吗？\n${nextBlock ? '开启后将自动拒绝所有向你发起的好友申请' : '关闭后允许他人向你发起好友申请'}。`,
    async () => {
      const result = await friendStore.setBlockApplications(currentAccountId.value!, nextBlock)
      if (result.ok) {
        toast.success(result.message || `已${action}屏蔽加好友申请`)
      }
      else {
        toast.error(result.message || '切换屏蔽加好友申请失败')
      }
      return result
    },
  )
}

function getFriendStatusText(friend: any) {
  const p = friend.plant || {}
  const info = []
  if (p.stealNum)
    info.push(`偷${p.stealNum}`)
  if (p.dryNum)
    info.push(`水${p.dryNum}`)
  if (p.weedNum)
    info.push(`草${p.weedNum}`)
  if (p.insectNum)
    info.push(`虫${p.insectNum}`)
  return info.length ? info.join(' ') : '无操作'
}

function getFriendLevel(friend: any) {
  const level = Number.parseInt(String(friend?.level ?? ''), 10)
  if (!Number.isFinite(level) || level <= 0)
    return 0
  return level
}

function getFriendGold(friend: any) {
  const gold = Number.parseInt(String(friend?.gold ?? ''), 10)
  if (!Number.isFinite(gold) || gold < 0)
    return 0
  return gold
}

function formatFriendGold(value: unknown) {
  const gold = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(gold) || gold < 0)
    return '0'
  return gold.toLocaleString('zh-CN')
}

function getFriendAvatar(friend: any) {
  const direct = String(friend?.avatarUrl || friend?.avatar_url || '').trim()
  if (direct)
    return direct
  const uin = String(friend?.uin || '').trim()
  if (uin)
    return `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`
  return ''
}

function getFriendAvatarKey(friend: any) {
  const key = String(friend?.gid || friend?.uin || '').trim()
  return key || String(friend?.name || '').trim()
}

function canShowFriendAvatar(friend: any) {
  const key = getFriendAvatarKey(friend)
  if (!key)
    return false
  return !!getFriendAvatar(friend) && !avatarErrorKeys.value.has(key)
}

function handleFriendAvatarError(friend: any) {
  const key = getFriendAvatarKey(friend)
  if (!key)
    return
  avatarErrorKeys.value.add(key)
}

async function handleRemoveFromBlacklist(gid: number) {
  if (!currentAccountId.value)
    return
  await friendStore.toggleBlacklist(currentAccountId.value, gid)
}

async function handleRemoveGuardDogFriend(gid: number) {
  if (!currentAccountId.value)
    return
  await friendStore.removeGuardDogFriend(currentAccountId.value, gid)
}

async function handleRefreshGuardDogFriends() {
  if (!currentAccountId.value)
    return
  await friendStore.fetchGuardDogFriends(currentAccountId.value)
}

async function handleClearGuardDogFriends() {
  if (!currentAccountId.value)
    return
  confirmAction('确定清空护主犬好友清单吗？此操作不可撤销。', async () => {
    await friendStore.clearGuardDogFriends(currentAccountId.value!)
    toast.success('已清空护主犬好友清单')
  })
}

// ============ 护主犬帮忙黑/白名单 handler ============

function parseGidList(raw: string): number[] {
  return raw
    .split(/[\s,，;；\n\r]+/)
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0)
}

async function handleBatchAddGuardDogFriends() {
  if (!currentAccountId.value)
    return
  const gids = parseGidList(guardDogBatchInput.value)
  if (gids.length === 0) {
    toast.error('请输入有效的 GID 列表')
    return
  }
  try {
    guardDogBatchSaving.value = true
    await friendStore.batchAddGuardDogFriends(currentAccountId.value, gids)
    guardDogBatchInput.value = ''
    toast.success(`已添加 ${gids.length} 名好友到护主犬清单`)
  }
  catch (e: any) {
    toast.error(e?.message || '批量添加失败')
  }
  finally {
    guardDogBatchSaving.value = false
  }
}

async function handleBatchAddGuardDogBlacklist() {
  if (!currentAccountId.value)
    return
  const gids = parseGidList(guardDogBatchInput.value)
  if (gids.length === 0) {
    toast.error('请输入有效的 GID 列表')
    return
  }
  try {
    guardDogBatchSaving.value = true
    await friendStore.batchAddGuardDogBlacklist(currentAccountId.value, gids)
    guardDogBatchInput.value = ''
    toast.success(`已添加 ${gids.length} 名好友到护主犬帮忙黑名单`)
  }
  catch (e: any) {
    toast.error(e?.message || '批量添加失败')
  }
  finally {
    guardDogBatchSaving.value = false
  }
}

async function handleBatchAddGuardDogWhitelist() {
  if (!currentAccountId.value)
    return
  const gids = parseGidList(guardDogBatchInput.value)
  if (gids.length === 0) {
    toast.error('请输入有效的 GID 列表')
    return
  }
  try {
    guardDogBatchSaving.value = true
    await friendStore.batchAddGuardDogWhitelist(currentAccountId.value, gids)
    guardDogBatchInput.value = ''
    toast.success(`已添加 ${gids.length} 名好友到护主犬帮忙白名单`)
  }
  catch (e: any) {
    toast.error(e?.message || '批量添加失败')
  }
  finally {
    guardDogBatchSaving.value = false
  }
}

async function handleRemoveGuardDogBlacklistItem(gid: number) {
  if (!currentAccountId.value)
    return
  try {
    await friendStore.batchRemoveGuardDogBlacklist(currentAccountId.value, [gid])
    toast.success('已移出护主犬帮忙黑名单')
  }
  catch (e: any) {
    toast.error(e?.message || '移出失败')
  }
}

async function handleRemoveGuardDogWhitelistItem(gid: number) {
  if (!currentAccountId.value)
    return
  try {
    await friendStore.batchRemoveGuardDogWhitelist(currentAccountId.value, [gid])
    toast.success('已移出护主犬帮忙白名单')
  }
  catch (e: any) {
    toast.error(e?.message || '移出失败')
  }
}

async function handleClearGuardDogBlacklistList() {
  if (!currentAccountId.value)
    return
  confirmAction('确定清空护主犬帮忙黑名单吗？此操作不可撤销。', async () => {
    await friendStore.clearGuardDogBlacklist(currentAccountId.value!)
    toast.success('已清空护主犬帮忙黑名单')
  })
}

async function handleClearGuardDogWhitelistList() {
  if (!currentAccountId.value)
    return
  confirmAction('确定清空护主犬帮忙白名单吗？此操作不可撤销。', async () => {
    await friendStore.clearGuardDogWhitelist(currentAccountId.value!)
    toast.success('已清空护主犬帮忙白名单')
  })
}

async function handleFetchGuardDogSubTab(tab: 'friends' | 'blacklist' | 'whitelist') {
  if (!currentAccountId.value)
    return
  if (tab === 'friends') {
    await friendStore.fetchGuardDogFriends(currentAccountId.value)
  }
  else if (tab === 'blacklist') {
    await friendStore.fetchGuardDogBlacklist(currentAccountId.value)
  }
  else if (tab === 'whitelist') {
    await friendStore.fetchGuardDogWhitelist(currentAccountId.value)
  }
}

// ============ 护主犬扫描状态（全局 store，与组件生命周期解耦）============
const scanningGuardDog = computed(() =>
  !!currentAccountId.value
  && friendStore.scanningGuardDogAccountId === currentAccountId.value,
)
const scanGuardDogResult = computed(() => {
  const r = friendStore.scanGuardDogResult
  if (!r) return null
  if (r.accountId !== currentAccountId.value) return null
  return r
})
const scanProgressIndex = computed(() => {
  const p = friendStore.scanGuardDogProgress
  if (!p || p.accountId !== currentAccountId.value) return 0
  return Number(p.index) || 0
})
const scanProgressTotal = computed(() => {
  const p = friendStore.scanGuardDogProgress
  if (!p || p.accountId !== currentAccountId.value) return 0
  return Number(p.total) || 0
})
const scanProgressText = computed(() => {
  if (!scanningGuardDog.value) return ''
  const cur = scanProgressIndex.value
  const total = scanProgressTotal.value
  if (total <= 0) return '...'
  return `${cur}/${total}`
})

// 扫描是否被中断（worker 重启/应用宝自动重连等场景）
const scanWasInterrupted = computed(() => {
  const p = friendStore.scanGuardDogProgress
  if (!p || p.accountId !== currentAccountId.value) return false
  return p.status === 'interrupted'
})

// 进入护主犬 Tab 时拉一次进度（用于页面刷新后恢复轮询）
async function ensureScanStatusPolling() {
  if (!currentAccountId.value) return
  await friendStore.fetchScanStatus(currentAccountId.value)
  // 如果扫描实际还在进行（progress.status === 'running'）但 scanningGuardDogAccountId 因刷新丢了，续上
  const p = friendStore.scanGuardDogProgress
  if (p && p.accountId === currentAccountId.value && (p.status === 'running' || !p.status)) {
    if (friendStore.scanningGuardDogAccountId !== currentAccountId.value) {
      ;(friendStore as any).scanningGuardDogAccountId = currentAccountId.value
    }
    friendStore.startScanStatusPoll(currentAccountId.value)
  }
}

async function handleScanGuardDogFriends() {
  if (!currentAccountId.value || scanningGuardDog.value) return
  if (!currentAccount.value?.running || !status.value?.connection?.connected) {
    toast.error('账号未运行，无法扫描')
    return
  }
  try {
    const res: any = await friendStore.scanGuardDogFriends(currentAccountId.value)
    if (res && res.ok) {
      const s = res.scan
      if (s && s.newGids && s.newGids.length > 0) {
        toast.success(`扫描完成，新增 ${s.newGids.length} 位护主犬好友`)
      }
      else if (s) {
        toast.info(`扫描完成，共扫 ${s.scanned} 人，未发现新护主犬好友`)
      }
    }
    else {
      toast.error((res && res.error) || '扫描失败')
    }
  }
  catch (e: any) {
    toast.error(e?.message || '扫描失败')
  }
}

async function refreshInteractRecords() {
  if (!currentAccountId.value)
    return
  await friendStore.fetchInteractRecords(currentAccountId.value)
}

function getInteractAvatar(record: any) {
  return String(record?.avatarUrl || '').trim()
}

function getInteractAvatarKey(record: any) {
  const key = String(record?.visitorGid || record?.key || record?.nick || '').trim()
  return key ? `interact:${key}` : ''
}

function canShowInteractAvatar(record: any) {
  const key = getInteractAvatarKey(record)
  if (!key)
    return false
  return !!getInteractAvatar(record) && !avatarErrorKeys.value.has(key)
}

function handleInteractAvatarError(record: any) {
  const key = getInteractAvatarKey(record)
  if (!key)
    return
  avatarErrorKeys.value.add(key)
}

function getInteractBadgeClass(actionType: number) {
  if (Number(actionType) === 1)
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (Number(actionType) === 2)
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
  if (Number(actionType) === 3)
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
}

function formatInteractTime(timestamp: number) {
  const ts = Number(timestamp) || 0
  if (!ts)
    return '--'

  const date = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute

  if (diff >= 0 && diff < minute)
    return '刚刚'
  if (diff >= minute && diff < hour)
    return `${Math.floor(diff / minute)} 分钟前`

  const sameDay = now.getFullYear() === date.getFullYear()
    && now.getMonth() === date.getMonth()
    && now.getDate() === date.getDate()

  if (sameDay) {
    return `今天 ${date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })}`
  }

  if (now.getFullYear() === date.getFullYear()) {
    return `${date.getMonth() + 1}-${date.getDate()} ${date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })}`
  }

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function normalizeKnownFriendGidSyncCooldownSec(value: number) {
  const v = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(v) || v <= 0)
    return 600
  return Math.max(30, Math.min(86400, v))
}

function normalizeFriendsListCacheTtlSec(value: number) {
  const v = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(v) || v <= 0)
    return 60
  return Math.max(10, Math.min(86400, v))
}

async function handleRemoveKnownFriendGid(friend: any, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return
  const gid = Number(friend?.gid) || 0
  const name = String(friend?.name || `GID ${gid}`).trim()
  confirmAction(
    `确定将 ${name} 移出同步列表吗？后续如果最近访客再次命中，这个 GID 仍可被自动同步回来。`,
    async () => {
      await friendStore.removeKnownFriendGid(currentAccountId.value!, gid)
      await refreshFriendsAfterKnownGidChange()
      toast.success(`已移出同步列表: ${name}`)
    },
  )
}

async function refreshFriendsAfterKnownGidChange() {
  if (!currentAccountId.value)
    return
  await friendStore.fetchFriends(currentAccountId.value, true)
}

async function handleSaveKnownFriendSettings() {
  if (!currentAccountId.value)
    return
  const cooldownSec = normalizeKnownFriendGidSyncCooldownSec(localKnownFriendGidSyncCooldownSec.value)
  const cacheTtlSec = normalizeFriendsListCacheTtlSec(localFriendsListCacheTtlSec.value)
  await friendStore.saveKnownFriendSettings(currentAccountId.value, {
    knownFriendGidSyncCooldownSec: cooldownSec,
    friendsListCacheTtlSec: cacheTtlSec,
  })
  toast.success('设置已保存')
}

watch(knownFriendGidSyncCooldownSec, (val) => {
  localKnownFriendGidSyncCooldownSec.value = val
}, { immediate: true })

watch(friendsListCacheTtlSec, (val) => {
  localFriendsListCacheTtlSec.value = val
}, { immediate: true })

function parseBatchGids(input: string): number[] {
  const text = String(input || '').trim()
  if (!text)
    return []
  const gids: number[] = []
  const parts = text.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
  for (const part of parts) {
    const num = Number.parseInt(part, 10)
    if (Number.isFinite(num) && num > 0 && !gids.includes(num)) {
      gids.push(num)
    }
  }
  return gids
}

async function handleBatchAddKnownFriendGids() {
  if (!currentAccountId.value)
    return
  const gids = parseBatchGids(batchGidInput.value)
  if (gids.length === 0) {
    toast.error('请输入有效的 GID 列表')
    return
  }
  const result = await friendStore.batchAddKnownFriendGids(currentAccountId.value, gids)
  if (result.ok) {
    batchGidInput.value = ''
    showBatchAddGidModal.value = false
    await refreshFriendsAfterKnownGidChange()
    toast.success(`已批量添加 ${result.addedCount} 个 GID`)
  }
}

// ============ 好友申请 ============

const applicationAvatarErrorKeys = ref<Set<string>>(new Set())

function getApplicationAvatar(app: any) {
  const direct = String(app?.avatarUrl || '').trim()
  if (direct)
    return direct
  return ''
}

function getApplicationAvatarKey(app: any) {
  const key = String(app?.gid || '').trim()
  return key ? `app:${key}` : ''
}

function canShowApplicationAvatar(app: any) {
  const key = getApplicationAvatarKey(app)
  if (!key)
    return false
  return !!getApplicationAvatar(app) && !applicationAvatarErrorKeys.value.has(key)
}

function handleApplicationAvatarError(app: any) {
  const key = getApplicationAvatarKey(app)
  if (!key)
    return
  applicationAvatarErrorKeys.value.add(key)
}

function formatApplicationTime(timestamp: number) {
  const ts = Number(timestamp) || 0
  if (!ts)
    return '--'

  const date = new Date(ts * 1000)
  if (Number.isNaN(date.getTime()))
    return '--'

  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff >= 0 && diff < minute)
    return '刚刚'
  if (diff >= minute && diff < hour)
    return `${Math.floor(diff / minute)} 分钟前`
  if (diff >= hour && diff < day)
    return `${Math.floor(diff / hour)} 小时前`
  if (diff >= day && diff < 7 * day)
    return `${Math.floor(diff / day)} 天前`

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

async function refreshApplications() {
  if (!currentAccountId.value)
    return
  await friendStore.fetchApplications(currentAccountId.value)
}

async function handleAcceptApplication(app: any, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return
  const gid = Number(app?.gid) || 0
  if (!gid)
    return
  const name = String(app?.name || `GID:${gid}`).trim()
  confirmAction(`确定同意 ${name} 的好友申请吗?`, async () => {
    const result = await friendStore.acceptApplications(currentAccountId.value!, [gid])
    if (result.ok) {
      toast.success(result.message || `已同意 ${name} 的好友申请`)
      // 同意后刷新好友列表，确保新好友出现在列表中
      await friendStore.fetchFriends(currentAccountId.value!, true)
    }
    else {
      toast.error(result.message || '同意好友申请失败')
    }
    return result
  })
}

async function handleRejectApplication(app: any, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return
  const gid = Number(app?.gid) || 0
  if (!gid)
    return
  const name = String(app?.name || `GID:${gid}`).trim()
  confirmAction(`确定拒绝 ${name} 的好友申请吗?`, async () => {
    const result = await friendStore.rejectApplications(currentAccountId.value!, [gid])
    if (result.ok)
      toast.success(result.message || `已拒绝 ${name} 的好友申请`)
    else
      toast.error(result.message || '拒绝好友申请失败')
    return result
  })
}

async function handleAcceptAllApplications() {
  if (!currentAccountId.value)
    return
  const gids = applications.value.map(app => Number(app.gid)).filter(Boolean)
  if (gids.length === 0) {
    toast.info('没有可处理的好友申请')
    return
  }
  confirmAction(`确定一键同意 ${gids.length} 个好友申请吗?`, async () => {
    const result = await friendStore.acceptApplications(currentAccountId.value!, gids)
    if (result.ok) {
      toast.success(result.message || `已同意 ${gids.length} 个好友申请`)
      await friendStore.fetchFriends(currentAccountId.value!, true)
    }
    else {
      toast.error(result.message || '批量同意失败')
    }
    return result
  })
}

async function handleRejectAllApplications() {
  if (!currentAccountId.value)
    return
  const gids = applications.value.map(app => Number(app.gid)).filter(Boolean)
  if (gids.length === 0) {
    toast.info('没有可处理的好友申请')
    return
  }
  confirmAction(`确定一键拒绝 ${gids.length} 个好友申请吗?此操作不可撤销。`, async () => {
    const result = await friendStore.rejectApplications(currentAccountId.value!, gids)
    if (result.ok)
      toast.success(result.message || `已拒绝 ${gids.length} 个好友申请`)
    else
      toast.error(result.message || '批量拒绝失败')
    return result
  })
}

// ============ 被删记录 ============

async function refreshDeletedRecords() {
  if (!currentAccountId.value)
    return
  await friendStore.fetchDeletedRecords(currentAccountId.value)
}

async function handleClearDeletedRecords() {
  if (!currentAccountId.value)
    return
  confirmAction(`确定清空全部被删记录吗？此操作不可撤销。`, async () => {
    const result = await friendStore.clearDeletedRecords(currentAccountId.value!)
    if (result.ok) {
      toast.success(`已清空 ${result.clearedCount || 0} 条被删记录`)
    }
    else {
      toast.error(result.error || '清空失败')
    }
    return result
  })
}

async function handleRemoveDeletedRecord(item: { gid: number; deletedAt: number }) {
  if (!currentAccountId.value)
    return
  const result = await friendStore.removeDeletedRecord(currentAccountId.value, Number(item.gid), Number(item.deletedAt))
  if (result.ok) {
    toast.success('已移除该记录')
  }
  else {
    toast.error(result.error || '移除失败')
  }
}

// 被删记录 → 一键拉黑（游戏 BlockFriend RPC）
async function handleBlockDeletedFriend(item: { gid: number; name?: string; deletedAt: number }) {
  if (!currentAccountId.value)
    return
  const displayName = item.name || `GID:${item.gid}`
  confirmAction(`确定把 ${displayName} 加入游戏内黑名单吗？`, async () => {
    const result = await friendStore.blockFriend(currentAccountId.value!, Number(item.gid))
    if (result.ok) {
      toast.success(`${displayName} 已加入黑名单`)
      // 拉黑成功后，移除该被删记录
      await friendStore.removeDeletedRecord(currentAccountId.value!, Number(item.gid), Number(item.deletedAt))
      // 同步刷新黑名单页签数据
      friendStore.fetchBlacklist(currentAccountId.value!)
    }
    else {
      toast.error(result.message || '拉黑失败')
    }
    return { ok: !!result.ok }
  })
}

function formatDeletedAt(timestamp: number) {
  const ts = Number(timestamp) || 0
  if (!ts)
    return '--'
  const date = new Date(ts)
  if (Number.isNaN(date.getTime()))
    return '--'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
</script>

<template>
  <div class="friends-page p-4" :class="isMultiSelectMode ? 'pb-24 sm:pb-20' : ''">
    <div class="animate-stagger-1 mb-4 flex flex-col animate-fade-in-up gap-4 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="flex items-center gap-2 text-2xl font-bold font-display">
        <span class="title-wheat">🌾</span>
        👥 好友管理
      </h2>
      <div class="flex items-center gap-3">
        <div v-if="activeTab === 'friends'" class="relative">
          <span class="absolute left-3 top-1/2 text-gray-400 -translate-y-1/2">🔍</span>
          <input
            v-model="searchKeyword"
            type="text"
            placeholder="搜索好友..."
            class="w-full border farm-input border-gray-300 rounded-xl bg-white py-2 pl-10 pr-4 text-sm sm:w-64 dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
        </div>
        <div v-if="activeTab === 'friends' && friends.length" class="text-sm text-gray-500">
          共 <span class="text-amber-600 font-bold dark:text-amber-400">{{ filteredSortedFriends.length.toLocaleString('zh-CN') }}</span>/{{ friends.length.toLocaleString('zh-CN') }} 名好友
        </div>
        <div v-if="activeTab === 'applications'" class="text-sm text-gray-500">
          共 <span class="text-blue-600 font-bold dark:text-blue-400">{{ applications.length.toLocaleString('zh-CN') }}</span> 个申请
        </div>
        <div v-if="activeTab === 'blacklist'" class="text-sm text-gray-500">
          共 <span class="text-red-600 font-bold dark:text-red-400">{{ blacklist.length.toLocaleString('zh-CN') }}</span> 人
        </div>
        <div v-if="activeTab === 'deleted'" class="text-sm text-gray-500">
          共 <span class="text-pink-600 font-bold dark:text-pink-400">{{ deletedRecords.length.toLocaleString('zh-CN') }}</span> 人
        </div>
        <div v-if="activeTab === 'guardDog'" class="text-sm text-gray-500">
          共 <span class="text-amber-600 font-bold dark:text-amber-400">{{ guardDogFriends.length.toLocaleString('zh-CN') }}</span> 人
        </div>
        <div v-if="activeTab === 'visitors' && interactRecords.length" class="text-sm text-gray-500">
          共 <span class="text-blue-600 font-bold dark:text-blue-400">{{ filteredInteractRecords.length.toLocaleString('zh-CN') }}</span>/{{ interactRecords.length.toLocaleString('zh-CN') }} 条记录
        </div>
      </div>
    </div>

    <div class="farm-card-enhanced animate-stagger-2 mb-4 animate-fade-in-up overflow-hidden p-0">
      <div class="border-b" :style="{ borderColor: 'color-mix(in srgb, var(--theme-primary) 15%, transparent)' }">
        <nav class="flex gap-1 overflow-x-auto p-1.5" style="-webkit-overflow-scrolling: touch; scrollbar-width: thin;">
          <button
            v-for="tab in TABS"
            :key="tab.key"
            class="relative flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-bold transition-all duration-300"
            :class="activeTab === tab.key
              ? 'text-white shadow-md scale-105'
              : 'hover:scale-105'"
            :style="activeTab === tab.key
              ? {
                backgroundColor: 'var(--theme-primary)',
                boxShadow: `0 4px 12px color-mix(in srgb, var(--theme-primary), 40%, transparent)`,
              }
              : {
                color: 'color-mix(in srgb, var(--theme-text) 60%, transparent)',
              }"
            @click="activeTab = tab.key"
          >
            <div
              :class="[tab.icon, { 'animate-sparkle': activeTab === tab.key }]"
            />
            <span class="hidden sm:inline">{{ tab.label }}</span>
            <span class="sm:hidden">{{ tab.short }}</span>
            <span
              v-if="tab.key === 'blacklist' && blacklist.length > 0"
              class="rounded-full px-1.5 py-0.5 text-xs font-bold"
              :class="activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'"
            >
              {{ blacklist.length.toLocaleString('zh-CN') }}
            </span>
            <span
              v-if="tab.key === 'deleted' && deletedRecords.length > 0"
              class="rounded-full px-1.5 py-0.5 text-xs font-bold"
              :class="activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400'"
            >
              {{ deletedRecords.length.toLocaleString('zh-CN') }}
            </span>
            <span
              v-if="tab.key === 'guardDog' && guardDogFriends.length > 0"
              class="rounded-full px-1.5 py-0.5 text-xs font-bold"
              :class="activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'"
            >
              {{ guardDogFriends.length.toLocaleString('zh-CN') }}
            </span>
            <span
              v-if="tab.key === 'applications' && applications.length > 0"
              class="animate-pulse-glow rounded-full px-1.5 py-0.5 text-xs font-bold"
              :class="activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'"
            >
              {{ applications.length.toLocaleString('zh-CN') }}
            </span>
            <div
              v-if="activeTab === tab.key"
              class="pointer-events-none absolute inset-0"
              style="background: linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 50%);"
            />
          </button>
        </nav>
      </div>
    </div>

    <div v-if="loading || statusLoading || interactLoading || applicationsLoading || deletedRecordsLoading" class="animate-stagger-3 flex animate-fade-in-up justify-center py-12">
      <span class="animate-spin text-4xl">⏳</span>
    </div>

    <div v-else-if="emptyState?.kind === 'no-account'" class="farm-card-enhanced animate-stagger-3 flex flex-col animate-fade-in-up items-center justify-center gap-3 p-12 text-center text-gray-500">
      <span class="animate-float-slow text-4xl text-gray-400">👤</span>
      <div>
        <div class="text-lg text-gray-700 font-medium font-display dark:text-gray-300">
          未选择账号
        </div>
        <div class="mt-1 text-sm text-gray-400">
          请先在顶部添加并选择一个农场账号
        </div>
      </div>
    </div>

    <div v-else-if="emptyState?.kind === 'not-running'" class="farm-card-enhanced animate-stagger-3 flex flex-col animate-fade-in-up items-center justify-center gap-4 p-12 text-center text-gray-500">
      <span class="animate-float-medium text-4xl text-gray-400">⏸️</span>
      <div>
        <div class="text-lg text-gray-700 font-medium font-display dark:text-gray-300">
          账号尚未启动
        </div>
        <div class="mt-1 text-sm text-gray-400">
          启动账号后才会连接到游戏服务器并拉取好友列表
        </div>
      </div>
      <button
        class="cartoon-btn rounded-xl bg-amber-100 px-4 py-2 text-sm text-amber-700 transition dark:bg-amber-900/30 hover:bg-amber-200 dark:text-amber-400 dark:hover:bg-amber-900/50"
        @click="handleStartAccount"
      >
        ▶️ 启动账号
      </button>
    </div>

    <div v-else-if="emptyState?.kind === 'loading-status'" class="farm-card-enhanced animate-stagger-3 flex flex-col animate-fade-in-up items-center justify-center gap-3 p-12 text-center text-gray-500">
      <span class="animate-spin text-4xl">⏳</span>
      <div>
        <div class="text-lg text-gray-700 font-medium font-display dark:text-gray-300">
          正在拉取账号状态…
        </div>
        <div class="mt-1 text-sm text-gray-400">
          稍等片刻
        </div>
      </div>
    </div>

    <div v-else-if="emptyState?.kind === 'disconnected'" class="farm-card-enhanced animate-stagger-3 flex flex-col animate-fade-in-up items-center justify-center gap-4 p-12 text-center text-gray-500">
      <span class="animate-float-medium text-4xl text-gray-400">📡</span>
      <div>
        <div class="text-lg text-gray-700 font-medium font-display dark:text-gray-300">
          连接已断开
        </div>
        <div class="mt-1 text-sm text-gray-400">
          账号已启动但未连接到游戏服务器，请检查网络或稍后重试
        </div>
      </div>
      <button
        class="cartoon-btn rounded-xl bg-blue-100 px-4 py-2 text-sm text-blue-700 transition dark:bg-blue-900/30 hover:bg-blue-200 dark:text-blue-400 dark:hover:bg-blue-900/50"
        @click="handleRecheckConnection"
      >
        🔄 重新检测
      </button>
    </div>

    <template v-else>
      <div v-if="activeTab === 'friends'" class="space-y-4">
        <div v-if="currentAccountId && isQqAccount" class="farm-card-enhanced animate-stagger-3 mb-4 animate-fade-in-up p-5">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div class="flex items-center gap-2">
                <span class="animate-wiggle text-lg text-amber-500">📋</span>
                <h3 class="text-lg text-gray-700 font-semibold font-display dark:text-gray-200">
                  QQ 好友自动同步
                </h3>
                <button
                  class="animate-pulse-glow cursor-pointer rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 font-bold transition dark:bg-amber-900/30 hover:bg-amber-200 dark:text-amber-400 dark:hover:bg-amber-900/50"
                  @click="openGidListModal"
                >
                  {{ knownFriendGidCount.toLocaleString('zh-CN') }}
                </button>
              </div>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                QQ 新好友接口依赖已知 GID。系统会自动从最近访客补充，进入好友农场明确失败时自动移除失效 GID。
              </p>
            </div>
            <div class="flex shrink-0 gap-2">
              <button
                class="cartoon-btn rounded-xl bg-amber-100 px-3 py-1.5 text-sm text-amber-700 transition dark:bg-amber-900/30 hover:bg-amber-200 dark:text-amber-400 disabled:opacity-50 dark:hover:bg-amber-900/50"
                :disabled="knownFriendSettingsLoading"
                @click="currentAccountId && friendStore.fetchKnownFriendSettings(currentAccountId)"
              >
                <div v-if="knownFriendSettingsLoading" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
                刷新
              </button>
              <button
                class="cartoon-btn rounded-xl bg-green-100 px-3 py-1.5 text-sm text-green-700 transition dark:bg-green-900/30 hover:bg-green-200 dark:text-green-400 disabled:opacity-50 dark:hover:bg-green-900/50"
                :disabled="knownFriendSettingsSaving"
                @click="handleSaveKnownFriendSettings"
              >
                <div v-if="knownFriendSettingsSaving" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
                保存设置
              </button>
              <button
                class="cartoon-btn rounded-xl bg-blue-100 px-3 py-1.5 text-sm text-blue-700 transition dark:bg-blue-900/30 hover:bg-blue-200 dark:text-blue-400 disabled:opacity-50 dark:hover:bg-blue-900/50"
                @click="showBatchAddGidModal = true"
              >
                批量新增 GID
              </button>
            </div>
          </div>

          <div class="decorative-divider my-4" />

          <div class="grid gap-3 lg:grid-cols-2">
            <div>
              <label class="mb-1 block text-xs text-gray-500 dark:text-gray-400">访客检测入库冷却(秒)</label>
              <input
                v-model.number="localKnownFriendGidSyncCooldownSec"
                type="number"
                class="w-full border farm-input border-gray-300 rounded-xl bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
            </div>
            <div>
              <label class="mb-1 block text-xs text-gray-500 dark:text-gray-400">好友列表缓存(秒)</label>
              <input
                v-model.number="localFriendsListCacheTtlSec"
                type="number"
                class="w-full border farm-input border-gray-300 rounded-xl bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
            </div>
          </div>
        </div>

        <div v-if="friends.length === 0" class="farm-card-enhanced animate-stagger-4 animate-fade-in-up p-8 text-center text-gray-500">
          <template v-if="loading">
            <div class="animate-spin mx-auto mb-3 text-4xl text-gray-300">
              ⏳
            </div>
            <div class="text-lg font-display">
              正在拉取好友列表…
            </div>
            <div class="mt-1 text-sm text-gray-400">
              首次可能需要 5~10 秒
            </div>
          </template>
          <template v-else-if="!friendsLoaded">
            <div class="mx-auto mb-3 text-4xl text-gray-300">
              ⚠️
            </div>
            <div class="text-lg font-display">
              好友列表加载失败
            </div>
            <div class="mt-1 text-sm text-gray-400">
              可能 worker 还在初始化或游戏接口暂时不可用
            </div>
            <button
              class="cartoon-btn mt-4 rounded-xl bg-blue-100 px-4 py-2 text-sm text-blue-700 transition dark:bg-blue-900/30 hover:bg-blue-200 dark:text-blue-400 dark:hover:bg-blue-900/50"
              @click="loadData"
            >
              🔄 重试
            </button>
          </template>
          <template v-else>
            <div class="mx-auto mb-3 text-4xl text-gray-300">
              👥
            </div>
            <div class="text-lg font-display">
              暂无好友
            </div>
            <div class="mt-1 text-sm text-gray-400">
              当前账号在游戏中没有好友，可能是新号或好友都被拉黑了
            </div>
            <div class="mt-3 flex justify-center gap-2">
              <button
                class="cartoon-btn rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300"
                @click="handleRefreshFriends"
              >
                🔄 重新拉取
              </button>
              <button
                v-if="blacklist.length > 0"
                class="cartoon-btn rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300"
                @click="activeTab = 'blacklist'"
              >
                🚫 查看黑名单 ({{ blacklist.length }})
              </button>
            </div>
          </template>
        </div>

        <template v-else>
          <div class="farm-card-enhanced animate-stagger-4 flex flex-wrap animate-fade-in-up items-center gap-2 p-3">
            <div class="flex-1" />
            <button
              v-if="!isMultiSelectMode"
              class="cartoon-btn rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-600"
              :disabled="loading"
              @click="handleBatchBlacklist"
            >
              一键拉黑
            </button>
            <button
              v-if="!isMultiSelectMode"
              class="cartoon-btn rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-600"
              :disabled="loading"
              @click="handleBatchWhitelist"
            >
              一键拉白
            </button>
            <button
              v-if="!isMultiSelectMode"
              class="cartoon-btn rounded-xl bg-indigo-100 px-3 py-1.5 text-sm text-indigo-700 transition dark:bg-indigo-900/30 hover:bg-indigo-200 dark:text-indigo-400 dark:hover:bg-indigo-900/50"
              @click="enterMultiSelectMode"
            >
              ☑️ 多选
            </button>
            <template v-else>
              <span class="text-sm text-gray-600 dark:text-gray-300">
                已选 <span class="font-bold text-indigo-600 dark:text-indigo-400">{{ selectedCount.toLocaleString('zh-CN') }}</span>/{{ filteredSortedFriends.length.toLocaleString('zh-CN') }} 人
              </span>
              <button
                class="cartoon-btn rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300"
                :disabled="multiSelectBusy"
                @click="toggleSelectAllVisible"
              >
                {{ allVisibleSelected ? '取消全选' : '全选当前页' }}
              </button>
              <button
                class="cartoon-btn rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300"
                :disabled="selectedCount === 0 || multiSelectBusy"
                @click="clearSelection"
              >
                清空选择
              </button>
              <button
                class="cartoon-btn rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300"
                :disabled="multiSelectBusy"
                @click="exitMultiSelectMode"
              >
                ❌ 退出多选
              </button>
            </template>
            <button
              class="cartoon-btn rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-600"
              :disabled="loading"
              @click="handleRefreshFriends"
            >
              <div v-if="loading" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
              刷新列表
            </button>
          </div>

          <!-- 排序 + 筛选 -->
          <div class="farm-card-enhanced animate-stagger-4 p-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs text-gray-500 dark:text-gray-400 shrink-0">排序</span>
              <button
                v-for="opt in sortOptions"
                :key="opt.key"
                class="cartoon-btn flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition"
                :class="friendSortKey === opt.key
                  ? 'border-blue-400 bg-blue-50 text-blue-700 font-bold dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                @click="toggleSort(opt.key)"
              >
                {{ opt.label }}
                <span v-if="friendSortKey === opt.key" class="opacity-70">
                  {{ friendSortOrder === 'desc' ? '↓' : '↑' }}
                </span>
              </button>
              <span class="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
              <span class="text-xs text-gray-500 dark:text-gray-400 shrink-0">筛选</span>
              <button
                v-for="chip in filterChips"
                :key="chip.key"
                class="cartoon-btn rounded-lg border px-2 py-1 text-xs transition"
                :class="friendFilters[chip.key]
                  ? chip.activeClass + ' font-bold'
                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'"
                @click="toggleFilterChip(chip.key)"
              >
                {{ chip.label }}
              </button>
              <button
                class="cartoon-btn rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-500 transition dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                :class="showFilterPanel ? '!bg-amber-50 !text-amber-700 dark:!bg-amber-900/30 dark:!text-amber-300' : ''"
                @click="showFilterPanel = !showFilterPanel"
              >
                📊 等级 {{ showFilterPanel ? '×' : '+' }}
              </button>
              <button
                v-if="hasActiveFilter"
                class="cartoon-btn rounded-lg border border-orange-200 bg-orange-50 px-2 py-1 text-xs text-orange-700 transition hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/20 dark:text-orange-300"
                @click="resetFriendFilters"
              >
                🔄 重置
              </button>
            </div>
            <div v-if="showFilterPanel" class="mt-2 flex flex-wrap items-center gap-2 border-t pt-2 dark:border-gray-700">
              <span class="text-xs text-gray-500 dark:text-gray-400 shrink-0">等级范围</span>
              <input
                v-model.number="friendLevelMin"
                type="number"
                min="0"
                placeholder="最小"
                class="farm-input w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
              <span class="text-xs text-gray-400">~</span>
              <input
                v-model.number="friendLevelMax"
                type="number"
                min="0"
                placeholder="最大"
                class="farm-input w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
              <button
                v-for="r in levelPresets"
                :key="r.label"
                class="cartoon-btn rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                @click="friendLevelMin = r.min; friendLevelMax = r.max"
              >
                {{ r.label }}
              </button>
            </div>
          </div>

          <div
            v-for="(friend, idx) in paginatedFriends"
            :key="friend.gid"
            class="farm-card-enhanced animate-fade-in-up overflow-hidden transition-all"
            :class="[
              isMultiSelectMode && selectedFriendGids.has(String(friend.gid))
                ? 'ring-2 ring-indigo-400 dark:ring-indigo-500'
                : '',
            ]"
            :style="{ animationDelay: `${0.05 * (idx + 5)}s` }"
          >
            <div
              class="relative flex flex-col cursor-pointer justify-between gap-4 p-4 transition-all duration-300 sm:flex-row hover:scale-[1.01] sm:items-center"
              :class="[
                blacklistGidSet.has(Number(friend.gid)) ? 'opacity-60' : '',
                expandedFriends.has(friend.gid) && !isMultiSelectMode ? 'bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-900/10' : '',
              ]"
              @click="isMultiSelectMode ? toggleSelectFriend(String(friend.gid)) : toggleFriend(friend.gid)"
            >
              <div
                v-if="expandedFriends.has(friend.gid) && !isMultiSelectMode"
                class="absolute bottom-0 left-0 top-0 w-1 rounded-l-2xl"
                :style="{ backgroundColor: 'var(--theme-primary)' }"
              />
              <div class="flex items-center gap-3 min-w-0 flex-1">
                <!-- 多选模式下的复选框 -->
                <div
                  v-if="isMultiSelectMode"
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-all"
                  :class="selectedFriendGids.has(String(friend.gid))
                    ? 'border-indigo-500 bg-indigo-500 text-white dark:border-indigo-400 dark:bg-indigo-500'
                    : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700'"
                  @click.stop="toggleSelectFriend(String(friend.gid))"
                >
                  <span v-if="selectedFriendGids.has(String(friend.gid))" class="text-xs">✓</span>
                </div>
                <div class="relative h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-2 ring-amber-200/50 dark:bg-gray-600 dark:ring-amber-700/30">
                  <img
                    v-if="canShowFriendAvatar(friend)"
                    :src="getFriendAvatar(friend)"
                    class="h-full w-full object-cover"
                    loading="lazy"
                    @error="handleFriendAvatarError(friend)"
                  >
                  <span v-else class="text-gray-400">👤</span>
                  <div v-if="!blacklistGidSet.has(Number(friend.gid))" class="animate-online-pulse absolute h-3.5 w-3.5 border-2 border-white rounded-full bg-green-500 -bottom-0.5 -right-0.5 dark:border-gray-800" />
                </div>
                <div>
                  <div class="flex items-center gap-2 font-bold">
                    {{ friend.name }}
                    <span class="text-xs text-gray-400 font-normal">({{ friend.gid }})</span>

                    <span v-if="blacklistGidSet.has(Number(friend.gid))" class="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">已屏蔽</span>
                    <span v-if="guardDogBlacklistGidSet.has(Number(friend.gid))" class="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">护黑</span>
                    <span v-if="guardDogWhitelistGidSet.has(Number(friend.gid))" class="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">护白</span>
                  </div>
                  <div class="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      v-if="getFriendLevel(friend) > 0"
                      class="level-badge"
                    >
                      Lv.{{ getFriendLevel(friend) }}
                    </span>
                    <span
                      v-if="getFriendGold(friend) > 0"
                      class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 font-bold dark:bg-amber-900/20 dark:text-amber-300"
                    >
                      💰 {{ formatFriendGold(friend.gold) }}
                    </span>
                  </div>
                  <div class="mt-1 text-sm" :class="getFriendStatusText(friend) !== '无操作' ? 'text-green-500 font-medium' : 'text-gray-400'">
                    <span v-if="getFriendStatusText(friend) !== '无操作'" class="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-600 font-bold dark:bg-green-900/20 dark:text-green-400">
                      ✨ {{ getFriendStatusText(friend) }}
                    </span>
                    <span v-else class="text-gray-400">{{ getFriendStatusText(friend) }}</span>
                  </div>
                </div>
              </div>

              <div v-if="!isMultiSelectMode" class="flex flex-wrap gap-2">
                <button
                  class="cartoon-btn rounded-xl bg-blue-100 px-3 py-2 text-sm text-blue-700 transition dark:bg-blue-900/30 hover:bg-blue-200 dark:text-blue-400 dark:hover:bg-blue-900/50"
                  @click="handleOp(friend.gid, 'steal', $event)"
                >
                  🥬 偷取
                </button>
                <button
                  class="cartoon-btn rounded-xl bg-green-100 px-3 py-2 text-sm text-green-700 transition dark:bg-green-900/30 hover:bg-green-200 dark:text-green-400 dark:hover:bg-green-900/50"
                  @click="handleOp(friend.gid, 'farming', $event)"
                >
                  🌱 一键务农
                </button>
                <button
                  class="cartoon-btn rounded-xl bg-red-100 px-3 py-2 text-sm text-red-700 transition dark:bg-red-900/30 hover:bg-red-200 dark:text-red-400 dark:hover:bg-red-900/50"
                  @click="handleOp(friend.gid, 'bad', $event)"
                >
                  💀 捣乱
                </button>
                <button
                  class="cartoon-btn rounded-xl px-3 py-2 text-sm transition"
                  :class="blacklistGidSet.has(Number(friend.gid))
                    ? 'bg-gray-200 text-gray-600 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700/50 dark:text-gray-400 dark:hover:bg-gray-700'"
                  @click="handleToggleBlacklist(friend, $event)"
                >
                  {{ blacklistGidSet.has(Number(friend.gid)) ? '⬆️ 移出黑名单' : '🚫 加入黑名单' }}
                </button>
                <button
                  class="cartoon-btn rounded-xl px-3 py-2 text-sm transition"
                  :class="guardDogBlacklistGidSet.has(Number(friend.gid))
                    ? 'bg-red-200 text-red-700 hover:bg-red-300 dark:bg-red-900/40 dark:text-red-300'
                    : 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30'"
                  :title="guardDogBlacklistGidSet.has(Number(friend.gid)) ? '已在护主犬帮忙黑名单，点此移除' : '加入护主犬帮忙黑名单（强制跳过帮忙）'"
                  @click="handleToggleGuardDogBlacklist(friend, $event)"
                >
                  {{ guardDogBlacklistGidSet.has(Number(friend.gid)) ? '🚫 护黑' : '🚫 护黑' }}
                </button>
                <button
                  class="cartoon-btn rounded-xl px-3 py-2 text-sm transition"
                  :class="guardDogWhitelistGidSet.has(Number(friend.gid))
                    ? 'bg-green-200 text-green-700 hover:bg-green-300 dark:bg-green-900/40 dark:text-green-300'
                    : 'bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30'"
                  :title="guardDogWhitelistGidSet.has(Number(friend.gid)) ? '已在护主犬帮忙白名单，点此移除' : '加入护主犬帮忙白名单（只帮白名单内 gid）'"
                  @click="handleToggleGuardDogWhitelist(friend, $event)"
                >
                  {{ guardDogWhitelistGidSet.has(Number(friend.gid)) ? '✅ 护白' : '✅ 护白' }}
                </button>
                <button
                  v-if="isQqAccount && knownFriendGidSet.has(Number(friend.gid))"
                  class="cartoon-btn rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-700 transition dark:bg-amber-900/30 hover:bg-amber-200 dark:text-amber-400 dark:hover:bg-amber-900/50"
                  @click="handleRemoveKnownFriendGid(friend, $event)"
                >
                  📋 移出同步列表
                </button>
                <!-- 游戏内拉黑好友（游戏服务端实现了 BlockFriend RPC） -->
                <button
                  class="cartoon-btn rounded-xl bg-red-100 px-3 py-2 text-sm text-red-700 transition dark:bg-red-900/30 hover:bg-red-200 dark:text-red-400 dark:hover:bg-red-900/50"
                  title="调用游戏 BlockFriend 接口拉黑此好友"
                  @click="handleBlockFriend(friend, $event)"
                >
                  🚫 拉黑
                </button>
              </div>
            </div>

            <div v-if="expandedFriends.has(friend.gid) && !isMultiSelectMode" class="border-t p-4 dark:border-gray-700" :style="{ background: 'linear-gradient(180deg, rgba(139,105,20,0.03) 0%, transparent 100%)' }">
              <div v-if="friendLandsLoading[friend.gid]" class="flex justify-center py-4">
                <div class="i-svg-spinners-90-ring-with-bg text-2xl text-blue-500" />
              </div>
              <div v-else-if="!friendLands[friend.gid] || friendLands[friend.gid]?.length === 0" class="py-4 text-center text-gray-500">
                无土地数据
              </div>
              <div v-else class="grid grid-cols-2 gap-2 lg:grid-cols-8 md:grid-cols-5 sm:grid-cols-4">
                <LandCard
                  v-for="land in friendLands[friend.gid]"
                  :key="land.id"
                  :land="land"
                />
              </div>
            </div>
          </div>

          <!-- 分页控件 -->
          <div v-if="filteredSortedFriends.length > pageSize" class="animate-stagger-7 mt-4 flex flex-wrap animate-fade-in-up items-center justify-center gap-2">
            <button
              class="cartoon-btn border border-gray-200 rounded-xl bg-white px-3 py-1.5 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-800 hover:bg-gray-50 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-700"
              :disabled="currentPage === 1"
              @click="goToPage(1)"
            >
              🏠 首页
            </button>
            <button
              class="cartoon-btn border border-gray-200 rounded-xl bg-white px-3 py-1.5 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-800 hover:bg-gray-50 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-700"
              :disabled="currentPage === 1"
              @click="goToPage(currentPage - 1)"
            >
              ⬅️ 上一页
            </button>
            <div class="flex items-center gap-1">
              <template v-for="p in totalPages" :key="p">
                <button
                  v-if="p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)"
                  class="h-8 w-8 rounded-xl text-sm font-bold transition-all duration-200"
                  :class="p === currentPage
                    ? 'text-white scale-110 shadow-md'
                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:scale-105 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
                  :style="p === currentPage ? { backgroundColor: 'var(--theme-primary)', boxShadow: '0 4px 12px color-mix(in srgb, var(--theme-primary), 40%, transparent)' } : {}"
                  @click="goToPage(p)"
                >
                  {{ p }}
                </button>
                <span
                  v-else-if="p === currentPage - 2 || p === currentPage + 2"
                  class="px-1 text-gray-400"
                >...</span>
              </template>
            </div>
            <button
              class="cartoon-btn border border-gray-200 rounded-xl bg-white px-3 py-1.5 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-800 hover:bg-gray-50 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-700"
              :disabled="currentPage === totalPages"
              @click="goToPage(currentPage + 1)"
            >
              下一页 ➡️
            </button>
            <button
              class="cartoon-btn border border-gray-200 rounded-xl bg-white px-3 py-1.5 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-800 hover:bg-gray-50 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-700"
              :disabled="currentPage === totalPages"
              @click="goToPage(totalPages)"
            >
              🏁 末页
            </button>
            <span class="text-sm text-gray-500 dark:text-gray-400">
              共 <span class="text-amber-600 font-bold dark:text-amber-400">{{ filteredSortedFriends.length.toLocaleString('zh-CN') }}</span> 位好友
            </span>
          </div>
        </template>
      </div>

      <div v-else-if="activeTab === 'applications'" class="space-y-4">
        <div class="farm-card-enhanced animate-stagger-3 mb-1 flex flex-wrap animate-fade-in-up items-center gap-2 p-3">
          <div class="flex flex-1 items-center gap-2">
            <span class="text-lg">📨</span>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              在此查看并处理向你发起的好友申请，可单独或批量同意/拒绝。
            </p>
          </div>
          <button
            class="cartoon-btn rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-600"
            :disabled="applicationsLoading || applicationActionLoading"
            @click="refreshApplications"
          >
            🔄 刷新
          </button>
          <button
            v-if="applications.length > 0"
            class="cartoon-btn rounded-xl bg-green-100 px-3 py-1.5 text-sm text-green-700 transition dark:bg-green-900/30 hover:bg-green-200 dark:text-green-400 disabled:opacity-50 dark:hover:bg-green-900/50"
            :disabled="applicationActionLoading"
            @click="handleAcceptAllApplications"
          >
            ✅ 全部同意
          </button>
          <button
            v-if="applications.length > 0"
            class="cartoon-btn rounded-xl bg-red-100 px-3 py-1.5 text-sm text-red-700 transition dark:bg-red-900/30 hover:bg-red-200 dark:text-red-400 disabled:opacity-50 dark:hover:bg-red-900/50"
            :disabled="applicationActionLoading"
            @click="handleRejectAllApplications"
          >
            ❌ 全部拒绝
          </button>
          <button
            class="cartoon-btn rounded-xl px-3 py-1.5 text-sm transition"
            :class="friendStore.blockApplications
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'"
            :disabled="applicationActionLoading"
            :title="friendStore.blockApplications ? '当前已开启：拒绝所有向你发起的好友申请' : '当前已关闭：允许他人向你发起好友申请'"
            @click="handleToggleBlockApplications"
          >
            🛡 {{ friendStore.blockApplications ? '屏蔽申请：开' : '屏蔽申请：关' }}
          </button>
        </div>

        <div v-if="!!applicationsError" class="farm-card-enhanced animate-stagger-4 animate-fade-in-up p-6 text-center text-sm text-red-600 dark:text-red-300" style="background: linear-gradient(145deg, #fef2f2 0%, #fee2e2 100%);">
          <span class="text-2xl">⚠️</span>
          <div class="mt-2">
            {{ applicationsError }}
          </div>
        </div>

        <div v-else-if="applications.length === 0" class="farm-card-enhanced animate-stagger-4 animate-fade-in-up p-8 text-center text-gray-500">
          <div class="animate-float-slow mx-auto mb-3 text-4xl text-gray-300">
            📭
          </div>
          <div class="text-lg font-display">
            暂无好友申请
          </div>
          <div class="mt-1 text-sm text-gray-400">
            新的好友申请会显示在这里
          </div>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="(app, idx) in applications"
            :key="app.gid"
            class="farm-card-enhanced flex animate-fade-in-up items-center gap-3 p-4 transition-all duration-300 hover:scale-[1.01]"
            :style="{ animationDelay: `${0.05 * (idx + 4)}s` }"
          >
            <div class="relative h-12 w-12 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-2 ring-blue-200/50 dark:bg-gray-700 dark:ring-blue-700/30">
              <img
                v-if="canShowApplicationAvatar(app)"
                :src="getApplicationAvatar(app)"
                class="h-full w-full object-cover"
                loading="lazy"
                @error="handleApplicationAvatarError(app)"
              >
              <span v-else class="text-xl text-gray-400">👤</span>
              <div class="animate-online-pulse absolute h-3.5 w-3.5 border-2 border-white rounded-full bg-blue-500 -bottom-0.5 -right-0.5 dark:border-gray-800" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="mb-1 flex flex-wrap items-center gap-2">
                <span class="max-w-full truncate text-base text-gray-800 font-bold dark:text-gray-100">
                  {{ app.name || `GID:${app.gid}` }}
                </span>
                <span v-if="Number(app.level) > 0" class="level-badge" style="font-size: 10px; padding: 2px 8px;">
                  Lv.{{ app.level }}
                </span>
                <span class="text-xs text-gray-400 font-mono">
                  GID {{ app.gid }}
                </span>
              </div>
              <div class="text-xs text-gray-400">
                🕐 {{ formatApplicationTime(app.timeAt) }}
              </div>
            </div>
            <div class="flex shrink-0 gap-2">
              <button
                class="cartoon-btn rounded-xl bg-green-100 px-3 py-2 text-sm text-green-700 transition dark:bg-green-900/30 hover:bg-green-200 dark:text-green-400 disabled:opacity-50 dark:hover:bg-green-900/50"
                :disabled="applicationActionLoading"
                @click="handleAcceptApplication(app, $event)"
              >
                ✅ 同意
              </button>
              <button
                class="cartoon-btn rounded-xl bg-red-100 px-3 py-2 text-sm text-red-700 transition dark:bg-red-900/30 hover:bg-red-200 dark:text-red-400 disabled:opacity-50 dark:hover:bg-red-900/50"
                :disabled="applicationActionLoading"
                @click="handleRejectApplication(app, $event)"
              >
                ❌ 拒绝
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="activeTab === 'blacklist'" class="space-y-4">
        <div class="farm-card-enhanced animate-stagger-3 animate-fade-in-up p-5">
          <div class="flex items-center gap-2">
            <span class="text-xl">🚫</span>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              加入黑名单的好友在自动偷菜和帮助时会被跳过。
            </p>
          </div>
        </div>
        <div v-if="blacklist.length === 0" class="farm-card-enhanced animate-stagger-4 animate-fade-in-up p-8 text-center text-gray-500">
          <div class="animate-float-slow mx-auto mb-3 text-4xl text-gray-300">
            🚫
          </div>
          <div class="text-lg font-display">
            暂无黑名单好友
          </div>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="(item, idx) in blacklist"
            :key="item.gid"
            class="farm-card-enhanced flex animate-fade-in-up items-center justify-between p-4 transition-all duration-300 hover:scale-[1.01]"
            :style="{ animationDelay: `${0.05 * (idx + 4)}s` }"
          >
            <div class="flex items-center gap-3">
              <div class="relative h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-2 ring-red-200/50 dark:bg-gray-600 dark:ring-red-700/30">
                <img
                  v-if="item.avatarUrl"
                  :src="item.avatarUrl"
                  class="h-full w-full object-cover"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                >
                <span v-else class="text-gray-400">👤</span>
                <div class="absolute h-3.5 w-3.5 border-2 border-white rounded-full bg-red-500 -bottom-0.5 -right-0.5 dark:border-gray-800" />
              </div>
              <div class="min-w-0 flex flex-col">
                <div class="flex items-center gap-2">
                  <span class="font-bold">{{ item.name || `GID:${item.gid}` }}</span>
                  <span
                    v-if="item.level"
                    class="flex shrink-0 items-center gap-0.5 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                    :title="`等级 ${item.level}`"
                  >
                    <span>⭐</span>
                    <span class="font-semibold">Lv.{{ item.level }}</span>
                  </span>
                </div>
                <span class="text-sm text-gray-400">({{ item.gid }})</span>
              </div>
            </div>
            <button
              class="cartoon-btn rounded-xl bg-green-100 px-3 py-1.5 text-sm text-green-700 dark:bg-green-900/30 hover:bg-green-200 dark:text-green-400 dark:hover:bg-green-900/50"
              @click="handleRemoveFromBlacklist(item.gid)"
            >
              ⬆️ 移出黑名单
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="activeTab === 'deleted'" class="space-y-4">
        <div class="farm-card-enhanced animate-stagger-3 animate-fade-in-up p-5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xl">💔</span>
            <p class="flex-1 text-sm text-gray-500 dark:text-gray-400">
              系统通过对比好友列表快照自动记录被好友删除的 GID，可用于追溯关系变化。
            </p>
            <button
              class="cartoon-btn rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-600"
              :disabled="deletedRecordsLoading"
              @click="refreshDeletedRecords"
            >
              🔄 刷新
            </button>
            <button
              v-if="deletedRecords.length > 0"
              class="cartoon-btn rounded-xl bg-red-100 px-3 py-1.5 text-sm text-red-700 transition dark:bg-red-900/30 hover:bg-red-200 dark:text-red-400 disabled:opacity-50 dark:hover:bg-red-900/50"
              :disabled="deletedRecordsActionLoading"
              @click="handleClearDeletedRecords"
            >
              🗑️ 清空记录
            </button>
          </div>
        </div>

        <div v-if="deletedRecords.length === 0" class="farm-card-enhanced animate-stagger-4 animate-fade-in-up p-8 text-center text-gray-500">
          <div class="animate-float-slow mx-auto mb-3 text-4xl text-gray-300">
            💔
          </div>
          <div class="text-lg font-display">
            暂无被删记录
          </div>
          <div class="mt-1 text-sm text-gray-400">
            第一次拉取好友列表时会建立基准快照，之后若发现好友消失会记录在此
          </div>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="(item, idx) in deletedRecords"
            :key="`${item.gid}-${item.deletedAt}`"
            class="farm-card-enhanced flex animate-fade-in-up items-center justify-between p-4 transition-all duration-300 hover:scale-[1.01]"
            :style="{ animationDelay: `${0.05 * (idx + 4)}s` }"
          >
            <div class="flex items-center gap-3">
              <div class="relative h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-2 ring-pink-200/50 dark:bg-gray-600 dark:ring-pink-700/30">
                <img
                  v-if="item.avatarUrl"
                  :src="item.avatarUrl"
                  class="h-full w-full object-cover"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                >
                <span v-else class="text-gray-400">👤</span>
                <div class="absolute h-3.5 w-3.5 border-2 border-white rounded-full bg-pink-500 -bottom-0.5 -right-0.5 dark:border-gray-800" />
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-bold">{{ item.name || `GID:${item.gid}` }}</span>
                  <span class="rounded bg-pink-100 px-1.5 py-0.5 text-xs text-pink-700 font-bold dark:bg-pink-900/30 dark:text-pink-400">已删除</span>
                </div>
                <div class="mt-0.5 text-xs text-gray-400">
                  GID {{ item.gid }} · 💔 {{ formatDeletedAt(item.deletedAt) }}
                </div>
              </div>
            </div>
            <div class="flex shrink-0 gap-2">
              <button
                class="cartoon-btn rounded-xl bg-red-100 px-3 py-1.5 text-sm text-red-700 transition dark:bg-red-900/30 hover:bg-red-200 dark:text-red-400 disabled:opacity-50 dark:hover:bg-red-900/50"
                :disabled="deletedRecordsActionLoading"
                @click="handleBlockDeletedFriend(item)"
              >
                🚫 拉黑
              </button>
              <button
                class="cartoon-btn rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-600"
                :disabled="deletedRecordsActionLoading"
                @click="handleRemoveDeletedRecord(item)"
              >
                ⬆️ 移除记录
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="activeTab === 'guardDog'" class="space-y-4">
        <!-- 护主犬子 Tab 切换 -->
        <div class="farm-card-enhanced animate-fade-in-up p-3">
          <div class="flex flex-wrap gap-2">
            <button
              v-for="tab in guardDogSubTabs"
              :key="tab.key"
              class="cartoon-btn rounded-xl px-3 py-1.5 text-sm font-bold transition-all duration-200"
              :class="guardDogSubTab === tab.key
                ? 'text-white shadow-md scale-105'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 hover:scale-105 dark:hover:bg-gray-600'"
              :style="guardDogSubTab === tab.key ? {
                backgroundColor: tab.color === 'amber' ? '#f59e0b' : tab.color === 'red' ? '#ef4444' : '#10b981',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              } : {}"
              @click="guardDogSubTab = tab.key; handleFetchGuardDogSubTab(tab.key)"
            >
              {{ tab.label }}
              <span
                v-if="(tab.key === 'friends' && guardDogFriends.length > 0)
                  || (tab.key === 'blacklist' && guardDogBlacklist.length > 0)
                  || (tab.key === 'whitelist' && guardDogWhitelist.length > 0)"
                class="ml-1 rounded-full bg-white/30 px-1.5 py-0.5 text-xs"
              >
                {{ tab.key === 'friends' ? guardDogFriends.length
                  : tab.key === 'blacklist' ? guardDogBlacklist.length
                  : guardDogWhitelist.length }}
              </span>
            </button>
          </div>
        </div>

        <!-- 子 Tab: 护主犬清单 -->
        <template v-if="guardDogSubTab === 'friends'">
          <div class="farm-card-enhanced animate-stagger-3 animate-fade-in-up p-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-base shrink-0">🐶</span>
              <span class="text-xs text-gray-500 dark:text-gray-400 shrink-0">自动登记护主犬好友</span>
              <input
                v-model="guardDogBatchInput"
                type="text"
                placeholder="批量加 GID 进来..."
                class="flex-1 min-w-[140px] border farm-input border-gray-300 rounded-lg bg-white px-2 py-1 text-xs dark:border-gray-600 focus:border-amber-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
              <button
                class="cartoon-btn rounded-lg bg-amber-100 px-2 py-1 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 disabled:opacity-50"
                :disabled="guardDogBatchSaving || !guardDogBatchInput.trim()"
                @click="handleBatchAddGuardDogFriends"
              >
                ➕ 加入
              </button>
              <div class="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
              <button
                class="cartoon-btn rounded-lg bg-amber-100 px-2 py-1 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 disabled:opacity-50"
                :disabled="loading || scanningGuardDog"
                @click="handleScanGuardDogFriends"
              >
                <span v-if="scanningGuardDog">⏳ {{ scanProgressText }}</span>
                <span v-else>🔍 扫描</span>
              </button>
              <button
                class="cartoon-btn rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300 disabled:opacity-50"
                :disabled="loading"
                @click="handleRefreshGuardDogFriends"
              >
                🔄 刷新
              </button>
              <button
                v-if="guardDogFriends.length > 0"
                class="cartoon-btn rounded-lg bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400"
                @click="handleClearGuardDogFriends"
              >
                🗑️ 清空
              </button>
            </div>
            <div v-if="scanGuardDogResult" class="mt-2 rounded-lg bg-gray-50 px-2 py-1 text-[10px] text-gray-600 dark:bg-gray-700/50 dark:text-gray-300">
              扫 {{ scanGuardDogResult.scanned }} · 命中 {{ scanGuardDogResult.guardDogCount }} · 新增 {{ scanGuardDogResult.newGids.length }} · 失败 {{ scanGuardDogResult.errorCount }} · 耗时 {{ Math.round(scanGuardDogResult.durationMs / 1000) }}s
              <span v-if="scanGuardDogResult.newGids.length > 0" class="ml-1 text-amber-600 dark:text-amber-400">
                新增：{{ scanGuardDogResult.newGids.join(', ') }}
              </span>
            </div>
            <div v-else-if="scanWasInterrupted" class="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              ⚠️ 上次扫描被中断，请重新点「扫描」
            </div>
          </div>
          <div v-if="guardDogFriends.length === 0" class="farm-card-enhanced animate-stagger-4 animate-fade-in-up px-3 py-4 text-center text-gray-500">
            <div class="text-xs">
              🐶 暂未发现携带护主犬的好友（自动登记）
            </div>
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="(item, idx) in guardDogFriends"
              :key="item.gid"
              class="farm-card-enhanced flex animate-fade-in-up items-center justify-between gap-2 px-3 py-2 transition-all duration-300 hover:scale-[1.01]"
              :style="{ animationDelay: `${0.03 * (idx + 1)}s` }"
            >
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <div class="relative h-8 w-8 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-2 ring-amber-200/50 dark:bg-gray-600 dark:ring-amber-700/30">
                  <img
                    v-if="item.avatarUrl"
                    :src="item.avatarUrl"
                    class="h-full w-full object-cover"
                    loading="lazy"
                    @error="($event.target as HTMLImageElement).style.display = 'none'"
                  >
                  <span v-else class="text-xs text-gray-400">👤</span>
                  <div class="absolute h-4 w-4 border-2 border-white rounded-full bg-amber-500 -bottom-0.5 -right-0.5 flex items-center justify-center text-[8px] dark:border-gray-800">
                    🐶
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5 text-sm">
                    <span class="font-bold truncate">{{ item.name || `GID:${item.gid}` }}</span>
                    <span class="shrink-0 text-xs text-gray-400">({{ item.gid }})</span>
                    <span v-if="(item as any).level" class="shrink-0 text-xs text-gray-500">Lv.{{ (item as any).level }}</span>
                  </div>
                </div>
              </div>
              <div class="flex shrink-0 gap-1">
                <button
                  class="cartoon-btn rounded-lg px-2 py-1 text-xs transition"
                  :class="guardDogBlacklistGidSet.has(Number(item.gid))
                    ? 'bg-red-200 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    : 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30'"
                  :title="guardDogBlacklistGidSet.has(Number(item.gid)) ? '已在护黑，点此移除' : '加入护主犬帮忙黑名单'"
                  @click="handleToggleGuardDogBlacklist({ gid: item.gid }, $event)"
                >
                  🚫
                </button>
                <button
                  class="cartoon-btn rounded-lg px-2 py-1 text-xs transition"
                  :class="guardDogWhitelistGidSet.has(Number(item.gid))
                    ? 'bg-green-200 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    : 'bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30'"
                  :title="guardDogWhitelistGidSet.has(Number(item.gid)) ? '已在护白，点此移除' : '加入护主犬帮忙白名单'"
                  @click="handleToggleGuardDogWhitelist({ gid: item.gid }, $event)"
                >
                  ✅
                </button>
                <button
                  class="cartoon-btn shrink-0 rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  :title="`从护主犬清单中移除`"
                  @click="handleRemoveGuardDogFriend(item.gid)"
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>
        </template>

        <!-- 子 Tab: 帮忙黑名单 -->
        <template v-else-if="guardDogSubTab === 'blacklist'">
          <div class="farm-card-enhanced animate-fade-in-up p-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-base shrink-0">🚫</span>
              <span class="text-xs text-red-600 dark:text-red-400 shrink-0">强制跳过帮忙（优先级最高）</span>
              <input
                v-model="guardDogBatchInput"
                type="text"
                placeholder="批量加 GID 进黑名单..."
                class="flex-1 min-w-[140px] border farm-input border-gray-300 rounded-lg bg-white px-2 py-1 text-xs dark:border-gray-600 focus:border-red-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-red-500"
              />
              <button
                class="cartoon-btn rounded-lg bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400 disabled:opacity-50"
                :disabled="guardDogBatchSaving || !guardDogBatchInput.trim()"
                @click="handleBatchAddGuardDogBlacklist"
              >
                ➕ 加入
              </button>
              <button
                v-if="guardDogBlacklist.length > 0"
                class="cartoon-btn rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                @click="handleClearGuardDogBlacklistList"
              >
                🗑️ 清空
              </button>
            </div>
          </div>

          <div v-if="guardDogBlacklist.length === 0" class="farm-card-enhanced animate-fade-in-up px-3 py-4 text-center text-xs text-gray-500">
            🚫 护主犬帮忙黑名单为空（空名单不生效）
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="(item, idx) in guardDogBlacklist"
              :key="item.gid"
              class="farm-card-enhanced flex animate-fade-in-up items-center justify-between px-3 py-2 transition-all duration-300 hover:scale-[1.01]"
              :style="{ animationDelay: `${0.03 * (idx + 1)}s` }"
            >
              <div class="flex items-center gap-2 min-w-0">
                <div class="relative h-8 w-8 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-2 ring-red-200/50 dark:bg-gray-600 dark:ring-red-700/30">
                  <img
                    v-if="item.avatarUrl"
                    :src="item.avatarUrl"
                    class="h-full w-full object-cover"
                    loading="lazy"
                    @error="($event.target as HTMLImageElement).style.display = 'none'"
                  >
                  <span v-else class="text-xs text-gray-400">👤</span>
                  <div class="absolute h-3 w-3 border-2 border-white rounded-full bg-red-500 -bottom-0.5 -right-0.5 dark:border-gray-800" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5 text-sm">
                    <span class="font-bold truncate">{{ item.name || `GID:${item.gid}` }}</span>
                    <span class="shrink-0 text-xs text-gray-400">({{ item.gid }})</span>
                  </div>
                </div>
              </div>
              <button
                class="cartoon-btn shrink-0 rounded-lg bg-green-100 px-2 py-1 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400"
                @click="handleRemoveGuardDogBlacklistItem(item.gid)"
              >
                ⬆️
              </button>
            </div>
          </div>
        </template>

        <!-- 子 Tab: 帮忙白名单 -->
        <template v-else>
          <div class="farm-card-enhanced animate-fade-in-up p-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-base shrink-0">✅</span>
              <span class="text-xs text-green-600 dark:text-green-400 shrink-0">只帮白名单内 gid（覆盖护主犬检测）</span>
              <input
                v-model="guardDogBatchInput"
                type="text"
                placeholder="批量加 GID 进白名单..."
                class="flex-1 min-w-[140px] border farm-input border-gray-300 rounded-lg bg-white px-2 py-1 text-xs dark:border-gray-600 focus:border-green-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              <button
                class="cartoon-btn rounded-lg bg-green-100 px-2 py-1 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400 disabled:opacity-50"
                :disabled="guardDogBatchSaving || !guardDogBatchInput.trim()"
                @click="handleBatchAddGuardDogWhitelist"
              >
                ➕ 加入
              </button>
              <button
                v-if="guardDogWhitelist.length > 0"
                class="cartoon-btn rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                @click="handleClearGuardDogWhitelistList"
              >
                🗑️ 清空
              </button>
            </div>
          </div>

          <div v-if="guardDogWhitelist.length === 0" class="farm-card-enhanced animate-fade-in-up px-3 py-4 text-center text-xs text-gray-500">
            ✅ 护主犬帮忙白名单为空（空名单时回退到护主犬检测）
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="(item, idx) in guardDogWhitelist"
              :key="item.gid"
              class="farm-card-enhanced flex animate-fade-in-up items-center justify-between px-3 py-2 transition-all duration-300 hover:scale-[1.01]"
              :style="{ animationDelay: `${0.03 * (idx + 1)}s` }"
            >
              <div class="flex items-center gap-2 min-w-0">
                <div class="relative h-8 w-8 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-2 ring-green-200/50 dark:bg-gray-600 dark:ring-green-700/30">
                  <img
                    v-if="item.avatarUrl"
                    :src="item.avatarUrl"
                    class="h-full w-full object-cover"
                    loading="lazy"
                    @error="($event.target as HTMLImageElement).style.display = 'none'"
                  >
                  <span v-else class="text-xs text-gray-400">👤</span>
                  <div class="absolute h-3 w-3 border-2 border-white rounded-full bg-green-500 -bottom-0.5 -right-0.5 dark:border-gray-800" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5 text-sm">
                    <span class="font-bold truncate">{{ item.name || `GID:${item.gid}` }}</span>
                    <span class="shrink-0 text-xs text-gray-400">({{ item.gid }})</span>
                  </div>
                </div>
              </div>
              <button
                class="cartoon-btn shrink-0 rounded-lg bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400"
                @click="handleRemoveGuardDogWhitelistItem(item.gid)"
              >
                ⬇️
              </button>
            </div>
          </div>
        </template>
      </div>

      <div v-else-if="activeTab === 'visitors'" class="space-y-4">
        <div class="farm-card-enhanced animate-stagger-3 animate-fade-in-up p-4">
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-for="item in interactFilters"
              :key="item.key"
              class="relative cartoon-btn overflow-hidden rounded-full px-3 py-1 text-xs font-bold transition-all duration-300"
              :class="interactFilter === item.key
                ? 'text-white shadow-md scale-105'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 hover:scale-105 dark:hover:bg-gray-600'"
              :style="interactFilter === item.key ? { backgroundColor: 'var(--theme-primary)', boxShadow: '0 4px 12px color-mix(in srgb, var(--theme-primary), 40%, transparent)' } : {}"
              @click="interactFilter = item.key"
            >
              {{ item.label }}
              <div
                v-if="interactFilter === item.key"
                class="pointer-events-none absolute inset-0"
                style="background: linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 50%);"
              />
            </button>
            <button
              class="cartoon-btn rounded-xl bg-gray-100 px-3 py-1.5 text-xs text-gray-600 transition disabled:cursor-not-allowed dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 disabled:opacity-60 dark:hover:bg-gray-600"
              :disabled="interactLoading"
              @click="refreshInteractRecords"
            >
              🔄 {{ interactLoading ? '刷新中...' : '刷新' }}
            </button>
          </div>
        </div>

        <div v-if="!!interactError" class="farm-card-enhanced animate-stagger-4 animate-fade-in-up p-6 text-center text-sm text-red-600 dark:text-red-300" style="background: linear-gradient(145deg, #fef2f2 0%, #fee2e2 100%);">
          <span class="text-2xl">⚠️</span>
          <div class="mt-2">
            {{ interactError }}
          </div>
        </div>

        <div v-else-if="visibleInteractRecords.length === 0" class="farm-card-enhanced animate-stagger-4 animate-fade-in-up p-8 text-center text-gray-500">
          <div class="animate-float-slow mx-auto mb-3 text-4xl text-gray-300">
            👀
          </div>
          <div class="text-lg font-display">
            暂无访客记录
          </div>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="(record, idx) in visibleInteractRecords"
            :key="record.key"
            class="farm-card-enhanced flex animate-fade-in-up items-start gap-3 p-4 transition-all duration-300 hover:scale-[1.01]"
            :style="{ animationDelay: `${0.05 * (idx + 4)}s` }"
          >
            <div class="relative h-12 w-12 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-2 ring-amber-200/50 dark:bg-gray-700 dark:ring-amber-700/30">
              <img
                v-if="canShowInteractAvatar(record)"
                :src="getInteractAvatar(record)"
                class="h-full w-full object-cover"
                loading="lazy"
                @error="handleInteractAvatarError(record)"
              >
              <span v-else class="text-xl text-gray-400">👤</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="mb-1 flex flex-wrap items-center gap-2">
                <span class="max-w-full truncate text-base text-gray-800 font-bold dark:text-gray-100">
                  {{ record.nick || `GID:${record.visitorGid}` }}
                </span>
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-bold"
                  :class="getInteractBadgeClass(record.actionType)"
                >
                  {{ record.actionLabel }}
                </span>
                <span v-if="record.level" class="level-badge" style="font-size: 10px; padding: 2px 8px;">
                  Lv.{{ record.level }}
                </span>
                <span v-if="record.visitorGid" class="text-xs text-gray-400 font-mono">
                  GID {{ record.visitorGid }}
                </span>
              </div>
              <div class="text-sm text-gray-600 dark:text-gray-300">
                {{ record.actionDetail || record.actionLabel }}
              </div>
            </div>
            <div class="shrink-0 text-right text-xs text-gray-400">
              🕐 {{ formatInteractTime(record.serverTimeMs) }}
            </div>
          </div>

          <div v-if="filteredInteractRecords.length > visibleInteractRecords.length" class="pt-2 text-center text-xs text-gray-400">
            <div class="decorative-divider mb-4" />
            仅展示最近 <span class="font-bold">{{ visibleInteractRecords.length.toLocaleString('zh-CN') }}</span> 条
          </div>
        </div>
      </div>
    </template>

    <ConfirmModal
      :show="showConfirm"
      :loading="confirmLoading"
      title="确认操作"
      :message="confirmMessage"
      @confirm="onConfirm"
      @cancel="!confirmLoading && (showConfirm = false)"
    />

    <Teleport to="body">
      <!-- 多选模式底部操作栏 -->
      <div
        v-if="isMultiSelectMode"
        class="fixed bottom-0 left-0 right-0 z-40 border-t-2 border-indigo-200 bg-white/95 shadow-2xl backdrop-blur dark:border-indigo-800 dark:bg-gray-800/95"
        style="padding-bottom: env(safe-area-inset-bottom, 0);"
      >
        <div class="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-3">
          <span class="text-sm text-gray-600 dark:text-gray-300">
            已选 <span class="font-bold text-indigo-600 dark:text-indigo-400">{{ selectedCount.toLocaleString('zh-CN') }}</span> 人
          </span>
          <button
            class="cartoon-btn rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 disabled:opacity-50"
            :disabled="multiSelectBusy"
            @click="toggleSelectAllVisible"
          >
            {{ allVisibleSelected ? '取消全选' : '全选当前页' }}
          </button>
          <button
            class="cartoon-btn rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 disabled:opacity-50"
            :disabled="selectedCount === 0 || multiSelectBusy"
            @click="clearSelection"
          >
            清空选择
          </button>
          <div class="flex-1" />
          <button
            class="cartoon-btn rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 disabled:opacity-50"
            :disabled="multiSelectBusy"
            @click="exitMultiSelectMode"
          >
            ❌ 退出
          </button>
          <button
            class="cartoon-btn rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-700 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-200 disabled:opacity-50"
            :disabled="selectedCount === 0 || multiSelectBusy"
            @click="handleMultiSelectBatchBlacklist"
          >
            🚫 加入黑名单
          </button>
          <button
            class="cartoon-btn rounded-xl bg-green-100 px-3 py-2 text-sm text-green-700 transition dark:bg-green-900/30 hover:bg-green-200 dark:text-green-400 disabled:opacity-50"
            :disabled="selectedCount === 0 || multiSelectBusy"
            @click="handleMultiSelectBatchGuardWhite"
          >
            ✅ 加入白名单
          </button>
          <button
            class="cartoon-btn rounded-xl bg-red-100 px-3 py-2 text-sm text-red-700 transition dark:bg-red-900/30 hover:bg-red-200 dark:text-red-400 disabled:opacity-50"
            :disabled="selectedCount === 0 || multiSelectBusy"
            @click="handleMultiSelectBatchGuardBlack"
          >
            🚫 批量护黑
          </button>
          <button
            class="cartoon-btn rounded-xl bg-green-100 px-3 py-2 text-sm text-green-700 transition dark:bg-green-900/30 hover:bg-green-200 dark:text-green-400 disabled:opacity-50"
            :disabled="selectedCount === 0 || multiSelectBusy"
            @click="handleMultiSelectBatchGuardWhite"
          >
            ✅ 批量护白
          </button>
          <button
            v-if="isQqAccount"
            class="cartoon-btn rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-700 transition dark:bg-amber-900/30 hover:bg-amber-200 dark:text-amber-400 disabled:opacity-50"
            :disabled="selectedCount === 0 || multiSelectBusy"
            @click="handleMultiSelectBatchRemoveFromKnownList"
          >
            📋 移出同步列表
          </button>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="showBatchAddGidModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click.self="showBatchAddGidModal = false"
      >
        <div class="farm-card-enhanced max-w-lg w-full animate-bounce-in p-6">
          <h3 class="mb-4 flex items-center gap-2 text-lg text-gray-800 font-semibold font-display dark:text-gray-100">
            <span class="text-xl">📋</span>
            批量新增 GID
          </h3>
          <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
            ✨ 支持一行一个或用逗号/空格分隔，自动去重
          </p>
          <textarea
            v-model="batchGidInput"
            rows="8"
            placeholder="每行一个 GID，或用逗号、空格分隔&#10;例如：&#10;12345678&#10;87654321&#10;或&#10;12345678, 87654321, 11111111"
            class="mb-4 w-full border farm-input border-gray-300 rounded-xl bg-white p-3 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div class="decorative-divider mb-4" />
          <div class="flex justify-end gap-3">
            <button
              class="cartoon-btn border border-gray-300 rounded-xl bg-white px-4 py-2 text-sm text-gray-700 transition dark:border-gray-600 dark:bg-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-600"
              @click="showBatchAddGidModal = false"
            >
              ❌ 取消
            </button>
            <button
              class="cartoon-btn rounded-xl px-4 py-2 text-sm text-white transition disabled:opacity-50"
              :disabled="knownFriendSettingsSaving || !batchGidInput.trim()"
              :style="{ backgroundColor: 'var(--theme-primary)' }"
              @click="handleBatchAddKnownFriendGids"
            >
              <div v-if="knownFriendSettingsSaving" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
              ✅ 确认添加
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="showGidListModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click.self="showGidListModal = false"
      >
        <div class="farm-card-enhanced max-h-[80vh] max-w-2xl w-full flex flex-col animate-bounce-in overflow-hidden">
          <div class="flex shrink-0 items-center justify-between p-5">
            <div>
              <h3 class="flex items-center gap-2 text-lg text-gray-800 font-semibold font-display dark:text-gray-100">
                <span class="text-xl">📋</span>
                已导入的 GID 列表
              </h3>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                共 <span class="text-amber-600 font-bold dark:text-amber-400">{{ knownFriendGidCount.toLocaleString('zh-CN') }}</span> 个 GID，
                <span class="text-yellow-600 font-bold dark:text-yellow-400">✅ 已同步 {{ syncedGidCount.toLocaleString('zh-CN') }} 个</span>，
                <span class="text-red-600 font-bold dark:text-red-400">❌ 未同步 {{ unsyncedGidCount.toLocaleString('zh-CN') }} 个</span>
              </p>
            </div>
            <button
              class="rounded-xl p-2 text-gray-400 transition hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700"
              @click="showGidListModal = false"
            >
              <span class="text-xl">✕</span>
            </button>
          </div>

          <div class="decorative-divider mx-5" />

          <div class="shrink-0 p-4">
            <div class="flex gap-2">
              <input
                v-model="gidSearchKeyword"
                type="text"
                placeholder="🔍 搜索 GID..."
                class="flex-1 border farm-input border-gray-300 rounded-xl bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
              <button
                class="shrink-0 cartoon-btn rounded-xl bg-red-100 px-3 py-2 text-sm text-red-700 transition dark:bg-red-900/30 hover:bg-red-200 dark:text-red-400 disabled:opacity-50 dark:hover:bg-red-900/50"
                :disabled="knownFriendSettingsSaving || unsyncedGidCount === 0"
                @click="handleRemoveUnsyncedGids"
              >
                <div v-if="knownFriendSettingsSaving" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
                🗑️ 删除未同步 ({{ unsyncedGidCount.toLocaleString('zh-CN') }})
              </button>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto px-5 pb-5">
            <div v-if="filteredKnownFriendGids.length === 0" class="py-8 text-center text-gray-500 dark:text-gray-400">
              <div class="mb-2 text-4xl">
                📭
              </div>
              暂无数据
            </div>
            <div v-else class="grid gap-2 lg:grid-cols-3 sm:grid-cols-2">
              <div
                v-for="item in filteredKnownFriendGids"
                :key="item.gid"
                class="flex items-center justify-between rounded-xl p-2 transition-all duration-200 hover:scale-[1.02]"
                :class="[
                  item.synced
                    ? 'border-2 border-yellow-300 bg-gradient-to-r from-yellow-50 to-amber-50 dark:border-yellow-700/50 dark:from-yellow-900/20 dark:to-amber-900/20'
                    : 'border-2 border-red-300 bg-gradient-to-r from-red-50 to-pink-50 dark:border-red-700/50 dark:from-red-900/20 dark:to-pink-900/20',
                ]"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="text-sm font-bold font-mono"
                    :class="item.synced ? 'text-yellow-700 dark:text-yellow-400' : 'text-red-700 dark:text-red-400'"
                  >
                    {{ item.gid.toLocaleString('zh-CN') }}
                  </span>
                  <span
                    v-if="item.synced"
                    class="rounded-full bg-yellow-200 px-2 py-0.5 text-xs text-yellow-700 font-bold dark:bg-yellow-800/50 dark:text-yellow-300"
                  >
                    ✅ 已同步
                  </span>
                  <span
                    v-else
                    class="rounded-full bg-red-200 px-2 py-0.5 text-xs text-red-700 font-bold dark:bg-red-800/50 dark:text-red-300"
                  >
                    ❌ 未同步
                  </span>
                </div>
                <button
                  class="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900/30"
                  :disabled="knownFriendSettingsSaving"
                  @click="handleRemoveGidFromList(item.gid)"
                >
                  <span class="text-sm">🗑️</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
