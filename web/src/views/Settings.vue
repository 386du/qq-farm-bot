<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import AccountModal from '@/components/AccountModal.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import GoConfigModal from '@/components/GoConfigModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import YybConfigModal from '@/components/YybConfigModal.vue'
import YybLoginModal from '@/components/YybLoginModal.vue'
import { menuRoutes } from '@/router/menu'
import { getPlatformClass, getPlatformLabel, useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useFarmStore } from '@/stores/farm'
import { useGoLoginStore } from '@/stores/go-login'
import { useSettingStore } from '@/stores/setting'
import { useUserStore } from '@/stores/user'
import { useYybLoginStore } from '@/stores/yyb-login'

const router = useRouter()
const appStore = useAppStore()
const accountStore = useAccountStore()
const userStore = useUserStore()
const settingStore = useSettingStore()
const farmStore = useFarmStore()
const yybStore = useYybLoginStore()
const goStore = useGoLoginStore()

const showYybConfig = ref(false)
const showYybLogin = ref(false)
const showGoConfig = ref(false)

function openYybConfig() {
  showYybConfig.value = true
}

function closeYybConfig() {
  showYybConfig.value = false
  yybStore.loadConfig()
}

function openYybLogin() {
  showYybLogin.value = true
}

function closeYybLogin() {
  showYybLogin.value = false
}

function openGoConfig() {
  showGoConfig.value = true
}

function closeGoConfig() {
  showGoConfig.value = false
  goStore.loadConfig()
}

function closeAccountModal() {
  showModal.value = false
}

const activeTab = ref<'account' | 'strategy' | 'automation' | 'user'>(
  (localStorage.getItem('settings-active-tab') as 'account' | 'strategy' | 'automation' | 'user') || 'account',
)

watch(activeTab, (newTab) => {
  localStorage.setItem('settings-active-tab', newTab)
})

const tabs = [
  { key: 'account', label: '账号管理', icon: '👤' },
  { key: 'strategy', label: '策略设置', icon: '⚙️' },
  { key: 'automation', label: '自动控制', icon: '🔄' },
  { key: 'user', label: '用户管理', icon: '👥' },
] as const

const bottomNavItems = computed(() => menuRoutes.filter(item => !item.adminOnly || userStore.isAdminPanelUser))

function isNavItemVisible(item: typeof menuRoutes[number]): boolean {
  return appStore.isBottomNavVisible(item.path, true)
}

function toggleNavItem(item: typeof menuRoutes[number]) {
  appStore.setBottomNavVisible(item.path, !isNavItemVisible(item))
}

function resetNavItems() {
  appStore.resetBottomNav()
}

// ===== 底部栏外观设置 =====
const localBottomNavStyle = ref({ ...appStore.bottomNavStyle })

// 实时保存到 store
watch(localBottomNavStyle, (val) => {
  appStore.setBottomNavStyle(val)
}, { deep: true })

// 预览项（始终 5 个，固定第三个为激活）
const previewNavItems = [
  { path: '', label: '概览', icon: 'i-carbon-home', active: false },
  { path: 'p', label: '个人', icon: 'i-carbon-wheat', active: false },
  { path: 'a', label: '活动', icon: 'i-carbon-calendar', active: true },
  { path: 'f', label: '好友', icon: 'i-carbon-user-multiple', active: false },
  { path: 's', label: '设置', icon: 'i-carbon-settings', active: false },
]

const iconSizeOptions = [
  { value: 'sm' as const, label: '小', icon: 'i-carbon-text-indent-less text-lg' },
  { value: 'md' as const, label: '中', icon: 'i-carbon-text-indent text-2xl' },
  { value: 'lg' as const, label: '大', icon: 'i-carbon-text-indent-more text-3xl' },
]

const navPreviewBorderClass = computed(() => localBottomNavStyle.value.showTopBorder ? 'border-t border-white/40' : '')
const navPreviewStyle = computed(() => ({
  borderRadius: `${localBottomNavStyle.value.borderRadius}px`,
  '--bn-light-alpha': `${localBottomNavStyle.value.backgroundOpacity}%`,
  '--bn-dark-alpha': `${localBottomNavStyle.value.backgroundOpacityDark}%`,
  '--bn-bounce': (localBottomNavStyle.value.bounceIntensity / 100).toString(),
  '--bn-blur': `${(localBottomNavStyle.value.backdropBlur / 100) * 24}px`,
} as Record<string, string | number>))
const navPreviewIconSize = computed(() => {
  switch (localBottomNavStyle.value.iconSize) {
    case 'sm': return 'text-base'
    case 'lg': return 'text-2xl'
    default: return 'text-lg'
  }
})
const navPreviewShouldBounce = computed(() => localBottomNavStyle.value.bounceIntensity > 0)

/** 预览重播 — 改 key 强制重挂载，触发 CSS 动画 */
const previewReplayKey = ref(0)
function replayPreview() {
  previewReplayKey.value++
}

function resetBottomNavStyleLocal() {
  appStore.resetBottomNavStyle()
  localBottomNavStyle.value = { ...appStore.bottomNavStyle }
}

const modalVisible = ref(false)
const modalConfig = ref({
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  isAlert: true,
})

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  modalConfig.value = {
    title: type === 'danger' ? '错误' : '提示',
    message,
    type,
    isAlert: true,
  }
  modalVisible.value = true
}

// ==================== 账号管理 ====================
const { accounts, loading: accountsLoading, currentAccountId } = storeToRefs(accountStore)

const showModal = ref(false)
const showDeleteConfirm = ref(false)
const deleteLoading = ref(false)
const editingAccount = ref<any>(null)
const accountToDelete = ref<any>(null)
const showClearStoppedConfirm = ref(false)
const clearStoppedLoading = ref(false)
const startAllLoading = ref(false)

const isAccountOpsDisabled = computed(() => !userStore.isAdmin && userStore.isExpired)
const quotaLimit = computed(() => {
  const limit = userStore.accountLimit
  if (limit === undefined || limit === null)
    return 3
  return limit
})
const isOverQuota = computed(() => {
  if (userStore.isAdmin)
    return false
  const limit = quotaLimit.value
  if (limit === -1)
    return false
  return accounts.value.length >= limit
})
const isAddAccountDisabled = computed(() => isAccountOpsDisabled.value || isOverQuota.value)
const addAccountDisabledReason = computed(() => {
  if (isAccountOpsDisabled.value)
    return '账号已到期，无法添加账号'
  if (isOverQuota.value)
    return '已超过配额，无法添加账号'
  return ''
})

const stoppedAccounts = computed(() => accounts.value.filter((acc: any) => !acc.running))
const stoppedAccountsCount = computed(() => stoppedAccounts.value.length)
const runningAccounts = computed(() => accounts.value.filter((acc: any) => acc.running))
const runningAccountsCount = computed(() => runningAccounts.value.length)
const hasRunningAccounts = computed(() => runningAccountsCount.value > 0)

onMounted(async () => {
  await accountStore.fetchAccounts()
  yybStore.loadConfig()
  if (!currentAccountId.value && accounts.value.length > 0 && accounts.value[0]) {
    accountStore.selectAccount(String(accounts.value[0].id))
  }
  if (currentAccountId.value) {
    await settingStore.fetchSettings(currentAccountId.value)
    syncLocalStrategySettings()
    syncLocalAutomationSettings()
    syncLocalOfflineSettings()
    await farmStore.fetchSeeds(currentAccountId.value)
  }
})

useIntervalFn(() => {
  accountStore.fetchAccounts()
}, 3000)

function openSettings(account: any) {
  accountStore.selectAccount(account.id)
  router.push('/settings')
}

function openAddModal() {
  editingAccount.value = null
  showModal.value = true
}

function openEditModal(account: any) {
  editingAccount.value = { ...account }
  showModal.value = true
}

async function handleDelete(account: any) {
  accountToDelete.value = account
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  if (accountToDelete.value) {
    try {
      deleteLoading.value = true
      await accountStore.deleteAccount(accountToDelete.value.id)
      accountToDelete.value = null
      showDeleteConfirm.value = false
    }
    finally {
      deleteLoading.value = false
    }
  }
}

async function toggleAccount(account: any) {
  if (account.running) {
    await accountStore.stopAccount(account.id)
  }
  else {
    await accountStore.startAccount(account.id)
  }
}

function handleSaved() {
  accountStore.fetchAccounts()
}

function selectAccount(account: any) {
  if (!account || !account.id)
    return
  accountStore.selectAccount(String(account.id))
}

function openClearStoppedConfirm() {
  if (stoppedAccountsCount.value === 0) {
    showAlert('没有已停止的账号需要清理', 'primary')
    return
  }
  showClearStoppedConfirm.value = true
}

async function confirmClearStopped() {
  clearStoppedLoading.value = true
  try {
    const stoppedIds = stoppedAccounts.value.map((acc: any) => acc.id)
    let deletedCount = 0
    for (const id of stoppedIds) {
      try {
        await accountStore.deleteAccount(id)
        deletedCount++
      }
      catch (e) {
        console.error(`删除账号 ${id} 失败:`, e)
      }
    }
    showClearStoppedConfirm.value = false
    showAlert(`成功清理 ${deletedCount} 个已停止的账号`, 'primary')
    await accountStore.fetchAccounts()
  }
  finally {
    clearStoppedLoading.value = false
  }
}

async function startAllAccounts() {
  const targets = stoppedAccounts.value
  if (targets.length === 0) {
    showAlert('没有已停止的账号需要启动', 'primary')
    return
  }
  if (isAccountOpsDisabled.value) {
    showAlert('账号已到期，无法启动账号', 'danger')
    return
  }
  startAllLoading.value = true
  let successCount = 0
  try {
    for (const acc of targets) {
      try {
        await accountStore.startAccount(acc.id)
        successCount++
      }
      catch (e) {
        console.error(`启动账号 ${acc.id} 失败:`, e)
      }
    }
    showAlert(`一键启动完成，成功 ${successCount}/${targets.length}`, 'primary')
    await accountStore.fetchAccounts()
  }
  finally {
    startAllLoading.value = false
  }
}

async function stopAllAccounts() {
  const targets = runningAccounts.value
  if (targets.length === 0) {
    showAlert('没有运行中的账号需要停止', 'primary')
    return
  }
  startAllLoading.value = true
  let successCount = 0
  try {
    for (const acc of targets) {
      try {
        await accountStore.stopAccount(acc.id)
        successCount++
      }
      catch (e) {
        console.error(`停止账号 ${acc.id} 失败:`, e)
      }
    }
    showAlert(`一键停止完成，成功 ${successCount}/${targets.length}`, 'primary')
    await accountStore.fetchAccounts()
  }
  finally {
    startAllLoading.value = false
  }
}

function handleToggleAllAccounts() {
  if (hasRunningAccounts.value) {
    stopAllAccounts()
  }
  else {
    startAllAccounts()
  }
}

// ==================== 策略设置 ====================
const { settings, loading: settingsLoading } = storeToRefs(settingStore)
const { seeds } = storeToRefs(farmStore)

const strategySaving = ref(false)

const currentAccountName = computed(() => {
  const acc = accounts.value.find((a: any) => a.id === currentAccountId.value)
  return acc ? (acc.name || acc.nick || acc.id) : null
})

const localStrategySettings = ref({
  plantingStrategy: 'max_exp',
  preferredSeedId: 0,
  bagSeedPriority: [] as number[],
  bagSeedFallbackStrategy: 'level',
  stealDelaySeconds: 0,
  plantOrderRandom: false,
  plantDelaySeconds: 0,
  intervals: { farmMin: 2, farmMax: 5, helpMin: 10, helpMax: 15, stealMin: 10, stealMax: 15 },
  friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
})

const plantingStrategyOptions = [
  { label: '优先种植种子', value: 'preferred' },
  { label: '最高等级作物', value: 'level' },
  { label: '最大经验/时', value: 'max_exp' },
  { label: '最大普通肥经验/时', value: 'max_fert_exp' },
  { label: '最大净利润/时', value: 'max_profit' },
  { label: '最大普通肥净利润/时', value: 'max_fert_profit' },
  { label: '背包种子优先', value: 'bag_priority' },
]

const BAG_FALLBACK_STRATEGY_OPTIONS = [
  { label: '最高等级作物', value: 'level' },
  { label: '最大经验/时', value: 'max_exp' },
  { label: '最大普通肥经验/时', value: 'max_fert_exp' },
  { label: '最大净利润/时', value: 'max_profit' },
  { label: '最大普通肥净利润/时', value: 'max_fert_profit' },
  { label: '优先种植种子', value: 'preferred' },
]

interface BagSeedItem {
  seedId: number
  name: string
  count: number
  requiredLevel: number
  plantSize: number
}

const bagSeeds = ref<BagSeedItem[]>([])
const bagSeedsLoading = ref(false)
const bagSeedsError = ref<string | null>(null)
const draggingBagSeedId = ref<number | null>(null)

// 列表的展示顺序 = 背包种子的优先顺序。
// `bagSeedPriority` 完整地按这个顺序保存所有当前背包中的种子，
// 未在列表里的种子会被追加到末尾（按等级倒序、seedId 升序）。
// 任何重排（▲/▼ 按钮、拖拽）都会同步更新 `bagSeedPriority`。
const sortedBagSeeds = computed<BagSeedItem[]>(() => {
  const priority = localStrategySettings.value.bagSeedPriority || []
  const inPriority = new Set(priority)

  const prioritized: BagSeedItem[] = []
  for (const seedId of priority) {
    const seed = bagSeeds.value.find(s => s.seedId === seedId)
    if (seed)
      prioritized.push(seed)
  }

  const rest = bagSeeds.value
    .filter(s => !inPriority.has(s.seedId))
    .sort((a, b) => {
      if (a.requiredLevel !== b.requiredLevel)
        return b.requiredLevel - a.requiredLevel
      return a.seedId - b.seedId
    })

  return [...prioritized, ...rest]
})

function persistBagSeedOrder(ordered: BagSeedItem[]) {
  localStrategySettings.value.bagSeedPriority = ordered.map(s => s.seedId)
}

async function fetchBagSeeds() {
  if (!currentAccountId.value)
    return
  bagSeedsLoading.value = true
  bagSeedsError.value = null
  try {
    const res = await api.get('/api/bag/seeds', {
      headers: { 'x-account-id': currentAccountId.value },
    })
    if (res.data.ok) {
      bagSeeds.value = (res.data.data || []).filter((s: BagSeedItem) => s.plantSize === 1)
    }
  }
  catch (e: any) {
    bagSeedsError.value = e.message || '加载失败'
  }
  finally {
    bagSeedsLoading.value = false
  }
}

function moveBagSeedByIndex(displayIndex: number, direction: -1 | 1) {
  const current = [...sortedBagSeeds.value]
  const targetIndex = displayIndex + direction
  if (targetIndex < 0 || targetIndex >= current.length)
    return
  const tmp = current[displayIndex]!
  current[displayIndex] = current[targetIndex]!
  current[targetIndex] = tmp
  persistBagSeedOrder(current)
}

function resetBagSeedPriority() {
  const natural = [...bagSeeds.value].sort((a, b) => {
    if (a.requiredLevel !== b.requiredLevel)
      return b.requiredLevel - a.requiredLevel
    return a.seedId - b.seedId
  })
  persistBagSeedOrder(natural)
}

function startBagSeedDrag(seedId: number, event: DragEvent) {
  draggingBagSeedId.value = seedId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(seedId))
  }
}

function dragOverBagSeed(_seedId: number, event: DragEvent) {
  if (draggingBagSeedId.value === null)
    return
  event.preventDefault()
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = 'move'
}

function dropBagSeed(targetSeedId: number, event: DragEvent) {
  event.preventDefault()
  const sourceSeedId = draggingBagSeedId.value ?? Number(event.dataTransfer?.getData('text/plain') || '')
  draggingBagSeedId.value = null
  if (!sourceSeedId || sourceSeedId === targetSeedId)
    return

  const current = [...sortedBagSeeds.value]
  const sourceIndex = current.findIndex(s => s.seedId === sourceSeedId)
  const targetIndex = current.findIndex(s => s.seedId === targetSeedId)
  if (sourceIndex < 0 || targetIndex < 0)
    return

  const [moved] = current.splice(sourceIndex, 1)
  const newTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
  current.splice(newTargetIndex, 0, moved!)
  persistBagSeedOrder(current)
}

watchEffect(() => {
  if (localStrategySettings.value.plantingStrategy === 'bag_priority' && currentAccountId.value) {
    fetchBagSeeds()
  }
})

const preferredSeedOptions = computed(() => {
  const options: { label: string, value: number, disabled?: boolean }[] = [{ label: '自动选择', value: 0, disabled: false }]
  if (seeds.value) {
    options.push(...seeds.value.map(seed => ({
      label: `${seed.requiredLevel}级 ${seed.name} (${seed.price}金)`,
      value: seed.seedId,
      disabled: seed.locked || seed.soldOut,
    })))
  }
  return options
})

const analyticsSortByMap: Record<string, string> = {
  max_exp: 'exp',
  max_fert_exp: 'fert',
  max_profit: 'profit',
  max_fert_profit: 'fert_profit',
}

const strategyPreviewLabel = ref<string | null>(null)

watchEffect(async () => {
  let strategy = localStrategySettings.value.plantingStrategy
  if (strategy === 'preferred') {
    strategyPreviewLabel.value = null
    return
  }
  if (strategy === 'bag_priority') {
    strategy = localStrategySettings.value.bagSeedFallbackStrategy || 'level'
    if (strategy === 'preferred') {
      const preferredId = localStrategySettings.value.preferredSeedId
      if (preferredId > 0 && seeds.value) {
        const seed = seeds.value.find(s => s.seedId === preferredId)
        if (seed) {
          strategyPreviewLabel.value = `${seed.requiredLevel}级 ${seed.name}`
        }
        else {
          strategyPreviewLabel.value = '未选择优先种子'
        }
      }
      else {
        strategyPreviewLabel.value = '未选择优先种子'
      }
      return
    }
  }
  if (!seeds.value || seeds.value.length === 0) {
    strategyPreviewLabel.value = null
    return
  }
  const available = seeds.value.filter(s => !s.locked && !s.soldOut)
  if (available.length === 0) {
    strategyPreviewLabel.value = '暂无可用种子'
    return
  }
  if (strategy === 'level') {
    const best = [...available].sort((a, b) => b.requiredLevel - a.requiredLevel)[0]
    strategyPreviewLabel.value = best ? `${best.requiredLevel}级 ${best.name}` : null
    return
  }
  const sortBy = analyticsSortByMap[strategy]
  if (sortBy) {
    try {
      const res = await api.get(`/api/analytics?sort=${sortBy}`)
      const rankings: any[] = res.data.ok ? (res.data.data || []) : []
      const availableIds = new Set(available.map(s => s.seedId))
      const match = rankings.find(r => availableIds.has(Number(r.seedId)))
      if (match) {
        const seed = available.find(s => s.seedId === Number(match.seedId))
        strategyPreviewLabel.value = seed ? `${seed.requiredLevel}级 ${seed.name}` : null
      }
      else {
        strategyPreviewLabel.value = '暂无匹配种子'
      }
    }
    catch {
      strategyPreviewLabel.value = null
    }
  }
})

function syncLocalStrategySettings() {
  if (settings.value) {
    localStrategySettings.value = JSON.parse(JSON.stringify({
      plantingStrategy: settings.value.plantingStrategy,
      preferredSeedId: settings.value.preferredSeedId,
      bagSeedPriority: settings.value.bagSeedPriority ?? [],
      bagSeedFallbackStrategy: settings.value.bagSeedFallbackStrategy ?? 'level',
      stealDelaySeconds: settings.value.stealDelaySeconds ?? 0,
      plantOrderRandom: !!settings.value.plantOrderRandom,
      plantDelaySeconds: settings.value.plantDelaySeconds ?? 0,
      intervals: settings.value.intervals,
      friendQuietHours: settings.value.friendQuietHours,
    }))
  }
}

async function loadStrategyData() {
  if (currentAccountId.value) {
    await settingStore.fetchSettings(currentAccountId.value)
    syncLocalStrategySettings()
    await farmStore.fetchSeeds(currentAccountId.value)
  }
}

async function saveStrategySettings() {
  if (!currentAccountId.value)
    return
  strategySaving.value = true
  try {
    const fullSettings = {
      ...settings.value,
      ...localStrategySettings.value,
      automation: localAutomationSettings.value.automation,
    }
    const res = await settingStore.saveSettings(currentAccountId.value, fullSettings)
    if (res.ok) {
      showAlert('策略设置已保存', 'primary')
    }
    else {
      showAlert(`保存失败: ${res.error}`, 'danger')
    }
  }
  finally {
    strategySaving.value = false
  }
}

watch(currentAccountId, async () => {
  if (currentAccountId.value) {
    await loadStrategyData()
    syncLocalAutomationSettings()
    syncLocalOfflineSettings()
  }
})

// ==================== 自动控制 ====================
const automationSaving = ref(false)

const allFertilizerLandTypes = ['purple-gold', 'gold', 'black', 'red', 'normal']

const fertilizerLandTypeOptions = [
  { label: '紫金土地', value: 'purple-gold' },
  { label: '金土地', value: 'gold' },
  { label: '黑土地', value: 'black' },
  { label: '红土地', value: 'red' },
  { label: '普通土地', value: 'normal' },
]

function normalizeFertilizerLandTypes(input: unknown) {
  const source = Array.isArray(input) ? input : allFertilizerLandTypes
  const normalized: string[] = []
  for (const item of source) {
    const value = String(item || '').trim().toLowerCase()
    if (!allFertilizerLandTypes.includes(value))
      continue
    if (normalized.includes(value))
      continue
    normalized.push(value)
  }
  return normalized
}

const localAutomationSettings = ref({
  automation: {
    farm: false,
    task: false,
    sell: true,
    friend: false,
    farm_push: false,
    land_upgrade: true,
    friend_steal: false,
    friend_help: false,
    friend_help_only_guard_dog: false,
    friend_bad: true,
    friend_help_exp_limit: false,
    friend_auto_accept: false,
    friend_auto_accept_min_level: 0,
    fertilizer_gift: false,
    fertilizer_buy_organic: false,
    fertilizer_buy_normal: false,
    fertilizer: 'normal',
    skip_own_weed_bug: false,
    fertilizer_multi_season: false,
    fertilizer_land_types: [...allFertilizerLandTypes],
    fertilizer_smart_seconds: 300,
  },
  fertilizerBuyOrganicCount: 10,
  fertilizerBuyOrganicThresholdHours: 10,
  fertilizerBuyNormalCount: 10,
  fertilizerBuyNormalThresholdHours: 10,
  fertilizerBuyCheckIntervalMinutes: 30,
})

const fertilizerOptions = [
  { label: '普通 + 有机', value: 'both' },
  { label: '普通 + 快成熟有机', value: 'smart' },
  { label: '仅普通化肥', value: 'normal' },
  { label: '仅有机化肥', value: 'organic' },
  { label: '不施肥', value: 'none' },
]

function syncLocalAutomationSettings() {
  if (settings.value) {
    if (!settings.value.automation) {
      localAutomationSettings.value.automation = {
        farm: false,
        task: false,
        sell: false,
        friend: false,
        farm_push: false,
        land_upgrade: false,
        friend_steal: false,
        friend_help: false,
        friend_help_only_guard_dog: false,
        friend_bad: false,
        friend_help_exp_limit: false,
        friend_auto_accept: false,
        friend_auto_accept_min_level: 0,
        fertilizer_gift: false,
        fertilizer_buy_organic: false,
        fertilizer_buy_normal: false,
        fertilizer: 'none',
        skip_own_weed_bug: false,
        fertilizer_multi_season: false,
        fertilizer_land_types: [...allFertilizerLandTypes],
        fertilizer_smart_seconds: 300,
      }
    }
    else {
      const defaults = {
        farm: false,
        task: false,
        sell: false,
        friend: false,
        farm_push: false,
        land_upgrade: false,
        friend_steal: false,
        friend_help: false,
        friend_help_only_guard_dog: false,
        friend_bad: false,
        friend_help_exp_limit: false,
        friend_auto_accept: false,
        friend_auto_accept_min_level: 0,
        fertilizer_gift: false,
        fertilizer_buy_organic: false,
        fertilizer_buy_normal: false,
        fertilizer: 'none',
        skip_own_weed_bug: false,
        fertilizer_multi_season: false,
        fertilizer_land_types: [...allFertilizerLandTypes],
        fertilizer_smart_seconds: 300,
      }
      localAutomationSettings.value.automation = {
        ...defaults,
        ...settings.value.automation,
      }
    }
    localAutomationSettings.value.automation.fertilizer_land_types = normalizeFertilizerLandTypes(localAutomationSettings.value.automation.fertilizer_land_types)
    if (localAutomationSettings.value.automation.fertilizer_smart_seconds === undefined) {
      localAutomationSettings.value.automation.fertilizer_smart_seconds = 300
    }
    localAutomationSettings.value.fertilizerBuyOrganicCount = settings.value.fertilizerBuyOrganicCount ?? 10
    localAutomationSettings.value.fertilizerBuyOrganicThresholdHours = settings.value.fertilizerBuyOrganicThresholdHours ?? 10
    localAutomationSettings.value.fertilizerBuyNormalCount = settings.value.fertilizerBuyNormalCount ?? 10
    localAutomationSettings.value.fertilizerBuyNormalThresholdHours = settings.value.fertilizerBuyNormalThresholdHours ?? 10
    localAutomationSettings.value.fertilizerBuyCheckIntervalMinutes = settings.value.fertilizerBuyCheckIntervalMinutes ?? 30
  }
}

async function saveAutomationSettings() {
  if (!currentAccountId.value)
    return
  automationSaving.value = true
  try {
    const fullSettings = {
      ...settings.value,
      automation: localAutomationSettings.value.automation,
      fertilizerBuyOrganicCount: localAutomationSettings.value.fertilizerBuyOrganicCount,
      fertilizerBuyOrganicThresholdHours: localAutomationSettings.value.fertilizerBuyOrganicThresholdHours,
      fertilizerBuyNormalCount: localAutomationSettings.value.fertilizerBuyNormalCount,
      fertilizerBuyNormalThresholdHours: localAutomationSettings.value.fertilizerBuyNormalThresholdHours,
      fertilizerBuyCheckIntervalMinutes: localAutomationSettings.value.fertilizerBuyCheckIntervalMinutes,
    }
    const res = await settingStore.saveSettings(currentAccountId.value, fullSettings)
    if (res.ok) {
      showAlert('自动控制设置已保存', 'primary')

      // 如果启用了自动购买化肥，立即检测并购买
      if (localAutomationSettings.value.automation.fertilizer_buy_organic || localAutomationSettings.value.automation.fertilizer_buy_normal) {
        try {
          const buyRes = await api.post('/api/fertilizer/check-and-buy', {
            buyOrganic: localAutomationSettings.value.automation.fertilizer_buy_organic,
            buyNormal: localAutomationSettings.value.automation.fertilizer_buy_normal,
            organicCount: localAutomationSettings.value.fertilizerBuyOrganicCount,
            organicThresholdHours: localAutomationSettings.value.fertilizerBuyOrganicThresholdHours,
            normalCount: localAutomationSettings.value.fertilizerBuyNormalCount,
            normalThresholdHours: localAutomationSettings.value.fertilizerBuyNormalThresholdHours,
          }, {
            headers: { 'x-account-id': currentAccountId.value },
          })
          if (buyRes.data?.ok) {
            const totalBought = (buyRes.data.organicBought || 0) + (buyRes.data.normalBought || 0)
            if (totalBought > 0) {
              showAlert(`已自动购买 ${totalBought} 个化肥`, 'primary')
            }
          }
        }
        catch (e) {
          console.error('检测购买化肥失败', e)
        }
      }
    }
    else {
      showAlert(`保存失败: ${res.error}`, 'danger')
    }
  }
  finally {
    automationSaving.value = false
  }
}

// ==================== 用户管理 ====================
const passwordSaving = ref(false)
const offlineSaving = ref(false)
const offlineTesting = ref(false)

const passwordForm = ref({
  old: '',
  new: '',
  confirm: '',
})

const localOffline = ref({
  channel: 'webhook',
  reloginUrlMode: 'none',
  endpoint: '',
  token: '',
  title: '',
  msg: '',
  offlineDeleteSec: 0,
})

const channelOptions = [
  { label: 'Webhook(自定义接口)', value: 'webhook' },
  { label: 'Qmsg 酱', value: 'qmsg' },
  { label: 'Server 酱', value: 'serverchan' },
  { label: 'Push Plus', value: 'pushplus' },
  { label: 'Push Plus Hxtrip', value: 'pushplushxtrip' },
  { label: '钉钉', value: 'dingtalk' },
  { label: '企业微信', value: 'wecom' },
  { label: 'Bark', value: 'bark' },
  { label: 'Go-cqhttp', value: 'gocqhttp' },
  { label: 'OneBot', value: 'onebot' },
  { label: 'Atri', value: 'atri' },
  { label: 'PushDeer', value: 'pushdeer' },
  { label: 'iGot', value: 'igot' },
  { label: 'Telegram', value: 'telegram' },
  { label: '飞书', value: 'feishu' },
  { label: 'IFTTT', value: 'ifttt' },
  { label: '企业微信群机器人', value: 'wecombot' },
  { label: 'Discord', value: 'discord' },
  { label: 'WxPusher', value: 'wxpusher' },
]

const reloginUrlModeOptions = [
  { label: '不需要', value: 'none' },
  { label: 'QQ直链', value: 'qq_link' },
  { label: '二维码链接', value: 'qr_link' },
]

const CHANNEL_DOCS: Record<string, string> = {
  webhook: '',
  qmsg: 'https://qmsg.zendee.cn/',
  serverchan: 'https://sct.ftqq.com/',
  pushplus: 'https://www.pushplus.plus/',
  pushplushxtrip: 'https://pushplus.hxtrip.com/',
  dingtalk: 'https://open.dingtalk.com/document/group/custom-robot-access',
  wecom: 'https://guole.fun/posts/626/',
  wecombot: 'https://developer.work.weixin.qq.com/document/path/91770',
  bark: 'https://github.com/Finb/Bark',
  gocqhttp: 'https://docs.go-cqhttp.org/api/',
  onebot: 'https://docs.go-cqhttp.org/api/',
  atri: 'https://blog.tianli0.top/',
  pushdeer: 'https://www.pushdeer.com/',
  igot: 'https://push.hellyw.com/',
  telegram: 'https://core.telegram.org/bots',
  feishu: 'https://www.feishu.cn/hc/zh-CN/articles/360024984973',
  ifttt: 'https://ifttt.com/maker_webhooks',
  discord: 'https://discord.com/developers/docs/resources/webhook#execute-webhook',
  wxpusher: 'https://wxpusher.zjiecode.com/docs/#/',
}

const currentChannelDocUrl = computed(() => {
  const key = String(localOffline.value.channel || '').trim().toLowerCase()
  return CHANNEL_DOCS[key] || ''
})

function openChannelDocs() {
  const url = currentChannelDocUrl.value
  if (!url)
    return
  window.open(url, '_blank', 'noopener,noreferrer')
}

function syncLocalOfflineSettings() {
  if (settings.value?.offlineReminder) {
    localOffline.value = JSON.parse(JSON.stringify(settings.value.offlineReminder))
  }
}

watch(settings, () => {
  syncLocalOfflineSettings()
}, { deep: true })

async function handleChangePassword() {
  if (!passwordForm.value.old || !passwordForm.value.new) {
    showAlert('请填写完整', 'danger')
    return
  }
  if (passwordForm.value.new !== passwordForm.value.confirm) {
    showAlert('两次密码输入不一致', 'danger')
    return
  }
  if (passwordForm.value.new.length < 4) {
    showAlert('密码长度至少4位', 'danger')
    return
  }

  passwordSaving.value = true
  try {
    const res = await userStore.changePassword(passwordForm.value.old, passwordForm.value.new)

    if (res.ok) {
      showAlert('密码修改成功，请重新登录', 'primary')
      passwordForm.value = { old: '', new: '', confirm: '' }
      setTimeout(() => {
        userStore.logout()
        window.location.href = '/login'
      }, 1500)
    }
    else {
      showAlert(`修改失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    passwordSaving.value = false
  }
}

async function handleSaveOffline() {
  offlineSaving.value = true
  try {
    const res = await settingStore.saveOfflineConfig(localOffline.value)

    if (res.ok) {
      showAlert('下线提醒设置已保存', 'primary')
    }
    else {
      showAlert(`保存失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    offlineSaving.value = false
  }
}

async function handleTestOffline() {
  offlineTesting.value = true
  try {
    const { data } = await api.post('/api/settings/offline-reminder/test', localOffline.value)
    if (data?.ok) {
      showAlert('测试消息发送成功', 'primary')
    }
    else {
      showAlert(`测试失败: ${data?.error || '未知错误'}`, 'danger')
    }
  }
  catch (e: any) {
    const msg = e?.response?.data?.error || e?.message || '请求失败'
    showAlert(`测试失败: ${msg}`, 'danger')
  }
  finally {
    offlineTesting.value = false
  }
}
</script>

<template>
  <div class="settings-page">
    <div class="mb-4">
      <h1 class="text-2xl text-gray-900 font-bold dark:text-gray-100">
        设置
      </h1>
    </div>

    <div class="farm-card-enhanced overflow-hidden p-0">
      <div class="border-b" :style="{ borderColor: 'color-mix(in srgb, var(--theme-primary) 15%, transparent)' }">
        <nav class="scrollbar-hide flex gap-1.5 overflow-x-auto p-2.5">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="relative flex flex-shrink-0 items-center gap-2 overflow-hidden rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-300"
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
            {{ tab.label }}
            <div
              v-if="activeTab === tab.key"
              class="pointer-events-none absolute inset-0"
              style="background: linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 50%);"
            />
          </button>
        </nav>
      </div>

      <div class="p-5">
        <!-- 账号管理 -->
        <div v-if="activeTab === 'account'" class="space-y-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              账号管理
            </h3>
            <div class="flex flex-wrap gap-2">
              <BaseButton
                variant="secondary"
                size="sm"
                @click="openYybConfig()"
              >
                <span class="mr-2">⚙️</span>
                应用宝配置
              </BaseButton>
              <BaseButton
                variant="secondary"
                size="sm"
                @click="openGoConfig()"
              >
                <span class="mr-2">🧩</span>
                Go 服务配置
              </BaseButton>
              <BaseButton
                variant="secondary"
                size="sm"
                :disabled="yybStore.config.accounts.length === 0"
                @click="openYybLogin()"
              >
                <span class="mr-2">🔑</span>
                一键登录
              </BaseButton>
              <BaseButton
                v-if="userStore.isAdmin"
                variant="secondary"
                size="sm"
                :disabled="stoppedAccountsCount === 0"
                @click="openClearStoppedConfirm"
              >
                <span class="mr-2">🗑️</span>
                <span class="hidden sm:inline">一键清理</span>
                <span class="sm:hidden">清理</span>
                ({{ stoppedAccountsCount }})
              </BaseButton>
              <BaseButton
                variant="primary"
                size="sm"
                :loading="startAllLoading"
                :disabled="accounts.length === 0"
                @click="handleToggleAllAccounts"
              >
                <span class="mr-2">{{ hasRunningAccounts ? '⏹️' : '▶️' }}</span>
                {{ hasRunningAccounts ? '一键停止' : '一键启动' }}
                <span class="ml-1">({{ hasRunningAccounts ? runningAccountsCount : stoppedAccountsCount }})</span>
              </BaseButton>
              <BaseButton
                variant="secondary"
                size="sm"
                :disabled="isAddAccountDisabled"
                :title="addAccountDisabledReason"
                @click="openAddModal()"
              >
                <span class="mr-2">➕</span>
                添加账号
              </BaseButton>
            </div>
          </div>

          <div v-if="accountsLoading && accounts.length === 0" class="py-8 text-center text-gray-500">
            <span class="mb-2 inline-block animate-spin text-2xl">⏳</span>
            <div>加载中...</div>
          </div>

          <div v-else-if="accounts.length === 0" class="farm-card rounded-2xl bg-white py-12 text-center shadow-md dark:bg-gray-800">
            <div class="mb-4 inline-block text-4xl text-gray-400">
              👤
            </div>
            <p class="mb-4 text-gray-500">
              暂无账号
            </p>
            <BaseButton
              variant="text"
              size="sm"
              :disabled="isAddAccountDisabled"
              :title="addAccountDisabledReason"
              @click="openAddModal()"
            >
              立即添加
            </BaseButton>
          </div>

          <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:grid-cols-2 xl:grid-cols-4">
            <div
              v-for="acc in accounts"
              :key="acc.id"
              class="cartoon-card cursor-pointer border rounded-2xl bg-white p-3 shadow-md transition-all duration-200 dark:bg-gray-800 sm:p-4"
              :class="String(currentAccountId) === String(acc.id)
                ? 'ring-2'
                : 'border-transparent'"
              :style="String(currentAccountId) === String(acc.id)
                ? { borderColor: 'var(--theme-primary)', backgroundColor: 'rgba(var(--theme-primary-rgb, 59, 130, 246), 0.1)' }
                : {}"
              @click="selectAccount(acc)"
            >
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div class="min-w-0 flex flex-1 items-center gap-3">
                  <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 sm:h-12 sm:w-12 dark:bg-gray-700">
                    <img v-if="acc.uin" :src="`https://q1.qlogo.cn/g?b=qq&nk=${acc.uin}&s=100`" class="h-full w-full object-cover">
                    <span v-else class="text-xl text-gray-400 sm:text-2xl">👤</span>
                  </div>
                  <div class="min-w-0 flex-1">
                    <h4 class="truncate text-base font-bold sm:text-lg">
                      {{ acc.nick && acc.name ? `${acc.nick} (${acc.name})` : acc.name || acc.nick || acc.id }}
                    </h4>
                    <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span
                        v-if="acc.platform"
                        class="rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight"
                        :class="getPlatformClass(acc.platform)"
                      >
                        {{ getPlatformLabel(acc.platform) }}
                      </span>
                      <span class="truncate text-xs text-gray-500 sm:text-sm">
                        {{ acc.uin || '未绑定' }}
                      </span>
                    </div>
                  </div>
                </div>
                <div class="flex items-center justify-end gap-2 sm:flex-col sm:items-end">
                  <span class="flex items-center gap-1 text-xs text-gray-500 sm:hidden">
                    <div class="h-2 w-2 rounded-full" :class="acc.running ? 'bg-green-500' : 'bg-gray-300'" />
                    {{ acc.running ? '运行中' : '已停止' }}
                  </span>
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    class="border rounded-full shadow-sm transition-all duration-500 ease-in-out sm:w-20 active:scale-95"
                    :class="acc.running ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 focus:ring-red-500 active:border-red-300 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 dark:focus:ring-red-500 dark:active:border-red-700' : 'border-current bg-current/10 hover:bg-current/20 focus:ring-current active:current/30 dark:bg-current/20 dark:hover:bg-current/30'"
                    :style="acc.running ? {} : { borderColor: 'color-mix(in srgb, var(--theme-primary) 30%, transparent)', color: 'var(--theme-primary)', backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, transparent)' }"
                    :disabled="!acc.running && isAccountOpsDisabled"
                    :title="!acc.running && isAccountOpsDisabled ? '账号已到期，无法启动账号' : ''"
                    @click="toggleAccount(acc)"
                  >
                    <span class="mr-1">{{ acc.running ? '⏹️' : '▶️' }}</span>
                    {{ acc.running ? '停止' : '启动' }}
                  </BaseButton>
                </div>
              </div>

              <div class="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 sm:mt-4 dark:border-gray-700 sm:pt-4">
                <div class="hidden items-center gap-2 text-sm text-gray-500 sm:flex">
                  <span class="flex items-center gap-1">
                    <div class="h-2 w-2 rounded-full" :class="acc.running ? 'bg-green-500' : 'bg-gray-300'" />
                    {{ acc.running ? '运行中' : '已停止' }}
                  </span>
                </div>

                <div class="flex flex-1 justify-end gap-1 sm:flex-initial sm:gap-2">
                  <BaseButton
                    variant="ghost"
                    class="min-h-[36px] min-w-[36px] !p-2"
                    title="设置"
                    @click="openSettings(acc)"
                  >
                    ⚙️
                  </BaseButton>
                  <BaseButton
                    variant="ghost"
                    class="min-h-[36px] min-w-[36px] !p-2"
                    title="编辑"
                    @click="openEditModal(acc)"
                  >
                    ✏️
                  </BaseButton>
                  <BaseButton
                    variant="ghost"
                    class="min-h-[36px] min-w-[36px] text-red-500 !p-2 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300"
                    title="删除"
                    @click="handleDelete(acc)"
                  >
                    🗑️
                  </BaseButton>
                </div>
              </div>
            </div>
          </div>

          <AccountModal
            :show="showModal"
            :edit-data="editingAccount"
            @close="closeAccountModal"
            @saved="handleSaved"
            @yyb-login="showModal = false; showYybLogin = true"
            @yyb-config="showModal = false; showYybConfig = true"
            @go-config="showModal = false; showGoConfig = true"
          />

          <ConfirmModal
            :show="showDeleteConfirm"
            :loading="deleteLoading"
            title="删除账号"
            :message="accountToDelete ? `确定要删除账号 ${accountToDelete.name || accountToDelete.id} 吗?` : ''"
            confirm-text="删除"
            type="danger"
            @close="!deleteLoading && (showDeleteConfirm = false)"
            @cancel="!deleteLoading && (showDeleteConfirm = false)"
            @confirm="confirmDelete"
          />

          <ConfirmModal
            :show="showClearStoppedConfirm"
            :loading="clearStoppedLoading"
            title="一键清理已停止账号"
            :message="`确定要清理 ${stoppedAccountsCount} 个已停止的账号吗？此操作不可恢复！`"
            confirm-text="确认清理"
            type="danger"
            @close="!clearStoppedLoading && (showClearStoppedConfirm = false)"
            @cancel="!clearStoppedLoading && (showClearStoppedConfirm = false)"
            @confirm="confirmClearStopped"
          />

          <YybConfigModal
            :show="showYybConfig"
            @close="closeYybConfig"
          />

          <YybLoginModal
            :show="showYybLogin"
            @close="closeYybLogin"
            @saved="accountStore.fetchAccounts()"
          />

          <GoConfigModal
            :show="showGoConfig"
            @close="closeGoConfig"
          />
        </div>

        <!-- 策略设置 -->
        <div v-else-if="activeTab === 'strategy'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="flex items-center gap-2 text-lg text-gray-900 font-bold dark:text-gray-100">
              <div class="i-fas-cog text-lg" />
              策略设置
              <span v-if="currentAccountName" class="ml-2 text-sm text-gray-500 font-normal dark:text-gray-400">
                ({{ currentAccountName }})
              </span>
            </h3>
          </div>

          <div v-if="settingsLoading" class="py-4 text-center text-gray-500">
            <span class="mx-auto mb-2 inline-block animate-spin text-2xl">⏳</span>
            <p>加载中...</p>
          </div>

          <div v-else-if="!currentAccountId" class="py-8 text-center text-gray-500">
            <div class="mx-auto mb-2 text-3xl text-gray-400">
              ⚙️
            </div>
            <p>请先选择账号</p>
          </div>

          <div v-else class="space-y-4">
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <BaseSelect
                v-model="localStrategySettings.plantingStrategy"
                label="种植策略"
                :options="plantingStrategyOptions"
              />
              <BaseSelect
                v-if="localStrategySettings.plantingStrategy === 'preferred'"
                v-model="localStrategySettings.preferredSeedId"
                label="优先种植种子"
                :options="preferredSeedOptions"
              />
              <BaseSelect
                v-else-if="localStrategySettings.plantingStrategy === 'bag_priority' && localStrategySettings.bagSeedFallbackStrategy === 'preferred'"
                v-model="localStrategySettings.preferredSeedId"
                label="优先种植种子"
                :options="preferredSeedOptions"
              />
              <div v-else class="flex flex-col gap-1.5">
                <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
                  {{ localStrategySettings.plantingStrategy === 'bag_priority' ? '第二优先策略预览' : '策略选种预览' }}
                </label>
                <div
                  class="w-full flex items-center justify-between border border-gray-200 rounded-lg bg-gray-50 px-3 py-2 text-gray-500 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
                >
                  <span class="truncate">{{ strategyPreviewLabel ?? '加载中...' }}</span>
                  <span class="shrink-0 text-lg text-gray-400">▼</span>
                </div>
              </div>
            </div>

            <div v-if="localStrategySettings.plantingStrategy === 'bag_priority'" class="space-y-3">
              <BaseSelect
                v-model="localStrategySettings.bagSeedFallbackStrategy"
                label="第二优先策略"
                :options="BAG_FALLBACK_STRATEGY_OPTIONS"
              />
              <div class="border border-amber-200 rounded-lg bg-amber-50/70 p-3 space-y-3 dark:border-amber-800/50 dark:bg-amber-900/20">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div class="text-sm text-amber-900 font-semibold dark:text-amber-200">
                      背包种子优先顺序
                    </div>
                    <p class="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">
                      先按下方顺序消耗背包中的 1x1 种子；背包种子不足时，再按"第二优先策略"补种。
                    </p>
                  </div>
                  <button
                    class="rounded bg-amber-100 px-2 py-1 text-xs text-amber-700 transition dark:bg-amber-900/50 hover:bg-amber-200 dark:text-amber-300 dark:hover:bg-amber-900/70"
                    @click="resetBagSeedPriority"
                  >
                    重置顺序
                  </button>
                </div>
                <div v-if="bagSeedsLoading" class="py-4 text-center text-sm text-amber-700 dark:text-amber-300">
                  加载中...
                </div>
                <div v-else-if="bagSeedsError" class="py-4 text-center text-sm text-red-600 dark:text-red-400">
                  {{ bagSeedsError }}
                </div>
                <div v-else-if="bagSeeds.length === 0" class="py-4 text-center text-sm text-amber-700 dark:text-amber-300">
                  背包中暂无 1x1 种子
                </div>
                <div v-else class="grid gap-2 lg:grid-cols-3 sm:grid-cols-2">
                  <div
                    v-for="(seed, index) in sortedBagSeeds"
                    :key="seed.seedId"
                    class="flex cartoon-card items-center gap-2 border border-amber-200 rounded-xl bg-white p-2 dark:border-amber-700/50 dark:bg-gray-800"
                    draggable="true"
                    @dragstart="startBagSeedDrag(seed.seedId, $event)"
                    @dragover.prevent="dragOverBagSeed(seed.seedId, $event)"
                    @drop="dropBagSeed(seed.seedId, $event)"
                  >
                    <div class="h-8 w-8 flex shrink-0 items-center justify-center rounded bg-amber-100 text-xs text-amber-700 font-bold dark:bg-amber-900/50 dark:text-amber-300">
                      {{ index + 1 }}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm text-gray-800 font-medium dark:text-gray-200">
                        {{ seed.name }}
                      </div>
                      <div class="text-xs text-gray-500 dark:text-gray-400">
                        数量: {{ seed.count }} | 等级: {{ seed.requiredLevel }}
                      </div>
                    </div>
                    <div class="flex shrink-0 flex-col gap-1">
                      <button
                        class="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                        :disabled="index === 0"
                        @click="moveBagSeedByIndex(index, -1)"
                      >
                        <span class="text-sm">▲</span>
                      </button>
                      <button
                        class="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                        :disabled="index === sortedBagSeeds.length - 1"
                        @click="moveBagSeedByIndex(index, 1)"
                      >
                        <span class="text-sm">▼</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
              <BaseInput
                v-model.number="localStrategySettings.intervals.farmMin"
                label="农场巡查最小 (秒)"
                type="number"
                min="1"
              />
              <BaseInput
                v-model.number="localStrategySettings.intervals.farmMax"
                label="农场巡查最大 (秒)"
                type="number"
                min="1"
              />
            </div>

            <div class="grid grid-cols-2 gap-3 md:grid-cols-2">
              <BaseInput
                v-model.number="localStrategySettings.intervals.helpMin"
                label="帮助巡查最小 (秒)"
                type="number"
                min="1"
              />
              <BaseInput
                v-model.number="localStrategySettings.intervals.helpMax"
                label="帮助巡查最大 (秒)"
                type="number"
                min="1"
              />
            </div>

            <div class="grid grid-cols-2 gap-3 md:grid-cols-2">
              <BaseInput
                v-model.number="localStrategySettings.intervals.stealMin"
                label="偷菜巡查最小 (秒)"
                type="number"
                min="1"
              />
              <BaseInput
                v-model.number="localStrategySettings.intervals.stealMax"
                label="偷菜巡查最大 (秒)"
                type="number"
                min="1"
              />
            </div>

            <div class="flex flex-wrap items-center gap-4 border-t pt-3 dark:border-gray-700">
              <BaseSwitch
                v-model="localStrategySettings.friendQuietHours.enabled"
                label="启用静默时段"
              />
              <div class="flex items-center gap-2">
                <input
                  v-model="localStrategySettings.friendQuietHours.start"
                  type="time"
                  class="w-20 border border-gray-200 rounded bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  :disabled="!localStrategySettings.friendQuietHours.enabled"
                >
                <span class="text-xs text-gray-500">-</span>
                <input
                  v-model="localStrategySettings.friendQuietHours.end"
                  type="time"
                  class="w-20 border border-gray-200 rounded bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  :disabled="!localStrategySettings.friendQuietHours.enabled"
                >
              </div>
            </div>

            <div class="border-t pt-3 space-y-3 dark:border-gray-700">
              <h4 class="text-sm text-gray-700 font-medium dark:text-gray-300">
                种植与偷菜延迟设置
              </h4>
              <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                <BaseSwitch
                  v-model="localStrategySettings.plantOrderRandom"
                  label="种植顺序随机"
                />
                <BaseInput
                  v-model.number="localStrategySettings.plantDelaySeconds"
                  label="种植延迟 (秒)"
                  type="number"
                  min="0"
                />
                <BaseInput
                  v-model.number="localStrategySettings.stealDelaySeconds"
                  label="偷菜延迟 (秒)"
                  type="number"
                  min="0"
                />
              </div>
            </div>

            <div class="flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
              <BaseButton
                variant="primary"
                size="sm"
                :loading="strategySaving"
                @click="saveStrategySettings"
              >
                保存策略设置
              </BaseButton>
            </div>
          </div>
        </div>

        <!-- 自动控制 -->
        <div v-else-if="activeTab === 'automation'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              自动控制
              <span v-if="currentAccountName" class="ml-2 text-sm text-gray-500 font-normal dark:text-gray-400">
                ({{ currentAccountName }})
              </span>
            </h3>
          </div>

          <div v-if="settingsLoading" class="py-4 text-center text-gray-500">
            <span class="mx-auto mb-2 inline-block animate-spin text-2xl">⏳</span>
            <p>加载中...</p>
          </div>

          <div v-else-if="!currentAccountId" class="py-8 text-center text-gray-500">
            <div class="mx-auto mb-2 text-3xl text-gray-400">
              ⚙️
            </div>
            <p>请先选择账号</p>
          </div>

          <div v-else class="space-y-4">
            <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
              <BaseSwitch v-model="localAutomationSettings.automation.farm" label="自动种植收获" />
              <BaseSwitch v-model="localAutomationSettings.automation.task" label="自动做任务" />
              <BaseSwitch v-model="localAutomationSettings.automation.sell" label="自动卖果实" />
              <BaseSwitch v-model="localAutomationSettings.automation.friend" label="自动好友互动" />
              <BaseSwitch v-model="localAutomationSettings.automation.farm_push" label="推送触发巡田" />
              <BaseSwitch v-model="localAutomationSettings.automation.land_upgrade" label="自动升级土地" />
              <BaseSwitch v-model="localAutomationSettings.automation.fertilizer_gift" label="自动填充化肥" />
              <BaseSwitch v-model="localAutomationSettings.automation.fertilizer_buy_organic" label="自动购买有机化肥" />
              <BaseSwitch v-model="localAutomationSettings.automation.fertilizer_buy_normal" label="自动购买无机化肥" />
              <BaseSwitch v-model="localAutomationSettings.automation.skip_own_weed_bug" label="巡田时跳过一键务农" />
            </div>

            <div v-if="localAutomationSettings.automation.fertilizer_buy_organic || localAutomationSettings.automation.fertilizer_buy_normal" class="rounded bg-green-50 p-3 text-sm space-y-3 dark:bg-green-900/20">
              <div v-if="localAutomationSettings.automation.fertilizer_buy_organic" class="space-y-2">
                <div class="text-green-700 font-medium dark:text-green-400">
                  有机化肥设置
                </div>
                <div class="flex flex-wrap gap-4">
                  <BaseInput
                    v-model.number="localAutomationSettings.fertilizerBuyOrganicCount"
                    label="购买数量"
                    type="number"
                    min="1"
                    max="10000"
                  />
                  <BaseInput
                    v-model.number="localAutomationSettings.fertilizerBuyOrganicThresholdHours"
                    label="触发阈值 (小时)"
                    type="number"
                    min="1"
                    max="990"
                  />
                </div>
              </div>
              <div v-if="localAutomationSettings.automation.fertilizer_buy_normal" class="space-y-2">
                <div class="text-green-700 font-medium dark:text-green-400">
                  无机化肥设置
                </div>
                <div class="flex flex-wrap gap-4">
                  <BaseInput
                    v-model.number="localAutomationSettings.fertilizerBuyNormalCount"
                    label="购买数量"
                    type="number"
                    min="1"
                    max="10000"
                  />
                  <BaseInput
                    v-model.number="localAutomationSettings.fertilizerBuyNormalThresholdHours"
                    label="触发阈值 (小时)"
                    type="number"
                    min="1"
                    max="990"
                  />
                </div>
              </div>
              <div class="flex flex-wrap gap-4">
                <BaseInput
                  v-model.number="localAutomationSettings.fertilizerBuyCheckIntervalMinutes"
                  label="检测间隔 (分钟)"
                  type="number"
                  min="1"
                  max="1440"
                />
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                系统会按照设定的检测间隔定时检测化肥容器剩余量，当低于触发阈值时自动购买。保存设置后会立即检测一次。同时开启两种化肥购买时，优先购买有机化肥。
              </p>
            </div>

            <div v-if="localAutomationSettings.automation.friend" class="rounded bg-blue-50 p-3 text-sm space-y-3 dark:bg-blue-900/20">
              <div class="flex flex-wrap gap-4">
                <BaseSwitch v-model="localAutomationSettings.automation.friend_steal" label="自动偷菜" />
                <BaseSwitch v-model="localAutomationSettings.automation.friend_help" label="自动帮忙" />
                <BaseSwitch v-model="localAutomationSettings.automation.friend_bad" label="自动捣乱" />
                <BaseSwitch v-model="localAutomationSettings.automation.friend_help_exp_limit" label="经验满不帮忙" />
                <BaseSwitch
                  v-model="localAutomationSettings.automation.friend_help_only_guard_dog"
                  label="只帮护主犬好友"
                />
              </div>
              <p v-if="localAutomationSettings.automation.friend_help_only_guard_dog" class="text-xs text-blue-700 dark:text-blue-300">
                开启后，仅对携带护主犬（brief_dog_info）的好友执行帮忙操作；未携带护主犬的好友会跳过帮忙，但偷菜/捣乱不受影响。
              </p>
              <div class="flex flex-wrap items-center gap-4 pt-3">
                <BaseSwitch v-model="localAutomationSettings.automation.friend_auto_accept" label="自动同意好友申请" />
                <div v-if="localAutomationSettings.automation.friend_auto_accept" class="flex items-center gap-2">
                  <span class="text-xs text-gray-600 dark:text-gray-300">最低等级门槛</span>
                  <input
                    v-model.number="localAutomationSettings.automation.friend_auto_accept_min_level"
                    type="number"
                    min="0"
                    class="w-20 border border-gray-300 rounded-lg px-2 py-1 text-center text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-800 dark:text-gray-100 focus:outline-none"
                    placeholder="0"
                  >
                  <span class="text-xs text-gray-500">低于该等级自动忽略，高于或等于自动同意</span>
                </div>
              </div>
            </div>

            <div class="space-y-3">
              <div class="border border-amber-200 rounded bg-amber-50/60 p-3 dark:border-amber-800/60 dark:bg-amber-900/10">
                <div class="mb-2 text-sm text-amber-800 font-medium dark:text-amber-300">
                  施肥范围
                </div>
                <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <label
                    v-for="option in fertilizerLandTypeOptions"
                    :key="option.value"
                    class="flex cursor-pointer items-center gap-1.5 rounded bg-white px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    <input
                      v-model="localAutomationSettings.automation.fertilizer_land_types"
                      :value="option.value"
                      type="checkbox"
                      class="h-3.5 w-3.5"
                    >
                    <span>{{ option.label }}</span>
                  </label>
                </div>
                <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  施肥前会优先按土地类型过滤，仅对命中范围的地块执行施肥策略。
                </p>
              </div>

              <BaseSelect
                v-model="localAutomationSettings.automation.fertilizer"
                label="施肥策略"
                :options="fertilizerOptions"
              />

              <div class="flex items-center gap-4">
                <BaseSwitch
                  v-model="localAutomationSettings.automation.fertilizer_multi_season"
                  label="多季补肥"
                />
              </div>

              <div v-if="localAutomationSettings.automation.fertilizer === 'smart'" class="flex flex-wrap gap-4 rounded bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
                <BaseInput
                  v-model.number="localAutomationSettings.automation.fertilizer_smart_seconds"
                  label="快成熟判定秒数"
                  type="number"
                  min="30"
                  max="3600"
                  class="w-40"
                />
                <span class="flex items-end pb-2 text-xs text-gray-500 dark:text-gray-400">
                  距离成熟时间 ≤ 此秒数时施有机肥（默认300秒=5分钟）
                </span>
              </div>
            </div>

            <div class="flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
              <BaseButton
                variant="primary"
                size="sm"
                :loading="automationSaving"
                @click="saveAutomationSettings"
              >
                保存自动控制
              </BaseButton>
            </div>
          </div>
        </div>

        <!-- 用户管理 -->
        <div v-else-if="activeTab === 'user'" class="space-y-4">
          <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
            用户管理
          </h3>

          <div class="space-y-4">
            <div class="farm-card border border-gray-200 rounded-2xl bg-white p-4 shadow-md dark:border-gray-700 dark:bg-gray-800">
              <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
                🔑 修改用户密码
              </h4>

              <div class="space-y-3">
                <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <BaseInput
                    v-model="passwordForm.old"
                    label="当前密码"
                    type="password"
                    placeholder="当前用户密码"
                  />
                  <BaseInput
                    v-model="passwordForm.new"
                    label="新密码"
                    type="password"
                    placeholder="至少 4 位"
                  />
                  <BaseInput
                    v-model="passwordForm.confirm"
                    label="确认新密码"
                    type="password"
                    placeholder="再次输入新密码"
                  />
                </div>

                <div class="flex items-center justify-end pt-1">
                  <BaseButton
                    variant="primary"
                    size="sm"
                    :loading="passwordSaving"
                    @click="handleChangePassword"
                  >
                    修改用户密码
                  </BaseButton>
                </div>
              </div>
            </div>

            <div class="farm-card border border-gray-200 rounded-2xl bg-white p-4 shadow-md dark:border-gray-700 dark:bg-gray-800">
              <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
                🔔 下线提醒
              </h4>

              <div class="space-y-3">
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div class="flex flex-col gap-1.5">
                    <div class="flex items-center justify-between">
                      <span class="text-sm text-gray-700 font-medium dark:text-gray-300">推送渠道</span>
                      <BaseButton
                        variant="text"
                        size="sm"
                        :disabled="!currentChannelDocUrl"
                        @click="openChannelDocs"
                      >
                        官网
                      </BaseButton>
                    </div>
                    <BaseSelect
                      v-model="localOffline.channel"
                      :options="channelOptions"
                    />
                  </div>
                  <BaseSelect
                    v-model="localOffline.reloginUrlMode"
                    label="重登录链接"
                    :options="reloginUrlModeOptions"
                  />
                </div>

                <BaseInput
                  v-model="localOffline.endpoint"
                  label="接口地址"
                  type="text"
                  :disabled="localOffline.channel !== 'webhook'"
                />

                <BaseInput
                  v-model="localOffline.token"
                  label="Token"
                  type="text"
                  placeholder="接收端 token"
                />

                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <BaseInput
                    v-model="localOffline.title"
                    label="标题"
                    type="text"
                    placeholder="提醒标题"
                  />
                  <BaseInput
                    v-model.number="localOffline.offlineDeleteSec"
                    label="离线删除账号 (秒)"
                    type="number"
                    min="0"
                    placeholder="0 表示不删除"
                  />
                </div>

                <BaseInput
                  v-model="localOffline.msg"
                  label="内容"
                  type="text"
                  placeholder="提醒内容"
                />
              </div>

              <div class="mt-4 flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
                <BaseButton
                  variant="secondary"
                  size="sm"
                  :loading="offlineTesting"
                  :disabled="offlineSaving"
                  @click="handleTestOffline"
                >
                  测试通知
                </BaseButton>
                <BaseButton
                  variant="primary"
                  size="sm"
                  :loading="offlineSaving"
                  :disabled="offlineTesting"
                  @click="handleSaveOffline"
                >
                  保存下线提醒设置
                </BaseButton>
              </div>
            </div>

            <div class="farm-card border border-gray-200 rounded-2xl bg-white p-4 shadow-md dark:border-gray-700 dark:bg-gray-800">
              <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
                🧭 悬浮底栏显示
              </h4>

              <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
                自定义底部导航栏显示哪些入口，关闭后不再显示。
              </p>

              <div class="grid grid-cols-2 gap-3 md:grid-cols-4 sm:grid-cols-3">
                <label
                  v-for="item in bottomNavItems"
                  :key="item.path"
                  class="flex cursor-pointer items-center gap-2 border rounded-xl p-3 transition-colors"
                  :class="isNavItemVisible(item)
                    ? 'border-[color-mix(in_srgb,var(--theme-primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-primary)_8%,transparent)]'
                    : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'"
                  :style="isNavItemVisible(item) ? { color: 'var(--theme-primary)' } : { color: 'var(--theme-text)' }"
                >
                  <input
                    type="checkbox"
                    class="h-4 w-4 border-gray-300 rounded text-[var(--theme-primary)] focus:ring-[var(--theme-primary)]"
                    :checked="isNavItemVisible(item)"
                    @change="toggleNavItem(item)"
                  >
                  <div :class="item.icon" class="text-lg" />
                  <span class="text-sm font-medium">{{ item.label }}</span>
                </label>
              </div>

              <div class="mt-4 flex justify-end">
                <BaseButton variant="secondary" size="sm" @click="resetNavItems">
                  恢复默认
                </BaseButton>
              </div>
            </div>

            <!-- 悬浮底栏外观 -->
            <div class="farm-card border border-gray-200 rounded-2xl bg-white p-4 shadow-md dark:border-gray-700 dark:bg-gray-800">
              <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
                🎨 悬浮底栏外观
              </h4>

              <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
                调整底部导航栏的圆角、背景透明度、磨砂强度、图标大小等。设置会立即生效并自动保存。
              </p>

              <!-- 实时预览 -->
              <div class="mb-5">
                <div class="mb-2 flex items-center justify-between">
                  <div class="text-xs text-gray-500 font-medium dark:text-gray-400">
                    实时预览
                  </div>
                  <button
                    class="text-xs px-2 py-1 border rounded-md transition-colors hover:border-[var(--theme-primary)] hover:text-[color:var(--theme-primary)]"
                    style="border-color: color-mix(in srgb, var(--theme-primary) 30%, transparent); color: var(--theme-primary);"
                    @click="replayPreview"
                  >
                    <div class="i-carbon-play inline-block mr-0.5" />
                    重新播放
                  </button>
                </div>
                <div
                  class="relative h-28 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700"
                  style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 50%, #6ee7b7 100%);"
                >
                  <!-- 模拟手机状态条 + 模拟内容 -->
                  <div class="absolute inset-x-0 top-2 flex items-center justify-center gap-1 text-[10px] text-gray-600 opacity-50">
                    <span>9:41</span>
                    <span>·</span>
                    <span>5G</span>
                    <span>·</span>
                    <span>100%</span>
                  </div>

                  <!-- 悬浮底栏预览 -->
                  <div class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-3 pb-3">
                    <div
                      class="bn-container pointer-events-auto flex w-full max-w-[220px] items-center justify-around border-t border-white/30 px-2 pt-2 pb-3 backdrop-blur-md dark:border-gray-700/50"
                      :class="navPreviewBorderClass"
                      :style="navPreviewStyle"
                      :key="previewReplayKey"
                    >
                      <div
                        v-for="item in previewNavItems"
                        :key="item.path"
                        class="relative flex flex-col items-center justify-center rounded-xl px-1.5 py-1 transition-all duration-200"
                        :class="item.active ? 'bottom-nav-item-active text-[color:var(--theme-primary)]' : 'text-gray-600 dark:text-gray-300'"
                      >
                        <div
                          :class="[item.icon, 'mb-0.5 leading-none', navPreviewIconSize, item.active && navPreviewShouldBounce ? 'bottom-nav-icon-bounce' : '']"
                          :style="item.active ? { color: 'var(--theme-primary)', filter: `drop-shadow(0 2px 4px color-mix(in srgb, var(--theme-primary) 40%, transparent))` } : {}"
                        />
                        <span v-if="localBottomNavStyle.showLabel" class="text-[10px] font-medium">
                          {{ item.label }}
                        </span>
                        <div
                          v-if="item.active"
                          class="bottom-nav-indicator"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 圆角 -->
              <div class="mb-4">
                <div class="mb-1.5 flex items-center justify-between">
                  <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
                    圆角
                  </label>
                  <span class="text-xs text-gray-500 dark:text-gray-400">
                    {{ localBottomNavStyle.borderRadius }}px
                  </span>
                </div>
                <input
                  v-model.number="localBottomNavStyle.borderRadius"
                  type="range"
                  min="0"
                  max="28"
                  step="1"
                  class="w-full accent-current"
                  :style="{ color: 'var(--theme-primary)' }"
                >
                <div class="mt-1 flex justify-between text-[10px] text-gray-400">
                  <span>直角</span>
                  <span>大圆角</span>
                </div>
              </div>

              <!-- 背景透明度 (亮色 / 暗色) -->
              <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div class="mb-1.5 flex items-center justify-between">
                    <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
                      背景透明度(亮色)
                    </label>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      {{ localBottomNavStyle.backgroundOpacity }}%
                    </span>
                  </div>
                  <input
                    v-model.number="localBottomNavStyle.backgroundOpacity"
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    class="w-full accent-current"
                    :style="{ color: 'var(--theme-primary)' }"
                  >
                </div>
                <div>
                  <div class="mb-1.5 flex items-center justify-between">
                    <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
                      背景透明度(暗色)
                    </label>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      {{ localBottomNavStyle.backgroundOpacityDark }}%
                    </span>
                  </div>
                  <input
                    v-model.number="localBottomNavStyle.backgroundOpacityDark"
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    class="w-full accent-current"
                    :style="{ color: 'var(--theme-primary)' }"
                  >
                </div>
              </div>

              <!-- 图标大小 -->
              <div class="mb-4">
                <label class="mb-1.5 block text-sm text-gray-700 font-medium dark:text-gray-300">
                  图标大小
                </label>
                <div class="flex gap-2">
                  <button
                    v-for="opt in iconSizeOptions"
                    :key="opt.value"
                    class="flex-1 border rounded-lg px-3 py-2 text-sm transition-all"
                    :class="localBottomNavStyle.iconSize === opt.value
                      ? 'border-[var(--theme-primary)] bg-[color-mix(in_srgb,var(--theme-primary)_10%,transparent)] font-bold text-[color:var(--theme-primary)]'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-600 dark:text-gray-300'"
                    @click="localBottomNavStyle.iconSize = opt.value"
                  >
                    <div :class="opt.icon" class="mx-auto" />
                    <div class="mt-0.5 text-xs">
                      {{ opt.label }}
                    </div>
                  </button>
                </div>
              </div>

              <!-- 弹跳强度 -->
              <div class="mb-4">
                <div class="mb-1.5 flex items-center justify-between">
                  <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
                    弹跳强度
                  </label>
                  <span class="text-xs text-gray-500 dark:text-gray-400">
                    {{ localBottomNavStyle.bounceIntensity === 0 ? '关闭' : `${localBottomNavStyle.bounceIntensity}%` }}
                  </span>
                </div>
                <input
                  v-model.number="localBottomNavStyle.bounceIntensity"
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  class="w-full accent-current"
                  :style="{ color: 'var(--theme-primary)' }"
                >
                <div class="mt-1 flex justify-between text-[10px] text-gray-400">
                  <span>无动画</span>
                  <span>轻弹</span>
                  <span>Q 弹</span>
                </div>
              </div>

              <!-- 磨砂强度 -->
              <div class="mb-4">
                <div class="mb-1.5 flex items-center justify-between">
                  <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
                    磨砂强度
                  </label>
                  <span class="text-xs text-gray-500 dark:text-gray-400">
                    {{ Math.round((localBottomNavStyle.backdropBlur / 100) * 24) }}px
                  </span>
                </div>
                <input
                  v-model.number="localBottomNavStyle.backdropBlur"
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  class="w-full accent-current"
                  :style="{ color: 'var(--theme-primary)' }"
                >
                <div class="mt-1 flex justify-between text-[10px] text-gray-400">
                  <span>无磨砂</span>
                  <span>半磨砂</span>
                  <span>满磨砂</span>
                </div>
              </div>

              <!-- 显示选项 -->
              <div class="space-y-2">
                <BaseSwitch
                  :model-value="localBottomNavStyle.showTopBorder"
                  label="显示顶部边线"
                  @update:model-value="(v) => localBottomNavStyle.showTopBorder = !!v"
                />
                <BaseSwitch
                  :model-value="localBottomNavStyle.showLabel"
                  label="显示文字标签"
                  @update:model-value="(v) => localBottomNavStyle.showLabel = !!v"
                />
              </div>

              <div class="mt-4 flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
                <BaseButton variant="secondary" size="sm" @click="resetBottomNavStyleLocal">
                  恢复默认
                </BaseButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="modalVisible"
      :title="modalConfig.title"
      :message="modalConfig.message"
      :type="modalConfig.type"
      :is-alert="modalConfig.isAlert"
      confirm-text="知道了"
      @confirm="modalVisible = false"
      @cancel="modalVisible = false"
    />
  </div>
</template>
