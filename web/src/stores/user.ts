import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'
import api from '@/api'

export interface UserCard {
  code: string
  description: string
  days: number
  expiresAt: number | null
  enabled: boolean
}

export interface User {
  username: string
  role: string
  card: UserCard | null
  accountLimit: number
  avatar?: string
  mustChangePassword?: boolean
}

export interface LoginResult {
  ok: boolean
  error?: string
  errorType?: 'rate_limit' | 'locked' | 'invalid_credentials'
  remainingMs?: number
  data?: {
    token: string
    role: string
    card: UserCard | null
    accountLimit: number
    user: { username: string }
    mustChangePassword?: boolean
  }
}

export interface Card {
  code: string
  description: string
  days: number
  type: 'time' | 'quota'
  enabled: boolean
  usedBy: string | null
  usedAt: number | null
  createdAt: number
}

export const useUserStore = defineStore('user', () => {
  const token = useStorage('admin_token', '')
  const userInfo = useStorage<User | null>('user_info', null)
  const userPermissions = useStorage<string[]>('user_permissions', [])
  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => userInfo.value?.role === 'admin')
  const isAdminPanelUser = computed(() => ['admin', 'operator', 'viewer'].includes(userInfo.value?.role || ''))
  const username = computed(() => userInfo.value?.username || '')
  const role = computed(() => userInfo.value?.role || 'user')
  const userCard = computed(() => userInfo.value?.card)
  const accountLimit = computed(() => userInfo.value?.accountLimit ?? 2)
  const avatar = computed(() => userInfo.value?.avatar || '')

  // 检查用户是否过期
  const isExpired = computed(() => {
    if (!userInfo.value?.card?.expiresAt)
      return false
    return Date.now() > userInfo.value.card.expiresAt
  })

  // 获取过期时间显示
  const expireTimeText = computed(() => {
    if (!userInfo.value?.card)
      return '无卡密'
    if (userInfo.value.card.days === -1)
      return '永久有效'
    if (!userInfo.value.card.expiresAt)
      return '未激活'
    const date = new Date(userInfo.value.card.expiresAt)
    return date.toLocaleString('zh-CN')
  })

  async function login(username: string, password: string): Promise<LoginResult> {
    try {
      const res = await api.post('/api/login', { username, password })
      if (res.data.ok) {
        token.value = res.data.data.token
        userInfo.value = {
          username: res.data.data.user.username,
          role: res.data.data.role,
          card: res.data.data.card,
          accountLimit: res.data.data.accountLimit ?? 2,
          mustChangePassword: res.data.data.mustChangePassword,
        }
      }
      return res.data
    }
    catch (error: any) {
      const data = error.response?.data
      if (data) {
        return {
          ok: false,
          error: data.error,
          errorType: data.errorType,
          remainingMs: data.remainingMs,
        }
      }
      return { ok: false, error: error.message || '网络错误' }
    }
  }

  async function register(username: string, password: string, cardCode: string) {
    const res = await api.post('/api/register', { username, password, cardCode })
    return res.data
  }

  async function logout() {
    try {
      await api.post('/api/logout')
    }
    finally {
      token.value = ''
      userInfo.value = null
    }
  }

  async function fetchUserInfo() {
    try {
      const res = await api.get('/api/user/me')
      if (res.data.ok) {
        userInfo.value = res.data.data
      }
      return res.data
    }
    catch {
      return { ok: false }
    }
  }

  async function fetchPermissions() {
    try {
      const res = await api.get('/api/admin/me/permissions')
      if (res.data.ok) {
        userPermissions.value = res.data.data.permissions || []
      }
      return res.data
    }
    catch {
      userPermissions.value = []
      return { ok: false }
    }
  }

  function hasPermission(permission: string): boolean {
    const perms = userPermissions.value
    if (perms.includes('*')) return true
    if (perms.includes(permission)) return true
    const prefix = permission.split(':')[0]
    if (perms.includes(`${prefix}:*`)) return true
    return false
  }

  function hasAnyPermission(...permissions: string[]): boolean {
    return permissions.some(p => hasPermission(p))
  }

  async function renew(cardCode: string) {
    const res = await api.post('/api/user/renew', { cardCode })
    if (res.data.ok) {
      // 更新本地用户信息
      if (userInfo.value) {
        userInfo.value.card = res.data.data.card
        userInfo.value.accountLimit = res.data.data.accountLimit
      }
    }
    return res.data
  }

  async function changePassword(oldPassword: string, newPassword: string) {
    const res = await api.post('/api/user/change-password', { oldPassword, newPassword })
    return res.data
  }

  // 管理员功能
  async function getAllUsers() {
    const res = await api.get('/api/admin/users')
    return res.data
  }

  async function getLoginLogs(limit = 100, offset = 0) {
    const res = await api.get('/api/admin/login-logs', { params: { limit, offset } })
    return res.data
  }

  async function clearLoginLogs() {
    const res = await api.delete('/api/admin/login-logs')
    return res.data
  }

  async function updateUser(username: string, updates: Partial<UserCard>) {
    const res = await api.post(`/api/admin/users/${username}`, updates)
    return res.data
  }

  async function deleteUser(username: string) {
    const res = await api.delete(`/api/admin/users/${username}`)
    return res.data
  }

  async function renewUser(username: string, cardCode: string) {
    const res = await api.post(`/api/admin/users/${username}/renew`, { cardCode })
    return res.data
  }

  async function getAllCards() {
    const res = await api.get('/api/admin/cards')
    return res.data
  }

  async function createCard(description: string, days: number, count?: number, type?: 'time' | 'quota') {
    const res = await api.post('/api/admin/cards', { description, days, count, type })
    return res.data
  }

  async function updateCard(code: string, updates: Partial<Card>) {
    const res = await api.post(`/api/admin/cards/${code}`, updates)
    return res.data
  }

  async function deleteCard(code: string) {
    const res = await api.delete(`/api/admin/cards/${code}`)
    return res.data
  }

  async function deleteCardsBatch(codes: string[]) {
    const res = await api.post('/api/admin/cards/batch-delete', { codes })
    return res.data
  }

  async function getSessions() {
    const res = await api.get('/api/admin/sessions')
    return res.data
  }

  async function revokeSession(token: string) {
    const res = await api.delete(`/api/admin/sessions/${token}`)
    return res.data
  }

  async function revokeUserSessions(username: string) {
    const res = await api.post('/api/admin/sessions/revoke-user', { username })
    return res.data
  }

  return {
    token,
    userInfo,
    userPermissions,
    isLoggedIn,
    isAdmin,
    isAdminPanelUser,
    username,
    role,
    userCard,
    accountLimit,
    avatar,
    isExpired,
    expireTimeText,
    login,
    register,
    logout,
    fetchUserInfo,
    fetchPermissions,
    hasPermission,
    hasAnyPermission,
    renew,
    changePassword,
    getAllUsers,
    getLoginLogs,
    clearLoginLogs,
    updateUser,
    deleteUser,
    renewUser,
    getAllCards,
    createCard,
    updateCard,
    deleteCard,
    deleteCardsBatch,
    getSessions,
    revokeSession,
    revokeUserSessions,
  }
})
