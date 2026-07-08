<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useAccountStore } from '@/stores/account'
import { useActivityStore, type ActivityBattlePass, type ActivityShopGood } from '@/stores/activity'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const activityStore = useActivityStore()
const statusStore = useStatusStore()
const toast = useToastStore()

const { currentAccount } = storeToRefs(accountStore)
const { name, currencies, crops, items, summary, loading, lastError } = storeToRefs(activityStore)

const accountRef = computed(() => currentAccount.value?.id || currentAccount.value?.uin || '')
const accountRunning = computed(() => {
  const s = statusStore.status
  return !!(s && s.connection && s.connection.connected)
})

type Tab = 'overview' | 'lottery' | 'shop' | 'checkin'
const activeTab = ref<Tab>('overview')

const showPaidConfirm = ref(false)
const paidCount = ref(1)

const imageErrors = ref<Set<number>>(new Set())

const liveLottery = computed(() => activityStore.liveLottery)
const liveShop = computed<ActivityShopGood[]>(() => activityStore.liveShop || [])
const liveSignin = computed(() => activityStore.liveSignin)
const liveBattlePass = computed<ActivityBattlePass | null>(() => activityStore.liveBattlePass)

async function reload() {
  if (!accountRef.value) {
    toast.warning('请先选择账号')
    return
  }
  if (!accountRunning.value) {
    toast.warning('账号未运行,无法获取活动数据')
    return
  }
  await activityStore.fetchOverview(name.value)
  activityStore.refreshLiveFromCache()
}

async function drawFree(count: number = 1) {
  if (!accountRef.value || !accountRunning.value) {
    toast.warning('账号未运行')
    return
  }
  const r = await activityStore.drawLottery({ mode: 'free', count })
  if (r) {
    await activityStore.fetchOverview(name.value)
    activityStore.refreshLiveFromCache()
  }
}

function tryPaid(count: number = 1) {
  if (!accountRef.value || !accountRunning.value) {
    toast.warning('账号未运行')
    return
  }
  paidCount.value = count
  showPaidConfirm.value = true
}

async function confirmPaid() {
  showPaidConfirm.value = false
  const r = await activityStore.drawLottery({ mode: 'paid', count: paidCount.value, allowPaid: true })
  if (r) {
    await activityStore.fetchOverview(name.value)
    activityStore.refreshLiveFromCache()
  }
}

async function buyShop(g: ActivityShopGood) {
  if (!accountRef.value || !accountRunning.value) {
    toast.warning('账号未运行')
    return
  }
  if (g.soldOut) return
  const r = await activityStore.exchange(g.id, 1)
  if (r) {
    await activityStore.fetchOverview(name.value)
    activityStore.refreshLiveFromCache()
  }
}

async function claimSignin() {
  if (!accountRef.value || !accountRunning.value) {
    toast.warning('账号未运行')
    return
  }
  const r = await activityStore.claimDailySignin()
  if (r) {
    await activityStore.fetchOverview(name.value)
    activityStore.refreshLiveFromCache()
  }
}

async function claimBattlePass() {
  if (!accountRef.value || !accountRunning.value) {
    toast.warning('账号未运行')
    return
  }
  const r = await activityStore.claimBattlePass()
  if (r) {
    await activityStore.fetchOverview(name.value)
    activityStore.refreshLiveFromCache()
  }
}

async function claimTasks() {
  if (!accountRef.value || !accountRunning.value) {
    toast.warning('账号未运行')
    return
  }
  const r = await activityStore.claimTasks()
  if (r) {
    await activityStore.fetchOverview(name.value)
    activityStore.refreshLiveFromCache()
  }
}

function costText(g: ActivityShopGood): string {
  if (!g.cost || g.cost.length === 0) return '免费'
  return g.cost.map(c => `${c.name} x${c.count}`).join(' + ')
}

function qualityColor(q: number): string {
  if (q >= 5) return 'text-amber-400'
  if (q === 4) return 'text-purple-400'
  if (q === 3) return 'text-blue-400'
  if (q === 2) return 'text-green-400'
  return 'text-gray-400'
}

function qualityBg(q: number): string {
  if (q >= 5) return 'bg-amber-100 dark:bg-amber-900/40'
  if (q === 4) return 'bg-purple-100 dark:bg-purple-900/40'
  if (q === 3) return 'bg-blue-100 dark:bg-blue-900/40'
  if (q === 2) return 'bg-green-100 dark:bg-green-900/40'
  return 'bg-gray-100 dark:bg-gray-800/40'
}

function formatExp(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`
  return String(value)
}

const tabs = computed(() => {
  const list: Array<{ key: Tab, label: string, icon: string, badge?: number }> = [
    { key: 'overview', label: '概览', icon: 'i-carbon-view' },
  ]
  if (liveLottery.value) {
    list.push({ key: 'lottery', label: '奇遇礼莲', icon: 'i-carbon-currency', badge: liveLottery.value.totalRemaining })
  }
  if (liveShop.value.length > 0) {
    list.push({ key: 'shop', label: '商店兑换', icon: 'i-carbon-purchase', badge: liveShop.value.length })
  }
  if (liveSignin.value || liveBattlePass.value) {
    list.push({
      key: 'checkin',
      label: '签到/战令',
      icon: 'i-carbon-task',
      badge: (liveSignin.value && !liveSignin.value.claimedToday ? 1 : 0) + (liveBattlePass.value?.claimableCount || 0),
    })
  }
  return list
})

onMounted(() => {
  if (accountRef.value && accountRunning.value) reload()
})

onActivated(() => {
  if (accountRef.value && accountRunning.value && currencies.value.length === 0 && crops.value.length === 0) {
    reload()
  }
})

watch(() => currentAccount.value?.id || currentAccount.value?.uin || '', async (v) => {
  if (v && accountRunning.value) await reload()
  else if (!v) {
    activityStore.currencies = []
    activityStore.crops = []
    activityStore.items = []
  }
})

watch(() => statusStore.status?.connection?.connected, async (v) => {
  if (v && accountRef.value && currencies.value.length === 0) await reload()
})
</script>

<template>
  <div class="h-full flex flex-col p-4">
    <!-- Header -->
    <div class="farm-card-enhanced mb-3 overflow-hidden p-3">
      <div class="flex items-center gap-3">
        <div class="h-9 w-9 flex items-center justify-center rounded-xl" style="background: var(--theme-primary);">
          <div class="i-fas-spa text-xl text-white" />
        </div>
        <div class="flex-1">
          <div class="text-base font-bold" :style="{ color: 'var(--theme-text)' }">
            {{ name }}
          </div>
          <div class="text-xs opacity-70" :style="{ color: 'var(--theme-text)' }">
            道具 · 种子 · 代币 · 抽奖 · 战令 · 任务
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="liveSignin && !liveSignin.claimedToday"
            class="rounded-xl border px-2.5 py-1.5 text-xs font-medium transition hover:opacity-80"
            :style="{ borderColor: 'var(--theme-primary)', color: 'var(--theme-primary)' }"
            :disabled="activityStore.isBusy('daily-signin')"
            @click="claimSignin"
          >
            <div v-if="activityStore.isBusy('daily-signin')" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
            领每日赠礼
          </button>
          <button
            v-if="liveBattlePass && liveBattlePass.claimableCount > 0"
            class="rounded-xl border px-2.5 py-1.5 text-xs font-medium transition hover:opacity-80"
            :style="{ borderColor: 'var(--theme-primary)', color: 'var(--theme-primary)' }"
            :disabled="activityStore.isBusy('battle-pass')"
            @click="claimBattlePass"
          >
            <div v-if="activityStore.isBusy('battle-pass')" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
            战令({{ liveBattlePass.claimableCount }})
          </button>
          <button
            class="rounded-xl bg-emerald-500 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            :disabled="activityStore.isBusy('tasks')"
            @click="claimTasks"
          >
            <div v-if="activityStore.isBusy('tasks')" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
            一键领任务
          </button>
          <button
            class="rounded-xl px-3 py-1.5 text-sm font-medium text-white shadow transition disabled:opacity-50"
            :style="{ background: 'var(--theme-primary)' }"
            :disabled="loading || !accountRef || !accountRunning"
            @click="reload"
          >
            <div v-if="loading" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
            <div v-else class="i-carbon-renew mr-1 inline-block align-text-bottom" />
            刷新
          </button>
        </div>
      </div>

      <!-- Tabs -->
      <div v-if="tabs.length > 1" class="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="rounded-xl px-3 py-1.5 text-xs font-medium transition"
          :class="activeTab === t.key ? 'text-white shadow' : 'hover:opacity-80'"
          :style="activeTab === t.key
            ? { background: 'var(--theme-primary)' }
            : { background: 'color-mix(in srgb, var(--theme-text) 8%, transparent)', color: 'var(--theme-text)' }"
          @click="activeTab = t.key"
        >
          <div :class="t.icon" class="mr-1 inline-block align-text-bottom" />
          {{ t.label }}
          <span v-if="t.badge && t.badge > 0" class="ml-1 rounded bg-rose-500 px-1 text-[10px] text-white">
            {{ t.badge }}
          </span>
        </button>
      </div>
    </div>

    <!-- Empty / error -->
    <div v-if="!accountRef" class="flex-1 flex items-center justify-center text-sm opacity-60">
      请先在左侧选择一个账号
    </div>
    <div v-else-if="!accountRunning" class="flex-1 flex items-center justify-center text-sm opacity-60">
      账号未运行,无法拉取活动数据
    </div>
    <div v-else-if="loading && currencies.length === 0 && crops.length === 0 && items.length === 0" class="flex-1 flex items-center justify-center text-sm opacity-60">
      <div class="i-svg-spinners-90-ring-with-bg mr-2 text-xl" />
      正在拉取活动数据...
    </div>
    <div v-else-if="lastError" class="flex-1 flex items-center justify-center text-sm text-red-500">
      {{ lastError }}
    </div>

    <!-- Content -->
    <div v-else class="custom-scrollbar flex-1 overflow-y-auto">
      <!-- OVERVIEW TAB -->
      <div v-if="activeTab === 'overview'" class="space-y-3">
        <!-- Currencies -->
        <div v-if="currencies.length > 0" class="farm-card-enhanced overflow-hidden rounded-2xl p-3">
          <div class="mb-2 flex items-center gap-2">
            <div class="i-carbon-currency text-lg" :style="{ color: 'var(--theme-primary)' }" />
            <span class="text-sm font-bold" :style="{ color: 'var(--theme-text)' }">活动代币</span>
            <span class="text-xs opacity-60">({{ currencies.length }})</span>
          </div>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <div
              v-for="c in currencies"
              :key="c.id"
              class="flex items-center gap-2.5 rounded-xl p-2"
              :style="{ background: 'color-mix(in srgb, var(--theme-primary) 8%, transparent)' }"
            >
              <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/50 dark:bg-gray-800/40">
                <img
                  v-if="c.image && !imageErrors.has(c.id)"
                  :src="c.image"
                  :alt="c.name"
                  class="max-h-full max-w-full object-contain"
                  loading="lazy"
                  @error="imageErrors.add(c.id)"
                >
                <div v-else class="i-carbon-currency opacity-40" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-xs font-medium" :style="{ color: 'var(--theme-text)' }">
                  {{ c.name }}
                </div>
                <div class="text-lg font-bold" :style="{ color: 'var(--theme-primary)' }">
                  {{ c.count }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Crops (seeds + fruits) -->
        <div v-if="crops.length > 0" class="farm-card-enhanced overflow-hidden rounded-2xl p-3">
          <div class="mb-2 flex items-center gap-2">
            <div class="i-carbon-sprout text-lg" :style="{ color: 'var(--theme-primary)' }" />
            <span class="text-sm font-bold" :style="{ color: 'var(--theme-text)' }">活动种子 / 果实</span>
            <span class="text-xs opacity-60">({{ crops.length }})</span>
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="crop in crops"
              :key="crop.plantId"
              class="flex items-center gap-3 rounded-xl p-2.5"
              :style="{ background: 'color-mix(in srgb, var(--theme-text) 4%, transparent)' }"
            >
              <div class="h-12 w-12 flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/50 dark:bg-gray-800/40">
                <img
                  v-if="crop.image"
                  :src="crop.image"
                  :alt="crop.seedName"
                  class="max-h-full max-w-full object-contain"
                  loading="lazy"
                  @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
                >
                <div v-else class="i-carbon-cube opacity-40" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="truncate text-sm font-bold" :style="{ color: 'var(--theme-text)' }">
                    {{ crop.name }}
                  </span>
                  <span v-if="crop.growTimeText" class="text-[10px] opacity-60">
                    {{ crop.growTimeText }}
                  </span>
                </div>
                <div class="mt-0.5 flex items-center gap-2 text-[11px] opacity-70">
                  <span class="rounded bg-emerald-100 px-1 dark:bg-emerald-900/30" :title="crop.seedName">
                    种子 ×{{ crop.seedCount }}
                  </span>
                  <span class="rounded bg-amber-100 px-1 dark:bg-amber-900/30" :title="crop.fruitName">
                    果实 ×{{ crop.fruitCount }}
                  </span>
                  <span v-if="crop.price > 0" class="opacity-50">
                    {{ crop.price }} {{ crop.priceUnit }}/个
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Other items -->
        <div v-if="items.length > 0" class="farm-card-enhanced overflow-hidden rounded-2xl p-3">
          <div class="mb-2 flex items-center gap-2">
            <div class="i-carbon-box text-lg" :style="{ color: 'var(--theme-primary)' }" />
            <span class="text-sm font-bold" :style="{ color: 'var(--theme-text)' }">活动道具 / 奖励</span>
            <span class="text-xs opacity-60">({{ items.length }})</span>
          </div>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <div
              v-for="it in items"
              :key="it.id"
              class="flex items-center gap-2 rounded-xl p-2"
              :style="{ background: 'color-mix(in srgb, var(--theme-text) 4%, transparent)' }"
            >
              <div class="h-8 w-8 flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/50 dark:bg-gray-800/40">
                <img
                  v-if="it.image"
                  :src="it.image"
                  :alt="it.name"
                  class="max-h-full max-w-full object-contain"
                  loading="lazy"
                  @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
                >
                <div v-else class="i-carbon-cube opacity-40" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[11px] font-medium" :style="{ color: 'var(--theme-text)' }" :title="it.name">
                  {{ it.name }}
                </div>
                <div class="text-xs opacity-60">
                  ×{{ it.count }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="!summary || (summary.cropCount || 0) + (summary.itemCount || 0) === 0" class="farm-card-enhanced overflow-hidden rounded-2xl p-6 text-center text-sm opacity-60">
          当前账号没有匹配到 {{ name }} 的道具
        </div>
      </div>

      <!-- LOTTERY TAB -->
      <div v-else-if="activeTab === 'lottery' && liveLottery" class="space-y-3">
        <div class="farm-card-enhanced overflow-hidden rounded-2xl p-3">
          <div class="mb-2 flex items-center gap-2">
            <div class="i-carbon-currency text-lg" :style="{ color: 'var(--theme-primary)' }" />
            <span class="text-sm font-bold" :style="{ color: 'var(--theme-text)' }">奇遇礼莲</span>
          </div>
          <div class="mb-3 grid grid-cols-2 gap-2 text-sm">
            <div
              class="rounded-xl p-2.5"
              :style="{ background: 'color-mix(in srgb, var(--theme-primary) 8%, transparent)' }"
            >
              <div class="text-xs opacity-60">
                免费 ({{ liveLottery.freeDailyLimit }} / 日)
              </div>
              <div class="text-lg font-bold" :style="{ color: 'var(--theme-primary)' }">
                余 {{ liveLottery.freeRemaining }}
              </div>
            </div>
            <div
              class="rounded-xl p-2.5"
              :style="{ background: 'color-mix(in srgb, #f59e0b 12%, transparent)' }"
            >
              <div class="text-xs opacity-60">
                付费 ({{ liveLottery.paidDailyLimit }} / 日)
              </div>
              <div class="text-lg font-bold text-amber-500">
                余 {{ liveLottery.paidRemaining }}
              </div>
            </div>
          </div>
          <div class="mb-2 text-xs opacity-60">
            付费单价: <span class="font-medium">{{ liveLottery.paidCostName }} x{{ liveLottery.paidCostCount }}</span>
            <span v-if="liveLottery.paidDiamondCost > 0">· 钻石 {{ liveLottery.paidDiamondCost }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              class="rounded-xl px-3 py-1.5 text-xs font-bold text-white shadow-sm transition disabled:opacity-50"
              :style="{ background: 'var(--theme-primary)' }"
              :disabled="liveLottery.freeRemaining <= 0 || activityStore.isBusy(`draw-free-1`)"
              @click="drawFree(1)"
            >
              <div v-if="activityStore.isBusy(`draw-free-1`)" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
              免费抽 1 次
            </button>
            <button
              v-if="liveLottery.freeDailyLimit > 1"
              class="rounded-xl border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50"
              :style="{ borderColor: 'var(--theme-primary)', color: 'var(--theme-primary)' }"
              :disabled="liveLottery.freeRemaining <= 0 || activityStore.isBusy(`draw-free-${Math.min(liveLottery.freeRemaining, 10)}`)"
              @click="drawFree(Math.min(liveLottery.freeRemaining, 10))"
            >
              <div v-if="activityStore.isBusy(`draw-free-${Math.min(liveLottery.freeRemaining, 10)}`)" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
              免费全抽
            </button>
            <button
              class="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition disabled:opacity-50"
              :disabled="liveLottery.paidRemaining <= 0 || activityStore.isBusy(`draw-paid-1`)"
              @click="tryPaid(1)"
            >
              <div v-if="activityStore.isBusy(`draw-paid-1`)" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
              付费抽 1 次
            </button>
          </div>
        </div>

        <!-- Preview goods -->
        <div v-if="liveLottery.previewGoods && liveLottery.previewGoods.length > 0" class="farm-card-enhanced overflow-hidden rounded-2xl p-3">
          <div class="mb-2 flex items-center gap-2">
            <div class="i-carbon-view text-lg" :style="{ color: 'var(--theme-primary)' }" />
            <span class="text-sm font-bold" :style="{ color: 'var(--theme-text)' }">奖池预览</span>
            <span class="text-xs opacity-60">({{ liveLottery.previewGoods.length }})</span>
          </div>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <div
              v-for="(g, idx) in liveLottery.previewGoods.slice(0, 12)"
              :key="idx"
              class="rounded-xl p-2"
              :class="qualityBg(g.quality)"
            >
              <div class="mb-1 flex items-center gap-1">
                <span
                  class="rounded px-1 py-0.5 text-[10px] font-bold"
                  :class="qualityColor(g.quality)"
                >
                  Q{{ g.quality }}
                </span>
                <span v-if="g.displayUpTag" class="rounded bg-rose-500 px-1 py-0.5 text-[10px] font-bold text-white">
                  {{ g.displayUpTagValue || 'UP' }}
                </span>
              </div>
              <div class="space-y-0.5">
                <div
                  v-for="(it, i2) in g.items"
                  :key="i2"
                  class="flex items-center gap-1 text-[11px]"
                >
                  <img
                    v-if="it.image"
                    :src="it.image"
                    :alt="it.name"
                    class="h-4 w-4 object-contain"
                    loading="lazy"
                    @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
                  >
                  <span class="truncate" :title="it.name">
                    {{ it.name }} x{{ it.count }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- SHOP TAB -->
      <div v-else-if="activeTab === 'shop' && liveShop.length > 0" class="space-y-2">
        <div
          v-for="g in liveShop"
          :key="g.id"
          class="farm-card-enhanced flex items-center gap-3 overflow-hidden rounded-2xl p-3"
        >
          <div class="flex flex-wrap items-center gap-1.5">
            <div
              v-for="(it, idx) in g.item"
              :key="idx"
              class="h-10 w-10 flex items-center justify-center overflow-hidden rounded-lg bg-white/50 dark:bg-gray-800/40"
            >
              <img
                v-if="it.image"
                :src="it.image"
                :alt="it.name"
                class="max-h-full max-w-full object-contain"
                loading="lazy"
                @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
              >
              <div v-else class="i-carbon-cube opacity-40" />
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-bold" :style="{ color: 'var(--theme-text)' }" :title="g.name">
                {{ g.name }}
              </span>
              <span
                v-if="g.soldOut"
                class="rounded bg-gray-300 px-1 py-0.5 text-[10px] text-white dark:bg-gray-700"
              >
                已售罄
              </span>
              <span
                v-else-if="g.purchaseLimit > 0"
                class="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-600 dark:bg-amber-900/40 dark:text-amber-300"
              >
                限购 {{ g.purchaseLimit }} · 已兑 {{ g.purchasedCount }}
              </span>
            </div>
            <div v-if="g.description" class="mt-0.5 line-clamp-1 text-[11px] opacity-60" :title="g.description">
              {{ g.description }}
            </div>
            <div class="mt-1 text-xs">
              <span class="opacity-60">价格:</span>
              <span class="ml-1 font-medium" :style="{ color: 'var(--theme-primary)' }">
                {{ costText(g) }}
              </span>
            </div>
          </div>
          <button
            class="rounded-xl px-3 py-1.5 text-xs font-bold text-white shadow-sm transition disabled:opacity-50"
            :style="{ background: g.soldOut ? '#9ca3af' : 'var(--theme-primary)' }"
            :disabled="g.soldOut || activityStore.isBusy(`exchange-${g.id}-1`)"
            @click="buyShop(g)"
          >
            <div v-if="activityStore.isBusy(`exchange-${g.id}-1`)" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
            兑换
          </button>
        </div>
      </div>

      <!-- CHECKIN / BATTLE PASS TAB -->
      <div v-else-if="activeTab === 'checkin'" class="space-y-3">
        <div v-if="liveSignin" class="farm-card-enhanced overflow-hidden rounded-2xl p-3">
          <div class="mb-2 flex items-center gap-2">
            <div class="i-carbon-gift text-lg" :style="{ color: 'var(--theme-primary)' }" />
            <span class="text-sm font-bold" :style="{ color: 'var(--theme-text)' }">活动每日赠礼</span>
          </div>
          <div v-if="liveSignin.claimedToday" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
            ✓ 今日赠礼已领取
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="r in liveSignin.rewards"
              :key="r.id"
              class="flex items-center gap-2 rounded-xl p-2"
              :style="{ background: 'color-mix(in srgb, var(--theme-primary) 8%, transparent)' }"
            >
              <div class="flex-1 text-xs" :style="{ color: 'var(--theme-text)' }">
                {{ r.description || `奖励 #${r.id}` }}
              </div>
              <div class="flex items-center gap-1">
                <img
                  v-for="(it, i) in r.items"
                  :key="i"
                  v-show="it.image"
                  :src="it.image"
                  :alt="it.name"
                  class="h-5 w-5 object-contain"
                  loading="lazy"
                  @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
                >
              </div>
              <button
                class="rounded-lg px-2.5 py-1 text-xs font-bold text-white shadow-sm transition disabled:opacity-50"
                :style="{ background: 'var(--theme-primary)' }"
                :disabled="activityStore.isBusy('daily-signin')"
                @click="claimSignin"
              >
                <div v-if="activityStore.isBusy('daily-signin')" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
                领取
              </button>
            </div>
          </div>
        </div>

        <div v-if="liveBattlePass" class="farm-card-enhanced overflow-hidden rounded-2xl p-3">
          <div class="mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="i-carbon-trophy text-lg" :style="{ color: 'var(--theme-primary)' }" />
              <span class="text-sm font-bold" :style="{ color: 'var(--theme-text)' }">
                战令 · {{ liveBattlePass.name || '赛季战令' }}
              </span>
            </div>
            <span class="text-xs opacity-60">
              Lv.{{ liveBattlePass.level }} / {{ liveBattlePass.maxLevel || '∞' }}
            </span>
          </div>

          <div class="mb-2 h-2 overflow-hidden rounded-full bg-gray-200/50 dark:bg-gray-700/50">
            <div
              class="h-full transition-all"
              :style="{
                width: liveBattlePass.maxLevel > 0
                  ? `${Math.min(100, (liveBattlePass.level / liveBattlePass.maxLevel) * 100)}%`
                  : '0%',
                background: 'var(--theme-primary)',
              }"
            />
          </div>

          <div class="mb-2 flex items-center justify-between text-xs opacity-70">
            <span>经验: {{ formatExp(liveBattlePass.currentLevelExp) }} / {{ formatExp(liveBattlePass.nextLevelNeedExp) }}</span>
            <span v-if="liveBattlePass.isPremium" class="rounded bg-amber-100 px-1.5 py-0.5 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
              已开通尊享
            </span>
            <span v-else-if="liveBattlePass.premiumPrice > 0" class="opacity-60">
              尊享价 {{ liveBattlePass.premiumPrice }}
            </span>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="rounded-xl p-2" :style="{ background: 'color-mix(in srgb, var(--theme-primary) 8%, transparent)' }">
              <div class="opacity-60">
                免费可领
              </div>
              <div class="text-lg font-bold" :style="{ color: 'var(--theme-primary)' }">
                {{ liveBattlePass.claimableFreeLevels.length }} 级
              </div>
              <div class="text-[10px] opacity-60">
                已领至 Lv.{{ liveBattlePass.freeClaimedLevel }}
              </div>
            </div>
            <div class="rounded-xl p-2" :style="{ background: 'color-mix(in srgb, #f59e0b 12%, transparent)' }">
              <div class="opacity-60">
                尊享可领
              </div>
              <div class="text-lg font-bold text-amber-500">
                {{ liveBattlePass.claimablePremiumLevels.length }} 级
              </div>
              <div class="text-[10px] opacity-60">
                已领至 Lv.{{ liveBattlePass.premiumClaimedLevel }}
              </div>
            </div>
          </div>

          <button
            v-if="liveBattlePass.claimableCount > 0"
            class="mt-2 w-full rounded-xl py-1.5 text-xs font-bold text-white shadow-sm transition disabled:opacity-50"
            :style="{ background: 'var(--theme-primary)' }"
            :disabled="activityStore.isBusy('battle-pass')"
            @click="claimBattlePass"
          >
            <div v-if="activityStore.isBusy('battle-pass')" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
            一键领取 {{ liveBattlePass.claimableCount }} 级战令奖励
          </button>
        </div>

        <div v-if="!liveSignin && !liveBattlePass" class="farm-card-enhanced overflow-hidden rounded-2xl p-6 text-center text-sm opacity-60">
          当前账号没有可领取的活动赠礼 / 战令
        </div>
      </div>

      <!-- FALLBACK -->
      <div v-else class="farm-card-enhanced overflow-hidden rounded-2xl p-6 text-center text-sm opacity-60">
        没有可显示的内容
      </div>
    </div>

    <!-- Confirm paid draw -->
    <ConfirmModal
      :show="showPaidConfirm"
      title="确认付费奇遇"
      :message="`将消耗 ${liveLottery?.paidCostName || '道具'} x${(liveLottery?.paidCostCount || 0) * paidCount} 进行 ${paidCount} 次付费奇遇礼莲,确认继续?`"
      type="primary"
      confirm-text="确认"
      cancel-text="取消"
      :loading="activityStore.isBusy('draw-paid-1') || activityStore.isBusy(`draw-paid-${paidCount}`)"
      @confirm="confirmPaid"
      @cancel="showPaidConfirm = false"
    />
  </div>
</template>

<style scoped>
.farm-card-enhanced {
  background: color-mix(in srgb, var(--theme-bg) 95%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-text) 8%, transparent);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--theme-text) 5%, transparent);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--theme-primary) 30%, transparent);
  border-radius: 3px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--theme-primary) 50%, transparent);
}

.line-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
