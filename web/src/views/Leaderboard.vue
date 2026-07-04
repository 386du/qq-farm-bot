<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const accountStore = useAccountStore()
const userStore = useUserStore()
const toast = useToastStore()

type DateKey = 'today' | 'yesterday'
type TabKey = 'score' | 'gold' | 'steal' | 'harvest' | 'helpFarming' | 'guardDogDrop'

const loading = ref(false)
const reportLoading = ref(false)
const regenerating = ref(false)
const dateKey = ref<DateKey>('today')
const activeTab = ref<TabKey>('score')
const data = ref<any>(null)
const report = ref<any>(null)
const lastRefreshedAt = ref<number>(0)
const lastRefreshedText = ref<string>('—')
const autoRefreshEnabled = ref(true)
const autoRefreshSeconds = 30

// 防止请求堆积：用一个 requestSeq 标识"最新一次"，旧的响应会被丢弃
let requestSeq = 0
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null

const showRegenerateConfirm = ref(false)

const tabs: Array<{ key: TabKey, label: string, icon: string }> = [
  { key: 'score', label: '综合', icon: '🏆' },
  { key: 'gold', label: '金币', icon: '💰' },
  { key: 'steal', label: '偷菜', icon: '🥷' },
  { key: 'harvest', label: '收菜', icon: '🌾' },
  { key: 'helpFarming', label: '帮忙', icon: '🤝' },
  { key: 'guardDogDrop', label: '护主犬', icon: '🐶' },
]

// 把服务端返回的 "today"/"yesterday"/"YYYY-MM-DD" 统一为 YYYY-MM-DD
function resolveDateKey(param: DateKey | string): string {
  if (param === 'today')
    return todayKey()
  if (param === 'yesterday')
    return yesterdayKey()
  return String(param)
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function yesterdayKey(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 当前显示的日期标签 (今天/昨天) + 实际日期
const currentDateLabel = computed(() => dateKey.value === 'today' ? '今日' : '昨日')
const currentDateValue = computed(() => resolveDateKey(dateKey.value))

async function fetchLeaderboard(silent = false) {
  const mySeq = ++requestSeq
  loading.value = true
  try {
    // 始终用 refresh=1, 保证拿到运行中账号的最新内存数据
    const res = await api.get('/api/leaderboard', { params: { date: currentDateValue.value, refresh: 1 } })
    if (mySeq !== requestSeq)
      return
    if (res.data.ok) {
      data.value = res.data.data
      lastRefreshedAt.value = Date.now()
      updateRefreshedText()
    }
    else {
      if (!silent)
        toast.error(res.data.error || '加载失败')
    }
  }
  catch (e: any) {
    if (mySeq !== requestSeq)
      return
    if (!silent)
      toast.error(e.message || '加载失败')
  }
  finally {
    if (mySeq === requestSeq)
      loading.value = false
  }
}

async function fetchReport(silent = false) {
  const mySeq = requestSeq
  reportLoading.value = true
  try {
    const res = await api.get('/api/report/daily', { params: { date: currentDateValue.value, refresh: 1 } })
    if (mySeq !== requestSeq)
      return
    if (res.data.ok) {
      report.value = res.data.data
    }
  }
  catch {
    if (mySeq !== requestSeq)
      return
    if (!silent) {
      // ignore
    }
  }
  finally {
    if (mySeq === requestSeq)
      reportLoading.value = false
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
  if (sec < 5)
    lastRefreshedText.value = '刚刚'
  else if (sec < 60)
    lastRefreshedText.value = `${sec} 秒前`
  else if (sec < 3600)
    lastRefreshedText.value = `${Math.floor(sec / 60)} 分钟前`
  else lastRefreshedText.value = new Date(lastRefreshedAt.value).toLocaleTimeString('zh-CN')
}

const currentList = computed(() => {
  if (!data.value)
    return []
  if (activeTab.value === 'gold')
    return data.value.byGold || []
  if (activeTab.value === 'steal')
    return data.value.bySteal || []
  if (activeTab.value === 'harvest')
    return data.value.byHarvest || []
  if (activeTab.value === 'helpFarming')
    return data.value.byHelpFarming || []
  if (activeTab.value === 'guardDogDrop')
    return data.value.byGuardDogDrop || []
  return data.value.accounts || []
})

const maxValue = computed(() => {
  const list = currentList.value
  if (!list.length)
    return 1
  let max = 0
  for (const e of list) {
    const v = valueOf(e)
    if (v > max)
      max = v
  }
  return max > 0 ? max : 1
})

function valueOf(entry: any) {
  if (!entry)
    return 0
  if (activeTab.value === 'gold')
    return entry.gold || 0
  if (activeTab.value === 'steal')
    return entry.stealCount || 0
  if (activeTab.value === 'harvest')
    return entry.harvestCount || 0
  if (activeTab.value === 'helpFarming')
    return entry.helpFarmingCount || 0
  if (activeTab.value === 'guardDogDrop')
    return entry.guardDogDropCount || 0
  return entry.score || 0
}

function formatNumber(n: number) {
  return (n || 0).toLocaleString('zh-CN')
}

function rankIcon(rank: number) {
  if (rank === 1)
    return '🥇'
  if (rank === 2)
    return '🥈'
  if (rank === 3)
    return '🥉'
  return `${rank}`
}

function rankColor(rank: number) {
  if (rank === 1)
    return 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)'
  if (rank === 2)
    return 'linear-gradient(135deg, #d1d5db 0%, #9ca3af 100%)'
  if (rank === 3)
    return 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)'
  return 'color-mix(in srgb, var(--theme-primary) 12%, transparent)'
}

const valueLabel = computed(() => {
  if (activeTab.value === 'gold')
    return '金币'
  if (activeTab.value === 'steal')
    return '偷菜'
  if (activeTab.value === 'harvest')
    return '收菜'
  if (activeTab.value === 'helpFarming')
    return '帮忙'
  if (activeTab.value === 'guardDogDrop')
    return '护主犬'
  return '得分'
})

const tabAccentColor = computed(() => {
  if (activeTab.value === 'gold')
    return '#10b981'
  if (activeTab.value === 'steal')
    return '#8b5cf6'
  if (activeTab.value === 'harvest')
    return '#f59e0b'
  if (activeTab.value === 'helpFarming')
    return '#06b6d4'
  if (activeTab.value === 'guardDogDrop')
    return '#ef4444'
  return 'var(--theme-primary)'
})

const tabAccentSoft = computed(() => `color-mix(in srgb, ${tabAccentColor.value} 12%, transparent)`)

function platformLabel(p: string) {
  if (p === 'wx')
    return '微信'
  if (p === 'qq')
    return 'QQ'
  return p || '未知'
}

function progressWidth(entry: any): string {
  const v = valueOf(entry)
  const max = maxValue.value
  if (!max || max <= 1)
    return '0%'
  return `${Math.min(100, Math.max(0, (v / max) * 100))}%`
}

// ============ 重新生成日报 (跟随当前 dateKey) ============
function askRegenerate() {
  if (regenerating.value)
    return
  showRegenerateConfirm.value = true
}

async function confirmRegenerate() {
  if (regenerating.value)
    return
  regenerating.value = true
  try {
    // 用 POST 调专用重算接口, 跟随当前 dateKey
    const res = await api.post('/api/admin/report/regenerate', null, {
      params: { date: currentDateValue.value },
    })
    if (res.data.ok) {
      toast.success(`${currentDateLabel.value}日报已重新生成`)
      // 重新拉一次当前视图 (会从磁盘读最新落盘结果)
      await refreshAll(true)
    }
    else {
      toast.error(res.data.error || '生成失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '生成失败')
  }
  finally {
    regenerating.value = false
    showRegenerateConfirm.value = false
  }
}

// ============ 自动刷新 / tick 计时 ============
function startAutoRefresh() {
  stopAutoRefresh()
  if (autoRefreshEnabled.value) {
    autoRefreshTimer = setInterval(() => {
      if (autoRefreshEnabled.value) {
        refreshAll(true)
      }
    }, autoRefreshSeconds * 1000)
  }
  // tick 永远在跑, 即便关闭自动刷新也要让 "X 秒前" 文本继续推进, 否则会被冻结
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
  }
  else {
    startAutoRefresh() // 只重启 tick, 不重启数据刷新
    toast.info('已关闭自动刷新')
  }
}

// ============ 切换日期 tab ============
async function changeDateKey(next: DateKey) {
  if (dateKey.value === next)
    return
  dateKey.value = next
  // 清空旧数据, 避免短暂展示上一份
  data.value = null
  report.value = null
  lastRefreshedAt.value = 0
  lastRefreshedText.value = '—'
  await refreshAll()
}

// 切换日期时自动重新拉取
watch(dateKey, async (next) => {
  // 已在 changeDateKey 内处理, 这里做兜底, 避免直接改 ref 时漏刷
  if (data.value && data.value.date !== resolveDateKey(next)) {
    data.value = null
    report.value = null
    await refreshAll()
  }
})

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
        <div class="mb-3 flex items-center justify-between">
          <div>
            <h1 class="flex items-center gap-2 text-2xl font-black">
              <span class="i-carbon-trophy text-3xl" style="color: var(--theme-primary)" />
              跨账号排行榜
              <span class="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold" style="background: rgba(16, 185, 129, 0.15); color: #10b981">
                <span class="i-carbon-circle-filled animate-pulse" />
                实时
              </span>
            </h1>
            <p class="mt-1 text-sm opacity-70">
              多账号挂机,谁与争锋
            </p>
          </div>
          <div class="flex flex-col items-end gap-1">
            <div class="flex items-center gap-1 rounded-lg p-1" style="background: color-mix(in srgb, var(--theme-primary) 8%, transparent)">
              <button
                class="rounded-md px-3 py-1 text-xs font-bold transition-all"
                :class="dateKey === 'yesterday' ? 'shadow' : 'opacity-60'"
                :style="dateKey === 'yesterday' ? { backgroundColor: 'var(--theme-primary)', color: 'white' } : {}"
                @click="changeDateKey('yesterday')"
              >
                昨日
              </button>
              <button
                class="rounded-md px-3 py-1 text-xs font-bold transition-all"
                :class="dateKey === 'today' ? 'shadow' : 'opacity-60'"
                :style="dateKey === 'today' ? { backgroundColor: 'var(--theme-primary)', color: 'white' } : {}"
                @click="changeDateKey('today')"
              >
                今日
              </button>
            </div>
            <span class="text-xs opacity-60">{{ data?.date || currentDateValue || '加载中...' }}</span>
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
              class="rounded-lg px-2 py-1 text-xs font-bold transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
              style="background: var(--theme-gradient); color: white"
              :disabled="loading"
              :title="loading ? '刷新中…' : '立即刷新'"
              @click="refreshAll()"
            >
              <span v-if="loading" class="i-svg-spinners-90-ring-with-bg" />
              <span v-else class="i-carbon-refresh" />
              刷新
            </button>
          </div>
        </div>

        <!-- 日报概览 -->
        <div v-if="report" class="grid grid-cols-2 mt-3 gap-3 sm:grid-cols-4">
          <div class="rounded-xl p-3" style="background: color-mix(in srgb, var(--theme-primary) 8%, transparent)">
            <div class="text-xs opacity-70">
              活跃账号
            </div>
            <div class="mt-0.5 text-xl font-black" style="color: var(--theme-primary)">
              {{ report.activeAccounts }}<span class="text-sm opacity-60">/{{ report.totalAccounts }}</span>
            </div>
          </div>
          <div class="rounded-xl p-3" style="background: color-mix(in srgb, #f59e0b 8%, transparent)">
            <div class="text-xs opacity-70">
              收菜
            </div>
            <div class="mt-0.5 text-xl font-black" style="color: #f59e0b">
              🌾 {{ formatNumber(report.totals.harvest) }}
            </div>
          </div>
          <div class="rounded-xl p-3" style="background: color-mix(in srgb, #8b5cf6 8%, transparent)">
            <div class="text-xs opacity-70">
              偷菜
            </div>
            <div class="mt-0.5 text-xl font-black" style="color: #8b5cf6">
              🥷 {{ formatNumber(report.totals.steal) }}
            </div>
          </div>
          <div class="rounded-xl p-3" style="background: color-mix(in srgb, #10b981 8%, transparent)">
            <div class="text-xs opacity-70">
              金币
            </div>
            <div class="mt-0.5 text-xl font-black" style="color: #10b981">
              💰 {{ formatNumber(report.totals.gold) }}
            </div>
          </div>
        </div>

        <!-- 三王 + 护主犬王 -->
        <div v-if="report && (report.mvpAccount || report.harvestKingAccount || report.stealKingAccount)" class="grid grid-cols-3 mt-3 gap-3">
          <div v-if="report.mvpAccount" class="rounded-xl p-3 text-center" style="background: color-mix(in srgb, #fbbf24 15%, transparent); border: 1px solid #fbbf24 30%">
            <div class="text-2xl">
              🏆
            </div>
            <div class="mt-1 text-xs opacity-70">
              综合冠军
            </div>
            <div class="mt-0.5 truncate text-sm font-bold">
              {{ report.mvpAccount.accountName }}
            </div>
            <div class="text-xs opacity-60">
              {{ report.mvpAccount.score }} 分
            </div>
          </div>
          <div v-if="report.harvestKingAccount" class="rounded-xl p-3 text-center" style="background: color-mix(in srgb, #f59e0b 15%, transparent); border: 1px solid #f59e0b 30%">
            <div class="text-2xl">
              🌾
            </div>
            <div class="mt-1 text-xs opacity-70">
              收菜之王
            </div>
            <div class="mt-0.5 truncate text-sm font-bold">
              {{ report.harvestKingAccount.accountName }}
            </div>
            <div class="text-xs opacity-60">
              {{ report.harvestKingAccount.harvest }} 次
            </div>
          </div>
          <div v-if="report.stealKingAccount" class="rounded-xl p-3 text-center" style="background: color-mix(in srgb, #8b5cf6 15%, transparent); border: 1px solid #8b5cf6 30%">
            <div class="text-2xl">
              🥷
            </div>
            <div class="mt-1 text-xs opacity-70">
              偷菜之王
            </div>
            <div class="mt-0.5 truncate text-sm font-bold">
              {{ report.stealKingAccount.accountName }}
            </div>
            <div class="text-xs opacity-60">
              {{ report.stealKingAccount.steal }} 次
            </div>
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
          :style="activeTab === tab.key ? { backgroundColor: tab.key === 'score' ? 'var(--theme-primary)' : tabAccentColor, color: 'white' } : { background: 'color-mix(in srgb, var(--theme-bg) 60%, transparent)' }"
          @click="activeTab = tab.key"
        >
          <span>{{ tab.icon }}</span>
          <span>{{ tab.label }}</span>
        </button>
      </div>

      <!-- 排行榜列表 -->
      <div v-if="loading && !data" class="farm-card-enhanced p-8 text-center opacity-60">
        <div class="i-carbon-circle-dash mx-auto animate-spin text-2xl" />
        <p class="mt-2 text-sm">
          加载中...
        </p>
      </div>

      <div v-else-if="!currentList.length" class="farm-card-enhanced p-8 text-center opacity-60">
        <div class="i-carbon-warning mx-auto text-3xl" />
        <p class="mt-2 text-sm">
          {{ currentDateLabel }}暂无{{ valueLabel }}数据,等待账号活动...
        </p>
        <p class="mt-1 text-xs opacity-50">
          数据来自各账号 worker 落盘的 stats 文件
        </p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="entry in currentList"
          :key="entry.accountId"
          class="farm-card-enhanced relative flex items-center gap-3 p-3"
        >
          <!-- 排名 -->
          <div
            class="h-10 w-10 flex flex-shrink-0 items-center justify-center rounded-xl text-base font-black"
            :style="{
              background: rankColor(entry.rank),
              color: entry.rank <= 3 ? 'white' : 'var(--theme-text)',
            }"
          >
            <span v-if="entry.rank <= 3">{{ rankIcon(entry.rank) }}</span>
            <span v-else>{{ entry.rank }}</span>
          </div>

          <!-- 账号信息 -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <div class="truncate text-base font-bold">
                {{ entry.accountName }}
              </div>
              <span v-if="entry.running" class="i-carbon-circle-filled text-xs" style="color: #10b981" title="运行中" />
              <span v-else class="i-carbon-circle-filled text-xs opacity-40" title="未运行" />
            </div>
            <div class="flex items-center gap-2 text-xs opacity-60">
              <span>{{ platformLabel(entry.platform) }}</span>
              <span>·</span>
              <span>综合 {{ entry.score }} 分</span>
              <template v-if="entry.lastSavedAt">
                <span>·</span>
                <span class="opacity-50">存盘 {{ new Date(entry.lastSavedAt).toLocaleTimeString('zh-CN') }}</span>
              </template>
            </div>
          </div>

          <!-- 数值 + 进度条 -->
          <div class="flex-shrink-0 text-right">
            <div class="text-lg font-black" :style="{ color: tabAccentColor }">
              {{ formatNumber(valueOf(entry)) }}
            </div>
            <div class="text-xs opacity-60">
              {{ valueLabel }}
            </div>
          </div>

          <!-- 进度条背景 -->
          <div class="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden rounded-b-2xl" :style="{ background: tabAccentSoft }">
            <div
              class="h-full transition-all"
              :style="{
                width: progressWidth(entry),
                background: tabAccentColor,
              }"
            />
          </div>
        </div>
      </div>

      <!-- 管理员快捷操作 -->
      <div v-if="userStore.isAdminPanelUser" class="farm-card-enhanced p-4">
        <div class="mb-2 text-sm font-bold opacity-80">
          ⚙️ 管理员操作
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            class="rounded-xl px-4 py-2 text-sm text-white font-bold transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
            style="background: var(--theme-gradient)"
            :disabled="regenerating"
            :title="regenerating ? '正在生成…' : `重新生成${currentDateLabel}日报`"
            @click="askRegenerate"
          >
            <span v-if="regenerating" class="i-svg-spinners-90-ring-with-bg mr-1" />
            <span v-else>📊</span>
            重新生成{{ currentDateLabel }}日报
          </button>
          <button
            class="rounded-xl px-4 py-2 text-sm text-white font-bold transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
            style="background: linear-gradient(135deg, #10b981 0%, #059669 100%)"
            :disabled="loading"
            @click="refreshAll()"
          >
            <span v-if="loading" class="i-svg-spinners-90-ring-with-bg mr-1" />
            <span v-else>🔄</span>
            立即刷新
          </button>
        </div>
        <p class="mt-2 text-xs opacity-50">
          * 数据始终从磁盘实时重算，每次刷新也会强制各 worker flush 最新内存统计
        </p>
      </div>
    </div>

    <ConfirmModal
      :show="showRegenerateConfirm"
      :loading="regenerating"
      title="重新生成日报"
      :message="`确认要重新生成 ${currentDateLabel}（${currentDateValue}）的日报数据吗？`"
      @confirm="confirmRegenerate"
      @cancel="!regenerating && (showRegenerateConfirm = false)"
    />
  </div>
</template>
