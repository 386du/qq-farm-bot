<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const accountStore = useAccountStore()
const userStore = useUserStore()
const toast = useToastStore()

const loading = ref(false)
const dateKey = ref<'today' | 'yesterday'>('today')
const activeTab = ref<'score' | 'gold' | 'steal' | 'harvest' | 'helpFarming' | 'guardDogDrop'>('score')
const data = ref<any>(null)
const report = ref<any>(null)
const lastRefreshedAt = ref<number>(0)
const lastRefreshedText = ref<string>('—')
const autoRefreshEnabled = ref(true)
const autoRefreshSeconds = 30
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null

async function fetchLeaderboard(silent = false) {
  loading.value = true
  try {
    // 始终用 refresh=1, 保证拿到运行中账号的最新内存数据
    const res = await api.get('/api/leaderboard', { params: { date: dateKey.value, refresh: 1 } })
    if (res.data.ok) {
      data.value = res.data.data
      lastRefreshedAt.value = Date.now()
      updateRefreshedText()
    }
    else {
      if (!silent) toast.error(res.data.error || '加载失败')
    }
  } catch (e: any) {
    if (!silent) toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function fetchReport(silent = false) {
  try {
    const res = await api.get('/api/report/daily', { params: { date: dateKey.value, refresh: 1 } })
    if (res.data.ok) {
      report.value = res.data.data
    }
  } catch (e: any) {
    if (!silent) {
      // ignore
    }
  }
}

async function refreshAll(silent = false) {
  await Promise.all([fetchLeaderboard(silent), fetchReport(silent)])
}

function updateRefreshedText() {
  if (!lastRefreshedAt.value) {
    lastRefreshedText.value = '—'
    return
  }
  const sec = Math.floor((Date.now() - lastRefreshedAt.value) / 1000)
  if (sec < 5) lastRefreshedText.value = '刚刚'
  else if (sec < 60) lastRefreshedText.value = `${sec} 秒前`
  else if (sec < 3600) lastRefreshedText.value = `${Math.floor(sec / 60)} 分钟前`
  else lastRefreshedText.value = new Date(lastRefreshedAt.value).toLocaleTimeString('zh-CN')
}

const tabs = [
  { key: 'score', label: '综合', icon: '🏆' },
  { key: 'gold', label: '金币', icon: '💰' },
  { key: 'steal', label: '偷菜', icon: '🥷' },
  { key: 'harvest', label: '收菜', icon: '🌾' },
  { key: 'helpFarming', label: '帮忙', icon: '🤝' },
  { key: 'guardDogDrop', label: '护主犬', icon: '🐶' },
] as const

const currentList = computed(() => {
  if (!data.value) return []
  if (activeTab.value === 'gold') return data.value.byGold || []
  if (activeTab.value === 'steal') return data.value.bySteal || []
  if (activeTab.value === 'harvest') return data.value.byHarvest || []
  if (activeTab.value === 'helpFarming') return data.value.byHelpFarming || []
  if (activeTab.value === 'guardDogDrop') return data.value.byGuardDogDrop || []
  return data.value.accounts || []
})

const maxValue = computed(() => {
  const list = currentList.value
  if (!list.length) return 1
  if (activeTab.value === 'gold') return Math.max(...list.map((e: any) => e.gold || 0), 1)
  if (activeTab.value === 'steal') return Math.max(...list.map((e: any) => e.stealCount || 0), 1)
  if (activeTab.value === 'harvest') return Math.max(...list.map((e: any) => e.harvestCount || 0), 1)
  if (activeTab.value === 'helpFarming') return Math.max(...list.map((e: any) => e.helpFarmingCount || 0), 1)
  if (activeTab.value === 'guardDogDrop') return Math.max(...list.map((e: any) => e.guardDogDropCount || 0), 1)
  return Math.max(...list.map((e: any) => e.score || 0), 1)
})

function valueOf(entry: any) {
  if (activeTab.value === 'gold') return entry.gold || 0
  if (activeTab.value === 'steal') return entry.stealCount || 0
  if (activeTab.value === 'harvest') return entry.harvestCount || 0
  if (activeTab.value === 'helpFarming') return entry.helpFarmingCount || 0
  if (activeTab.value === 'guardDogDrop') return entry.guardDogDropCount || 0
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
  if (activeTab.value === 'helpFarming') return '帮忙'
  if (activeTab.value === 'guardDogDrop') return '护主犬'
  return '得分'
}

function tabAccentColor() {
  if (activeTab.value === 'gold') return '#10b981'
  if (activeTab.value === 'steal') return '#8b5cf6'
  if (activeTab.value === 'harvest') return '#f59e0b'
  if (activeTab.value === 'helpFarming') return '#06b6d4'
  if (activeTab.value === 'guardDogDrop') return '#ef4444'
  return 'var(--theme-primary)'
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

function startAutoRefresh() {
  stopAutoRefresh()
  if (!autoRefreshEnabled.value) return
  autoRefreshTimer = setInterval(() => {
    if (autoRefreshEnabled.value) {
      refreshAll(true)
    }
  }, autoRefreshSeconds * 1000)
  // 每秒更新"X 秒前"文本
  tickTimer = setInterval(updateRefreshedText, 1000)
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
  }
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}

function toggleAutoRefresh() {
  autoRefreshEnabled.value = !autoRefreshEnabled.value
  if (autoRefreshEnabled.value) {
    startAutoRefresh()
    refreshAll(true)
    toast.success(`已开启自动刷新（每 ${autoRefreshSeconds} 秒）`)
  } else {
    stopAutoRefresh()
    toast.info('已关闭自动刷新')
  }
}

onMounted(() => {
  accountStore.fetchAccounts()
  refreshAll()
  startAutoRefresh()
})

onBeforeUnmount(() => {
  stopAutoRefresh()
})
</script>

<template>
  <div class="h-full overflow-y-auto p-4 pb-36">
    <div class="mx-auto max-w-4xl space-y-4">
      <!-- 顶部标题 -->
      <div class="farm-card-enhanced p-5">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h1 class="text-2xl font-black flex items-center gap-2">
              <span class="i-carbon-trophy text-3xl" style="color: var(--theme-primary)" />
              跨账号排行榜
              <span class="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold" style="background: rgba(16, 185, 129, 0.15); color: #10b981">
                <span class="i-carbon-circle-filled animate-pulse" />
                实时
              </span>
            </h1>
            <p class="text-sm opacity-70 mt-1">多账号挂机,谁与争锋</p>
          </div>
          <div class="flex flex-col items-end gap-1">
            <div class="flex items-center gap-1 rounded-lg p-1" style="background: color-mix(in srgb, var(--theme-primary) 8%, transparent)">
              <button
                class="rounded-md px-3 py-1 text-xs font-bold transition-all"
                :class="dateKey === 'yesterday' ? 'shadow' : 'opacity-60'"
                :style="dateKey === 'yesterday' ? { backgroundColor: 'var(--theme-primary)', color: 'white' } : {}"
                @click="dateKey = 'yesterday'; refreshAll()"
              >
                昨日
              </button>
              <button
                class="rounded-md px-3 py-1 text-xs font-bold transition-all"
                :class="dateKey === 'today' ? 'shadow' : 'opacity-60'"
                :style="dateKey === 'today' ? { backgroundColor: 'var(--theme-primary)', color: 'white' } : {}"
                @click="dateKey = 'today'; refreshAll()"
              >
                今日
              </button>
            </div>
            <span class="text-xs opacity-60">{{ data?.date || '加载中...' }}</span>
          </div>
        </div>

        <!-- 实时状态 + 刷新按钮 -->
        <div class="flex items-center justify-between gap-2 rounded-xl p-2" style="background: color-mix(in srgb, var(--theme-primary) 5%, transparent)">
          <div class="flex items-center gap-2 text-xs opacity-80">
            <span class="i-carbon-time" />
            <span>数据更新: <span class="font-bold">{{ lastRefreshedText }}</span></span>
            <span v-if="autoRefreshEnabled" class="text-xs" style="color: #10b981">· 每 {{ autoRefreshSeconds }}s 自动刷新</span>
            <span v-else class="text-xs opacity-50">· 自动刷新已关闭</span>
          </div>
          <div class="flex items-center gap-1">
            <button
              class="rounded-lg px-2 py-1 text-xs font-bold transition-all hover:scale-105"
              :style="autoRefreshEnabled ? { background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' } : { background: 'rgba(107, 114, 128, 0.15)', color: '#6b7280' }"
              :title="autoRefreshEnabled ? '关闭自动刷新' : '开启自动刷新'"
              @click="toggleAutoRefresh"
            >
              <span v-if="autoRefreshEnabled" class="i-carbon-pause-filled" />
              <span v-else class="i-carbon-play-filled-alt" />
              {{ autoRefreshEnabled ? '自动' : '手动' }}
            </button>
            <button
              class="rounded-lg px-2 py-1 text-xs font-bold transition-all hover:scale-105"
              style="background: var(--theme-gradient); color: white"
              :class="loading ? 'animate-pulse' : ''"
              :disabled="loading"
              @click="refreshAll()"
            >
              <span v-if="loading" class="i-svg-spinners-90-ring-with-bg" />
              <span v-else class="i-carbon-refresh" />
              刷新
            </button>
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

        <!-- 三王 + 护主犬王 -->
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
          :style="activeTab === tab.key ? { backgroundColor: tab.key === 'score' ? 'var(--theme-primary)' : tabAccentColor(), color: 'white' } : { background: 'color-mix(in srgb, var(--theme-bg) 60%, transparent)' }"
          @click="activeTab = tab.key"
        >
          <span>{{ tab.icon }}</span>
          <span>{{ tab.label }}</span>
        </button>
      </div>

      <!-- 排行榜列表 -->
      <div v-if="loading && !data" class="farm-card-enhanced p-8 text-center opacity-60">
        <div class="i-carbon-circle-dash animate-spin text-2xl mx-auto" />
        <p class="mt-2 text-sm">加载中...</p>
      </div>

      <div v-else-if="!currentList.length" class="farm-card-enhanced p-8 text-center opacity-60">
        <div class="i-carbon-warning text-3xl mx-auto" />
        <p class="mt-2 text-sm">暂无数据,等待账号活动...</p>
        <p class="text-xs opacity-50 mt-1">数据来自各账号 worker 落盘的 stats 文件</p>
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
              <span v-if="entry.lastSavedAt">·</span>
              <span v-if="entry.lastSavedAt" class="opacity-50">存盘 {{ new Date(entry.lastSavedAt).toLocaleTimeString('zh-CN') }}</span>
            </div>
          </div>

          <!-- 数值 + 进度条 -->
          <div class="flex-shrink-0 text-right">
            <div class="font-black text-lg" :style="{ color: tabAccentColor() }">
              {{ formatNumber(valueOf(entry)) }}
            </div>
            <div class="text-xs opacity-60">
              {{ valueLabel() }}
            </div>
          </div>

          <!-- 进度条背景 -->
          <div class="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden rounded-b-2xl" :style="{ background: `color-mix(in srgb, ${tabAccentColor()} 12%, transparent)` }">
            <div
              class="h-full transition-all"
              :style="{
                width: ((valueOf(entry) / maxValue) * 100) + '%',
                background: tabAccentColor(),
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
          <button
            class="rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-105"
            style="background: linear-gradient(135deg, #10b981 0%, #059669 100%)"
            @click="refreshAll()"
          >
            🔄 立即刷新
          </button>
        </div>
        <p class="text-xs opacity-50 mt-2">* 数据始终从磁盘实时重算，每次刷新也会强制各 worker flush 最新内存统计</p>
      </div>
    </div>
  </div>
</template>
