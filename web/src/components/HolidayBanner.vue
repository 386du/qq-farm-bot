<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import api from '@/api'

const holiday = ref<any>(null)
const dismissed = ref(false)
const themeApplied = ref(false)

async function fetch() {
  try {
    const res = await api.get('/api/holiday/current')
    if (res.data.ok) {
      holiday.value = res.data.data
      // 读取本地 storage 中的"已忽略节日"
      try {
        const lastDismissed = localStorage.getItem('holiday_dismissed')
        if (lastDismissed && holiday.value && lastDismissed === holiday.value.name) {
          dismissed.value = true
        }
        else {
          dismissed.value = false
        }
      }
      catch {}
      // 自动应用主题
      if (holiday.value && holiday.value.theme && !dismissed.value) {
        applyTheme(holiday.value.theme)
      }
    }
  }
  catch {
    // ignore
  }
}

function applyTheme(name: string) {
  if (themeApplied.value)
    return
  themeApplied.value = true
  document.documentElement.setAttribute('data-holiday-theme', name)
  try {
    localStorage.setItem('holiday_theme', name)
  }
  catch {}
}

function clearTheme() {
  if (!themeApplied.value)
    return
  themeApplied.value = false
  document.documentElement.removeAttribute('data-holiday-theme')
  try {
    localStorage.removeItem('holiday_theme')
  }
  catch {}
}

function dismiss() {
  dismissed.value = true
  try {
    localStorage.setItem('holiday_dismissed', holiday.value?.name || '')
  }
  catch {}
  clearTheme()
}

watch(dismissed, (val) => {
  if (val) {
    clearTheme()
  }
  else if (holiday.value && holiday.value.theme) {
    applyTheme(holiday.value.theme)
  }
})

onMounted(() => {
  fetch()
})

defineExpose({ fetch })
</script>

<template>
  <div
    v-if="holiday && !dismissed"
    class="relative mb-4 overflow-hidden rounded-2xl p-4"
    :style="{
      background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(239, 68, 68, 0.15) 100%)',
      border: '1px solid rgba(245, 158, 11, 0.3)',
    }"
  >
    <div class="absolute select-none text-6xl opacity-20 -right-4 -top-4">
      {{ holiday.icon }}
    </div>
    <div class="relative z-10 flex items-center gap-3">
      <div class="text-3xl">
        {{ holiday.icon }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="text-base font-black" style="color: #f59e0b">
          {{ holiday.name }}快乐!
        </div>
        <div class="mt-0.5 text-sm opacity-80">
          {{ holiday.greeting }}
        </div>
        <div class="mt-0.5 text-xs opacity-60">
          {{ holiday.decoration }} · {{ holiday.from }} ~ {{ holiday.to }}
        </div>
      </div>
      <button
        class="rounded-full p-1.5 opacity-60 transition-opacity hover:opacity-100"
        title="关闭"
        @click="dismiss()"
      >
        <div class="i-carbon-close text-lg" />
      </button>
    </div>
  </div>
</template>
