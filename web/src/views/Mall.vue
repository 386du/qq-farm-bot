<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useMallStore, type MallGood } from '@/stores/mall'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const mallStore = useMallStore()
const statusStore = useStatusStore()
const toast = useToastStore()

const { currentAccount } = storeToRefs(accountStore)
const { goods, loading, lastError, lastSlotType } = storeToRefs(mallStore)

const SLOT_OPTIONS = [
  { label: '推荐 (1)', value: 1 },
  { label: '热销 (2)', value: 2 },
  { label: '新品 (3)', value: 3 },
  { label: '折扣 (4)', value: 4 },
  { label: '装扮 (5)', value: 5 },
] as const

const selectedSlot = ref<number>(1)
const search = ref('')
const selectedShop = ref<'all' | 'mall' | 'shop'>('all')

const accountRef = computed(() => currentAccount.value?.id || currentAccount.value?.uin || '')
const accountRunning = computed(() => {
  const s = statusStore.status
  return !!(s && s.connection && s.connection.connected)
})

const filteredGoods = computed<MallGood[]>(() => {
  const key = search.value.trim().toLowerCase()
  return goods.value.filter((g: MallGood) => {
    if (selectedShop.value !== 'all' && g.source !== selectedShop.value) return false
    if (!key) return true
    if (String(g.name).toLowerCase().includes(key)) return true
    return (g.items || []).some(it => String(it.name || '').toLowerCase().includes(key))
  })
})

const shopTabs = computed(() => {
  const tabs: Array<{ key: 'all' | 'mall' | 'shop', label: string, count: number }> = [
    { key: 'all', label: '全部', count: goods.value.length },
    { key: 'mall', label: '道具商城', count: goods.value.filter(g => g.source === 'mall').length },
    { key: 'shop', label: '宠物/道具商店', count: goods.value.filter(g => g.source === 'shop').length },
  ]
  return tabs
})

const summary = computed(() => {
  const list = filteredGoods.value
  return {
    total: list.length,
    free: list.filter(g => g.isFree).length,
    limited: list.filter(g => g.isLimited).length,
  }
})

async function reload() {
  if (!accountRef.value) {
    toast.warning('请先选择账号')
    return
  }
  if (!accountRunning.value) {
    toast.warning('账号未运行,无法获取商城数据')
    return
  }
  await mallStore.fetchGoods(selectedSlot.value)
}

function changeSlot(v: number) {
  selectedSlot.value = v
  reload()
}

function changeShop(v: 'all' | 'mall' | 'shop') {
  selectedShop.value = v
}

async function buy(g: MallGood) {
  if (!accountRef.value) {
    toast.warning('请先选择账号')
    return
  }
  if (!accountRunning.value) {
    toast.warning('账号未运行,无法购买')
    return
  }
  if (!g.unlocked) {
    toast.warning(`「${g.name}」 尚未解锁`)
    return
  }
  if (g.isFree) {
    await mallStore.purchase(g, 1)
  }
  else {
    const max = g.remaining === null ? 1 : Math.max(1, g.remaining)
    await mallStore.purchase(g, Math.min(1, max))
  }
  await mallStore.fetchGoods(selectedSlot.value)
}

function formatPrice(price: MallGood['price']): string {
  if (!price) return ''
  if (price.itemId === 0 || price.amount === 0) return price.unit || '免费'
  return `${price.amount} ${price.unit}`
}

function priceClass(price: MallGood['price']): string {
  if (!price || price.itemId === 0) return 'text-emerald-500 dark:text-emerald-300'
  if (price.itemId === 1002) return 'text-sky-500 dark:text-sky-300'
  if (price.itemId === 1005) return 'text-amber-500 dark:text-amber-300'
  if (price.itemId === 1001 || price.itemId === 1) return 'text-yellow-500 dark:text-yellow-300'
  return 'text-gray-500 dark:text-gray-300'
}

function limitLabel(g: MallGood): string {
  if (!g.isLimited || !g.limitCount) return ''
  const remainingText = g.remaining === null ? '' : `,余 ${g.remaining}`
  if (g.limitType === 'daily') return `每日限购 ${g.limitCount}${remainingText}`
  return `永久限购 ${g.limitCount}${remainingText}`
}

function soldOut(g: MallGood): boolean {
  return g.remaining !== null && g.remaining <= 0
}

onMounted(() => {
  if (accountRef.value && accountRunning.value) {
    reload()
  }
})

onActivated(() => {
  if (accountRef.value && accountRunning.value && goods.value.length === 0) {
    reload()
  }
})

watch(() => currentAccount.value?.id || currentAccount.value?.uin || '', async (v) => {
  if (v && accountRunning.value) await reload()
  else if (!v) mallStore.goods = []
})

watch(() => statusStore.status?.connection?.connected, async (v) => {
  if (v && accountRef.value && goods.value.length === 0) await reload()
})
</script>

<template>
  <div class="h-full flex flex-col p-4">
    <!-- Header -->
    <div class="farm-card-enhanced mb-3 overflow-hidden p-3">
      <div class="flex items-center gap-3">
        <div class="h-9 w-9 flex items-center justify-center rounded-xl" style="background: var(--theme-primary);">
          <div class="i-carbon-shop text-xl text-white" />
        </div>
        <div class="flex-1">
          <div class="text-base font-bold" :style="{ color: 'var(--theme-text)' }">
            道具商城
          </div>
          <div class="text-xs opacity-70" :style="{ color: 'var(--theme-text)' }">
            化肥 / 道具 / 装扮 · 实时拉取官方商城
          </div>
        </div>
        <button
          class="rounded-xl px-3 py-1.5 text-sm font-medium text-white shadow transition disabled:opacity-50"
          :style="{ background: 'var(--theme-primary)' }"
          :disabled="loading || !accountRef || !accountRunning"
          @click="reload"
        >
          <div v-if="loading" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
          <div v-else class="i-carbon-refresh mr-1 inline-block align-text-bottom" />
          刷新
        </button>
      </div>

      <!-- Slot tabs -->
      <div class="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          v-for="opt in SLOT_OPTIONS"
          :key="opt.value"
          class="rounded-xl px-2.5 py-1 text-xs font-medium transition"
          :class="selectedSlot === opt.value ? 'text-white shadow' : 'hover:opacity-80'"
          :style="selectedSlot === opt.value
            ? { background: 'var(--theme-primary)' }
            : { background: 'color-mix(in srgb, var(--theme-text) 8%, transparent)', color: 'var(--theme-text)' }"
          @click="changeSlot(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>

      <!-- Source tabs -->
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          v-for="tab in shopTabs"
          :key="tab.key"
          class="rounded-lg px-2.5 py-1 text-xs transition"
          :style="selectedShop === tab.key
            ? { background: 'color-mix(in srgb, var(--theme-primary) 20%, transparent)', color: 'var(--theme-primary)', fontWeight: 'bold' }
            : { color: 'var(--theme-text)', opacity: 0.7 }"
          @click="changeShop(tab.key)"
        >
          {{ tab.label }} ({{ tab.count }})
        </button>
        <div class="flex-1" />
        <input
          v-model="search"
          type="text"
          placeholder="搜索商品 / 物品"
          class="w-40 rounded-lg border border-gray-200/50 bg-white/50 px-2.5 py-1 text-xs dark:border-gray-600/50 dark:bg-gray-800/40 focus:outline-none focus:ring-1"
          :style="{ color: 'var(--theme-text)' }"
        >
      </div>
    </div>

    <!-- Empty / error state -->
    <div v-if="!accountRef" class="flex-1 flex items-center justify-center text-sm opacity-60">
      请先在左侧选择一个账号
    </div>
    <div v-else-if="!accountRunning" class="flex-1 flex items-center justify-center text-sm opacity-60">
      账号未运行,无法拉取商城数据
    </div>
    <div v-else-if="loading && goods.length === 0" class="flex-1 flex items-center justify-center text-sm opacity-60">
      <div class="i-svg-spinners-90-ring-with-bg mr-2 text-xl" />
      正在拉取商城数据...
    </div>
    <div v-else-if="lastError" class="flex-1 flex items-center justify-center text-sm text-red-500">
      {{ lastError }}
    </div>
    <div v-else-if="goods.length === 0" class="flex-1 flex items-center justify-center text-sm opacity-60">
      该分类下暂时没有商品
    </div>

    <!-- Goods grid -->
    <div v-else class="custom-scrollbar flex-1 overflow-y-auto">
      <div class="mb-2 flex items-center justify-between text-xs opacity-60">
        <span>共 {{ summary.total }} 件商品 · 免费 {{ summary.free }} · 限购 {{ summary.limited }}</span>
        <span>Slot {{ lastSlotType }}</span>
      </div>
      <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <div
          v-for="g in filteredGoods"
          :key="`${g.source}-${g.shopId}-${g.goodsId}`"
          class="farm-card-enhanced group relative overflow-hidden rounded-2xl p-3 transition hover:-translate-y-0.5 hover:shadow-md"
          :class="soldOut(g) || !g.unlocked ? 'opacity-60' : ''"
        >
          <!-- Tag bar -->
          <div class="mb-2 flex items-center justify-between">
            <span
              v-if="g.isFree"
              class="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300"
            >
              免费
            </span>
            <span
              v-else-if="g.isLimited"
              class="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-900/40 dark:text-amber-300"
            >
              限购
            </span>
            <span
              v-else
              class="rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:bg-sky-900/40 dark:text-sky-300"
            >
              商城
            </span>
            <span
              v-if="g.discount"
              class="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:bg-rose-900/40 dark:text-rose-300"
            >
              {{ g.discount }}
            </span>
          </div>

          <!-- Image -->
          <div class="mb-2 flex h-20 items-center justify-center">
            <img
              v-if="g.image"
              :src="g.image"
              :alt="g.name"
              class="max-h-full max-w-full object-contain"
              loading="lazy"
              @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
            >
            <div v-else class="i-carbon-cube text-3xl opacity-30" />
          </div>

          <!-- Name -->
          <div class="mb-0.5 truncate text-sm font-bold" :style="{ color: 'var(--theme-text)' }" :title="g.name">
            {{ g.name }}
          </div>
          <div v-if="g.description" class="mb-1 line-clamp-1 text-[10px] opacity-50" :title="g.description">
            {{ g.description }}
          </div>

          <!-- Item list (one line) -->
          <div v-if="g.items && g.items.length > 0" class="mb-1 flex flex-wrap gap-1 text-[10px] opacity-70">
            <span
              v-for="(it, idx) in g.items.slice(0, 2)"
              :key="idx"
              class="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10"
            >
              {{ it.name }} x{{ it.count }}
            </span>
            <span v-if="g.items.length > 2" class="opacity-50">
              +{{ g.items.length - 2 }}
            </span>
          </div>

          <!-- Limit info -->
          <div v-if="limitLabel(g)" class="mb-1 text-[10px] text-amber-500 dark:text-amber-300">
            {{ limitLabel(g) }}
          </div>

          <!-- Price + Buy -->
          <div class="mt-2 flex items-center justify-between">
            <span class="text-sm font-bold" :class="priceClass(g.price)">
              {{ formatPrice(g.price) }}
            </span>
            <button
              v-if="!soldOut(g) && g.unlocked"
              class="rounded-lg px-2.5 py-1 text-xs font-bold text-white shadow-sm transition disabled:opacity-50"
              :style="{ background: 'var(--theme-primary)' }"
              :disabled="mallStore.isPurchasing(g.goodsId)"
              @click.stop="buy(g)"
            >
              <div v-if="mallStore.isPurchasing(g.goodsId)" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
              购买
            </button>
            <span v-else class="rounded-lg bg-gray-200/50 px-2.5 py-1 text-xs text-gray-500 dark:bg-gray-700/50 dark:text-gray-400">
              {{ g.unlocked ? '已售罄' : '未解锁' }}
            </span>
          </div>

          <!-- Source label -->
          <div class="mt-1.5 text-[10px] opacity-40">
            {{ g.shopName || (g.source === 'mall' ? '道具商城' : '道具商店') }} · #{{ g.goodsId }}
          </div>
        </div>
      </div>
    </div>
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
