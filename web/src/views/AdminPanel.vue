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

type AdminTab = 'dashboard' | 'card' | 'user' | 'account' | 'log' | 'system' | 'session' | 'invite'

const activeTab = ref<AdminTab>(
  (localStorage.getItem('admin-active-tab') as AdminTab) || 'dashboard',
)

watch(activeTab, (newTab) => {
  localStorage.setItem('admin-active-tab', newTab)
})

const tabs = [
  { key: 'dashboard', label: '仪表盘', icon: 'i-carbon-dashboard', permission: 'dashboard:read' },
  { key: 'card', label: '卡密', icon: 'i-carbon-ticket', permission: 'card:*' },
  { key: 'user', label: '用户', icon: 'i-carbon-user-admin', permission: 'user:read' },
  { key: 'account', label: '账号', icon: 'i-carbon-cloud', permission: 'account:read' },
  { key: 'session', label: '会话', icon: 'i-carbon-events', permission: 'session:read' },
  { key: 'log', label: '日志', icon: 'i-carbon-document', permission: 'log:read' },
  { key: 'system', label: '系统', icon: 'i-carbon-settings', permission: 'system:*' },
  { key: 'invite', label: '邀请', icon: 'i-carbon-gift', permission: 'invite:*' },
] as const

const visibleTabs = computed(() => tabs.filter(tab => userStore.hasPermission(tab.permission)))

// 如果当前标签没有权限，自动切换到第一个有权限的标签
watch(visibleTabs, (list) => {
  const first = list[0]
  if (first && !list.some(t => t.key === activeTab.value)) {
    activeTab.value = first.key
  }
}, { immediate: true })

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

// ========== 邀请管理 ==========
interface InviteRule {
  count: number
  rewardDays: number
  rewardAccountLimit?: number
  description?: string
}

interface InviteRecord {
  inviter: string
  invitee: string
  invitedAt: number
}

const inviteConfig = ref({ enabled: true, rules: [] as InviteRule[] })
const inviteRecords = ref<InviteRecord[]>([])
const inviteLoading = ref(false)
const inviteSaving = ref(false)
const newInviteRule = ref<InviteRule>({ count: 1, rewardDays: 7, rewardAccountLimit: 0, description: '' })

async function fetchInviteConfig() {
  inviteLoading.value = true
  try {
    const result = await userStore.getInviteConfig()
    if (result.ok) {
      inviteConfig.value = result.data
    }
    else {
      toast.error(result.error || '获取邀请配置失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取邀请配置失败')
  }
  finally {
    inviteLoading.value = false
  }
}

async function fetchInviteRecords() {
  try {
    const result = await userStore.getInviteRecords()
    if (result.ok) {
      inviteRecords.value = result.data
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取邀请记录失败')
  }
}

async function saveInviteConfig() {
  inviteSaving.value = true
  try {
    const result = await userStore.setInviteConfig({
      enabled: inviteConfig.value.enabled,
      rules: inviteConfig.value.rules,
    })
    if (result.ok) {
      inviteConfig.value = result.data
      toast.success('邀请配置保存成功')
    }
    else {
      toast.error(result.error || '保存失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '保存失败')
  }
  finally {
    inviteSaving.value = false
  }
}

function addInviteRule() {
  const count = Math.max(1, Number.parseInt(String(newInviteRule.value.count), 10) || 1)
  const rewardDays = Number.parseInt(String(newInviteRule.value.rewardDays), 10) || 0
  const rewardAccountLimit = Number.parseInt(String(newInviteRule.value.rewardAccountLimit), 10) || 0

  if (rewardDays <= 0 && rewardAccountLimit <= 0) {
    toast.warning('奖励天数和账号额度至少填写一个')
    return
  }

  const exists = inviteConfig.value.rules.find(r => r.count === count)
  if (exists) {
    toast.warning('该人数档位已存在')
    return
  }

  inviteConfig.value.rules.push({
    count,
    rewardDays,
    rewardAccountLimit,
    description: newInviteRule.value.description || '',
  })

  inviteConfig.value.rules.sort((a, b) => a.count - b.count)

  newInviteRule.value = { count: count + 1, rewardDays: 7, rewardAccountLimit: 0, description: '' }
}

function removeInviteRule(index: number) {
  inviteConfig.value.rules.splice(index, 1)
}

function formatInviteReward(rule: InviteRule): string {
  const parts: string[] = []
  if (rule.rewardDays > 0)
    parts.push(`+${rule.rewardDays} 天`)
  if (rule.rewardAccountLimit && rule.rewardAccountLimit > 0)
    parts.push(`+${rule.rewardAccountLimit} 额度`)
  return parts.join('、') || '无'
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
  return formatDateTimeCN(timestamp)
}

function formatDateTimeCN(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
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
  role: string
  expiresAt: string
  isPermanent: boolean
}

interface RoleOption {
  value: string
  label: string
}

const roleLabels: Record<string, string> = {
  admin: '超级管理员',
  operator: '运营人员',
  viewer: '只读管理员',
  user: '普通用户',
}

const roleBadgeColors: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  operator: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  viewer: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  user: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
}

function getRoleLabel(role: string): string {
  return roleLabels[role] || role
}

function getRoleBadgeColor(role: string): string {
  return (roleBadgeColors[role] || roleBadgeColors.user) as string
}

const users = ref<UserInfo[]>([])
const usersLoading = ref(false)
const showEditModal = ref(false)
const selectedUser = ref<UserInfo | null>(null)
const editForm = ref<EditForm>({
  newUsername: '',
  password: '',
  accountLimit: 2,
  role: 'user',
  expiresAt: '',
  isPermanent: false,
})
const availableRoles = ref<RoleOption[]>([])
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

async function fetchRoles() {
  try {
    const res = await api.get('/api/admin/roles')
    if (res.data.ok) {
      availableRoles.value = res.data.data
    }
  }
  catch {
    availableRoles.value = []
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
    role: user.role || 'user',
    expiresAt: user.card?.expiresAt ? formatDateTimeLocal(user.card.expiresAt) : '',
    isPermanent: user.card?.days === -1,
  }
  fetchRoles()
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
      role: editForm.value.role,
      expiresAt: expiresAtValue,
      isPermanent: editForm.value.isPermanent,
    }

    if (editForm.value.newUsername && editForm.value.newUsername !== selectedUser.value.username) {
      updateData.newUsername = editForm.value.newUsername
    }

    if (editForm.value.password) {
      updateData.password = editForm.value.password
    }

    if (editForm.value.role === selectedUser.value.role) {
      delete updateData.role
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
  nick?: string
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

// ========== 在线会话管理 ==========
interface SessionInfo {
  token: string
  username: string
  role: string
  ip?: string
  userAgent?: string
  createdAt: number
  lastActivityAt: number
  online: boolean
}

const sessions = ref<SessionInfo[]>([])
const sessionsLoading = ref(false)
const sessionsTimer = ref<number | null>(null)
const sessionSearch = ref('')
const sessionToRevoke = ref<SessionInfo | null>(null)
const showRevokeSessionConfirm = ref(false)
const revokeSessionLoading = ref(false)
const userSessionsToRevoke = ref('')
const showRevokeUserSessionsConfirm = ref(false)
const revokeUserSessionsLoading = ref(false)

const filteredSessions = computed(() => {
  let result = sessions.value
  const query = sessionSearch.value.trim().toLowerCase()
  if (query) {
    result = result.filter(s =>
      s.username.toLowerCase().includes(query)
      || (s.ip || '').toLowerCase().includes(query)
      || (s.userAgent || '').toLowerCase().includes(query)
      || s.token.toLowerCase().includes(query),
    )
  }
  return result
})

const currentToken = computed(() => userStore.token)

async function fetchSessions() {
  sessionsLoading.value = true
  try {
    const result = await userStore.getSessions()
    if (result.ok) {
      sessions.value = result.data || []
    }
    else {
      toast.error(result.error || '获取会话列表失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || '获取会话列表失败')
  }
  finally {
    sessionsLoading.value = false
  }
}

async function revokeSession(session: SessionInfo) {
  if (session.token === currentToken.value) {
    toast.error('不能强制下线当前会话')
    return
  }
  revokeSessionLoading.value = true
  try {
    const result = await userStore.revokeSession(session.token)
    if (result.ok) {
      toast.success('会话已强制下线')
      showRevokeSessionConfirm.value = false
      sessionToRevoke.value = null
      await fetchSessions()
    }
    else {
      toast.error(result.error || '操作失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || '操作失败')
  }
  finally {
    revokeSessionLoading.value = false
  }
}

function confirmRevokeSession(session: SessionInfo) {
  sessionToRevoke.value = session
  showRevokeSessionConfirm.value = true
}

async function revokeAllUserSessions() {
  const username = userSessionsToRevoke.value.trim()
  if (!username) {
    toast.error('请输入用户名')
    return
  }
  if (username === userStore.username) {
    toast.error('不能强制下线自己的全部会话')
    return
  }
  revokeUserSessionsLoading.value = true
  try {
    const result = await userStore.revokeUserSessions(username)
    if (result.ok) {
      toast.success(`已强制下线 ${username} 的全部会话`)
      showRevokeUserSessionsConfirm.value = false
      userSessionsToRevoke.value = ''
      await fetchSessions()
    }
    else {
      toast.error(result.error || '操作失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || '操作失败')
  }
  finally {
    revokeUserSessionsLoading.value = false
  }
}

function startSessionsTimer() {
  stopSessionsTimer()
  sessionsTimer.value = window.setInterval(fetchSessions, 10000)
}

function stopSessionsTimer() {
  if (sessionsTimer.value) {
    clearInterval(sessionsTimer.value)
    sessionsTimer.value = null
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
  return formatDateTimeCN(timestamp)
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

// ========== 审计日志 ==========
interface AuditLog {
  id: string
  timestamp: number
  event: string
  username: string
  ip: string
  details?: Record<string, any>
}

const activeLogTab = ref<'login' | 'audit'>('login')
const auditLogs = ref<AuditLog[]>([])
const auditLogsLoading = ref(false)
const auditLogsTotal = ref(0)
const auditLogsPage = ref(1)
const auditLogsPageSize = ref(10)
const auditEventFilter = ref('')
const auditUsernameFilter = ref('')
const auditIpFilter = ref('')
const showClearAuditLogsConfirm = ref(false)
const clearAuditLogsLoading = ref(false)
const expandedAuditLogIds = ref<Set<string>>(new Set())

function isAuditLogExpanded(id: string): boolean {
  return expandedAuditLogIds.value.has(id)
}

function toggleAuditLogExpanded(id: string) {
  const set = new Set(expandedAuditLogIds.value)
  if (set.has(id))
    set.delete(id)
  else
    set.add(id)
  expandedAuditLogIds.value = set
}

const auditEventOptions = computed(() => {
  const events = new Set(auditLogs.value.map(log => log.event))
  return Array.from(events).sort()
})

async function fetchAuditLogs() {
  auditLogsLoading.value = true
  try {
    const offset = (auditLogsPage.value - 1) * auditLogsPageSize.value
    const res = await api.get('/api/admin/audit-logs', {
      params: {
        limit: auditLogsPageSize.value,
        offset,
      },
    })
    if (res.data?.ok) {
      auditLogs.value = res.data.data.logs || []
      auditLogsTotal.value = res.data.data.total || 0
    }
    else {
      toast.error(res.data?.error || '获取审计日志失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '获取审计日志失败')
  }
  finally {
    auditLogsLoading.value = false
  }
}

function resetAuditFilters() {
  auditEventFilter.value = ''
  auditUsernameFilter.value = ''
  auditIpFilter.value = ''
  auditLogsPage.value = 1
}

const filteredAuditLogs = computed(() => {
  return auditLogs.value.filter((log) => {
    if (auditEventFilter.value && log.event !== auditEventFilter.value)
      return false
    if (auditUsernameFilter.value && !log.username.toLowerCase().includes(auditUsernameFilter.value.toLowerCase()))
      return false
    if (auditIpFilter.value && !log.ip.includes(auditIpFilter.value))
      return false
    return true
  })
})

const auditTotalPages = computed(() => Math.ceil(auditLogsTotal.value / auditLogsPageSize.value) || 1)

watch([auditEventFilter, auditUsernameFilter, auditIpFilter], () => {
  auditLogsPage.value = 1
  expandedAuditLogIds.value.clear()
})

watch(auditLogsPage, () => {
  expandedAuditLogIds.value.clear()
})

function openClearAuditLogsConfirm() {
  if (auditLogsTotal.value === 0) {
    toast.warning('暂无审计日志可清空')
    return
  }
  showClearAuditLogsConfirm.value = true
}

async function confirmClearAuditLogs() {
  clearAuditLogsLoading.value = true
  try {
    const res = await api.delete('/api/admin/audit-logs')
    if (res.data?.ok) {
      toast.success('审计日志已清空')
      auditLogs.value = []
      auditLogsTotal.value = 0
      showClearAuditLogsConfirm.value = false
    }
    else {
      toast.error(res.data?.error || '清空失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '清空失败')
  }
  finally {
    clearAuditLogsLoading.value = false
  }
}

function isAuditEventSuccess(event: string): boolean {
  return [
    'login_success',
    'account_added',
    'account_started',
    'card_created',
    'cards_created_batch',
    'backup_imported',
    'ip_unblocked',
    'user_renewed',
    'user_renewed_public',
    'user_renewed_by_admin',
    'announcement_updated',
  ].includes(event)
}

function isAuditEventDanger(event: string): boolean {
  return [
    'login_failed',
    'account_deleted',
    'account_stopped',
    'card_deleted',
    'cards_deleted_batch',
    'ip_blacklisted',
    'ip_blacklist_cleared',
    'audit_logs_cleared',
    'user_deleted',
    'system_config_reset',
    'cleanup_run',
    'password_reset',
    'session_revoked',
    'user_sessions_revoked',
  ].includes(event)
}

function getAuditEventLabel(event: string): string {
  const labels: Record<string, string> = {
    login_success: '登录成功',
    login_failed: '登录失败',
    password_changed: '修改密码',
    password_reset: '重置密码',
    account_added: '添加账号',
    account_updated: '更新账号',
    account_deleted: '删除账号',
    account_started: '启动账号',
    account_stopped: '停止账号',
    account_remark_updated: '更新账号备注',
    account_settings_saved: '保存账号设置',
    user_updated: '更新用户',
    user_edited: '编辑用户',
    user_deleted: '删除用户',
    user_renewed: '用户续费',
    user_renewed_public: '用户自助续费',
    user_renewed_by_admin: '管理员续费用户',
    system_config_updated: '更新系统配置',
    system_config_reset: '重置系统配置',
    announcement_updated: '更新公告',
    card_created: '创建卡密',
    cards_created_batch: '批量创建卡密',
    card_updated: '更新卡密',
    card_deleted: '删除卡密',
    cards_deleted_batch: '批量删除卡密',
    card_claim_status_changed: '卡密领取开关',
    backup_imported: '导入备份',
    ip_blacklisted: '封禁IP',
    ip_unblocked: '解封IP',
    ip_blacklist_cleared: '清空IP黑名单',
    audit_logs_cleared: '清空审计日志',
    cleanup_run: '执行系统清理',
    theme_changed: '切换主题',
    session_revoked: '强制下线会话',
    user_sessions_revoked: '强制下线用户全部会话',
  }
  return labels[event] || event
}

function formatAuditDetails(details?: Record<string, any>): string {
  if (!details || typeof details !== 'object')
    return '-'
  const entries = Object.entries(details)
  if (entries.length === 0)
    return '-'

  const keyLabels: Record<string, string> = {
    accountId: '账号ID',
    accountName: '账号名称',
    code: '卡密',
    codes: '卡密列表',
    content: '内容',
    count: '数量',
    days: '天数',
    description: '描述',
    durationMinutes: '时长(分钟)',
    enabled: '状态',
    errorType: '错误类型',
    files: '文件',
    ip: 'IP地址',
    logRetentionDays: '日志保留天数',
    newUsername: '新用户名',
    platform: '平台',
    reason: '原因',
    remark: '备注',
    serverUrl: '服务器地址',
    showOnce: '只显示一次',
    targetUser: '目标用户',
    theme: '主题',
    type: '类型',
    updates: '更新内容',
    userAgent: '浏览器',
  }

  return entries.map(([key, value]) => {
    const label = keyLabels[key] || key
    let displayValue = value
    if (Array.isArray(value))
      displayValue = value.join(', ')
    else if (typeof value === 'boolean')
      displayValue = value ? '是' : '否'
    else if (value === null || value === undefined || value === '')
      displayValue = '-'
    return `${label}: ${displayValue}`
  }).join('；')
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

// ========== 数据备份与恢复 ==========
interface BackupData {
  createdAt: number
  version: string
  files: Record<string, string>
}

const backupLoading = ref(false)
const importLoading = ref(false)
const backupData = ref<BackupData | null>(null)
const showImportConfirm = ref(false)
const importFileContent = ref('')
const importFileInput = ref<HTMLInputElement | null>(null)

async function fetchBackup() {
  backupLoading.value = true
  try {
    const res = await api.get('/api/admin/backup/export')
    if (res.data?.ok) {
      backupData.value = res.data.data
    }
    else {
      toast.error(res.data?.error || '获取备份数据失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '获取备份数据失败')
  }
  finally {
    backupLoading.value = false
  }
}

function downloadBackup() {
  if (!backupData.value)
    return
  const blob = new Blob([JSON.stringify(backupData.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `backup_${formatDateForFile(Date.now())}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  toast.success('备份文件已下载')
}

function handleImportFile(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file)
    return
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const content = String(e.target?.result || '')
      const parsed = JSON.parse(content)
      if (!parsed.files || typeof parsed.files !== 'object') {
        toast.error('无效的备份文件格式')
        return
      }
      importFileContent.value = content
      showImportConfirm.value = true
    }
    catch {
      toast.error('备份文件解析失败，请检查 JSON 格式')
    }
  }
  reader.readAsText(file)
  target.value = ''
}

async function confirmImport() {
  importLoading.value = true
  try {
    const parsed = JSON.parse(importFileContent.value)
    const res = await api.post('/api/admin/backup/import', { files: parsed.files })
    if (res.data?.ok) {
      toast.success(res.data?.message || '数据已导入')
      showImportConfirm.value = false
      importFileContent.value = ''
    }
    else {
      toast.error(res.data?.error || '导入失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '导入失败')
  }
  finally {
    importLoading.value = false
  }
}

// ========== IP 黑名单 ==========
interface IpBlacklistEntry {
  ip: string
  reason: string
  createdAt: number
  expiresAt: number | null
  autoBlocked: boolean
}

const ipBlacklist = ref<IpBlacklistEntry[]>([])
const ipBlacklistLoading = ref(false)
const newBlacklistIp = ref('')
const newBlacklistReason = ref('')
const newBlacklistDuration = ref(60)
const newBlacklistPermanent = ref(false)
const addBlacklistLoading = ref(false)
const showClearBlacklistConfirm = ref(false)
const clearBlacklistLoading = ref(false)

async function fetchIpBlacklist() {
  ipBlacklistLoading.value = true
  try {
    const res = await api.get('/api/admin/ip-blacklist')
    if (res.data?.ok) {
      ipBlacklist.value = res.data.data || []
    }
    else {
      toast.error(res.data?.error || '获取 IP 黑名单失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '获取 IP 黑名单失败')
  }
  finally {
    ipBlacklistLoading.value = false
  }
}

async function addIpBlacklist() {
  if (!newBlacklistIp.value.trim()) {
    toast.warning('请输入 IP 地址')
    return
  }
  addBlacklistLoading.value = true
  try {
    const res = await api.post('/api/admin/ip-blacklist', {
      ip: newBlacklistIp.value.trim(),
      reason: newBlacklistReason.value.trim() || undefined,
      durationMinutes: newBlacklistPermanent.value ? undefined : newBlacklistDuration.value,
    })
    if (res.data?.ok) {
      toast.success('IP 已封禁')
      newBlacklistIp.value = ''
      newBlacklistReason.value = ''
      await fetchIpBlacklist()
    }
    else {
      toast.error(res.data?.error || '封禁失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '封禁失败')
  }
  finally {
    addBlacklistLoading.value = false
  }
}

async function removeIpBlacklist(ip: string) {
  if (!confirm(`确定要解封 IP ${ip} 吗？`))
    return
  try {
    const res = await api.delete('/api/admin/ip-blacklist', { data: { ip } })
    if (res.data?.ok) {
      toast.success(res.data?.message || '已解封')
      await fetchIpBlacklist()
    }
    else {
      toast.error(res.data?.error || '解封失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '解封失败')
  }
}

function openClearBlacklistConfirm() {
  if (ipBlacklist.value.length === 0) {
    toast.warning('暂无黑名单可清空')
    return
  }
  showClearBlacklistConfirm.value = true
}

async function confirmClearBlacklist() {
  clearBlacklistLoading.value = true
  try {
    const res = await api.delete('/api/admin/ip-blacklist/all')
    if (res.data?.ok) {
      toast.success('IP 黑名单已清空')
      ipBlacklist.value = []
      showClearBlacklistConfirm.value = false
    }
    else {
      toast.error(res.data?.error || '清空失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '清空失败')
  }
  finally {
    clearBlacklistLoading.value = false
  }
}

function formatRemainingTime(expiresAt: number | null): string {
  if (!expiresAt)
    return '永久'
  const remaining = expiresAt - Date.now()
  if (remaining <= 0)
    return '已过期'
  const hours = Math.floor(remaining / 3600000)
  const minutes = Math.floor((remaining % 3600000) / 60000)
  if (hours > 0)
    return `${hours}小时${minutes}分钟`
  return `${minutes}分钟`
}

// ========== 清理工具 ==========
interface InvalidAccountResult {
  deletedCount: number
  deletedIds: string[]
}

interface OldLogsResult {
  loginLogs: number
  auditLogs: number
  ipBlacklist: number
}

interface CleanupResult {
  expiredTokens: number
  invalidAccounts: InvalidAccountResult
  oldLogs: OldLogsResult
}

const cleanupLoading = ref(false)
const cleanupResult = ref<CleanupResult | null>(null)
const logRetentionDays = ref(30)
const showCleanupConfirm = ref(false)

async function runCleanup() {
  cleanupLoading.value = true
  cleanupResult.value = null
  try {
    const res = await api.post('/api/admin/cleanup', { logRetentionDays: logRetentionDays.value })
    if (res.data?.ok) {
      cleanupResult.value = res.data.data
      toast.success('清理完成')
      // 刷新相关数据
      await fetchLoginLogs()
      await fetchAuditLogs()
      await fetchIpBlacklist()
    }
    else {
      toast.error(res.data?.error || '清理失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '清理失败')
  }
  finally {
    cleanupLoading.value = false
    showCleanupConfirm.value = false
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
  fetchAuditLogs()
  loadSystemConfig()
  loadDevicePresets()
  fetchCardClaimStatus()
  fetchBackup()
  fetchIpBlacklist()
  fetchInviteConfig()
  fetchInviteRecords()
})

onUnmounted(() => {
  stopDashboardTimer()
  stopSessionsTimer()
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
  if (tab === 'log') {
    fetchLoginLogs()
    fetchAuditLogs()
  }
  if (tab === 'system') {
    fetchBackup()
    fetchIpBlacklist()
  }
  if (tab === 'session') {
    fetchSessions()
    startSessionsTimer()
  }
  else {
    stopSessionsTimer()
  }
  if (tab === 'invite') {
    fetchInviteConfig()
    fetchInviteRecords()
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
        <nav class="scrollbar-hide flex gap-2 overflow-x-auto p-2">
          <button
            v-for="tab in visibleTabs"
            :key="tab.key"
            class="admin-tab flex flex-shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-300"
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
              class="farm-card border border-gray-200 rounded-2xl p-4 shadow-md dark:border-gray-700"
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
              class="farm-card border border-gray-200 rounded-2xl p-4 shadow-md dark:border-gray-700"
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
              class="farm-card border border-gray-200 rounded-2xl p-4 shadow-md dark:border-gray-700"
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
              class="farm-card border border-gray-200 rounded-2xl p-4 shadow-md dark:border-gray-700"
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
            class="farm-card border border-gray-200 rounded-2xl p-4 shadow-md dark:border-gray-700"
            :style="{ borderColor: 'color-mix(in srgb, var(--theme-primary) 20%, transparent)', background: 'color-mix(in srgb, var(--theme-bg) 95%, transparent)' }"
          >
            <h4 class="mb-3 text-base font-semibold" style="color: var(--theme-primary)">
              服务状态
            </h4>
            <div class="grid grid-cols-1 gap-3 text-sm lg:grid-cols-4 sm:grid-cols-2">
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
              <BaseButton
                v-if="userStore.hasPermission('card:*')"
                variant="primary"
                size="sm"
                @click="showCreateModal = true"
              >
                创建卡密
              </BaseButton>
            </div>
          </div>

          <!-- 卡密领取功能开关 -->
          <div v-if="userStore.hasPermission('card:*')" class="admin-info-card farm-card-enhanced p-5">
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
            <BaseButton
              v-if="userStore.hasPermission('card:*')"
              variant="danger"
              size="sm"
              @click="deleteSelectedCards"
            >
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
                      {{ formatDate(card.createdAt || null) }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-3 text-sm" style="color: color-mix(in srgb, var(--theme-text) 60%, transparent)">
                      {{ formatDate(card.usedAt || null) }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-3 text-right text-sm">
                      <div class="flex items-center justify-end gap-1.5">
                        <button class="admin-table-btn admin-table-btn-primary" @click="copyCode(card.code)">
                          复制
                        </button>
                        <button
                          v-if="userStore.hasPermission('card:*')"
                          class="admin-table-btn admin-table-btn-warning"
                          @click="toggleCardStatus(card)"
                        >
                          {{ card.enabled ? '禁用' : '启用' }}
                        </button>
                        <button
                          v-if="userStore.hasPermission('card:*')"
                          class="admin-table-btn admin-table-btn-danger"
                          @click="deleteCard(card)"
                        >
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
                        :class="getRoleBadgeColor(user.role)"
                      >
                        {{ getRoleLabel(user.role) }}
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
                        v-if="userStore.hasPermission('user:write') && !(user.username === 'admin' && currentUsername !== 'admin')"
                        class="mr-3 text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                        @click="openEditModal(user)"
                      >
                        编辑
                      </button>
                      <button
                        v-if="userStore.hasPermission('user:write') && !(user.username === 'admin' && currentUsername !== 'admin') && user.card"
                        class="mr-3 text-yellow-600 dark:text-yellow-400 hover:text-yellow-900 dark:hover:text-yellow-300"
                        @click="toggleUserStatus(user)"
                      >
                        {{ user.card.enabled === false ? '解封' : '封禁' }}
                      </button>
                      <button
                        v-if="userStore.hasPermission('user:write') && !(user.username === 'admin' && currentUsername !== 'admin') && user.username !== currentUsername"
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
                    角色
                  </label>
                  <select
                    v-model="editForm.role"
                    class="w-full border farm-input border-gray-200 rounded-xl bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    :disabled="selectedUser?.username === currentUsername"
                  >
                    <option v-for="r in availableRoles" :key="r.value" :value="r.value">
                      {{ r.label }}
                    </option>
                  </select>
                  <p v-if="selectedUser?.username === currentUsername" class="mt-1 text-xs text-amber-500">
                    不能修改自己的角色
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
                      <div class="text-[10px] text-gray-500 dark:text-gray-400">
                        {{ acc.nick || acc.uin || acc.qq || '-' }}
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
                        v-if="userStore.hasPermission('account:control') && !acc.running"
                        class="mr-3 text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300"
                        @click="startAdminAccount(acc)"
                      >
                        启动
                      </button>
                      <button
                        v-else-if="userStore.hasPermission('account:control')"
                        class="mr-3 text-yellow-600 dark:text-yellow-400 hover:text-yellow-900 dark:hover:text-yellow-300"
                        @click="stopAdminAccount(acc)"
                      >
                        停止
                      </button>
                      <button
                        v-if="userStore.hasPermission('account:control')"
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

        <!-- 在线会话管理 -->
        <div v-else-if="activeTab === 'session'" class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              在线会话管理
            </h3>
            <div class="flex items-center gap-2">
              <BaseButton variant="secondary" size="sm" :loading="sessionsLoading" @click="fetchSessions">
                刷新
              </BaseButton>
              <BaseButton
                v-if="userStore.hasPermission('session:delete')"
                variant="danger"
                size="sm"
                @click="showRevokeUserSessionsConfirm = true"
              >
                批量踢人
              </BaseButton>
            </div>
          </div>

          <div class="farm-card items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-md dark:bg-gray-800">
            <input
              v-model="sessionSearch"
              placeholder="搜索用户名、IP、浏览器或 Token..."
              class="h-8 w-full border farm-input border-gray-300 rounded-xl bg-white px-3 text-sm text-gray-900 outline-none transition-all dark:border-gray-600 focus:border-green-500 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-green-500/20"
            >
          </div>

          <div v-if="sessionsLoading" class="py-8 text-center text-gray-500">
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
                      状态
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      IP 地址
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      浏览器
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      登录时间
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      最后活跃
                    </th>
                    <th class="px-3 py-2 text-right text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                  <tr v-for="session in filteredSessions" :key="session.token">
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 font-medium dark:text-white">
                      {{ session.username }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      <span
                        class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                        :class="getRoleBadgeColor(session.role)"
                      >
                        {{ getRoleLabel(session.role) }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2">
                      <span
                        class="inline-flex items-center gap-1 rounded-full px-2 text-xs font-semibold leading-5"
                        :class="session.online ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'"
                      >
                        <span class="h-1.5 w-1.5 rounded-full" :class="session.online ? 'bg-green-500' : 'bg-gray-400'" />
                        {{ session.online ? '在线' : '离线' }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      {{ session.ip || '-' }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {{ parseBrowser(session.userAgent || '') }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {{ formatDateTimeCN(session.createdAt) }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {{ formatDateTimeCN(session.lastActivityAt) }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-right text-sm font-medium">
                      <button
                        v-if="session.token === currentToken"
                        class="cursor-not-allowed text-gray-400"
                        disabled
                      >
                        当前会话
                      </button>
                      <span
                        v-else-if="session.username === 'admin' && currentUsername !== 'admin'"
                        class="text-xs text-gray-400"
                      >
                        最高管理员
                      </span>
                      <button
                        v-else-if="userStore.hasPermission('session:delete')"
                        class="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                        @click="confirmRevokeSession(session)"
                      >
                        强制下线
                      </button>
                    </td>
                  </tr>
                  <tr v-if="filteredSessions.length === 0">
                    <td colspan="8" class="px-3 py-4 text-center text-gray-500 dark:text-gray-400">
                      暂无会话
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 强制下线单个会话确认弹窗 -->
          <div
            v-if="showRevokeSessionConfirm"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            @click.self="showRevokeSessionConfirm = false"
          >
            <div class="max-w-md w-full rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800" @click.stop>
              <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                确认强制下线
              </h2>
              <p class="mb-4 text-gray-600 dark:text-gray-300">
                确定要强制下线用户 <span class="font-bold">{{ sessionToRevoke?.username }}</span> 的会话吗？
              </p>
              <div class="flex justify-end space-x-3">
                <BaseButton variant="secondary" size="sm" @click="showRevokeSessionConfirm = false">
                  取消
                </BaseButton>
                <BaseButton
                  variant="danger"
                  size="sm"
                  :loading="revokeSessionLoading"
                  @click="sessionToRevoke && revokeSession(sessionToRevoke)"
                >
                  强制下线
                </BaseButton>
              </div>
            </div>
          </div>

          <!-- 批量踢人确认弹窗 -->
          <div
            v-if="showRevokeUserSessionsConfirm"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            @click.self="showRevokeUserSessionsConfirm = false"
          >
            <div class="max-w-md w-full rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800" @click.stop>
              <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                强制下线用户全部会话
              </h2>
              <p class="mb-4 text-gray-600 dark:text-gray-300">
                输入用户名，将该用户的所有会话强制下线。
              </p>
              <div class="mb-4">
                <input
                  v-model="userSessionsToRevoke"
                  placeholder="输入用户名"
                  class="w-full border farm-input border-gray-200 rounded-xl bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
              </div>
              <div class="flex justify-end space-x-3">
                <BaseButton variant="secondary" size="sm" @click="showRevokeUserSessionsConfirm = false">
                  取消
                </BaseButton>
                <BaseButton
                  variant="danger"
                  size="sm"
                  :loading="revokeUserSessionsLoading"
                  @click="revokeAllUserSessions"
                >
                  确认下线
                </BaseButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 日志中心 -->
        <div v-else-if="activeTab === 'log'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              日志中心
            </h3>
            <BaseButton
              variant="primary"
              size="sm"
              :loading="loginLogsLoading || auditLogsLoading"
              @click="fetchLoginLogs(); fetchAuditLogs()"
            >
              刷新
            </BaseButton>
          </div>

          <!-- 日志子标签 -->
          <div class="flex gap-2">
            <button
              class="cartoon-btn rounded-xl px-3 py-1.5 text-sm font-medium transition-colors"
              :class="activeLogTab === 'login'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
              :style="activeLogTab === 'login' ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="activeLogTab = 'login'"
            >
              登录日志
            </button>
            <button
              class="cartoon-btn rounded-xl px-3 py-1.5 text-sm font-medium transition-colors"
              :class="activeLogTab === 'audit'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
              :style="activeLogTab === 'audit' ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="activeLogTab = 'audit'"
            >
              审计日志
            </button>
          </div>

          <!-- 登录日志 -->
          <div v-if="activeLogTab === 'login'" class="space-y-4">
            <div class="flex items-center justify-end">
              <BaseButton
                v-if="userStore.hasPermission('system:*')"
                variant="danger"
                size="sm"
                @click="openClearLogsConfirm"
              >
                清空日志
              </BaseButton>
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

            <!-- 清空登录日志确认弹窗 -->
            <div
              v-if="showClearLogsConfirm"
              class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
              @click.self="showClearLogsConfirm = false"
            >
              <div class="max-w-md w-full rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800" @click.stop>
                <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                  确认清空登录日志
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

          <!-- 审计日志 -->
          <div v-else-if="activeLogTab === 'audit'" class="space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex flex-wrap items-center gap-2">
                <select
                  v-model="auditEventFilter"
                  class="border farm-input border-gray-300 rounded-xl bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">
                    全部事件
                  </option>
                  <option v-for="evt in auditEventOptions" :key="evt" :value="evt">
                    {{ getAuditEventLabel(evt) }}
                  </option>
                </select>
                <input
                  v-model="auditUsernameFilter"
                  placeholder="搜索用户"
                  class="h-8 w-32 border farm-input border-gray-300 rounded-xl bg-white px-3 text-sm text-gray-900 outline-none transition-all dark:border-gray-600 focus:border-green-500 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-green-500/20"
                >
                <input
                  v-model="auditIpFilter"
                  placeholder="搜索IP"
                  class="h-8 w-36 border farm-input border-gray-300 rounded-xl bg-white px-3 text-sm text-gray-900 outline-none transition-all dark:border-gray-600 focus:border-green-500 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-green-500/20"
                >
                <button
                  v-if="auditEventFilter || auditUsernameFilter || auditIpFilter"
                  class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  @click="resetAuditFilters"
                >
                  重置
                </button>
              </div>
              <BaseButton
                v-if="userStore.hasPermission('system:*')"
                variant="danger"
                size="sm"
                @click="openClearAuditLogsConfirm"
              >
                清空审计日志
              </BaseButton>
            </div>

            <div class="admin-log-area farm-card-enhanced overflow-hidden">
              <div class="overflow-x-auto">
                <table class="admin-table min-w-[640px] w-full text-left text-sm">
                  <thead class="admin-table-head">
                    <tr>
                      <th class="w-44 whitespace-nowrap px-3 py-2.5 font-bold">
                        🕐 时间
                      </th>
                      <th class="w-28 whitespace-nowrap px-3 py-2.5 font-bold">
                        📋 事件
                      </th>
                      <th class="w-24 whitespace-nowrap px-3 py-2.5 font-bold">
                        👤 用户
                      </th>
                      <th class="w-40 whitespace-nowrap px-3 py-2.5 font-bold">
                        🌐 IP地址
                      </th>
                      <th class="w-24 whitespace-nowrap px-3 py-2.5 text-right font-bold">
                        📝 详情
                      </th>
                    </tr>
                  </thead>
                  <tbody class="admin-table-body">
                    <tr v-if="auditLogsLoading">
                      <td colspan="5" class="px-4 py-8 text-center" style="color: color-mix(in srgb, var(--theme-text) 40%, transparent)">
                        加载中...
                      </td>
                    </tr>
                    <tr v-else-if="filteredAuditLogs.length === 0">
                      <td colspan="5" class="px-4 py-8 text-center" style="color: color-mix(in srgb, var(--theme-text) 40%, transparent)">
                        暂无审计日志
                      </td>
                    </tr>
                    <template v-for="(log, index) in filteredAuditLogs" :key="log.id">
                      <tr class="admin-table-row" :class="index % 2 === 0 ? 'row-even' : 'row-odd'">
                        <td class="whitespace-nowrap px-3 py-2.5 text-xs font-mono" style="color: var(--theme-text)">
                          {{ formatLogTime(log.timestamp) }}
                        </td>
                        <td class="whitespace-nowrap px-3 py-2.5">
                          <span class="admin-status-wrap inline-flex items-center gap-1.5">
                            <span
                              class="admin-status-dot"
                              :class="isAuditEventDanger(log.event) ? 'status-offline' : (isAuditEventSuccess(log.event) ? 'status-online' : '')"
                              :style="!isAuditEventDanger(log.event) && !isAuditEventSuccess(log.event) ? { background: '#3b82f6', boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.2)' } : {}"
                            />
                            <span
                              class="admin-badge inline-flex rounded-full px-2 py-0.5 text-xs font-bold"
                              :class="isAuditEventDanger(log.event) ? 'badge-red' : (isAuditEventSuccess(log.event) ? 'badge-green' : 'badge-blue')"
                            >
                              {{ getAuditEventLabel(log.event) }}
                            </span>
                          </span>
                        </td>
                        <td class="whitespace-nowrap px-3 py-2.5 text-sm font-medium" style="color: var(--theme-text)">
                          {{ log.username }}
                        </td>
                        <td class="whitespace-nowrap px-3 py-2.5">
                          <code class="admin-code-bg rounded-lg px-2 py-0.5 text-xs font-mono">{{ log.ip }}</code>
                        </td>
                        <td class="whitespace-nowrap px-3 py-2.5 text-right">
                          <button
                            v-if="log.details && Object.keys(log.details).length > 0"
                            class="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                            @click="toggleAuditLogExpanded(log.id)"
                          >
                            {{ isAuditLogExpanded(log.id) ? '收起' : '查看' }}
                          </button>
                          <span v-else class="text-xs text-gray-400">-</span>
                        </td>
                      </tr>
                      <tr v-if="isAuditLogExpanded(log.id)" class="admin-table-row" :class="index % 2 === 0 ? 'row-even' : 'row-odd'">
                        <td colspan="5" class="px-3 pb-3 pt-0">
                          <div class="rounded-xl bg-white/70 p-3 text-xs leading-relaxed dark:bg-black/20" style="color: color-mix(in srgb, var(--theme-text) 70%, transparent)">
                            {{ formatAuditDetails(log.details) }}
                          </div>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
              <div v-if="auditLogsTotal > 0" class="admin-log-footer flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm" style="color: color-mix(in srgb, var(--theme-text) 50%, transparent)">
                <span class="inline-flex items-center gap-1.5">
                  <span>📊</span>
                  共 {{ auditLogsTotal }} 条记录，第 {{ auditLogsPage }} / {{ auditTotalPages }} 页
                </span>
                <div class="flex items-center gap-2">
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    :disabled="auditLogsPage <= 1"
                    @click="auditLogsPage--; fetchAuditLogs()"
                  >
                    上一页
                  </BaseButton>
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    :disabled="auditLogsPage >= auditTotalPages"
                    @click="auditLogsPage++; fetchAuditLogs()"
                  >
                    下一页
                  </BaseButton>
                </div>
              </div>
            </div>

            <!-- 清空审计日志确认弹窗 -->
            <div
              v-if="showClearAuditLogsConfirm"
              class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
              @click.self="showClearAuditLogsConfirm = false"
            >
              <div class="max-w-md w-full rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800" @click.stop>
                <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                  确认清空审计日志
                </h2>
                <p class="mb-4 text-gray-600 dark:text-gray-300">
                  确定要清空所有审计日志吗？此操作不可恢复。
                </p>
                <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
                  当前共有 {{ auditLogsTotal }} 条记录
                </p>
                <div class="flex justify-end space-x-3">
                  <BaseButton variant="secondary" size="sm" @click="showClearAuditLogsConfirm = false">
                    取消
                  </BaseButton>
                  <BaseButton
                    variant="danger"
                    size="sm"
                    :loading="clearAuditLogsLoading"
                    @click="confirmClearAuditLogs"
                  >
                    确认清空
                  </BaseButton>
                </div>
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

          <!-- 数据备份与恢复 -->
          <div class="farm-card-enhanced p-5">
            <h4 class="mb-4 flex items-center gap-2 text-lg font-bold font-display" style="color: var(--theme-text)">
              <div class="admin-section-icon">
                <div class="i-carbon-archive" />
              </div>
              <span>数据备份与恢复</span>
              <div class="admin-section-divider" />
            </h4>

            <div class="space-y-4">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p class="text-sm text-gray-700 font-medium dark:text-gray-300">
                    导出核心数据
                  </p>
                  <p class="mt-1 text-xs" style="color: color-mix(in srgb, var(--theme-text) 50%, transparent)">
                    下载包含用户、卡密、账号、配置等核心数据的备份文件
                  </p>
                </div>
                <BaseButton
                  variant="primary"
                  size="sm"
                  :loading="backupLoading"
                  :disabled="!backupData"
                  @click="downloadBackup"
                >
                  下载备份
                </BaseButton>
              </div>

              <div class="border-t border-gray-200 dark:border-gray-700" />

              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p class="text-sm text-gray-700 font-medium dark:text-gray-300">
                    导入备份数据
                  </p>
                  <p class="mt-1 text-xs" style="color: color-mix(in srgb, var(--theme-text) 50%, transparent)">
                    选择之前下载的备份文件进行恢复，导入后建议重启服务
                  </p>
                </div>
                <label class="cursor-pointer">
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    :loading="importLoading"
                    @click="importFileInput?.click()"
                  >
                    上传恢复
                  </BaseButton>
                  <input
                    ref="importFileInput"
                    type="file"
                    accept=".json,application/json"
                    class="hidden"
                    @change="handleImportFile"
                  >
                </label>
              </div>
            </div>

            <!-- 导入确认弹窗 -->
            <div
              v-if="showImportConfirm"
              class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
              @click.self="showImportConfirm = false"
            >
              <div class="max-w-md w-full rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800" @click.stop>
                <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                  确认恢复备份
                </h2>
                <p class="mb-4 text-gray-600 dark:text-gray-300">
                  导入备份将覆盖当前系统中的核心数据，此操作不可恢复。请确认备份文件来源可靠。
                </p>
                <div class="flex justify-end space-x-3">
                  <BaseButton variant="secondary" size="sm" @click="showImportConfirm = false">
                    取消
                  </BaseButton>
                  <BaseButton
                    variant="danger"
                    size="sm"
                    :loading="importLoading"
                    @click="confirmImport"
                  >
                    确认恢复
                  </BaseButton>
                </div>
              </div>
            </div>
          </div>

          <!-- IP 黑名单 -->
          <div class="farm-card-enhanced p-5">
            <h4 class="mb-4 flex items-center gap-2 text-lg font-bold font-display" style="color: var(--theme-text)">
              <div class="admin-section-icon">
                <div class="i-carbon-security" />
              </div>
              <span>IP 黑名单</span>
              <div class="admin-section-divider" />
            </h4>

            <div class="space-y-4">
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div class="sm:col-span-4">
                  <BaseInput
                    v-model="newBlacklistIp"
                    placeholder="输入要封禁的 IP 地址"
                  />
                </div>
                <div class="sm:col-span-4">
                  <BaseInput
                    v-model="newBlacklistReason"
                    placeholder="封禁原因（可选）"
                  />
                </div>
                <div class="flex items-center gap-3 sm:col-span-4">
                  <BaseInput
                    v-model.number="newBlacklistDuration"
                    type="number"
                    min="1"
                    placeholder="封禁时长（分钟）"
                    :disabled="newBlacklistPermanent"
                    class="flex-1"
                  />
                  <label class="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                    <input
                      v-model="newBlacklistPermanent"
                      type="checkbox"
                      class="border-gray-300 rounded text-blue-600 focus:ring-blue-500"
                    >
                    永久
                  </label>
                </div>
              </div>
              <div class="flex justify-end gap-2">
                <BaseButton
                  variant="danger"
                  size="sm"
                  :loading="addBlacklistLoading"
                  @click="addIpBlacklist"
                >
                  封禁 IP
                </BaseButton>
                <BaseButton
                  variant="secondary"
                  size="sm"
                  :disabled="ipBlacklist.length === 0"
                  @click="openClearBlacklistConfirm"
                >
                  清空全部
                </BaseButton>
              </div>

              <div class="admin-log-area farm-card-enhanced overflow-hidden">
                <div class="overflow-x-auto">
                  <table class="admin-table min-w-full text-left text-sm">
                    <thead class="admin-table-head">
                      <tr>
                        <th class="px-4 py-3 font-bold">
                          🌐 IP地址
                        </th>
                        <th class="px-4 py-3 font-bold">
                          📝 原因
                        </th>
                        <th class="px-4 py-3 font-bold">
                          ⏰ 剩余时间
                        </th>
                        <th class="px-4 py-3 font-bold">
                          类型
                        </th>
                        <th class="px-4 py-3 text-right font-bold">
                          操作
                        </th>
                      </tr>
                    </thead>
                    <tbody class="admin-table-body">
                      <tr v-if="ipBlacklistLoading">
                        <td colspan="5" class="px-4 py-8 text-center" style="color: color-mix(in srgb, var(--theme-text) 40%, transparent)">
                          加载中...
                        </td>
                      </tr>
                      <tr v-else-if="ipBlacklist.length === 0">
                        <td colspan="5" class="px-4 py-8 text-center" style="color: color-mix(in srgb, var(--theme-text) 40%, transparent)">
                          暂无封禁记录
                        </td>
                      </tr>
                      <tr v-for="(entry, index) in ipBlacklist" :key="entry.ip" class="admin-table-row" :class="index % 2 === 0 ? 'row-even' : 'row-odd'">
                        <td class="whitespace-nowrap px-4 py-3">
                          <code class="admin-code-bg rounded-lg px-2.5 py-1 text-xs font-mono">{{ entry.ip }}</code>
                        </td>
                        <td class="whitespace-nowrap px-4 py-3 text-sm" style="color: var(--theme-text)">
                          {{ entry.reason || '-' }}
                        </td>
                        <td class="whitespace-nowrap px-4 py-3 text-sm" style="color: color-mix(in srgb, var(--theme-text) 60%, transparent)">
                          {{ formatRemainingTime(entry.expiresAt) }}
                        </td>
                        <td class="whitespace-nowrap px-4 py-3">
                          <span
                            class="admin-badge inline-flex rounded-full px-2.5 py-1 text-xs font-bold"
                            :class="entry.autoBlocked ? 'badge-purple' : 'badge-blue'"
                          >
                            {{ entry.autoBlocked ? '自动封禁' : '手动封禁' }}
                          </span>
                        </td>
                        <td class="whitespace-nowrap px-4 py-3 text-right text-sm">
                          <button class="admin-table-btn admin-table-btn-primary" @click="removeIpBlacklist(entry.ip)">
                            解封
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <!-- 清空黑名单确认弹窗 -->
            <div
              v-if="showClearBlacklistConfirm"
              class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
              @click.self="showClearBlacklistConfirm = false"
            >
              <div class="max-w-md w-full rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800" @click.stop>
                <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                  确认清空 IP 黑名单
                </h2>
                <p class="mb-4 text-gray-600 dark:text-gray-300">
                  确定要清空所有 IP 黑名单记录吗？此操作不可恢复。
                </p>
                <div class="flex justify-end space-x-3">
                  <BaseButton variant="secondary" size="sm" @click="showClearBlacklistConfirm = false">
                    取消
                  </BaseButton>
                  <BaseButton
                    variant="danger"
                    size="sm"
                    :loading="clearBlacklistLoading"
                    @click="confirmClearBlacklist"
                  >
                    确认清空
                  </BaseButton>
                </div>
              </div>
            </div>
          </div>

          <!-- 清理工具 -->
          <div class="farm-card-enhanced p-5">
            <h4 class="mb-4 flex items-center gap-2 text-lg font-bold font-display" style="color: var(--theme-text)">
              <div class="admin-section-icon">
                <div class="i-carbon-clean" />
              </div>
              <span>清理工具</span>
              <div class="admin-section-divider" />
            </h4>

            <div class="space-y-4">
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div class="rounded-xl bg-gray-50 p-4 dark:bg-gray-800/50">
                  <p class="text-sm text-gray-700 font-medium dark:text-gray-300">
                    清理内容
                  </p>
                  <ul class="mt-2 text-xs space-y-1" style="color: color-mix(in srgb, var(--theme-text) 60%, transparent)">
                    <li class="flex items-center gap-1.5">
                      <span class="i-carbon-checkmark" />
                      过期 Token
                    </li>
                    <li class="flex items-center gap-1.5">
                      <span class="i-carbon-checkmark" />
                      无效账号（无关联用户或无登录标识）
                    </li>
                    <li class="flex items-center gap-1.5">
                      <span class="i-carbon-checkmark" />
                      超过保留天数的登录日志、审计日志
                    </li>
                    <li class="flex items-center gap-1.5">
                      <span class="i-carbon-checkmark" />
                      已过期的 IP 黑名单记录
                    </li>
                  </ul>
                </div>

                <div class="flex flex-col justify-center gap-3 rounded-xl bg-gray-50 p-4 dark:bg-gray-800/50">
                  <div>
                    <label class="mb-1.5 block text-sm text-gray-700 font-medium dark:text-gray-300">
                      日志保留天数
                    </label>
                    <BaseInput
                      v-model.number="logRetentionDays"
                      type="number"
                      min="1"
                      max="365"
                      placeholder="默认 30 天"
                    />
                  </div>
                  <BaseButton
                    variant="danger"
                    size="sm"
                    :loading="cleanupLoading"
                    @click="showCleanupConfirm = true"
                  >
                    执行清理
                  </BaseButton>
                </div>
              </div>

              <div v-if="cleanupResult" class="border border-green-200 rounded-xl bg-green-50 p-4 dark:border-green-900 dark:bg-green-900/20">
                <p class="mb-2 text-sm text-green-800 font-bold dark:text-green-300">
                  清理完成
                </p>
                <div class="grid grid-cols-2 gap-2 text-xs text-green-700 sm:grid-cols-4 dark:text-green-400">
                  <div class="rounded-lg bg-white/60 p-2 dark:bg-black/20">
                    <div class="text-lg font-bold">
                      {{ cleanupResult.expiredTokens }}
                    </div>
                    <div>过期 Token</div>
                  </div>
                  <div class="rounded-lg bg-white/60 p-2 dark:bg-black/20">
                    <div class="text-lg font-bold">
                      {{ cleanupResult.invalidAccounts.deletedCount }}
                    </div>
                    <div>无效账号</div>
                  </div>
                  <div class="rounded-lg bg-white/60 p-2 dark:bg-black/20">
                    <div class="text-lg font-bold">
                      {{ cleanupResult.oldLogs.loginLogs + cleanupResult.oldLogs.auditLogs }}
                    </div>
                    <div>旧日志</div>
                  </div>
                  <div class="rounded-lg bg-white/60 p-2 dark:bg-black/20">
                    <div class="text-lg font-bold">
                      {{ cleanupResult.oldLogs.ipBlacklist }}
                    </div>
                    <div>过期黑名单</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 执行清理确认弹窗 -->
            <div
              v-if="showCleanupConfirm"
              class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
              @click.self="showCleanupConfirm = false"
            >
              <div class="max-w-md w-full rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800" @click.stop>
                <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                  确认执行清理
                </h2>
                <p class="mb-4 text-gray-600 dark:text-gray-300">
                  将清理过期 Token、无效账号、超过 {{ logRetentionDays }} 天的日志以及过期 IP 黑名单。此操作不可恢复。
                </p>
                <div class="flex justify-end space-x-3">
                  <BaseButton variant="secondary" size="sm" @click="showCleanupConfirm = false">
                    取消
                  </BaseButton>
                  <BaseButton
                    variant="danger"
                    size="sm"
                    :loading="cleanupLoading"
                    @click="runCleanup"
                  >
                    确认清理
                  </BaseButton>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 邀请管理 -->
        <div v-else-if="activeTab === 'invite'" class="space-y-4">
          <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
            邀请管理
          </h3>

          <div class="farm-card-enhanced p-5">
            <h4 class="mb-4 flex items-center gap-2 text-lg font-bold font-display" style="color: var(--theme-text)">
              <div class="admin-section-icon">
                <div class="i-carbon-gift" />
              </div>
              <span>奖励配置</span>
              <div class="admin-section-divider" />
            </h4>

            <div class="mb-4 flex items-center gap-3">
              <BaseSwitch
                v-model="inviteConfig.enabled"
                label="启用邀请功能"
              />
            </div>

            <div class="space-y-3">
              <div
                v-for="(rule, index) in inviteConfig.rules"
                :key="rule.count"
                class="flex flex-col gap-2 rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <BaseInput
                    v-model.number="rule.count"
                    type="number"
                    label="邀请人数"
                    min="1"
                    class="w-28"
                  />
                  <BaseInput
                    v-model.number="rule.rewardDays"
                    type="number"
                    label="奖励天数"
                    min="0"
                    class="w-28"
                  />
                  <BaseInput
                    v-model.number="rule.rewardAccountLimit"
                    type="number"
                    label="奖励额度"
                    min="0"
                    class="w-28"
                  />
                  <BaseInput
                    v-model="rule.description"
                    label="说明（可选）"
                    type="text"
                    class="min-w-[160px] flex-1"
                  />
                  <button
                    class="mt-5 rounded-lg p-2 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="删除"
                    @click="removeInviteRule(index)"
                  >
                    <div class="i-carbon-trash-can" />
                  </button>
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  奖励：{{ formatInviteReward(rule) }}
                </div>
              </div>
            </div>

            <div class="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
              <p class="mb-2 text-sm text-gray-700 font-medium dark:text-gray-300">
                新增档位
              </p>
              <div class="flex flex-wrap items-end gap-2">
                <BaseInput
                  v-model.number="newInviteRule.count"
                  type="number"
                  label="邀请人数"
                  min="1"
                  class="w-24"
                />
                <BaseInput
                  v-model.number="newInviteRule.rewardDays"
                  type="number"
                  label="奖励天数"
                  min="0"
                  class="w-24"
                />
                <BaseInput
                  v-model.number="newInviteRule.rewardAccountLimit"
                  type="number"
                  label="奖励额度"
                  min="0"
                  class="w-24"
                />
                <BaseInput
                  v-model="newInviteRule.description"
                  label="说明（可选）"
                  type="text"
                  class="min-w-[140px] flex-1"
                />
                <BaseButton variant="secondary" size="sm" @click="addInviteRule">
                  添加
                </BaseButton>
              </div>
            </div>

            <div class="mt-4 flex justify-end">
              <BaseButton
                variant="primary"
                size="sm"
                :loading="inviteSaving"
                @click="saveInviteConfig"
              >
                保存配置
              </BaseButton>
            </div>
          </div>

          <div class="farm-card-enhanced p-5">
            <h4 class="mb-4 flex items-center gap-2 text-lg font-bold font-display" style="color: var(--theme-text)">
              <div class="admin-section-icon">
                <div class="i-carbon-user-multiple" />
              </div>
              <span>邀请记录</span>
              <div class="admin-section-divider" />
            </h4>

            <div v-if="inviteRecords.length === 0" class="py-6 text-center text-gray-500">
              暂无邀请记录
            </div>
            <div v-else class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-gray-200 dark:border-gray-700">
                    <th class="px-3 py-2 text-left text-gray-700 dark:text-gray-300">
                      邀请人
                    </th>
                    <th class="px-3 py-2 text-left text-gray-700 dark:text-gray-300">
                      被邀请人
                    </th>
                    <th class="px-3 py-2 text-left text-gray-700 dark:text-gray-300">
                      邀请时间
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="record in inviteRecords"
                    :key="`${record.inviter}-${record.invitee}-${record.invitedAt}`"
                    class="border-b border-gray-100 dark:border-gray-800"
                  >
                    <td class="px-3 py-2">
                      {{ record.inviter }}
                    </td>
                    <td class="px-3 py-2">
                      {{ record.invitee }}
                    </td>
                    <td class="px-3 py-2 text-gray-500 dark:text-gray-400">
                      {{ formatDate(record.invitedAt) }}
                    </td>
                  </tr>
                </tbody>
              </table>
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
  inset: -3px;
  border-radius: 50%;
  border: 1px solid #22c55e;
  animation: status-ring-pulse 2s ease-out infinite;
  opacity: 0.6;
}

@keyframes status-ring-pulse {
  0% {
    transform: scale(0.85);
    opacity: 0.6;
  }
  100% {
    transform: scale(1.5);
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
