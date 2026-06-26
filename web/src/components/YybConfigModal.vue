<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useYybLoginStore } from '@/stores/yyb-login'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits(['close'])

const yybStore = useYybLoginStore()
const saving = ref(false)
const newOpenId = ref('')

const form = ref({
  apiToken: '',
  endpoint: 'http://211.154.25.123:28999/api/open/v1/farm/code',
  reconnectIntervalMinutes: 0,
  autoReconnect: true,
  openIds: [] as string[],
})

function resetForm() {
  const cfg = yybStore.config
  form.value = {
    apiToken: cfg.apiToken || '',
    endpoint: cfg.endpoint || 'http://211.154.25.123:28999/api/open/v1/farm/code',
    reconnectIntervalMinutes: cfg.reconnectIntervalMinutes || 0,
    autoReconnect: cfg.autoReconnect !== false,
    openIds: Array.isArray(cfg.openIds) ? [...cfg.openIds] : [],
  }
  newOpenId.value = ''
}

watch(() => props.show, (show) => {
  if (show) {
    yybStore.loadConfig().then(resetForm)
  }
})

const interval = computed({
  get: () => form.value.reconnectIntervalMinutes,
  set: (v: number) => {
    form.value.reconnectIntervalMinutes = Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0)
  },
})

function increaseInterval() {
  form.value.reconnectIntervalMinutes += 1
}

function decreaseInterval() {
  if (form.value.reconnectIntervalMinutes > 0) {
    form.value.reconnectIntervalMinutes -= 1
  }
}

function addOpenId() {
  const value = newOpenId.value.trim()
  if (!value)
    return
  if (!form.value.openIds.includes(value)) {
    form.value.openIds.push(value)
  }
  newOpenId.value = ''
}

function removeOpenId(index: number) {
  form.value.openIds.splice(index, 1)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    addOpenId()
  }
}

async function handleSave() {
  saving.value = true
  try {
    await yybStore.saveConfig({
      enabled: true,
      apiToken: form.value.apiToken,
      endpoint: form.value.endpoint,
      reconnectIntervalMinutes: form.value.reconnectIntervalMinutes,
      autoReconnect: form.value.autoReconnect,
      openIds: form.value.openIds,
    })
    emit('close')
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
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div class="max-h-[90vh] max-w-md w-full overflow-hidden rounded-2xl" :style="{ background: 'var(--theme-bg)', boxShadow: 'var(--theme-shadow-lg, 0 8px 32px rgba(0,0,0,0.16))' }">
      <div class="flex items-center justify-between p-4" style="border-bottom: 1px solid color-mix(in srgb, var(--theme-text) 10%, transparent)">
        <div>
          <h3 class="text-lg font-semibold" style="color: var(--theme-primary, var(--theme-text))">
            应用宝配置
          </h3>
          <p class="mt-1 text-xs opacity-70" style="color: var(--theme-text)">
            配置应用宝一键登录的 API Token 和 OpenID
          </p>
        </div>
        <BaseButton variant="ghost" class="!p-1" @click="close">
          <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
        </BaseButton>
      </div>

      <div class="max-h-[calc(90vh-80px)] overflow-y-auto p-4 space-y-4">
        <BaseInput
          v-model="form.apiToken"
          label="API Token"
          type="password"
          placeholder="请输入 API Token"
          class="farm-input"
        />

        <BaseInput
          v-model="form.endpoint"
          label="接口地址"
          placeholder="请输入接口地址"
          class="farm-input"
        />

        <div class="space-y-2">
          <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
            运行中定时重连间隔（分钟）
          </label>
          <div class="flex items-center overflow-hidden border-3 border-black/10 rounded-xl bg-white dark:border-gray-600 dark:bg-gray-800">
            <button
              type="button"
              class="h-11 w-12 flex items-center justify-center text-lg font-bold transition hover:bg-gray-100 dark:hover:bg-gray-700"
              :style="{ color: 'var(--theme-text)' }"
              @click="decreaseInterval"
            >
              −
            </button>
            <input
              v-model.number="interval"
              type="number"
              min="0"
              class="h-11 min-w-0 flex-1 border-x-3 border-black/10 bg-transparent text-center outline-none dark:border-gray-600 dark:text-white"
            >
            <button
              type="button"
              class="h-11 w-12 flex items-center justify-center text-lg font-bold transition hover:bg-gray-100 dark:hover:bg-gray-700"
              :style="{ color: 'var(--theme-text)' }"
              @click="increaseInterval"
            >
              +
            </button>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            输入 0 则不进行定时重登；设置后到达间隔时间将自动重新获取 Code 并重登
          </p>
        </div>

        <div class="space-y-1">
          <BaseSwitch v-model="form.autoReconnect" label="离线后自动重连" />
          <p class="text-xs text-gray-500 dark:text-gray-400">
            账号被踢下线或断线后自动获取新 Code 并重登
          </p>
        </div>

        <div class="space-y-2">
          <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
            OpenID 列表
          </label>
          <div class="space-y-2">
            <div
              v-for="(openid, index) in form.openIds"
              :key="openid"
              class="flex items-center justify-between gap-2 border border-gray-200 rounded-xl bg-gray-50 px-3 py-2 dark:border-gray-600 dark:bg-gray-800/50"
            >
              <span class="min-w-0 flex-1 truncate text-sm" :style="{ color: 'var(--theme-text)' }">
                {{ openid }}
              </span>
              <button
                type="button"
                class="text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                @click="removeOpenId(index)"
              >
                <div class="i-carbon-trash-can text-lg" />
              </button>
            </div>
            <div class="flex gap-2">
              <BaseInput
                v-model="newOpenId"
                placeholder="输入新 OpenID"
                class="flex-1 farm-input"
                @keydown="handleKeydown"
              />
              <BaseButton variant="secondary" size="sm" class="shrink-0" @click="addOpenId">
                添加
              </BaseButton>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
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
</template>
