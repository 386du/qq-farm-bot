<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import LandCard from '@/components/LandCard.vue'
import { useAccountStore } from '@/stores/account'
import { useFarmStore } from '@/stores/farm'
import { useStatusStore } from '@/stores/status'

const farmStore = useFarmStore()
const accountStore = useAccountStore()
const statusStore = useStatusStore()
const { lands, summary, loading } = storeToRefs(farmStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { status, loading: statusLoading, realtimeConnected } = storeToRefs(statusStore)

const operating = ref(false)
const confirmVisible = ref(false)
const confirmConfig = ref({
  title: '',
  message: '',
  opType: '',
})

async function executeOperate() {
  if (!currentAccountId.value || !confirmConfig.value.opType)
    return
  confirmVisible.value = false
  operating.value = true
  try {
    await farmStore.operate(currentAccountId.value, confirmConfig.value.opType)
  }
  finally {
    operating.value = false
  }
}

function handleOperate(opType: string) {
  if (!currentAccountId.value)
    return

  const confirmMap: Record<string, string> = {
    harvest: '确定要收获所有成熟作物吗？',
    clear: '确定要一键务农吗？(除草+除虫+浇水)',
    plant: '确定要一键种植吗？(根据策略配置)',
    upgrade: '确定要升级所有可升级的土地吗？(消耗金币)',
    all: '确定要一键全收吗？(包含收获、除草、种植等)',
  }

  confirmConfig.value = {
    title: '确认操作',
    message: confirmMap[opType] || '确定执行此操作吗？',
    opType,
  }
  confirmVisible.value = true
}

const operations = [
  { type: 'harvest', label: '收获', icon: '🌾', bgGradient: 'linear-gradient(180deg, #5bb8f5 0%, #3aa0e0 100%)', shadowColor: '#1e88c8' },
  { type: 'clear', label: '一键务农', icon: '🌿', bgGradient: 'linear-gradient(180deg, #5da94f 0%, #4a8c3f 100%)', shadowColor: '#3a6b2e' },
  { type: 'plant', label: '种植', icon: '🌱', bgGradient: 'linear-gradient(180deg, #7dcf69 0%, #5db849 100%)', shadowColor: '#3a8b2e' },
  { type: 'upgrade', label: '升级土地', icon: '⬆️', bgGradient: 'linear-gradient(180deg, #c084fc 0%, #a855f7 100%)', shadowColor: '#7c3aed' },
  { type: 'all', label: '一键全收', icon: '⚡', bgGradient: 'linear-gradient(180deg, #fcd34d 0%, #f0b020 100%)', shadowColor: '#d97706' },
]

async function refresh() {
  if (currentAccountId.value) {
    const acc = currentAccount.value
    if (!acc)
      return

    if (!realtimeConnected.value) {
      await statusStore.fetchStatus(currentAccountId.value)
    }

    if (acc.running && status.value?.connection?.connected) {
      farmStore.fetchLands(currentAccountId.value)
    }
  }
}

watch(currentAccountId, () => {
  refresh()
})

const { pause, resume } = useIntervalFn(() => {
  if (lands.value) {
    lands.value = lands.value.map((l: any) =>
      l.matureInSec > 0 ? { ...l, matureInSec: l.matureInSec - 1 } : l,
    )
  }
}, 1000)

const { pause: pauseRefresh, resume: resumeRefresh } = useIntervalFn(refresh, 60000)

onMounted(() => {
  refresh()
  resume()
  resumeRefresh()
})

onUnmounted(() => {
  pause()
  pauseRefresh()
})
</script>

<template>
  <div class="space-y-5">
    <div class="farm-card-enhanced overflow-hidden">
      <div class="flex flex-col items-center justify-between gap-4 p-5 sm:flex-row" style="border-bottom: 1px solid color-mix(in srgb, var(--theme-primary) 10%, transparent)">
        <h3 class="flex items-center gap-2 text-xl font-bold font-display" :style="{ color: 'var(--theme-text)' }">
          <span class="title-wheat inline-block">🌾</span>
          土地详情
        </h3>
        <div class="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
          <button
            v-for="op in operations"
            :key="op.type"
            class="relative flex items-center justify-center gap-2 overflow-hidden rounded-xl px-4 py-2.5 text-sm text-white font-bold transition-all duration-200 active:translate-y-1 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-110 hover:-translate-y-0.5"
            :style="{
              background: op.bgGradient,
              boxShadow: `0 3px 0 ${op.shadowColor}, 0 6px 14px ${op.shadowColor}50`,
            }"
            :disabled="operating"
            @click="handleOperate(op.type)"
          >
            <span class="text-base drop-shadow-sm">{{ op.icon }}</span>
            {{ op.label }}
            <div class="pointer-events-none absolute inset-0" style="background: linear-gradient(180deg, rgba(255,255,255,0.25) 0%, transparent 50%)" />
          </button>
        </div>
      </div>

      <div
        class="flex flex-wrap gap-3 p-5 text-sm"
        :style="{
          background: `linear-gradient(90deg, color-mix(in srgb, var(--theme-primary) 6%, transparent) 0%, color-mix(in srgb, var(--theme-secondary) 6%, transparent) 100%)`,
          borderBottom: '1px solid color-mix(in srgb, var(--theme-primary) 10%, transparent)',
        }"
      >
        <div class="flex items-center gap-2 rounded-full px-4 py-1.5 font-semibold shadow-sm transition-all duration-200 hover:scale-105" style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); color: #b45309">
          <span class="text-base">🌾</span>
          <div class="i-carbon-clean" />
          可收: <span class="font-bold">{{ summary?.harvestable || 0 }}</span>
        </div>
        <div class="flex items-center gap-2 rounded-full px-4 py-1.5 font-semibold shadow-sm transition-all duration-200 hover:scale-105" style="background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); color: #15803d">
          <span class="text-base">🌿</span>
          <div class="i-carbon-sprout" />
          生长: <span class="font-bold">{{ summary?.growing || 0 }}</span>
        </div>
        <div class="flex items-center gap-2 rounded-full px-4 py-1.5 font-semibold shadow-sm transition-all duration-200 hover:scale-105" style="background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%); color: #4b5563">
          <span class="text-base">🟫</span>
          <div class="i-carbon-checkbox" />
          空闲: <span class="font-bold">{{ summary?.empty || 0 }}</span>
        </div>
        <div class="flex items-center gap-2 rounded-full px-4 py-1.5 font-semibold shadow-sm transition-all duration-200 hover:scale-105" style="background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); color: #b91c1c">
          <span class="text-base">🥀</span>
          <div class="i-carbon-warning" />
          枯萎: <span class="font-bold">{{ summary?.dead || 0 }}</span>
        </div>
      </div>

      <!-- Grid -->
      <div class="p-5">
        <div v-if="loading || statusLoading" class="flex justify-center py-12">
          <div class="i-svg-spinners-90-ring-with-bg text-4xl text-green-500" />
        </div>

        <div v-else-if="!currentAccountId" class="flex flex-col farm-card items-center justify-center gap-4 rounded-2xl bg-white p-12 text-center text-gray-500 shadow-md dark:bg-gray-800">
          <div class="text-5xl">
            🧑‍🌾
          </div>
          <div>
            <div class="text-lg text-gray-700 font-medium font-display dark:text-gray-300">
              未登录账号
            </div>
            <div class="font-body mt-1 text-sm text-gray-400">
              请先添加农场账号开始种田吧!
            </div>
          </div>
        </div>

        <div v-else-if="!status?.connection?.connected" class="flex flex-col farm-card items-center justify-center gap-4 rounded-2xl bg-white p-12 text-center text-gray-500 shadow-md dark:bg-gray-800">
          <div class="text-5xl">
            📡
          </div>
          <div>
            <div class="text-lg text-gray-700 font-medium font-display dark:text-gray-300">
              账号未登录
            </div>
            <div class="font-body mt-1 text-sm text-gray-400">
              请先运行账号或检查网络连接 🔄
            </div>
          </div>
        </div>

        <div v-else-if="!lands || lands.length === 0" class="flex flex-col items-center justify-center gap-4 py-16">
          <div class="text-6xl">
            🌱🏡🌻
          </div>
          <div class="text-lg text-gray-500 font-display">
            还没有种下作物哦~
          </div>
          <div class="font-body text-sm text-gray-400">
            快去种下第一棵种子吧! 🧑‍🌾✨
          </div>
        </div>

        <div v-else class="grid grid-cols-2 gap-4 lg:grid-cols-6 md:grid-cols-4 sm:grid-cols-3">
          <LandCard
            v-for="land in lands"
            :key="land.id"
            :land="land"
          />
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="confirmVisible"
      :title="confirmConfig.title"
      :message="confirmConfig.message"
      @confirm="executeOperate"
      @cancel="confirmVisible = false"
    />
  </div>
</template>
