<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useGoLoginStore } from '@/stores/go-login'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const goStore = useGoLoginStore()
const toast = useToastStore()
const saving = ref(false)

const form = ref({
  enabled: false,
  apiBase: '',
  appId: 'wx5306c5978fdb76e4',
  apiKey: '',
  proxyApiUrl: '',
})

function resetForm() {
  form.value = {
    enabled: !!goStore.config.enabled,
    apiBase: goStore.config.apiBase || '',
    appId: goStore.config.appId || 'wx5306c5978fdb76e4',
    apiKey: goStore.config.apiKey || '',
    proxyApiUrl: goStore.config.proxyApiUrl || '',
  }
}

watch(() => props.show, (show) => {
  if (show) {
    goStore.loadConfig().then(resetForm)
  }
})

const panelStyle = computed(() => ({
  background: 'var(--theme-bg)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.24), 0 0 0 1px rgba(0,0,0,0.08)',
  maxHeight: 'min(85dvh, 700px)',
}))

async function handleSave() {
  saving.value = true
  try {
    if (form.value.enabled && !String(form.value.apiBase).trim()) {
      toast.warning('请填写 Go 服务地址')
      return
    }
    if (form.value.enabled && !String(form.value.appId).trim()) {
      toast.warning('请填写 AppID')
      return
    }
    await goStore.saveConfig({
      enabled: !!form.value.enabled,
      apiBase: String(form.value.apiBase).trim(),
      appId: String(form.value.appId).trim(),
      apiKey: String(form.value.apiKey).trim(),
      proxyApiUrl: String(form.value.proxyApiUrl).trim(),
    })
    toast.success('Go 服务配置已保存')
    emit('close')
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '保存失败')
  }
  finally {
    saving.value = false
  }
}

function close() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click.self="close" />
      <div
        class="absolute left-1/2 top-1/2 z-10 max-w-md w-[calc(100%-2rem)] flex flex-col rounded-2xl -translate-x-1/2 -translate-y-1/2"
        :style="panelStyle"
        @click.stop
      >
        <div class="flex shrink-0 items-center justify-between p-4" style="border-bottom: 1px solid color-mix(in srgb, var(--theme-text) 10%, transparent)">
          <div>
            <h3 class="text-lg font-semibold" style="color: var(--theme-primary, var(--theme-text))">
              Go 服务配置
            </h3>
            <p class="mt-1 text-xs opacity-70" style="color: var(--theme-text)">
              配置独立 Go 服务的地址(与微信扫码 apiBase 分开)
            </p>
          </div>
          <BaseButton variant="ghost" class="!p-1" @click="close">
            <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
          </BaseButton>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          <div class="space-y-1">
            <BaseSwitch v-model="form.enabled" label="启用 Go 扫码" />
            <p class="text-xs opacity-70" style="color: var(--theme-text)">
              启用后,添加账号页会显示「Go 扫码」Tab
            </p>
          </div>

          <BaseInput
            v-model="form.apiBase"
            label="Go 服务地址"
            placeholder="例如: http://192.168.1.10:8000"
            class="farm-input"
          />

          <BaseInput
            v-model="form.appId"
            label="微信小程序 AppID"
            placeholder="默认 wx5306c5978fdb76e4"
            class="farm-input"
          />

          <details class="rounded-xl border p-3 text-xs" style="border-color: color-mix(in srgb, var(--theme-text) 15%, transparent); color: var(--theme-text)">
            <summary class="cursor-pointer opacity-80">高级(代理模式,可选)</summary>
            <div class="mt-3 space-y-3">
              <BaseInput
                v-model="form.apiKey"
                label="API Key"
                placeholder="代理模式鉴权 Key(留空则走本地 API 模式)"
                class="farm-input"
              />
              <BaseInput
                v-model="form.proxyApiUrl"
                label="代理上游 URL"
                placeholder="留空则使用「Go 服务地址」"
                class="farm-input"
              />
              <p class="opacity-70">
                代理模式需后端支持 <code class="font-mono">/api/proxy</code>,目前仅本地 API 模式可用。
              </p>
            </div>
          </details>

          <div
            class="rounded-xl p-3 text-xs space-y-1"
            style="background: color-mix(in srgb, var(--theme-primary) 8%, transparent); color: var(--theme-text)"
          >
            <div>· 接口路径与微信本地 API 兼容: <code class="font-mono">/Login/LoginGetQRCar</code> · <code class="font-mono">/Login/LoginCheckQR</code> · <code class="font-mono">/Wxapp/JSLogin</code></div>
            <div>· 扫码成功后将以 <code class="font-mono">loginType=go_scan</code> 添加账号</div>
            <div>· 若该账号设置了「Code 刷新间隔 &gt; 0」,将按设定定时刷新 Code 并触发内部重连</div>
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <BaseButton variant="outline" class="cartoon-btn" @click="close">
              取消
            </BaseButton>
            <BaseButton variant="primary" class="cartoon-btn" :loading="saving" @click="handleSave">
              保存
            </BaseButton>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
