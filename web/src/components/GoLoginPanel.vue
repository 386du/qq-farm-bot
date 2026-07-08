<script setup lang="ts">
/* eslint-disable vue/custom-event-name-casing -- 与父组件约定使用 kebab-case 事件名,跨文件稳定 */
import { useIntervalFn } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAccountStore } from '@/stores/account'
import { useGoLoginStore } from '@/stores/go-login'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{
  embedded?: boolean
}>()

const emit = defineEmits<{
  (e: 'saved'): void
  (e: 'open-config'): void
}>()

const goStore = useGoLoginStore()
const accountStore = useAccountStore()
const toast = useToastStore()

const accountName = ref('')
const refreshInterval = ref<number>(3)
const started = ref(false)

const { pause: stopCheck, resume: startCheck } = useIntervalFn(async () => {
  if (goStore.status !== 'qr_ready' && goStore.status !== 'confirming')
    return
  const result = await goStore.checkLogin()
  if (result.success && result.wxid) {
    stopCheck()
    await handleAutoAddAccount(result.wxid, result.nickname)
  }
}, 2000, { immediate: false })

async function handleAutoAddAccount(wxid: string, nickname?: string) {
  try {
    const result = await goStore.getFarmCode()
    if (!result.success || !result.code) {
      toast.error(result.error || '获取 Code 失败')
      return
    }
    const name = accountName.value.trim() || nickname || `Go扫码账号${Date.now()}`
    await accountStore.addAccount({
      name,
      code: result.code,
      platform: 'wx',
      loginType: 'go_scan',
      openid: wxid,
      codeRefreshIntervalMinutes: Math.max(0, Math.floor(refreshInterval.value) || 0),
    })
    toast.success(`已添加账号：${name}`)
    emit('saved')
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '保存账号失败')
  }
}

async function loadQRCode() {
  goStore.resetState()
  const ok = await goStore.getQRCode()
  if (ok)
    startCheck()
  else stopCheck()
}

const qrImageSrc = computed(() => {
  if (!goStore.qrCode)
    return ''
  if (goStore.qrCode.startsWith('data:'))
    return goStore.qrCode
  if (goStore.qrCode.startsWith('http'))
    return goStore.qrCode
  return `data:image/png;base64,${goStore.qrCode}`
})

const statusClass = computed(() => {
  switch (goStore.status) {
    case 'success': return 'text-green-600'
    case 'error': return 'text-red-600'
    case 'qr_loading':
    case 'scanning': return 'text-blue-600'
    default: return 'text-gray-600'
  }
})

const configNotReady = computed(() => !goStore.config.enabled || !String(goStore.config.apiBase || '').trim())

watch(() => props.embedded, async (val) => {
  if (val && !started.value) {
    started.value = true
    try {
      await goStore.loadConfig()
    }
    catch {
      // 忽略
    }
    if (!configNotReady.value) {
      loadQRCode()
    }
  }
}, { immediate: true })
</script>

<template>
  <div class="space-y-4">
    <BaseInput
      v-model="accountName"
      label="账号备注（可选）"
      placeholder="留空使用微信昵称"
      class="farm-input"
    />

    <BaseInput
      v-model.number="refreshInterval"
      label="Code刷新间隔（分钟）"
      type="number"
      placeholder="0 表示不自动刷新"
      class="farm-input"
    />

    <div
      class="rounded-xl p-3 text-xs space-y-1"
      style="background: color-mix(in srgb, var(--theme-primary) 8%, transparent); color: var(--theme-text)"
    >
      <div>· Go 服务地址由管理员在后台管理中统一配置</div>
      <div>· 当前 APPID: {{ goStore.config.appId || 'wx5306c5978fdb76e4' }}</div>
      <div>· 扫码添加后按该账号设置的间隔获取 Code 并重启账号</div>
      <div v-if="goStore.config.apiBase">
        · 服务地址: <span class="font-mono">{{ goStore.config.apiBase }}</span>
      </div>
    </div>

    <div v-if="configNotReady" class="rounded-xl p-3 text-sm" style="background: rgba(239, 68, 68, 0.1); color: #ef4444">
      <div class="mb-2">
        Go 服务未配置或未启用
      </div>
      <BaseButton variant="outline" size="sm" @click="emit('open-config')">
        打开 Go 服务配置
      </BaseButton>
    </div>

    <div v-else class="flex flex-col items-center justify-center py-2 space-y-3">
      <div
        v-if="qrImageSrc"
        class="rounded-xl p-2"
        style="border: 2px solid color-mix(in srgb, var(--theme-text) 15%, transparent); background: #fff"
      >
        <img :src="qrImageSrc" class="h-48 w-48">
      </div>
      <div
        v-else
        class="h-48 w-48 flex items-center justify-center rounded-xl"
        :style="{ background: 'color-mix(in srgb, var(--theme-bg) 90%, var(--theme-text))' }"
      >
        <div v-if="goStore.loading" i-svg-spinners-90-ring-with-bg class="text-3xl" :style="{ color: 'var(--theme-primary)' }" />
        <span v-else class="text-sm" :style="{ color: 'var(--theme-text)' }">点击获取二维码</span>
      </div>

      <p class="text-center text-sm" :class="statusClass">
        {{ goStore.statusMessage }}
      </p>
      <p v-if="goStore.errorMessage" class="text-center text-sm text-red-600">
        {{ goStore.errorMessage }}
      </p>

      <div class="flex gap-2">
        <BaseButton
          variant="secondary"
          class="cartoon-btn"
          size="sm"
          :loading="goStore.loading"
          @click="loadQRCode"
        >
          刷新二维码
        </BaseButton>
        <BaseButton
          variant="ghost"
          class="cartoon-btn"
          size="sm"
          @click="emit('open-config')"
        >
          Go 服务配置
        </BaseButton>
      </div>
    </div>

    <div class="text-center text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
      使用微信扫描二维码登录,登录成功后将自动添加账号并按设定间隔自动刷新 Code
    </div>
  </div>
</template>
