<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const accountStore = useAccountStore()
const userStore = useUserStore()
const toast = useToastStore()

const loading = ref(false)
const dateKey = ref<'today' | 'yesterday'>('yesterday')
const activeTab = ref<'score' | 'gold' | 'steal' | 'harvest'>('score')
const data = ref<any>(null)
const report = ref<any>(null)

async function fetchLeaderboard() {
  loading.value = true
  try {
    const res = await api.get('/api/leaderboard', { params: { date: dateKey.value } })
    if (res.data.ok) {
      data.value = res.data.data
    }
    else {
      toast.error(res.data.error || '加载失败')
    }
  } catch (e: any) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function fetchReport() {
  try {
    const res = await api.get('/api/report/daily', { params: { date: dateKey.value } })
    if (res.data.ok) {
      report.value = res.data.data
    }
  } catch (e: any) {
    // ignore
  }
}

const tabs = [
  { key: 'score', label: '综合', icon: '🏆' },
  { key: 'gold', label: '金币', icon: '💰' },
  { key: 'steal', label: '偷菜', icon: '🥷' },
  { key: 'harvest', label: '收菜', icon: '🌾' },
] as const

const currentList = computed(() => {
  if (!data.value) return []
  if (activeTab.value === 'gold') return data.value.byGold || []
  if (activeTab.value === 'steal') return data.value.bySteal || []
  if (activeTab.value === 'harvest') return data.value.byHarvest || []
  return data.value.accounts || []
})

const maxValue = computed(() => {
  const list = currentList.value
  if (!list.length) return 1
  if (activeTab.value === 'gold') return Math.max(...list.map((e: any) => e.gold || 0), 1)
  if (activeTab.value === 'steal') return Math.max(...list.map((e: any) => e.stealCount || 0), 1)
  if (activeTab.value === 'harvest') return Math.max(...list.map((e: any) => e.harvestCount || 0), 1)
  return Math.max(...list.map((e: any) => e.score || 0), 1)
})

function valueOf(entry: any) {
  if (activeTab.value === 'gold') return entry.gold || 0
  if (activeTab.value === 'steal') return entry.stealCount || 0
  if (activeTab.value === 'harvest') return entry.harvestCount || 0
  return entry.score || 0
}

function formatNumber(n: number) {
  return (n || 0).toLocaleString('zh-CN')
}

function rankIcon(rank: number) {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return `${rank}`
}

function rankColor(rank: number) {
  if (rank === 1) return 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)'
  if (rank === 2) return 'linear-gradient(135deg, #d1d5db 0%, #9ca3af 100%)'
  if (rank === 3) return 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)'
  return 'color-mix(in srgb, var(--theme-primary) 12%, transparent)'
}

function valueLabel() {
  if (activeTab.value === 'gold') return '金币'
  if (activeTab.value === 'steal') return '偷菜'
  if (activeTab.value === 'harvest') return '收菜'
  return '得分'
}

async function regenerateReport() {
  if (!confirm('确认要重新生成昨日日报数据吗?')) return
  try {
    const dateKey = (() => {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()
    const res = await api.get('/api/report/daily', { params: { date: dateKey, refresh: 1 } })
    if (res.data.ok) {
      toast.success('日报已重新生成')
      fetchReport()
    } else {
      toast.error(res.data.error || '生成失败')
    }
  } catch (e: any) {
    toast.error(e.message || '生成失败')
  }
}

onMounted(() => {
  accountStore.fetchAccounts()
  fetchLeaderboard()
  fetchReport()
})
</script>

<template>
  <div class="h-full overflow-y-auto p-4 pb-24">
    <div class="mx-auto max-w-4xl space-y-4">
      <!-- 顶部标题 -->
      <div class="farm-card-enhanced p-5">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h1 class="text-2xl font-black flex items-center gap-2">
              <span class="i-carbon-trophy text-3xl" style="color: var(--theme-primary)" />
              跨账号排行榜
            </h1>
            <p class="text-sm opacity-70 mt-1">多账号挂机,谁与争锋</p>
          </div>
          <div class="flex flex-col items-end gap-1">
            <div class="flex items-center gap-1 rounded-lg p-1" style="background: color-mix(in srgb, var(--theme-primary) 8%, transparent)">
              <button
                class="rounded-md px-3 py-1 text-xs font-bold transition-all"
                :class="dateKey === 'yesterday' ? 'shadow' : 'opacity-60'"
                :style="dateKey === 'yesterday' ? { backgroundColor: 'var(--theme-primary)', color: 'white' } : {}"
                @click="dateKey = 'yesterday'; fetchLeaderboard(); fetchReport()"
              >
                昨日
              </button>
              <button
                class="rounded-md px-3 py-1 text-xs font-bold transition-all"
                :class="dateKey === 'today' ? 'shadow' : 'opacity-60'"
                :style="dateKey === 'today' ? { backgroundColor: 'var(--theme-primary)', color: 'white' } : {}"
                @click="dateKey = 'today'; fetchLeaderboard(); fetchReport()"
              >
                今日
              </button>
            </div>
            <span class="text-xs opacity-60">{{ data?.date || '加载中...' }}</span>
          </div>
        </div>

        <!-- 日报概览 -->
        <div v-if="report" class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <div class="rounded-xl p-3" style="background: color-mix(in srgb, var(--theme-primary) 8%, transparent)">
            <div class="text-xs opacity-70">活跃账号</div>
            <div class="text-xl font-black mt-0.5" style="color: var(--theme-primary)">
              {{ report.activeAccounts }}<span class="text-sm opacity-60">/{{ report.totalAccounts }}</span>
            </div>
          </div>
          <div class="rounded-xl p-3" style="background: color-mix(in srgb, #f59e0b 8%, transparent)">
            <div class="text-xs opacity-70">收菜</div>
            <div class="text-xl font-black mt-0.5" style="color: #f59e0b">
              🌾 {{ formatNumber(report.totals.harvest) }}
            </div>
          </div>
          <div class="rounded-xl p-3" style="background: color-mix(in srgb, #8b5cf6 8%, transparent)">
            <div class="text-xs opacity-70">偷菜</div>
            <div class="text-xl font-black mt-0.5" style="color: #8b5cf6">
              🥷 {{ formatNumber(report.totals.steal) }}
            </div>
          </div>
          <div class="rounded-xl p-3" style="background: color-mix(in srgb, #10b981 8%, transparent)">
            <div class="text-xs opacity-70">金币</div>
            <div class="text-xl font-black mt-0.5" style="color: #10b981">
              💰 {{ formatNumber(report.totals.gold) }}
            </div>
          </div>
        </div>

        <!-- 三王 -->
        <div v-if="report && (report.mvpAccount || report.harvestKingAccount || report.stealKingAccount)" class="grid grid-cols-3 gap-3 mt-3">
          <div v-if="report.mvpAccount" class="rounded-xl p-3 text-center" style="background: color-mix(in srgb, #fbbf24 15%, transparent); border: 1px solid #fbbf24 30%">
            <div class="text-2xl">🏆</div>
            <div class="text-xs opacity-70 mt-1">综合冠军</div>
            <div class="text-sm font-bold mt-0.5 truncate">{{ report.mvpAccount.accountName }}</div>
            <div class="text-xs opacity-60">{{ report.mvpAccount.score }} 分</div>
          </div>
          <div v-if="report.harvestKingAccount" class="rounded-xl p-3 text-center" style="background: color-mix(in srgb, #f59e0b 15%, transparent); border: 1px solid #f59e0b 30%">
            <div class="text-2xl">🌾</div>
            <div class="text-xs opacity-70 mt-1">收菜之王</div>
            <div class="text-sm font-bold mt-0.5 truncate">{{ report.harvestKingAccount.accountName }}</div>
            <div class="text-xs opacity-60">{{ report.harvestKingAccount.harvest }} 次</div>
          </div>
          <div v-if="report.stealKingAccount" class="rounded-xl p-3 text-center" style="background: color-mix(in srgb, #8b5cf6 15%, transparent); border: 1px solid #8b5cf6 30%">
            <div class="text-2xl">🥷</div>
            <div class="text-xs opacity-70 mt-1">偷菜之王</div>
            <div class="text-sm font-bold mt-0.5 truncate">{{ report.stealKingAccount.accountName }}</div>
            <div class="text-xs opacity-60">{{ report.stealKingAccount.steal }} 次</div>
          </div>
        </div>
      </div>

      <!-- 排行榜标签 -->
      <div class="flex gap-2 overflow-x-auto pb-1">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="flex flex-shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition-all"
          :class="activeTab === tab.key ? 'shadow-md scale-105' : 'opacity-60 hover:opacity-100'"
          :style="activeTab === tab.key ? { backgroundColor: 'var(--theme-primary)', color: 'white' } : { background: 'color-mix(in srgb, var(--theme-bg) 60%, transparent)' }"
          @click="activeTab = tab.key"
        >
          <span>{{ tab.icon }}</span>
          <span>{{ tab.label }}</span>
        </button>
      </div>

      <!-- 排行榜列表 -->
      <div v-if="loading" class="farm-card-enhanced p-8 text-center opacity-60">
        <div class="i-carbon-circle-dash animate-spin text-2xl mx-auto" />
        <p class="mt-2 text-sm">加载中...</p>
      </div>

      <div v-else-if="!currentList.length" class="farm-card-enhanced p-8 text-center opacity-60">
        <div class="i-carbon-warning text-3xl mx-auto" />
        <p class="mt-2 text-sm">暂无数据,等待账号活动...</p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="entry in currentList"
          :key="entry.accountId"
          class="farm-card-enhanced relative flex items-center gap-3 p-3"
        >
          <!-- 排名 -->
          <div
            class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-base font-black"
            :style="{
              background: rankColor(entry.rank),
              color: entry.rank <= 3 ? 'white' : 'var(--theme-text)',
            }"
          >
            <span v-if="entry.rank <= 3">{{ rankIcon(entry.rank) }}</span>
            <span v-else>{{ entry.rank }}</span>
          </div>

          <!-- 账号信息 -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <div class="truncate font-bold text-base">{{ entry.accountName }}</div>
              <span v-if="entry.running" class="i-carbon-circle-filled text-xs" style="color: #10b981" title="运行中" />
              <span v-else class="i-carbon-circle-filled text-xs opacity-40" title="未运行" />
            </div>
            <div class="text-xs opacity-60 flex items-center gap-2">
              <span>{{ entry.platform === 'wx' ? '微信' : 'QQ' }}</span>
              <span>·</span>
              <span>综合 {{ entry.score }} 分</span>
            </div>
          </div>

          <!-- 数值 + 进度条 -->
          <div class="flex-shrink-0 text-right">
            <div class="font-black text-lg" :style="{ color: 'var(--theme-primary)' }">
              {{ formatNumber(valueOf(entry)) }}
            </div>
            <div class="text-xs opacity-60">{{ valueLabel() }}</div>
          </div>

          <!-- 进度条背景 -->
          <div class="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden rounded-b-2xl" style="background: color-mix(in srgb, var(--theme-primary) 8%, transparent)">
            <div
              class="h-full transition-all"
              :style="{
                width: ((valueOf(entry) / maxValue) * 100) + '%',
                background: 'var(--theme-gradient)',
              }"
            />
          </div>
        </div>
      </div>

      <!-- 管理员快捷操作 -->
      <div v-if="userStore.isAdminPanelUser" class="farm-card-enhanced p-4">
        <div class="text-sm font-bold mb-2 opacity-80">⚙️ 管理员操作</div>
        <div class="flex flex-wrap gap-2">
          <button
            class="rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-105"
            style="background: var(--theme-gradient)"
            @click="regenerateReport()"
          >
            📊 重新生成昨日日报
          </button>
        </div>
        <p class="text-xs opacity-50 mt-2">* 重新生成会刷新 Dashboard 顶栏日报数据, 推送配置请到「设置」</p>
      </div>
    </div>
  </div>
</template>
