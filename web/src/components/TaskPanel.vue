<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, watch } from 'vue'
import DailyOverview from '@/components/DailyOverview.vue'
import { useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'

const statusStore = useStatusStore()
const accountStore = useAccountStore()
const { status, dailyGifts, realtimeConnected } = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)

const growth = computed(() => dailyGifts.value?.growth || null)

async function refresh() {
  if (currentAccountId.value) {
    const acc = currentAccount.value
    if (!acc)
      return

    if (!realtimeConnected.value) {
      await statusStore.fetchStatus(currentAccountId.value)
    }
    if (acc.running && status.value?.connection?.connected) {
      statusStore.fetchDailyGifts(currentAccountId.value)
    }
  }
}

onMounted(() => {
  refresh()
})

watch(currentAccountId, () => {
  refresh()
})

function formatTaskProgress(task: any) {
  if (!task)
    return '未开始'
  const rawCurrent = task.progress ?? task.current
  const rawTarget = task.totalProgress ?? task.target

  const current = Number.isFinite(rawCurrent)
    ? rawCurrent
    : (rawCurrent ? Number(rawCurrent) || 0 : 0)

  const target = Number.isFinite(rawTarget)
    ? rawTarget
    : (rawTarget ? Number(rawTarget) || 0 : 0)

  if (!current && !target)
    return '未开始'

  if (target && current >= target)
    return '已完成'

  return `进度：${current}/${target}`
}
</script>

<template>
  <div class="space-y-6">
    <DailyOverview :daily-gifts="dailyGifts" />

    <div class="farm-card-enhanced p-5">
      <div class="mb-4 flex items-center justify-between">
        <h3 class="flex items-center gap-2 text-lg font-bold font-display" :style="{ color: 'var(--theme-text)' }">
          <span class="title-wheat inline-block">🌱</span>
          <span>成长任务</span>
        </h3>
        <span
          v-if="growth"
          class="rounded-xl px-3 py-1 text-xs font-bold shadow-sm transition-all duration-200 hover:scale-105"
          :style="growth.doneToday
            ? { background: 'linear-gradient(135deg, #bbf7d0 0%, #86efac 100%)', color: '#15803d' }
            : { background: 'linear-gradient(135deg, #bfdbfe 0%, #93c5fd 100%)', color: '#1d4ed8' }"
        >
          {{ growth.doneToday ? '✨ 今日已完成' : `${growth.completedCount}/${growth.totalCount}` }}
        </span>
      </div>

      <div
        v-if="!currentAccountId"
        class="flex flex-col items-center justify-center gap-3 rounded-2xl py-8 text-center"
        :style="{ background: `linear-gradient(135deg, color-mix(in srgb, var(--theme-primary) 8%, transparent) 0%, color-mix(in srgb, var(--theme-secondary) 8%, transparent) 100%)` }"
      >
        <div class="animate-float text-3xl">
          👤
        </div>
        <div>
          <div class="text-sm font-bold" :style="{ color: 'var(--theme-text)' }">
            未登录账号
          </div>
          <div class="mt-1 text-xs opacity-60">
            请先添加农场账号
          </div>
        </div>
      </div>

      <div
        v-else-if="!status?.connection?.connected"
        class="flex flex-col items-center justify-center gap-3 rounded-2xl py-8 text-center"
        :style="{ background: `linear-gradient(135deg, color-mix(in srgb, var(--theme-primary) 8%, transparent) 0%, color-mix(in srgb, var(--theme-secondary) 8%, transparent) 100%)` }"
      >
        <div class="animate-float text-3xl">
          📡
        </div>
        <div>
          <div class="text-sm font-bold" :style="{ color: 'var(--theme-text)' }">
            账号未登录
          </div>
          <div class="mt-1 text-xs opacity-60">
            请先运行账号或检查网络连接 🔄
          </div>
        </div>
      </div>

      <div
        v-else-if="growth && growth.tasks && growth.tasks.length"
        class="space-y-2"
      >
        <div
          v-for="(task, idx) in growth.tasks"
          :key="idx"
          class="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-all duration-200 hover:scale-[1.01] hover:shadow-sm"
          :style="{ background: `linear-gradient(90deg, color-mix(in srgb, var(--theme-primary) 4%, transparent) 0%, transparent 100%)` }"
        >
          <div class="flex items-center gap-2">
            <div class="text-base">
              {{ task.done ? '✅' : '📋' }}
            </div>
            <span class="font-medium" :style="{ color: 'var(--theme-text)', opacity: task.done ? 0.6 : 0.9 }">{{ task.desc || task.name }}</span>
          </div>
          <span
            class="rounded-lg px-2 py-0.5 text-xs font-bold"
            :style="task.done
              ? { background: 'linear-gradient(135deg, #bbf7d0 0%, #86efac 100%)', color: '#15803d' }
              : { background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)', color: '#4b5563' }"
          >{{ formatTaskProgress(task) }}</span>
        </div>
      </div>

      <div v-else class="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <div class="text-3xl opacity-50">
          📭
        </div>
        <div class="text-sm opacity-60">
          暂无任务详情
        </div>
      </div>
    </div>
  </div>
</template>
