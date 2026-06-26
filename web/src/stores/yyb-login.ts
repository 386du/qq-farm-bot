import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'

export interface YybConfig {
  enabled: boolean
  apiToken: string
  endpoint: string
  reconnectIntervalMinutes: number
  autoReconnect: boolean
  openIds: string[]
}

const defaultConfig: YybConfig = {
  enabled: false,
  apiToken: '',
  endpoint: 'http://211.154.25.123:28999/api/open/v1/farm/code',
  reconnectIntervalMinutes: 0,
  autoReconnect: true,
  openIds: [],
}

export const useYybLoginStore = defineStore('yyb-login', () => {
  const rawConfig = ref<YybConfig>({ ...defaultConfig })
  const loading = ref(false)
  const fetchingCode = ref(false)

  const config = computed<YybConfig>(() => ({
    ...defaultConfig,
    ...rawConfig.value,
  }))

  async function loadConfig() {
    loading.value = true
    try {
      const res = await api.get('/api/user/yyb-config')
      if (res.data?.ok && res.data.config) {
        rawConfig.value = { ...defaultConfig, ...res.data.config }
      }
    }
    catch (e) {
      console.error('加载应用宝配置失败', e)
    }
    finally {
      loading.value = false
    }
  }

  async function saveConfig(payload: Partial<YybConfig>) {
    const res = await api.post('/api/user/yyb-config', payload)
    if (res.data?.ok && res.data.config) {
      rawConfig.value = { ...defaultConfig, ...res.data.config }
    }
    return res.data
  }

  async function fetchCode(openid: string): Promise<{ ok: boolean; code?: string; error?: string }> {
    fetchingCode.value = true
    try {
      const res = await api.post('/api/yyb/code', { openid }, { skipErrorToast: true } as any)
      if (res.data?.ok && res.data.code) {
        return { ok: true, code: res.data.code }
      }
      return { ok: false, error: res.data?.error || '获取 Code 失败' }
    }
    catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '请求失败'
      return { ok: false, error: msg }
    }
    finally {
      fetchingCode.value = false
    }
  }

  return {
    config,
    loading,
    fetchingCode,
    loadConfig,
    saveConfig,
    fetchCode,
  }
})
