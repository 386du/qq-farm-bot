import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'

export interface MallGood {
  goodsId: number
  source: 'mall' | 'shop'
  shopId: number
  shopName: string
  slotType: number
  name: string
  type: number
  isFree: boolean
  isLimited: boolean
  discount: string
  price: { itemId: number, amount: number, unit: string, balanceKey: string }
  items: Array<{ id: number, count: number, name: string, description: string, image: string }>
  image: string
  description: string
  unlocked: boolean
  boughtNum: number
  limitCount: number
  limitType: string
  remaining: number | null
}

export const useMallStore = defineStore('mall', () => {
  const goods = ref<MallGood[]>([])
  const loading = ref(false)
  const purchasing = ref<Set<number>>(new Set())
  const lastError = ref('')
  const lastSlotType = ref(1)

  async function fetchGoods(slotType: number = 1) {
    const accountStore = useAccountStore()
    const accountRef = accountStore.currentAccountId || accountStore.currentAccount?.id
    if (!accountRef) {
      lastError.value = '请先选择账号'
      goods.value = []
      return
    }
    loading.value = true
    lastError.value = ''
    lastSlotType.value = slotType
    try {
      const res = await api.get('/api/mall/goods', {
        params: { slotType },
      })
      if (res.data && res.data.ok) {
        goods.value = Array.isArray(res.data.data) ? res.data.data : []
      }
      else {
        goods.value = []
        lastError.value = (res.data && res.data.error) || '获取商城商品失败'
      }
    }
    catch (e: any) {
      goods.value = []
      lastError.value = e?.response?.data?.error || e?.message || '获取商城商品失败'
    }
    finally {
      loading.value = false
    }
  }

  async function purchase(goodsItem: MallGood, count: number = 1) {
    const accountStore = useAccountStore()
    const toast = useToastStore()
    const accountRef = accountStore.currentAccountId || accountStore.currentAccount?.id
    if (!accountRef) {
      toast.error('请先选择账号')
      return null
    }
    if (purchasing.value.has(goodsItem.goodsId)) return null
    purchasing.value.add(goodsItem.goodsId)
    try {
      const res = await api.post('/api/mall/purchase', {
        goodsId: goodsItem.goodsId,
        count,
        slotType: goodsItem.slotType || lastSlotType.value,
        source: goodsItem.source,
        shopId: goodsItem.shopId,
      })
      if (res.data && res.data.ok) {
        toast.success(`购买 ${goodsItem.name} x${count} 成功`)
        return res.data.data
      }
      toast.error((res.data && res.data.error) || '购买失败')
      return null
    }
    catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || '购买失败')
      return null
    }
    finally {
      purchasing.value.delete(goodsItem.goodsId)
    }
  }

  function isPurchasing(goodsId: number) {
    return purchasing.value.has(goodsId)
  }

  return { goods, loading, purchasing, lastError, lastSlotType, fetchGoods, purchase, isPurchasing }
})
