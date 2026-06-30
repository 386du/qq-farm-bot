<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/api'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const toast = useToastStore()
const loading = ref(false)
const sending = ref(false)
const report = ref<any>(null)

async function fetch() {
  loading.value = true
  try {
    const res = await api.get('/api/report/daily', { params: { date: 'yesterday' } })
    if (res.data.ok) {
      report.value = res.data.data
    }
  } catch (e: any) {
    // ignore
  } finally {
    loading.value = false
  }
}

async function pushNow() {
  sending.value = true
  try {
    const res = await api.post('/api/admin/report/push')
    if (res.data.ok && res.data.data?.ok) {
      toast.success('已推送昨日日报')
    } else {
      const err = res.data.data?.error || res.data.error
      toast.error(err || '推送失败')
    }
  } catch (e: any) {
    toast.error(e?.response?.data?.error || e.message || '推送失败')
  } finally {
    sending.value = false
  }
}

function formatNumber(n: number) {
  return (n || 0).toLocaleString('zh-CN')
}

onMounted(() => {
  fetch()
})
</script>

<template>
  <div v-if="!loading && report" class="farm-card-enhanced relative overflow-hidden p-4 mb-4">
    <div class="absolute -right-2 -top-2 text-5xl opacity-10">🌾</div>
    <div class="relative z-10">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="text-xl">🌾</span>
          <h3 class="font-black text-base">昨日农场日报</h3>
          <span class="text-xs opacity-60">{{ report.date }}</span>
        </div>
        <button
          v-if="userStore.isAdminPanelUser"
          class="rounded-lg px-2.5 py-1 text-xs font-bold transition-all hover:scale-105"
          style="background: var(--theme-gradient); color: white"
          :disabled="sending"
          @click="pushNow()"
        >
          {{ sending ? '推送中…' : '📤 立即推送' }}
        </button>
      </div>

      <div class="grid grid-cols-4 gap-2 mb-3">
        <div class="rounded-lg p-2 text-center" style="background: color-mix(in srgb, #10b981 10%, transparent)">
          <div class="text-xs opacity-60">收菜</div>
          <div class="text-base font-black" style="color: #10b981">🌾 {{ formatNumber(report.totals.harvest) }}</div>
        </div>
        <div class="rounded-lg p-2 text-center" style="background: color-mix(in srgb, #8b5cf6 10%, transparent)">
          <div class="text-xs opacity-60">偷菜</div>
          <div class="text-base font-black" style="color: #8b5cf6">🥷 {{ formatNumber(report.totals.steal) }}</div>
        </div>
        <div class="rounded-lg p-2 text-center" style="background: color-mix(in srgb, #f59e0b 10%, transparent)">
          <div class="text-xs opacity-60">化肥</div>
          <div class="text-base font-black" style="color: #f59e0b">🧪 {{ formatNumber(report.totals.fertilize) }}</div>
        </div>
        <div class="rounded-lg p-2 text-center" style="background: color-mix(in srgb, #fbbf24 10%, transparent)">
          <div class="text-xs opacity-60">金币</div>
          <div class="text-base font-black" style="color: #fbbf24">💰 {{ formatNumber(report.totals.gold) }}</div>
        </div>
      </div>

      <div v-if="report.mvpAccount || report.harvestKingAccount || report.stealKingAccount" class="flex flex-wrap gap-2">
        <div v-if="report.mvpAccount" class="rounded-lg px-2 py-1 text-xs font-bold flex items-center gap-1" style="background: color-mix(in srgb, #fbbf24 20%, transparent)">
          🏆 {{ report.mvpAccount.accountName }}
        </div>
        <div v-if="report.harvestKingAccount" class="rounded-lg px-2 py-1 text-xs font-bold flex items-center gap-1" style="background: color-mix(in srgb, #f59e0b 20%, transparent)">
          🌾 {{ report.harvestKingAccount.accountName }}
        </div>
        <div v-if="report.stealKingAccount" class="rounded-lg px-2 py-1 text-xs font-bold flex items-center gap-1" style="background: color-mix(in srgb, #8b5cf6 20%, transparent)">
          🥷 {{ report.stealKingAccount.accountName }}
        </div>
      </div>
    </div>
  </div>
</template>
