<script setup lang="ts">
import type { Card, UserCard } from '@/stores/user'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const toast = useToastStore()

const activeTab = ref<'dashboard' | 'card' | 'user' | 'account' | 'log' | 'system'>(
  (localStorage.getItem('admin-active-tab') as 'dashboard' | 'card' | 'user' | 'account' | 'log' | 'system') || 'dashboard',
)

watch(activeTab, (newTab) => {
  localStorage.setItem('admin-active-tab', newTab)
})

const tabs = [
  { key: 'dashboard', label: '仪表盘', icon: 'i-carbon-dashboard' },
  { key: 'card', label: '卡密', icon: 'i-carbon-ticket' },
  { key: 'user', label: '用户', icon: 'i-carbon-user-admin' },
  { key: 'account', label: '账号', icon: 'i-carbon-server' },
  { key: 'log', label: '日志', icon: 'i-carbon-document' },
  { key: 'system', label: '系统', icon: 'i-carbon-settings' },
] as const

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

// ========== 卡密管理 ==========
const cards = ref<Card[]>([])
const cardsLoading = ref(false)
const showCreateModal = ref(false)

const newCard = ref({
  description: '',
  days: 30,
  count: 1,
  type: 'time' as 'time' | 'quota',
})

const selectedCards = ref<Set<string>>(new Set())
const selectAll = ref(false)

const searchQuery = ref('')
const filterStatus = ref<'all' | 'used' | 'unused' | 'enabled' | 'disabled'>('all')
const cardTypeFilter = ref<'all' | 'time' | 'quota'>('all')

// 卡密领取功能
const cardClaimEnabled = ref(false)
const cardClaimLoading = ref(false)

const unusedTimeCardsCount = computed(() => {
  return cards.value.filter(c => c.type === 'time' && !c.usedBy && c.enabled).length
})

const filteredCards = computed(() => {
  let result = cards.value

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(card =>
      card.code.toLowerCase().includes(query)
      || card.description.toLowerCase().includes(query)
      || (card.usedBy && card.usedBy.toLowerCase().includes(query)),
    )
  }

  switch (filterStatus.value) {
    case 'used':
      result = result.filter(card => card.usedBy)
      break
    case 'unused':
      result = result.filter(card => !card.usedBy)
      break
    case 'enabled':
      result = result.filter(card => card.enabled)
      break
    case 'disabled':
      result = result.filter(card => !card.enabled)
      break
  }

  if (cardTypeFilter.value !== 'all') {
    result = result.filter(card => card.type === cardTypeFilter.value)
  }

  return result
})

async function fetchCards() {
  cardsLoading.value = true
  try {
    const result = await userStore.getAllCards()
    if (result.ok) {
      cards.value = result.data
    }
    else {
      toast.error(result.error || '获取卡密列表失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取卡密列表失败')
  }
  finally {
    cardsLoading.value = false
  }
}

async function fetchCardClaimStatus() {
  cardClaimLoading.value = true
  try {
    const res = await api.get('/api/card-claim/status')
    if (res.data.ok) {
      cardClaimEnabled.value = res.data.enabled
    }
  }
  catch (e: any) {
    console.error('获取卡密领取状态失败:', e)
  }
  finally {
    cardClaimLoading.value = false
  }
}

async function toggleCardClaimStatus(enabled: boolean | undefined) {
  if (enabled === undefined)
    return
  cardClaimLoading.value = true
  try {
    const res = await api.post('/api/admin/card-claim/status', { enabled })
    if (res.data.ok) {
      cardClaimEnabled.value = res.data.enabled
      toast.success(enabled ? '卡密领取功能已开启' : '卡密领取功能已关闭')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
    cardClaimEnabled.value = !enabled
  }
  finally {
    cardClaimLoading.value = false
  }
}

async function createCard() {
  if (!newCard.value.description) {
    toast.warning('请输入卡密描述')
    return
  }

  const count = Math.min(Math.max(Number.parseInt(String(newCard.value.count), 10) || 1, 1), 100)

  try {
    const result = await userStore.createCard(
      newCard.value.description,
      newCard.value.days,
      count > 1 ? count : undefined,
      newCard.value.type,
    )
    if (result.ok) {
      if (result.batch) {
        toast.success(`成功创建 ${result.count} 个卡密`)
        exportCardsToFile(result.data, `卡密批量导出_${newCard.value.description}_${formatDateForFile(Date.now())}.txt`)
      }
      else {
        toast.success('卡密创建成功')
      }
      showCreateModal.value = false
      newCard.value = { description: '', days: 30, count: 1, type: 'time' }
      await fetchCards()
    }
    else {
      toast.error(result.error || '创建卡密失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '创建卡密失败')
  }
}

async function toggleCardStatus(card: Card) {
  try {
    const result = await userStore.updateCard(card.code, { enabled: !card.enabled })
    if (result.ok) {
      toast.success(card.enabled ? '卡密已禁用' : '卡密已启用')
      await fetchCards()
    }
    else {
      toast.error(result.error || '操作失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function deleteCard(card: Card) {
  if (!confirm(`确定要删除卡密 ${card.code} 吗？`))
    return

  try {
    const result = await userStore.deleteCard(card.code)
    if (result.ok) {
      toast.success('卡密删除成功')
      await fetchCards()
    }
    else {
      toast.error(result.error || '删除卡密失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '删除卡密失败')
  }
}

async function deleteSelectedCards() {
  const selectedCodes = Array.from(selectedCards.value)
  if (selectedCodes.length === 0) {
    toast.warning('请先选择要删除的卡密')
    return
  }

  if (!confirm(`确定要删除选中的 ${selectedCodes.length} 个卡密吗？此操作不可恢复！`))
    return

  try {
    const result = await userStore.deleteCardsBatch(selectedCodes)
    if (result.ok) {
      toast.success(`成功删除 ${result.deletedCount} 个卡密`)
      if (result.notFoundCount > 0) {
        toast.warning(`${result.notFoundCount} 个卡密未找到`)
      }
      selectedCards.value.clear()
      selectAll.value = false
      await fetchCards()
    }
    else {
      toast.error(result.error || '批量删除卡密失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '批量删除卡密失败')
  }
}

async function copyCode(code: string) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code)
      toast.success('卡密已复制到剪贴板')
    }
    else {
      const textArea = document.createElement('textarea')
      textArea.value = code
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      toast.success('卡密已复制到剪贴板')
      document.body.removeChild(textArea)
    }
  }
  catch (e) {
    toast.error('复制失败，请手动复制')
    console.error('复制失败:', e)
  }
}

async function copySelectedCards() {
  const codes = Array.from(selectedCards.value)
  if (codes.length === 0)
    return

  try {
    const text = codes.join('\n')
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制 ${codes.length} 个卡密到剪贴板`)
    }
    else {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      toast.success(`已复制 ${codes.length} 个卡密到剪贴板`)
      document.body.removeChild(textArea)
    }
  }
  catch (e) {
    toast.error('复制失败，请手动复制')
    console.error('复制失败:', e)
  }
}

function formatDate(timestamp: number | null) {
  if (!timestamp)
    return '-'
  return new Date(timestamp).toLocaleString('zh-CN')
}

function formatDateForFile(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
}

function getCardTypeLabel(card: Card) {
  if (card.type === 'quota') {
    return '额度'
  }
  return '时间'
}

function getCardValueLabel(card: Card) {
  if (card.type === 'quota') {
    return `+${card.days}额度`
  }
  if (card.days === -1)
    return '永久'
  return `${card.days}天`
}

function exportCardsToFile(cardsToExport: Card[], filename?: string) {
  if (!cardsToExport || cardsToExport.length === 0) {
    toast.warning('没有可导出的卡密')
    return
  }

  const content = cardsToExport.map(card =>
    `卡密: ${card.code}\n描述: ${card.description}\n时长: ${getCardTypeLabel(card)}\n状态: ${card.enabled ? '启用' : '禁用'}\n${card.usedBy ? `使用者: ${card.usedBy}\n使用时间: ${formatDate(card.usedAt)}` : '未使用'}\n创建时间: ${formatDate(card.createdAt)}\n${'='.repeat(40)}`,
  ).join('\n\n')

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || `卡密导出_${formatDateForFile(Date.now())}.txt`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  toast.success(`已导出 ${cardsToExport.length} 个卡密到文件`)
}

function toggleSelectAll() {
  if (selectAll.value) {
    filteredCards.value.forEach(card => selectedCards.value.add(card.code))
  }
  else {
    filteredCards.value.forEach(card => selectedCards.value.delete(card.code))
  }
}

function toggleSelectCard(code: string) {
  if (selectedCards.value.has(code)) {
    selectedCards.value.delete(code)
    selectAll.value = false
  }
  else {
    selectedCards.value.add(code)
    if (filteredCards.value.every(card => selectedCards.value.has(card.code))) {
      selectAll.value = true
    }
  }
}

// ========== 仪表盘 ==========
interface DashboardData {
  totalUsers: number
  onlineUsers: number
  totalAccounts: number
  onlineAccounts: number
  uptime: number
  memory: {
    used: number
    total: number
    rss: number
  }
  version: string
}

const dashboard = ref<DashboardData | null>(null)
const dashboardLoading = ref(false)
const dashboardTimer = ref<number | null>(null)

function formatDuration(seconds: number): string {
  const s = Math.floor(seconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0)
    return `${d}天 ${h}小时`
  if (h > 0)
    return `${h}小时 ${m}分`
  return `${m}分 ${sec}秒`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

async function fetchDashboard() {
  dashboardLoading.value = true
  try {
    const res = await api.get('/api/admin/dashboard')
    if (res.data?.ok) {
      dashboard.value = res.data.data
    }
  }
  catch (e: any) {
    console.error('获取仪表盘失败', e)
  }
  finally {
    dashboardLoading.value = false
  }
}

function startDashboardTimer() {
  stopDashboardTimer()
  dashboardTimer.value = window.setInterval(fetchDashboard, 10000)
}

function stopDashboardTimer() {
  if (dashboardTimer.value) {
    clearInterval(dashboardTimer.value)
    dashboardTimer.value = null
  }
}

// ========== 用户管理 ==========
interface UserInfo {
  username: string
  role: string
  card: UserCard | null
  accountLimit: number
  online?: boolean
  lastActivityAt?: number | null
}

interface EditForm {
  newUsername: string
  password: string
  accountLimit: number
  expiresAt: string
  isPermanent: boolean
}

const users = ref<UserInfo[]>([])
const usersLoading = ref(false)
const showEditModal = ref(false)
const selectedUser = ref<UserInfo | null>(null)
const editForm = ref<EditForm>({
  newUsername: '',
  password: '',
  accountLimit: 2,
  expiresAt: '',
  isPermanent: false,
})
const editLoading = ref(false)

const currentUsername = computed(() => userStore.username)

async function fetchUsers() {
  usersLoading.value = true
  try {
    const result = await userStore.getAllUsers()
    if (result.ok) {
      users.value = result.data
    }
    else {
      toast.error(result.error || '获取用户列表失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取用户列表失败')
  }
  finally {
    usersLoading.value = false
  }
}

async function toggleUserStatus(user: UserInfo) {
  try {
    const updates: Partial<UserCard> = { enabled: !user.card?.enabled }
    const result = await userStore.updateUser(user.username, updates)
    if (result.ok) {
      toast.success(user.card?.enabled ? '用户已封禁' : '用户已解封')
      await fetchUsers()
    }
    else {
      toast.error(result.error || '操作失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function deleteUser(user: UserInfo) {
  if (!confirm(`确定要删除用户 ${user.username} 吗？此操作不可恢复！`))
    return

  try {
    const result = await userStore.deleteUser(user.username)
    if (result.ok) {
      toast.success('用户删除成功')
      await fetchUsers()
    }
    else {
      toast.error(result.error || '删除用户失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '删除用户失败')
  }
}

function openEditModal(user: UserInfo) {
  selectedUser.value = user
  editForm.value = {
    newUsername: user.username,
    password: '',
    accountLimit: user.accountLimit || 2,
    expiresAt: user.card?.expiresAt ? formatDateTimeLocal(user.card.expiresAt) : '',
    isPermanent: user.card?.days === -1,
  }
  showEditModal.value = true
}

function formatDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

async function handleEdit() {
  if (!selectedUser.value)
    return

  editLoading.value = true
  try {
    const expiresAtValue = editForm.value.isPermanent
      ? null
      : (editForm.value.expiresAt ? new Date(editForm.value.expiresAt).getTime() : null)

    const updateData: Record<string, any> = {
      accountLimit: editForm.value.accountLimit,
      expiresAt: expiresAtValue,
      isPermanent: editForm.value.isPermanent,
    }

    if (editForm.value.newUsername && editForm.value.newUsername !== selectedUser.value.username) {
      updateData.newUsername = editForm.value.newUsername
    }

    if (editForm.value.password) {
      updateData.password = editForm.value.password
    }

    const res = await api.post(`/api/admin/users/${selectedUser.value.username}/edit`, updateData)

    if (res.data.ok) {
      toast.success('用户信息已更新')
      showEditModal.value = false
      await fetchUsers()
    }
    else {
      toast.error(res.data.error || '更新失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '更新失败')
  }
  finally {
    editLoading.value = false
  }
}

function getDaysLabel(days: number) {
  if (days === -1)
    return '永久'
  return `${days}天`
}

function isExpired(card: UserCard | null) {
  if (!card?.expiresAt)
    return false
  return Date.now() > card.expiresAt
}

// ========== 账号全局管理 ==========
interface AdminAccount {
  id: string
  name: string
  uin: string
  qq: string
  platform: string
  username: string
  running: boolean
  createdAt: number
  updatedAt: number
}

const adminAccounts = ref<AdminAccount[]>([])
const adminAccountsLoading = ref(false)
const accountToDelete = ref<AdminAccount | null>(null)
const showDeleteAccountConfirm = ref(false)

async function fetchAdminAccounts() {
  adminAccountsLoading.value = true
  try {
    const res = await api.get('/api/admin/accounts')
    if (res.data?.ok) {
      adminAccounts.value = res.data.data || []
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || '获取账号列表失败')
  }
  finally {
    adminAccountsLoading.value = false
  }
}

async function startAdminAccount(acc: AdminAccount) {
  try {
    await api.post(`/api/admin/accounts/${acc.id}/start`)
    toast.success('启动指令已发送')
    await fetchAdminAccounts()
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || '启动失败')
  }
}

async function stopAdminAccount(acc: AdminAccount) {
  try {
    await api.post(`/api/admin/accounts/${acc.id}/stop`)
    toast.success('停止指令已发送')
    await fetchAdminAccounts()
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || '停止失败')
  }
}

function confirmDeleteAdminAccount(acc: AdminAccount) {
  accountToDelete.value = acc
  showDeleteAccountConfirm.value = true
}

async function deleteAdminAccount() {
  if (!accountToDelete.value)
    return
  try {
    await api.delete(`/api/admin/accounts/${accountToDelete.value.id}`)
    showDeleteAccountConfirm.value = false
    accountToDelete.value = null
    toast.success('删除成功')
    await fetchAdminAccounts()
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || '删除失败')
  }
}

// ========== 登录日志 ==========
interface LoginLog {
  id: string
  timestamp: number
  event: 'login_success' | 'login_failed'
  username: string
  errorType: string | null
  ip: string
  userAgent: string
}

const loginLogs = ref<LoginLog[]>([])
const loginLogsLoading = ref(false)
const loginLogsTotal = ref(0)
const showClearLogsConfirm = ref(false)
const clearLogsLoading = ref(false)

async function fetchLoginLogs() {
  loginLogsLoading.value = true
  try {
    const result = await userStore.getLoginLogs(100, 0)
    if (result.ok) {
      loginLogs.value = result.data.logs
      loginLogsTotal.value = result.data.total
    }
    else {
      toast.error(result.error || '获取登录日志失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取登录日志失败')
  }
  finally {
    loginLogsLoading.value = false
  }
}

function openClearLogsConfirm() {
  if (loginLogsTotal.value === 0) {
    toast.warning('暂无日志可清空')
    return
  }
  showClearLogsConfirm.value = true
}

async function confirmClearLogs() {
  clearLogsLoading.value = true
  try {
    const result = await userStore.clearLoginLogs()
    if (result.ok) {
      toast.success('日志已清空')
      loginLogs.value = []
      loginLogsTotal.value = 0
      showClearLogsConfirm.value = false
    }
    else {
      toast.error(result.error || '清空失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '清空失败')
  }
  finally {
    clearLogsLoading.value = false
  }
}

function formatLogTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN')
}

function getEventLabel(event: string): string {
  return event === 'login_success' ? '登录成功' : '登录失败'
}

function getErrorTypeLabel(errorType: string | null): string {
  if (!errorType)
    return '-'
  const labels: Record<string, string> = {
    rate_limit: '速率限制',
    locked: '账户锁定',
    invalid_credentials: '凭证错误',
  }
  return labels[errorType] || errorType
}

function parseBrowser(userAgent: string): string {
  if (!userAgent || userAgent === 'unknown')
    return '未知'

  if (userAgent.includes('Edg/')) {
    const match = userAgent.match(/Edg\/([\d.]+)/)
    return `Edge ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Chrome/')) {
    const match = userAgent.match(/Chrome\/([\d.]+)/)
    return `Chrome ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Firefox/')) {
    const match = userAgent.match(/Firefox\/([\d.]+)/)
    return `Firefox ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Safari/') && !userAgent.includes('Chrome')) {
    const match = userAgent.match(/Version\/([\d.]+)/)
    return `Safari ${match ? match[1] : ''}`
  }
  if (userAgent.includes('MSIE') || userAgent.includes('Trident/')) {
    return 'IE'
  }

  return '其他'
}

// ========== 系统配置 ==========
const systemConfigSaving = ref(false)
const systemConfigLoading = ref(false)

const localSystemConfig = ref({
  serverUrl: '',
  clientVersion: '',
  platform: 'qq',
  os: 'Windows',
  deviceInfo: {
    os: 'Windows',
    clientVersion: '',
    sysSoftware: 'Windows 10',
    network: 'wifi',
    memory: '16384',
    deviceId: 'DESKTOP-PC<WPC>',
    userAgent: '',
  },
})

const defaultSystemConfig = ref({
  serverUrl: '',
  clientVersion: '',
  platform: 'qq',
  os: 'Windows',
  deviceInfo: {
    os: 'Windows',
    clientVersion: '',
    sysSoftware: 'Windows 10',
    network: 'wifi',
    memory: '16384',
    deviceId: 'DESKTOP-PC<WPC>',
    userAgent: '',
  },
})

const devicePresets = ref<any[]>([])
const selectedPresetId = ref('')

const platformOptions = [
  { label: 'QQ', value: 'qq' },
  { label: '微信', value: 'wx' },
]

const osOptions = [
  { label: 'Windows', value: 'Windows' },
  { label: 'iOS', value: 'iOS' },
  { label: 'Android', value: 'Android' },
]

async function loadDevicePresets() {
  try {
    const { data } = await api.get('/api/admin/device-presets')
    if (data?.ok && data.data) {
      devicePresets.value = data.data
    }
  }
  catch (e: any) {
    console.error('加载设备预设失败:', e)
  }
}

function applyDevicePreset(presetId: string) {
  const preset = devicePresets.value.find(p => p.id === presetId)
  if (!preset)
    return
  const di = preset.deviceInfo as any
  localSystemConfig.value.os = di.os || 'Windows'
  localSystemConfig.value.clientVersion = di.clientVersion || ''
  localSystemConfig.value.deviceInfo = {
    os: di.os || 'Windows',
    clientVersion: di.clientVersion || '',
    sysSoftware: di.sysSoftware || '',
    network: di.network || 'wifi',
    memory: di.memory || '',
    deviceId: di.deviceId || '',
    userAgent: di.userAgent || '',
  }
  selectedPresetId.value = presetId
}

async function loadSystemConfig() {
  systemConfigLoading.value = true
  try {
    const { data } = await api.get('/api/admin/system-config')
    if (data?.ok) {
      if (data.data.default) {
        const def = data.data.default
        defaultSystemConfig.value = {
          serverUrl: def.serverUrl || '',
          clientVersion: def.clientVersion || '',
          platform: def.platform || 'qq',
          os: def.os || 'Windows',
          deviceInfo: def.deviceInfo ? { ...def.deviceInfo } : { ...defaultSystemConfig.value.deviceInfo },
        }
      }
      if (data.data.saved) {
        const saved = data.data.saved
        localSystemConfig.value = {
          serverUrl: saved.serverUrl || '',
          clientVersion: saved.clientVersion || '',
          platform: saved.platform || 'qq',
          os: saved.os || 'Windows',
          deviceInfo: saved.deviceInfo ? { ...saved.deviceInfo } : { ...localSystemConfig.value.deviceInfo },
        }
      }
      else {
        // 没有已保存的配置时，用默认值填充输入框
        const def = defaultSystemConfig.value
        localSystemConfig.value = {
          serverUrl: def.serverUrl || '',
          clientVersion: def.clientVersion || '',
          platform: def.platform || 'qq',
          os: def.os || 'Windows',
          deviceInfo: { ...def.deviceInfo },
        }
      }
    }
  }
  catch (e: any) {
    console.error('加载系统配置失败:', e)
  }
  finally {
    systemConfigLoading.value = false
  }
}

async function handleSaveSystemConfig() {
  systemConfigSaving.value = true
  try {
    const payload = {
      ...localSystemConfig.value,
      deviceInfo: { ...localSystemConfig.value.deviceInfo },
    }
    const { data } = await api.post('/api/admin/system-config', payload)
    if (data?.ok) {
      showAlert('系统配置已保存并立即生效，无需重启项目', 'primary')
    }
    else {
      showAlert(data?.error || '保存失败', 'danger')
    }
  }
  catch (e: any) {
    showAlert(`保存失败: ${e.message || '未知错误'}`, 'danger')
  }
  finally {
    systemConfigSaving.value = false
  }
}

async function handleResetSystemConfig() {
  systemConfigSaving.value = true
  try {
    const { data } = await api.post('/api/admin/system-config/reset')
    if (data?.ok) {
      const saved = data.data.saved
      localSystemConfig.value = {
        serverUrl: saved.serverUrl || '',
        clientVersion: saved.clientVersion || '',
        platform: saved.platform || 'qq',
        os: saved.os || 'Windows',
        deviceInfo: saved.deviceInfo ? { ...saved.deviceInfo } : { ...localSystemConfig.value.deviceInfo },
      }
      showAlert('系统配置已重置为默认值', 'primary')
    }
    else {
      showAlert(data?.error || '重置失败', 'danger')
    }
  }
  catch (e: any) {
    showAlert(`重置失败: ${e.message || '未知错误'}`, 'danger')
  }
  finally {
    systemConfigSaving.value = false
  }
}

onMounted(() => {
  fetchDashboard()
  if (activeTab.value === 'dashboard') {
    startDashboardTimer()
  }
  fetchCards()
  fetchUsers()
  fetchAdminAccounts()
  fetchLoginLogs()
  loadSystemConfig()
  loadDevicePresets()
  fetchCardClaimStatus()
})

onUnmounted(() => {
  stopDashboardTimer()
})

watch(activeTab, (tab) => {
  if (tab === 'dashboard') {
    fetchDashboard()
    startDashboardTimer()
  }
  else {
    stopDashboardTimer()
  }
  if (tab === 'account') {
    fetchAdminAccounts()
  }
})
</script>

<template>
  <div class="admin-panel space-y-5">
    <div class="farm-card-enhanced p-4">
      <h1 class="flex items-center gap-3 text-2xl font-bold font-display" style="color: var(--theme-text)">
        <div class="admin-title-icon">
          <div class="i-fas-user-shield" />
        </div>
        <span>后台管理</span>
        <div class="admin-title-decor" />
      </h1>
    </div>

    <div class="farm-card-enhanced">
      <div class="admin-tabs-nav">
        <nav class="flex gap-2 p-2">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="admin-tab flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-300"
            :class="activeTab === tab.key
              ? 'admin-tab-active'
              : 'admin-tab-inactive'"
            @click="activeTab = tab.key"
          >
            <div :class="tab.icon" class="admin-tab-icon" />
            {{ tab.label }}
          </button>
        </nav>
      </div>

      <div class="p-4">
        <!-- 仪表盘 -->
        <div v-if="activeTab === 'dashboard'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-800 font-semibold dark:text-gray-200">
              系统仪表盘
            </h3>
            <BaseButton variant="secondary" size="sm" :loading="dashboardLoading" @click="fetchDashboard">
              刷新
            </BaseButton>
          </div>

          <div v-if="!dashboard" class="py-8 text-center text-gray-500">
            <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
            <div>加载中...</div>
          </div>

          <div v-else class="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div
              class="farm-card rounded-2xl border border-gray-200 p-4 shadow-md dark:border-gray-700"
              :style="{ borderColor: 'color-mix(in srgb, var(--theme-primary) 20%, transparent)', background: 'color-mix(in srgb, var(--theme-bg) 95%, transparent)' }"
            >
              <div class="text-sm text-gray-500 dark:text-gray-400">
                总用户数
              </div>
              <div class="mt-1 text-2xl font-bold" style="color: var(--theme-primary)">
                {{ dashboard.totalUsers }}
              </div>
            </div>
            <div
              class="farm-card rounded-2xl border border-gray-200 p-4 shadow-md dark:border-gray-700"
              :style="{ borderColor: 'color-mix(in srgb, var(--theme-primary) 20%, transparent)', background: 'color-mix(in srgb, var(--theme-bg) 95%, transparent)' }"
            >
              <div class="text-sm text-gray-500 dark:text-gray-400">
                在线用户
              </div>
              <div class="mt-1 text-2xl font-bold" style="color: var(--theme-primary)">
                {{ dashboard.onlineUsers }}
              </div>
            </div>
            <div
              class="farm-card rounded-2xl border border-gray-200 p-4 shadow-md dark:border-gray-700"
              :style="{ borderColor: 'color-mix(in srgb, var(--theme-primary) 20%, transparent)', background: 'color-mix(in srgb, var(--theme-bg) 95%, transparent)' }"
            >
              <div class="text-sm text-gray-500 dark:text-gray-400">
                总账号数
              </div>
              <div class="mt-1 text-2xl font-bold" style="color: var(--theme-primary)">
                {{ dashboard.totalAccounts }}
              </div>
            </div>
            <div
              class="farm-card rounded-2xl border border-gray-200 p-4 shadow-md dark:border-gray-700"
              :style="{ borderColor: 'color-mix(in srgb, var(--theme-primary) 20%, transparent)', background: 'color-mix(in srgb, var(--theme-bg) 95%, transparent)' }"
            >
              <div class="text-sm text-gray-500 dark:text-gray-400">
                运行中账号
              </div>
              <div class="mt-1 text-2xl font-bold" style="color: var(--theme-primary)">
                {{ dashboard.onlineAccounts }}
              </div>
            </div>
          </div>

          <div
            v-if="dashboard"
            class="farm-card rounded-2xl border border-gray-200 p-4 shadow-md dark:border-gray-700"
            :style="{ borderColor: 'color-mix(in srgb, var(--theme-primary) 20%, transparent)', background: 'color-mix(in srgb, var(--theme-bg) 95%, transparent)' }"
          >
            <h4 class="mb-3 text-base font-semibold" style="color: var(--theme-primary)">
              服务状态
            </h4>
            <div class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div class="flex justify-between">
                <span class="text-gray-500 dark:text-gray-400">运行时长</span>
                <span class="font-medium" style="color: var(--theme-text)">{{ formatDuration(dashboard.uptime) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-500 dark:text-gray-400">内存使用</span>
                <span class="font-medium" style="color: var(--theme-text)">{{ formatBytes(dashboard.memory.used) }} / {{ formatBytes(dashboard.memory.rss) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-500 dark:text-gray-400">堆内存</span>
                <span class="font-medium" style="color: var(--theme-text)">{{ formatBytes(dashboard.memory.used) }} / {{ formatBytes(dashboard.memory.total) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-500 dark:text-gray-400">版本号</span>
                <span class="font-medium" style="color: var(--theme-text)">{{ dashboard.version || '-' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 卡密管理 -->
        <div v-if="activeTab === 'card'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-800 font-semibold dark:text-gray-200">
              卡密管理
            </h3>
            <div class="flex gap-2">
              <BaseButton variant="secondary" size="sm" @click="fetchCards">
                刷新
              </BaseButton>
              <BaseButton variant="primary" size="sm" @click="showCreateModal = true">
                创建卡密
              </BaseButton>
            </div>
          </div>

          <!-- 卡密领取功能开关 -->
          <div class="admin-info-card farm-card-enhanced p-5">
            <div class="flex items-center gap-4">
              <div class="admin-card-icon">
                <span class="text-2xl">🎫</span>
              </div>
              <div class="flex-1">
                <h4 class="text-base font-bold font-display" style="color: var(--theme-text)">
                  卡密领取功能
                </h4>
                <p class="mt-1 text-xs" style="color: color-mix(in srgb, var(--theme-text) 50%, transparent)">
                  开启后，用户注册时可免费领取一张时间卡密
                </p>
              </div>
              <div class="flex items-center gap-4">
                <div class="text-right">
                  <div class="text-xs" style="color: color-mix(in srgb, var(--theme-text) 50%, transparent)">
                    库存
                  </div>
                  <div class="asset-number text-lg font-extrabold" :class="unusedTimeCardsCount > 0 ? 'text-green-500' : 'text-red-500'">
                    {{ unusedTimeCardsCount }}
                    <span class="text-xs font-normal">张</span>
                  </div>
                </div>
                <div class="admin-switch-wrap">
                  <BaseSwitch
                    v-model="cardClaimEnabled"
                    :disabled="cardClaimLoading"
                    @update:model-value="toggleCardClaimStatus"
                  />
                </div>
              </div>
            </div>
          </div>

          <div class="flex gap-2">
            <button
              class="cartoon-btn rounded-xl px-3 py-1.5 text-sm font-medium transition-colors"
              :class="cardTypeFilter === 'all'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
              :style="cardTypeFilter === 'all' ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="cardTypeFilter = 'all'"
            >
              全部
            </button>
            <button
              class="cartoon-btn rounded-xl px-3 py-1.5 text-sm font-medium transition-colors"
              :class="cardTypeFilter === 'time'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
              :style="cardTypeFilter === 'time' ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="cardTypeFilter = 'time'"
            >
              时间卡密
            </button>
            <button
              class="cartoon-btn rounded-xl px-3 py-1.5 text-sm font-medium transition-colors"
              :class="cardTypeFilter === 'quota'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
              :style="cardTypeFilter === 'quota' ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="cardTypeFilter = 'quota'"
            >
              配额卡密
            </button>
          </div>

          <div class="flex farm-card items-center gap-2 rounded-2xl bg-white px-2 py-1.5 shadow-md dark:bg-gray-800">
            <input
              v-model="searchQuery"
              placeholder="搜索卡密、描述或使用者..."
              class="h-8 w-64 border farm-input border-gray-300 rounded-xl bg-white px-3 text-sm text-gray-900 outline-none transition-all dark:border-gray-600 focus:border-green-500 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-green-500/20"
            >
            <select
              v-model="filterStatus"
              class="border farm-input border-gray-300 rounded-xl bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="all">
                全部状态
              </option>
              <option value="unused">
                未使用
              </option>
              <option value="used">
                已使用
              </option>
              <option value="enabled">
                已启用
              </option>
              <option value="disabled">
                已禁用
              </option>
            </select>
          </div>

          <div v-if="selectedCards.size > 0" class="flex items-center gap-3 rounded-lg p-3" style="background-color: rgba(var(--theme-primary-rgb, 59, 130, 246), 0.1);">
            <span style="color: var(--theme-primary);">
              已选择 {{ selectedCards.size }} 个卡密
            </span>
            <BaseButton variant="secondary" size="sm" @click="copySelectedCards">
              一键复制
            </BaseButton>
            <BaseButton variant="danger" size="sm" @click="deleteSelectedCards">
              批量删除
            </BaseButton>
            <button
              class="ml-auto text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700"
              @click="selectedCards.clear(); selectAll = false"
            >
              清除选择
            </button>
          </div>

          <div v-if="cardsLoading" class="py-8 text-center text-gray-500">
            <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
            <div>加载中...</div>
          </div>

          <div v-else class="admin-table-wrap overflow-hidden rounded-2xl">
            <div class="overflow-x-auto">
              <table class="admin-table min-w-full text-left text-sm">
                <thead class="admin-table-head">
                  <tr>
                    <th class="px-3 py-3">
                      <input
                        v-model="selectAll"
                        type="checkbox"
                        class="border-gray-300 rounded"
                        @change="toggleSelectAll"
                      >
                    </th>
                    <th class="px-4 py-3 font-bold">
                      🔑 卡密
                    </th>
                    <th class="px-4 py-3 font-bold">
                      📝 描述
                    </th>
                    <th class="px-4 py-3 font-bold">
                      📦 类型
                    </th>
                    <th class="px-4 py-3 font-bold">
                      数值
                    </th>
                    <th class="px-4 py-3 font-bold">
                      状态
                    </th>
                    <th class="px-4 py-3 font-bold">
                      使用者
                    </th>
                    <th class="px-4 py-3 font-bold">
                      生成时间
                    </th>
                    <th class="px-4 py-3 font-bold">
                      使用时间
                    </th>
                    <th class="px-4 py-3 text-right font-bold">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody class="admin-table-body">
                  <tr v-for="(card, index) in filteredCards" :key="card.code" class="admin-table-row" :class="index % 2 === 0 ? 'row-even' : 'row-odd'">
                    <td class="px-3 py-3">
                      <input
                        :checked="selectedCards.has(card.code)"
                        type="checkbox"
                        class="border-gray-300 rounded"
                        @change="toggleSelectCard(card.code)"
                      >
                    </td>
                    <td class="whitespace-nowrap px-4 py-3">
                      <code class="admin-code-bg rounded-lg px-2.5 py-1 text-xs font-bold font-mono">{{ card.code }}</code>
                    </td>
                    <td class="whitespace-nowrap px-4 py-3 font-medium" style="color: var(--theme-text)">
                      {{ card.description }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-3">
                      <span
                        class="admin-badge inline-flex rounded-full px-2.5 py-1 text-xs font-bold"
                        :class="card.type === 'quota' ? 'badge-purple' : 'badge-blue'"
                      >
                        {{ getCardTypeLabel(card) }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-4 py-3 font-bold" style="color: var(--theme-text)">
                      {{ getCardValueLabel(card) }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-3">
                      <span class="admin-status-wrap inline-flex items-center gap-1.5">
                        <span
                          class="admin-status-dot"
                          :class="card.enabled ? 'status-online' : 'status-offline'"
                        />
                        <span
                          class="admin-badge inline-flex rounded-full px-2.5 py-1 text-xs font-bold"
                          :class="card.enabled ? 'badge-green' : 'badge-red'"
                        >
                          {{ card.enabled ? '启用' : '禁用' }}
                        </span>
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-4 py-3 text-sm" style="color: color-mix(in srgb, var(--theme-text) 60%, transparent)">
                      {{ card.usedBy || '-' }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-3 text-sm" style="color: color-mix(in srgb, var(--theme-text) 60%, transparent)">
                      {{ card.createdAt ? new Date(card.createdAt).toLocaleString() : '-' }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-3 text-sm" style="color: color-mix(in srgb, var(--theme-text) 60%, transparent)">
                      {{ card.usedAt ? new Date(card.usedAt).toLocaleString() : '-' }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-3 text-right text-sm">
                      <div class="flex items-center justify-end gap-1.5">
                        <button class="admin-table-btn admin-table-btn-primary" @click="copyCode(card.code)">
                          复制
                        </button>
                        <button class="admin-table-btn admin-table-btn-warning" @click="toggleCardStatus(card)">
                          {{ card.enabled ? '禁用' : '启用' }}
                        </button>
                        <button class="admin-table-btn admin-table-btn-danger" @click="deleteCard(card)">
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="filteredCards.length === 0">
                    <td colspan="10" class="px-4 py-8 text-center" style="color: color-mix(in srgb, var(--theme-text) 40%, transparent)">
                      暂无卡密
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div
            v-if="showCreateModal"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            @click.self="showCreateModal = false"
          >
            <div class="max-w-md w-full rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800" @click.stop>
              <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                创建卡密
              </h2>
              <div class="space-y-3">
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    描述
                  </label>
                  <BaseInput
                    v-model="newCard.description"
                    placeholder="例如：月卡-2024"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    卡密类型
                  </label>
                  <div class="flex gap-4">
                    <label class="flex cursor-pointer items-center gap-2">
                      <input
                        v-model="newCard.type"
                        type="radio"
                        value="time"
                        class="text-blue-600 focus:ring-blue-500"
                      >
                      <span class="text-sm text-gray-700 dark:text-gray-300">时间卡（增加使用时长）</span>
                    </label>
                    <label class="flex cursor-pointer items-center gap-2">
                      <input
                        v-model="newCard.type"
                        type="radio"
                        value="quota"
                        class="text-orange-600 focus:ring-orange-500"
                      >
                      <span class="text-sm text-gray-700 dark:text-gray-300">额度卡（增加账号额度）</span>
                    </label>
                  </div>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    {{ newCard.type === 'quota' ? '额度数量' : '天数' }}
                  </label>
                  <BaseInput
                    v-model.number="newCard.days"
                    type="number"
                    :placeholder="newCard.type === 'quota' ? '可添加的账号数量' : '天数'"
                  />
                  <p v-if="newCard.type === 'time'" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    输入-1表示永久，其他数字表示天数
                  </p>
                  <p v-else class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    用户使用后可增加的账号额度数量
                  </p>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    数量
                  </label>
                  <BaseInput
                    v-model.number="newCard.count"
                    type="number"
                    min="1"
                    max="100"
                    placeholder="数量"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    批量创建数量（1-100），批量创建后会自动导出文件
                  </p>
                </div>
              </div>
              <div class="mt-5 flex justify-end space-x-3">
                <BaseButton variant="secondary" size="sm" @click="showCreateModal = false">
                  取消
                </BaseButton>
                <BaseButton variant="primary" size="sm" @click="createCard">
                  创建
                </BaseButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 用户管理 -->
        <div v-else-if="activeTab === 'user'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              用户管理
            </h3>
            <BaseButton variant="primary" size="sm" @click="fetchUsers">
              刷新
            </BaseButton>
          </div>

          <div v-if="usersLoading" class="py-8 text-center text-gray-500">
            <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
            <div>加载中...</div>
          </div>

          <div v-else class="farm-card overflow-hidden border border-gray-200 rounded-2xl shadow-md dark:border-gray-700">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead class="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      用户名
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      角色
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      额度
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      时长
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      过期时间
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      状态
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      在线状态
                    </th>
                    <th class="px-3 py-2 text-right text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                  <tr v-for="user in users" :key="user.username">
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 font-medium dark:text-white">
                      {{ user.username }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      <span
                        class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                        :class="user.role === 'admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'"
                      >
                        {{ user.role === 'admin' ? '管理员' : '用户' }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      <span
                        class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                        :class="user.role === 'admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'"
                      >
                        {{ user.role === 'admin' ? '无限制' : `${user.accountLimit || 2}个` }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      {{ user.card ? getDaysLabel(user.card.days) : '无' }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm" :class="isExpired(user.card) ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'">
                      {{ formatDate(user.card?.expiresAt || null) }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2">
                      <span
                        v-if="user.card"
                        class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                        :class="user.card.enabled === false ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : (isExpired(user.card) ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200')"
                      >
                        {{ user.card.enabled === false ? '封禁' : (isExpired(user.card) ? '已过期' : '正常') }}
                      </span>
                      <span v-else class="text-gray-500 dark:text-gray-400">-</span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2">
                      <span
                        class="inline-flex items-center gap-1 rounded-full px-2 text-xs font-semibold leading-5"
                        :class="user.online ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'"
                      >
                        <span class="h-1.5 w-1.5 rounded-full" :class="user.online ? 'bg-green-500' : 'bg-gray-400'" />
                        {{ user.online ? '在线' : '离线' }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-right text-sm font-medium">
                      <button
                        class="mr-3 text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                        @click="openEditModal(user)"
                      >
                        编辑
                      </button>
                      <button
                        v-if="user.card"
                        class="mr-3 text-yellow-600 dark:text-yellow-400 hover:text-yellow-900 dark:hover:text-yellow-300"
                        @click="toggleUserStatus(user)"
                      >
                        {{ user.card.enabled === false ? '解封' : '封禁' }}
                      </button>
                      <button
                        v-if="user.username !== currentUsername"
                        class="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                        @click="deleteUser(user)"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                  <tr v-if="users.length === 0">
                    <td colspan="9" class="px-3 py-4 text-center text-gray-500 dark:text-gray-400">
                      暂无用户
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div
            v-if="showEditModal"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            @click.self="showEditModal = false"
          >
            <div class="max-w-md w-full rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800" @click.stop>
              <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                编辑用户：{{ selectedUser?.username }}
              </h2>
              <div class="space-y-3">
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    用户名
                  </label>
                  <BaseInput
                    v-model="editForm.newUsername"
                    placeholder="输入新用户名（留空则不修改）"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    用户名只能包含字母、数字和下划线，长度3-32位
                  </p>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    新密码
                  </label>
                  <BaseInput
                    v-model="editForm.password"
                    type="password"
                    placeholder="输入新密码（留空则不修改）"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    密码长度至少6位，需包含大写字母、小写字母、数字、特殊符号中的至少两种
                  </p>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    账号额度
                  </label>
                  <BaseInput
                    v-model.number="editForm.accountLimit"
                    type="number"
                    min="1"
                    placeholder="可添加的账号数量"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    用户最多可添加的农场账号数量
                  </p>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    过期时间
                  </label>
                  <div class="flex items-center gap-3">
                    <input
                      v-model="editForm.isPermanent"
                      type="checkbox"
                      class="border-gray-300 rounded text-blue-600 focus:ring-blue-500"
                    >
                    <span class="text-sm text-gray-600 dark:text-gray-400">永久有效</span>
                  </div>
                  <input
                    v-if="!editForm.isPermanent"
                    v-model="editForm.expiresAt"
                    type="datetime-local"
                    class="mt-2 w-full border farm-input border-gray-200 rounded-xl bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                </div>
              </div>
              <div class="mt-5 flex justify-end space-x-3">
                <BaseButton variant="secondary" size="sm" @click="showEditModal = false">
                  取消
                </BaseButton>
                <BaseButton
                  variant="primary"
                  size="sm"
                  :disabled="editLoading"
                  @click="handleEdit"
                >
                  {{ editLoading ? '保存中...' : '保存' }}
                </BaseButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 账号全局管理 -->
        <div v-else-if="activeTab === 'account'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              账号全局管理
            </h3>
            <BaseButton variant="primary" size="sm" @click="fetchAdminAccounts">
              刷新
            </BaseButton>
          </div>

          <div v-if="adminAccountsLoading" class="py-8 text-center text-gray-500">
            <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
            <div>加载中...</div>
          </div>

          <div v-else class="farm-card overflow-hidden border border-gray-200 rounded-2xl shadow-md dark:border-gray-700">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead class="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      账号
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      平台
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      所属用户
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      状态
                    </th>
                    <th class="px-3 py-2 text-right text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                  <tr v-for="acc in adminAccounts" :key="acc.id">
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 font-medium dark:text-white">
                      <div>{{ acc.name || acc.uin || acc.id }}</div>
                      <div class="text-xs text-gray-500 dark:text-gray-400">
                        {{ acc.uin || acc.qq || '-' }}
                      </div>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      {{ acc.platform || '-' }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      {{ acc.username || '-' }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2">
                      <span
                        class="inline-flex items-center gap-1 rounded-full px-2 text-xs font-semibold leading-5"
                        :class="acc.running ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'"
                      >
                        <span class="h-1.5 w-1.5 rounded-full" :class="acc.running ? 'bg-green-500' : 'bg-gray-400'" />
                        {{ acc.running ? '运行中' : '已停止' }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-right text-sm font-medium">
                      <button
                        v-if="!acc.running"
                        class="mr-3 text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300"
                        @click="startAdminAccount(acc)"
                      >
                        启动
                      </button>
                      <button
                        v-else
                        class="mr-3 text-yellow-600 dark:text-yellow-400 hover:text-yellow-900 dark:hover:text-yellow-300"
                        @click="stopAdminAccount(acc)"
                      >
                        停止
                      </button>
                      <button
                        class="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                        @click="confirmDeleteAdminAccount(acc)"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                  <tr v-if="adminAccounts.length === 0">
                    <td colspan="5" class="px-3 py-4 text-center text-gray-500 dark:text-gray-400">
                      暂无账号
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <ConfirmModal
            :show="showDeleteAccountConfirm"
            title="删除账号"
            :message="`确定要删除账号 ${accountToDelete?.name || accountToDelete?.uin || accountToDelete?.id} 吗？此操作不可恢复。`"
            type="danger"
            confirm-text="删除"
            @confirm="deleteAdminAccount"
            @cancel="showDeleteAccountConfirm = false; accountToDelete = null"
          />
        </div>

        <!-- 登录日志 -->
        <div v-else-if="activeTab === 'log'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              登录日志
            </h3>
            <div class="flex items-center gap-2">
              <BaseButton
                variant="danger"
                size="sm"
                @click="openClearLogsConfirm"
              >
                清空日志
              </BaseButton>
              <BaseButton
                variant="primary"
                size="sm"
                :loading="loginLogsLoading"
                @click="fetchLoginLogs"
              >
                刷新
              </BaseButton>
            </div>
          </div>

          <div class="admin-log-area farm-card-enhanced overflow-hidden">
            <div class="overflow-x-auto">
              <table class="admin-table min-w-full text-left text-sm">
                <thead class="admin-table-head">
                  <tr>
                    <th class="px-4 py-3 font-bold">
                      🕐 时间
                    </th>
                    <th class="px-4 py-3 font-bold">
                      📋 事件
                    </th>
                    <th class="px-4 py-3 font-bold">
                      👤 用户名
                    </th>
                    <th class="px-4 py-3 font-bold">
                      ❌ 错误类型
                    </th>
                    <th class="px-4 py-3 font-bold">
                      🌐 IP地址
                    </th>
                    <th class="px-4 py-3 font-bold">
                      🖥️ 浏览器
                    </th>
                  </tr>
                </thead>
                <tbody class="admin-table-body">
                  <tr v-if="loginLogsLoading">
                    <td colspan="6" class="px-4 py-8 text-center" style="color: color-mix(in srgb, var(--theme-text) 40%, transparent)">
                      加载中...
                    </td>
                  </tr>
                  <tr v-else-if="loginLogs.length === 0">
                    <td colspan="6" class="px-4 py-8 text-center" style="color: color-mix(in srgb, var(--theme-text) 40%, transparent)">
                      暂无登录日志
                    </td>
                  </tr>
                  <tr v-for="(log, index) in loginLogs" :key="log.id" class="admin-table-row" :class="index % 2 === 0 ? 'row-even' : 'row-odd'">
                    <td class="whitespace-nowrap px-4 py-3 text-sm font-mono" style="color: var(--theme-text)">
                      {{ formatLogTime(log.timestamp) }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-3">
                      <span class="admin-status-wrap inline-flex items-center gap-1.5">
                        <span
                          class="admin-status-dot"
                          :class="log.event === 'login_success' ? 'status-online' : 'status-offline'"
                        />
                        <span
                          class="admin-badge inline-flex rounded-full px-2.5 py-1 text-xs font-bold"
                          :class="log.event === 'login_success' ? 'badge-green' : 'badge-red'"
                        >
                          {{ getEventLabel(log.event) }}
                        </span>
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-4 py-3 font-bold" style="color: var(--theme-text)">
                      {{ log.username }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-3 text-sm" style="color: color-mix(in srgb, var(--theme-text) 60%, transparent)">
                      {{ getErrorTypeLabel(log.errorType) }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-3">
                      <code class="admin-code-bg rounded-lg px-2.5 py-1 text-xs font-mono">{{ log.ip }}</code>
                    </td>
                    <td class="whitespace-nowrap px-4 py-3 text-sm" style="color: color-mix(in srgb, var(--theme-text) 60%, transparent)">
                      {{ parseBrowser(log.userAgent) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="loginLogsTotal > 0" class="admin-log-footer px-4 py-3 text-sm" style="color: color-mix(in srgb, var(--theme-text) 50%, transparent)">
              <span class="inline-flex items-center gap-1.5">
                <span>📊</span>
                共 {{ loginLogsTotal }} 条记录
              </span>
            </div>
          </div>

          <!-- 清空日志确认弹窗 -->
          <div
            v-if="showClearLogsConfirm"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            @click.self="showClearLogsConfirm = false"
          >
            <div class="max-w-md w-full rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800" @click.stop>
              <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                确认清空日志
              </h2>
              <p class="mb-4 text-gray-600 dark:text-gray-300">
                确定要清空所有登录日志吗？此操作不可恢复。
              </p>
              <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
                当前共有 {{ loginLogsTotal }} 条记录
              </p>
              <div class="flex justify-end space-x-3">
                <BaseButton variant="secondary" size="sm" @click="showClearLogsConfirm = false">
                  取消
                </BaseButton>
                <BaseButton
                  variant="danger"
                  size="sm"
                  :loading="clearLogsLoading"
                  @click="confirmClearLogs"
                >
                  确认清空
                </BaseButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 系统配置 -->
        <div v-else-if="activeTab === 'system'" class="space-y-4">
          <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
            系统配置
          </h3>

          <div class="space-y-4">
            <div class="farm-card-enhanced p-5">
              <h4 class="mb-4 flex items-center gap-2 text-lg font-bold font-display" style="color: var(--theme-text)">
                <div class="admin-section-icon">
                  <div class="i-carbon-settings" />
                </div>
                <span>系统配置</span>
                <div class="admin-section-divider" />
              </h4>

              <!-- 设备预设选择 -->
              <div v-if="devicePresets.length" class="mb-4">
                <label class="mb-2 block text-sm text-gray-700 font-medium dark:text-gray-300">设备预设</label>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="preset in devicePresets"
                    :key="preset.id"
                    class="rounded-lg px-3 py-1.5 text-xs transition-all"
                    :class="selectedPresetId === preset.id
                      ? 'text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                    :style="selectedPresetId === preset.id ? { backgroundColor: 'var(--theme-primary)' } : {}"
                    :title="preset.description"
                    @click="applyDevicePreset(preset.id)"
                  >
                    {{ preset.name }}
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-3 text-sm">
                <BaseInput
                  v-model="localSystemConfig.serverUrl"
                  label="服务器地址"
                  type="text"
                  placeholder="wss://..."
                  class="col-span-2"
                />
                <div class="flex flex-col gap-1.5">
                  <label class="text-sm text-gray-700 font-medium dark:text-gray-300">平台</label>
                  <div class="flex gap-2">
                    <button
                      v-for="option in platformOptions"
                      :key="option.value"
                      class="rounded-lg px-3 py-1.5 text-sm transition-all"
                      :class="localSystemConfig.platform === option.value
                        ? 'text-white shadow-sm'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                      :style="localSystemConfig.platform === option.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
                      @click="localSystemConfig.platform = option.value"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>
                <div class="flex flex-col gap-1.5">
                  <label class="text-sm text-gray-700 font-medium dark:text-gray-300">系统</label>
                  <div class="flex gap-2">
                    <button
                      v-for="option in osOptions"
                      :key="option.value"
                      class="rounded-lg px-3 py-1.5 text-sm transition-all"
                      :class="localSystemConfig.deviceInfo.os === option.value
                        ? 'text-white shadow-sm'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                      :style="localSystemConfig.deviceInfo.os === option.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
                      @click="localSystemConfig.deviceInfo.os = option.value; localSystemConfig.os = option.value"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- 设备详细信息 -->
              <div class="grid grid-cols-2 mt-3 gap-3 text-sm">
                <BaseInput
                  v-model="localSystemConfig.deviceInfo.clientVersion"
                  label="客户端版本"
                  type="text"
                  :placeholder="defaultSystemConfig.deviceInfo.clientVersion || '从服务器加载中...'"
                  class="col-span-2"
                  @change="localSystemConfig.clientVersion = localSystemConfig.deviceInfo.clientVersion"
                />
                <BaseInput
                  v-model="localSystemConfig.deviceInfo.sysSoftware"
                  label="系统版本"
                  type="text"
                  placeholder="Windows 10"
                />
                <BaseInput
                  v-model="localSystemConfig.deviceInfo.deviceId"
                  label="设备标识"
                  type="text"
                  placeholder="DESKTOP-PC<WPC>"
                />
                <BaseInput
                  v-model="localSystemConfig.deviceInfo.memory"
                  label="内存(MB)"
                  type="text"
                  placeholder="16384"
                />
                <BaseInput
                  v-model="localSystemConfig.deviceInfo.network"
                  label="网络"
                  type="text"
                  placeholder="wifi"
                />
                <BaseInput
                  v-model="localSystemConfig.deviceInfo.userAgent"
                  label="User-Agent"
                  type="text"
                  placeholder="Mozilla/5.0 ..."
                  class="col-span-2"
                />
              </div>

              <div class="mt-3 flex justify-end gap-2">
                <BaseButton
                  variant="secondary"
                  size="sm"
                  :loading="systemConfigSaving"
                  @click="handleResetSystemConfig"
                >
                  重置
                </BaseButton>
                <BaseButton
                  variant="primary"
                  size="sm"
                  :loading="systemConfigSaving"
                  @click="handleSaveSystemConfig"
                >
                  保存
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

<style scoped lang="postcss">
/* 标题样式 */
.admin-title-icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--theme-primary) 0%, color-mix(in srgb, var(--theme-primary) 70%, #000) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 20px;
  box-shadow:
    0 4px 0 color-mix(in srgb, var(--theme-primary) 60%, #000),
    0 6px 20px color-mix(in srgb, var(--theme-primary) 40%, transparent),
    0 0 20px color-mix(in srgb, var(--theme-primary) 30%, transparent) inset;
  animation: title-icon-pulse 3s ease-in-out infinite;
}

@keyframes title-icon-pulse {
  0%,
  100% {
    transform: scale(1) rotate(0deg);
  }
  50% {
    transform: scale(1.05) rotate(3deg);
  }
}

.admin-title-decor {
  flex: 1;
  height: 3px;
  margin-left: 16px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--theme-primary) 40%, transparent) 0%,
    color-mix(in srgb, var(--theme-primary) 20%, transparent) 50%,
    transparent 100%
  );
  border-radius: 3px;
  position: relative;
}

.admin-title-decor::before {
  content: '🌾';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  font-size: 16px;
  animation: wheat-sway 3s ease-in-out infinite;
}

@keyframes wheat-sway {
  0%,
  100% {
    transform: translateY(-50%) rotate(-5deg);
  }
  50% {
    transform: translateY(-50%) rotate(5deg);
  }
}

/* 选项卡样式 */
.admin-tabs-nav {
  background: linear-gradient(180deg, rgba(139, 105, 20, 0.04) 0%, transparent 100%);
  border-bottom: 2px solid rgba(139, 105, 20, 0.08);
}

.dark .admin-tabs-nav {
  background: linear-gradient(180deg, rgba(109, 191, 91, 0.06) 0%, transparent 100%);
  border-bottom: 2px solid rgba(109, 191, 91, 0.1);
}

.admin-tab {
  font-family: 'Nunito', sans-serif;
  position: relative;
}

.admin-tab-inactive {
  color: #6b7280;
  background: rgba(0, 0, 0, 0.03);
}

.dark .admin-tab-inactive {
  color: #9ca3af;
  background: rgba(255, 255, 255, 0.03);
}

.admin-tab-inactive:hover {
  color: #374151;
  background: rgba(0, 0, 0, 0.06);
  transform: translateY(-1px);
}

.dark .admin-tab-inactive:hover {
  color: #e5e7eb;
  background: rgba(255, 255, 255, 0.06);
}

.admin-tab-active {
  background: linear-gradient(135deg, var(--theme-primary) 0%, color-mix(in srgb, var(--theme-primary) 80%, #000) 100%);
  color: white;
  transform: translateY(-2px);
  box-shadow:
    0 4px 0 color-mix(in srgb, var(--theme-primary) 60%, #000),
    0 6px 20px color-mix(in srgb, var(--theme-primary) 40%, transparent),
    0 0 20px color-mix(in srgb, var(--theme-primary) 30%, transparent) inset;
}

.admin-tab-icon {
  font-size: 16px;
  animation: admin-tab-icon-bounce 2.5s ease-in-out infinite;
}

@keyframes admin-tab-icon-bounce {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.15);
  }
}

/* 信息卡片 */
.admin-info-card {
  position: relative;
  overflow: hidden;
}

.admin-info-card::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 120px;
  height: 120px;
  background: radial-gradient(circle, color-mix(in srgb, var(--theme-primary) 8%, transparent) 0%, transparent 70%);
  border-radius: 50%;
  transform: translate(30%, -30%);
}

.admin-card-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 3px solid rgba(217, 119, 6, 0.2);
  box-shadow: 0 4px 12px rgba(217, 119, 6, 0.2);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.admin-info-card:hover .admin-card-icon {
  transform: scale(1.1) rotate(-5deg);
  box-shadow: 0 6px 20px rgba(217, 119, 6, 0.3);
}

.admin-switch-wrap {
  transform: scale(1.1);
}

/* 分组标题 */
.admin-section-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--theme-primary) 20%, transparent) 0%,
    color-mix(in srgb, var(--theme-primary) 10%, transparent) 100%
  );
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--theme-primary);
}

.admin-section-divider {
  flex: 1;
  height: 2px;
  margin-left: 12px;
  background: linear-gradient(90deg, rgba(139, 105, 20, 0.2) 0%, rgba(139, 105, 20, 0.1) 50%, transparent 100%);
  border-radius: 2px;
}

.dark .admin-section-divider {
  background: linear-gradient(90deg, rgba(109, 191, 91, 0.2) 0%, rgba(109, 191, 91, 0.1) 50%, transparent 100%);
}

/* 表格样式 */
.admin-table-wrap {
  background: linear-gradient(145deg, #ffffff 0%, #fefcf5 100%);
  border: 2px solid rgba(139, 105, 20, 0.12);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.8),
    0 4px 16px rgba(139, 105, 20, 0.1);
}

.dark .admin-table-wrap {
  background: linear-gradient(145deg, rgba(45, 55, 45, 0.98) 0%, rgba(30, 40, 30, 0.95) 100%);
  border: 2px solid rgba(109, 191, 91, 0.15);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 4px 16px rgba(0, 0, 0, 0.3);
}

.admin-table-head {
  background: linear-gradient(180deg, rgba(139, 105, 20, 0.08) 0%, rgba(139, 105, 20, 0.04) 100%);
  border-bottom: 2px solid rgba(139, 105, 20, 0.15);
}

.dark .admin-table-head {
  background: linear-gradient(180deg, rgba(109, 191, 91, 0.1) 0%, rgba(109, 191, 91, 0.05) 100%);
  border-bottom: 2px solid rgba(109, 191, 91, 0.2);
}

.admin-table-head th {
  color: #8b6914;
  font-family: 'ZCOOL KuaiLe', cursive;
  font-weight: normal;
  letter-spacing: 0.02em;
  font-size: 13px;
}

.dark .admin-table-head th {
  color: #6dbf5b;
}

.admin-table-row {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.admin-table-row.row-even {
  background: rgba(139, 105, 20, 0.02);
}

.dark .admin-table-row.row-even {
  background: rgba(109, 191, 91, 0.02);
}

.admin-table-row:hover {
  background: color-mix(in srgb, var(--theme-primary) 8%, transparent);
  transform: scale(1.002);
  box-shadow: 0 2px 12px rgba(139, 105, 20, 0.1);
}

.dark .admin-table-row:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

/* 徽章样式 */
.admin-badge {
  border: 2px solid transparent;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

.badge-green {
  background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
  color: #065f46;
  border-color: rgba(16, 185, 129, 0.3);
}

.dark .badge-green {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.25) 100%);
  color: #6ee7b7;
}

.badge-red {
  background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
  color: #991b1b;
  border-color: rgba(239, 68, 68, 0.3);
}

.dark .badge-red {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(220, 38, 38, 0.25) 100%);
  color: #fca5a5;
}

.badge-blue {
  background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
  color: #1e40af;
  border-color: rgba(59, 130, 246, 0.3);
}

.dark .badge-blue {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(37, 99, 235, 0.25) 100%);
  color: #93c5fd;
}

.badge-purple {
  background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
  color: #5b21b6;
  border-color: rgba(139, 92, 246, 0.3);
}

.dark .badge-purple {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.25) 0%, rgba(124, 58, 237, 0.25) 100%);
  color: #c4b5fd;
}

/* 状态指示点 */
.admin-status-dot {
  position: relative;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.admin-status-dot.status-online {
  background: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
}

.admin-status-dot.status-online::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid #22c55e;
  animation: status-ring-pulse 2s ease-out infinite;
}

@keyframes status-ring-pulse {
  0% {
    transform: scale(0.8);
    opacity: 1;
  }
  100% {
    transform: scale(1.8);
    opacity: 0;
  }
}

.admin-status-dot.status-offline {
  background: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
}

/* 代码背景 */
.admin-code-bg {
  background: linear-gradient(145deg, #1f2937 0%, #111827 100%);
  color: #6ee7b7;
  border: 1px solid rgba(75, 85, 99, 0.5);
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.3),
    0 1px 0 rgba(255, 255, 255, 0.05);
}

.dark .admin-code-bg {
  background: linear-gradient(145deg, #111827 0%, #0f172a 100%);
  color: #34d399;
}

/* 表格操作按钮 */
.admin-table-btn {
  padding: 6px 14px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 700;
  border: 2px solid rgba(0, 0, 0, 0.08);
  border-bottom: 3px solid rgba(0, 0, 0, 0.12);
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  cursor: pointer;
  background: white;
}

.dark .admin-table-btn {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
}

.admin-table-btn:hover {
  transform: translateY(-2px) scale(1.05);
}

.admin-table-btn:active {
  transform: translateY(1px) scale(0.98);
  border-bottom-width: 2px;
}

.admin-table-btn-primary {
  background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
  color: #1d4ed8;
  border-color: rgba(59, 130, 246, 0.2);
  border-bottom-color: rgba(59, 130, 246, 0.3);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.15);
}

.admin-table-btn-primary:hover {
  background: linear-gradient(135deg, #bfdbfe 0%, #93c5fd 100%);
  box-shadow:
    0 4px 16px rgba(59, 130, 246, 0.3),
    0 0 12px rgba(59, 130, 246, 0.2);
}

.dark .admin-table-btn-primary {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(37, 99, 235, 0.25) 100%);
  color: #93c5fd;
}

.admin-table-btn-warning {
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  color: #92400e;
  border-color: rgba(245, 158, 11, 0.2);
  border-bottom-color: rgba(245, 158, 11, 0.3);
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.15);
}

.admin-table-btn-warning:hover {
  background: linear-gradient(135deg, #fde68a 0%, #fcd34d 100%);
  box-shadow:
    0 4px 16px rgba(245, 158, 11, 0.3),
    0 0 12px rgba(245, 158, 11, 0.2);
}

.dark .admin-table-btn-warning {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.25) 0%, rgba(217, 119, 6, 0.25) 100%);
  color: #fcd34d;
}

.admin-table-btn-danger {
  background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
  color: #b91c1c;
  border-color: rgba(239, 68, 68, 0.2);
  border-bottom-color: rgba(239, 68, 68, 0.3);
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.15);
}

.admin-table-btn-danger:hover {
  background: linear-gradient(135deg, #fecaca 0%, #fca5a5 100%);
  box-shadow:
    0 4px 16px rgba(239, 68, 68, 0.3),
    0 0 12px rgba(239, 68, 68, 0.2);
}

.dark .admin-table-btn-danger {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(220, 38, 38, 0.25) 100%);
  color: #fca5a5;
}

/* 日志区域 */
.admin-log-area {
  position: relative;
}

.admin-log-footer {
  background: linear-gradient(0deg, rgba(139, 105, 20, 0.05) 0%, transparent 100%);
  border-top: 2px solid rgba(139, 105, 20, 0.08);
}

.dark .admin-log-footer {
  background: linear-gradient(0deg, rgba(109, 191, 91, 0.06) 0%, transparent 100%);
  border-top: 2px solid rgba(109, 191, 91, 0.1);
}
</style>
