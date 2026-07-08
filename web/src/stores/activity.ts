import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'

export interface ActivityCurrency {
  id: number
  name: string
  category: string
  count: number
  image: string
  description: string
  type: number
}

export interface ActivityCrop {
  plantId: number
  name: string
  seedId: number
  seedName: string
  seedCount: number
  fruitId: number
  fruitName: string
  fruitCount: number
  image: string
  fruitImage: string
  size: number
  requiredLevel: number
  seasons: number
  harvestCount: number
  growSeconds: number
  growTimeText: string
  exp: number
  price: number
  priceUnit: string
}

export interface ActivityItem {
  id: number
  name: string
  category: string
  count: number
  image: string
  description: string
  type: number
  price: number
  priceUnit: string
}

export interface ActivityShopGood {
  id: number
  name: string
  description: string
  item: Array<{ id: number, name: string, count: number, image: string }>
  cost: Array<{ id: number, name: string, count: number, image: string }>
  purchaseLimit: number
  purchasedCount: number
  remaining: number | null
  soldOut: boolean
  order: number
}

export interface ActivityLottery {
  freeRemaining: number
  freeDailyLimit: number
  paidRemaining: number
  paidDailyLimit: number
  totalRemaining: number
  totalLimit: number
  paidCostId: number
  paidCostName: string
  paidCostImage: string
  paidCostCount: number
  paidDiamondCost: number
  previewGoods: Array<{ goodsId: number, quality: number, poolType: number, displayUpTag: boolean, displayUpTagValue: string, items: any[] }>
}

export interface ActivityDailySignin {
  claimedToday: boolean
  rewards: Array<{ id: number, description: string, items: any[] }>
}

export interface ActivityBattlePass {
  battlepassId: number
  name: string
  description: string
  level: number
  totalExp: number
  currentLevelExp: number
  nextLevelNeedExp: number
  maxLevel: number
  isPremium: boolean
  freeClaimedLevel: number
  premiumClaimedLevel: number
  premiumPrice: number
  claimableFreeLevels: any[]
  claimablePremiumLevels: any[]
  claimableCount: number
  levels: any[]
}

export const useActivityStore = defineStore('activity', () => {
  const name = ref('荷风游记')
  const currencies = ref<ActivityCurrency[]>([])
  const crops = ref<ActivityCrop[]>([])
  const items = ref<ActivityItem[]>([])
  const summary = ref<any>({})
  const live = ref<any>(null)
  const loading = ref(false)
  const busy = ref<Set<string>>(new Set())
  const lastError = ref('')

  async function fetchOverview(activityName?: string) {
    const accountStore = useAccountStore()
    const accountRef = accountStore.currentAccountId || accountStore.currentAccount?.id
    if (!accountRef) {
      lastError.value = '请先选择账号'
      currencies.value = []
      crops.value = []
      items.value = []
      live.value = null
      return
    }
    loading.value = true
    lastError.value = ''
    if (activityName) name.value = activityName
    try {
      const res = await api.get('/api/activity/overview', {
        params: { name: name.value },
      })
      if (res.data && res.data.ok && res.data.data) {
        const d = res.data.data
        currencies.value = Array.isArray(d.currencies) ? d.currencies : []
        crops.value = Array.isArray(d.crops) ? d.crops : []
        items.value = Array.isArray(d.items) ? d.items : []
        summary.value = d.summary || {}
        live.value = d.live || null
      }
      else {
        currencies.value = []
        crops.value = []
        items.value = []
        live.value = null
        lastError.value = (res.data && res.data.error) || '获取活动概览失败'
      }
    }
    catch (e: any) {
      currencies.value = []
      crops.value = []
      items.value = []
      live.value = null
      lastError.value = e?.response?.data?.error || e?.message || '获取活动概览失败'
    }
    finally {
      loading.value = false
    }
  }

  function isBusy(key: string) {
    return busy.value.has(key)
  }

  async function withBusy<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    if (busy.value.has(key)) return null
    busy.value.add(key)
    try {
      return await fn()
    }
    finally {
      busy.value.delete(key)
    }
  }

  async function drawLottery(opts: { mode: 'free' | 'paid', count?: number, allowPaid?: boolean } = { mode: 'free' }) {
    const toast = useToastStore()
    const key = `draw-${opts.mode}-${opts.count || 1}`
    return withBusy(key, async () => {
      try {
        const res = await api.post('/api/activity/draw', {
          activityName: name.value,
          mode: opts.mode,
          count: opts.count || 1,
          allowPaid: !!opts.allowPaid,
        })
        if (res.data && res.data.ok) {
          const data = res.data.data
          const rewardNames = (data.rewards || []).map((r: any) => `${r.name} x${r.count}`).join('、')
          toast.success(`抽卡成功：${rewardNames || '无奖励'}`)
          return data
        }
        toast.error((res.data && res.data.error) || '抽卡失败')
        return null
      }
      catch (e: any) {
        toast.error(e?.response?.data?.error || e?.message || '抽卡失败')
        return null
      }
    })
  }

  async function drawSimple(count: number = 1) {
    const toast = useToastStore()
    const key = `draw-simple-${count}`
    return withBusy(key, async () => {
      try {
        const res = await api.post('/api/activity/draw-simple', {
          activityName: name.value,
          count,
        })
        if (res.data && res.data.ok) {
          const data = res.data.data
          const rewardNames = (data.awards || []).map((r: any) => `${r.name} x${r.count}`).join('、')
          toast.success(`抽奖成功：${rewardNames || '无奖励'}`)
          return data
        }
        toast.error((res.data && res.data.error) || '抽奖失败')
        return null
      }
      catch (e: any) {
        toast.error(e?.response?.data?.error || e?.message || '抽奖失败')
        return null
      }
    })
  }

  async function exchange(goodsId: number, count: number = 1) {
    const toast = useToastStore()
    const key = `exchange-${goodsId}-${count}`
    return withBusy(key, async () => {
      try {
        const res = await api.post('/api/activity/exchange', {
          activityName: name.value,
          goodsId,
          count,
        })
        if (res.data && res.data.ok) {
          const data = res.data.data
          const awardNames = (data.awards || []).map((r: any) => `${r.name} x${r.count}`).join('、')
          toast.success(`兑换成功：${awardNames || '无奖励'}`)
          return data
        }
        toast.error((res.data && res.data.error) || '兑换失败')
        return null
      }
      catch (e: any) {
        toast.error(e?.response?.data?.error || e?.message || '兑换失败')
        return null
      }
    })
  }

  async function claimDailySignin() {
    const toast = useToastStore()
    return withBusy('daily-signin', async () => {
      try {
        const res = await api.post('/api/activity/daily-signin/claim', { activityName: name.value })
        if (res.data && res.data.ok) {
          toast.success('活动赠礼已领取')
          return res.data.data
        }
        toast.error((res.data && res.data.error) || '领取失败')
        return null
      }
      catch (e: any) {
        toast.error(e?.response?.data?.error || e?.message || '领取失败')
        return null
      }
    })
  }

  async function claimBattlePass() {
    const toast = useToastStore()
    return withBusy('battle-pass', async () => {
      try {
        const res = await api.post('/api/activity/battle-pass/claim', {})
        if (res.data && res.data.ok) {
          const data = res.data.data
          toast.success(`战令已领 ${data.claimedLevels?.length || 0} 级奖励`)
          return data
        }
        toast.error((res.data && res.data.error) || '战令领取失败')
        return null
      }
      catch (e: any) {
        toast.error(e?.response?.data?.error || e?.message || '战令领取失败')
        return null
      }
    })
  }

  async function claimTasks() {
    const toast = useToastStore()
    return withBusy('tasks', async () => {
      try {
        const res = await api.post('/api/activity/tasks/claim', { activityName: name.value })
        if (res.data && res.data.ok) {
          const data = res.data.data
          toast.success(`已领 ${data.claimedCount || 0} 个活动任务`)
          return data
        }
        toast.error((res.data && res.data.error) || '任务领取失败')
        return null
      }
      catch (e: any) {
        toast.error(e?.response?.data?.error || e?.message || '任务领取失败')
        return null
      }
    })
  }

  const liveLottery = ref<ActivityLottery | null>(null)
  const liveShop = ref<ActivityShopGood[]>([])
  const liveSignin = ref<ActivityDailySignin | null>(null)
  const liveBattlePass = ref<ActivityBattlePass | null>(null)

  function refreshLiveFromCache() {
    if (!live.value) {
      liveLottery.value = null
      liveShop.value = []
      liveSignin.value = null
      liveBattlePass.value = null
      return
    }
    const activities = live.value.activity || {}
    liveLottery.value = activities.lotteryActivity && activities.lotteryActivity.lottery
      ? activities.lotteryActivity.lottery
      : null
    liveShop.value = activities.shopActivity && activities.shopActivity.shop
      ? activities.shopActivity.shop.goods
      : []
    liveSignin.value = activities.dailySigninActivity && activities.dailySigninActivity.dailySignin
      ? activities.dailySigninActivity.dailySignin
      : null
    liveBattlePass.value = live.value.season && live.value.season.battlePass
      ? live.value.season.battlePass
      : null
  }

  return {
    name, currencies, crops, items, summary, live, loading, busy, lastError,
    liveLottery, liveShop, liveSignin, liveBattlePass,
    fetchOverview, drawLottery, drawSimple, exchange,
    claimDailySignin, claimBattlePass, claimTasks, refreshLiveFromCache, isBusy,
  }
})
