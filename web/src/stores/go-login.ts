import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'

export interface GoConfig {
  enabled: boolean
  apiBase: string
  appId: string
  apiKey: string
  proxyApiUrl: string
}

const defaultConfig: GoConfig = {
  enabled: false,
  apiBase: '',
  appId: 'wx5306c5978fdb76e4',
  apiKey: '',
  proxyApiUrl: '',
}

export const useGoLoginStore = defineStore('go-login', () => {
  const rawConfig = ref<GoConfig>({ ...defaultConfig })
  const loading = ref(false)
  const qrCode = ref<string | null>(null)
  const uuid = ref('')
  const wxid = ref('')
  const status = ref<'idle' | 'qr_loading' | 'qr_ready' | 'scanning' | 'confirming' | 'success' | 'error'>('idle')
  const statusMessage = ref('')
  const errorMessage = ref('')

  const config = computed<GoConfig>(() => ({
    ...defaultConfig,
    ...rawConfig.value,
  }))

  async function loadConfig() {
    loading.value = true
    try {
      const res = await api.get('/api/user/go-config')
      if (res.data?.ok && res.data.config) {
        rawConfig.value = { ...defaultConfig, ...res.data.config }
      }
    }
    catch (e) {
      console.error('加载 Go 服务配置失败', e)
    }
    finally {
      loading.value = false
    }
  }

  async function saveConfig(payload: Partial<GoConfig>) {
    const res = await api.post('/api/user/go-config', payload)
    if (res.data?.ok && res.data.config) {
      rawConfig.value = { ...defaultConfig, ...res.data.config }
    }
    return res.data
  }

  function resetState() {
    qrCode.value = null
    uuid.value = ''
    wxid.value = ''
    status.value = 'idle'
    statusMessage.value = ''
    errorMessage.value = ''
  }

  // 获取二维码（走后端 /api/go/qrcode，后端再去调 Go 服务）
  async function getQRCode(): Promise<boolean> {
    loading.value = true
    status.value = 'qr_loading'
    statusMessage.value = '正在获取二维码...'
    errorMessage.value = ''
    try {
      const res = await api.post('/api/go/qrcode', {}, { skipErrorToast: true } as any)
      if (!res.data?.ok) {
        status.value = 'error'
        errorMessage.value = res.data?.error || '获取二维码失败'
        return false
      }
      uuid.value = res.data.data?.uuid || ''
      qrCode.value = res.data.data?.qrBase64 || ''
      status.value = 'qr_ready'
      statusMessage.value = '请使用微信扫码登录'
      return !!uuid.value
    }
    catch (e: any) {
      status.value = 'error'
      errorMessage.value = e?.response?.data?.error || e?.message || '请求失败'
      return false
    }
    finally {
      loading.value = false
    }
  }

  // 检查扫码状态
  async function checkLogin(): Promise<{ success: boolean, wxid?: string, nickname?: string }> {
    if (!uuid.value) {
      return { success: false }
    }
    status.value = 'scanning'
    statusMessage.value = '正在检查登录状态...'
    try {
      const res = await api.post('/api/go/check', { uuid: uuid.value }, { skipErrorToast: true } as any)
      if (!res.data?.ok) {
        status.value = 'error'
        errorMessage.value = res.data?.error || '检查扫码状态失败'
        return { success: false }
      }
      const data = res.data.data || {}
      const statusVal = Number(data.status) || 0
      const gotWxid = String(data.wxid || '').trim()
      const nickname = String(data.nickname || '微信用户')
      if (gotWxid) {
        wxid.value = gotWxid
        status.value = 'success'
        statusMessage.value = `登录成功！欢迎 ${nickname}`
        return { success: true, wxid: gotWxid, nickname }
      }
      if (statusVal === 1) {
        status.value = 'confirming'
        statusMessage.value = '已扫码，请在手机确认登录'
        return { success: false }
      }
      status.value = 'qr_ready'
      statusMessage.value = '等待扫码中'
      return { success: false }
    }
    catch (e: any) {
      status.value = 'error'
      errorMessage.value = e?.response?.data?.error || e?.message || '请求失败'
      return { success: false }
    }
  }

  // 获取 Code
  async function getFarmCode(wxidParam?: string): Promise<{ success: boolean, code?: string, error?: string }> {
    const target = wxidParam || wxid.value
    if (!target) {
      return { success: false, error: '缺少 wxid' }
    }
    statusMessage.value = '正在获取 Code...'
    try {
      const res = await api.post('/api/go/code', { wxid: target }, { skipErrorToast: true } as any)
      if (res.data?.ok && res.data.code) {
        return { success: true, code: String(res.data.code) }
      }
      return { success: false, error: res.data?.error || '获取 Code 失败' }
    }
    catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '请求失败'
      errorMessage.value = msg
      return { success: false, error: msg }
    }
  }

  return {
    config,
    loading,
    qrCode,
    uuid,
    wxid,
    status,
    statusMessage,
    errorMessage,
    loadConfig,
    saveConfig,
    resetState,
    getQRCode,
    checkLogin,
    getFarmCode,
  }
})
