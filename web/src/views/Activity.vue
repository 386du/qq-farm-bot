<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()

const activeTab = ref<'lottery' | 'battlepass' | 'shop' | 'solar' | 'all'>('lottery')
const loading = ref(false)

// 操作类型常量 (与后端 services/activity.ts 保持一致)
const OPERATE_CLAIM = 1          // 领取奖励
const OPERATE_DRAW = 7           // 单抽
const OPERATE_VIEW = 10          // 查看/进入活动

// 活动类型常量
const ACTIVITY_TYPE_DAILY = 1    // 每日任务
const ACTIVITY_TYPE_SHOP = 3     // 商店
const ACTIVITY_TYPE_LOTTERY = 8  // 抽奖

// 活动组数据
const activities = ref<any[]>([])
const groupId = ref(2026060100)

// 赛季数据
const seasonInfo = ref<any>(null)

// 节令数据
const solarTerms = ref<any[]>([])

// 商店数据 (改用 ShopService 获取真实商品)
const shopProfiles = ref<any[]>([])
const shopGoodsList = ref<Record<string, any[]>>({})  // shopId -> 商品列表
const shopLoading = ref(false)

// 货币/背包
const basicInfo = ref<any>(null)
const bagItems = ref<any[]>([])

// 操作结果
const operateResult = ref<any>(null)
const operateLoading = ref(false)

// 抽奖信息
const drawInfo = ref<any>(null)

// 付费确认弹窗
const showPaidConfirm = ref(false)
const pendingDrawType = ref(0)
const pendingActivityId = ref(0)

// 品质标签
function qualityLabel(q: number): string {
  const map: Record<number, string> = { 1: '普通', 2: '稀有', 3: '史诗', 4: '传说' }
  return map[q] || `品质${q}`
}

// 格式化日期
function formatDate(ts: number): string {
  if (!ts)
    return ''
  return new Date(ts * 1000).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

// 格式化数字
function formatNumber(n: number | string | undefined): string {
  const num = Number(n)
  if (!num && num !== 0) return '-'
  if (num >= 100000000) return `${(num / 100000000).toFixed(1)}亿`
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万`
  return num.toLocaleString('zh-CN')
}

// 货币配置
const currencyConfig: Record<string, { icon: string; color: string }> = {
  '点券': { icon: '💎', color: '#3b82f6' },
  '金币': { icon: '🪙', color: '#f59e0b' },
  '荷露': { icon: '🌸', color: '#ec4899' },
  '助威粽叶': { icon: '🍃', color: '#22c55e' },
}

// 解析 extra JSON
function parseExtra(extra: any): any {
  if (!extra)
    return null
  if (typeof extra === 'object')
    return extra
  try { return JSON.parse(extra) }
  catch { return null }
}

// 把 result 状态码转成中文提示
function resultText(result: number | string): string {
  const r = Number(result)
  const map: Record<number, string> = {
    0: '操作成功',
    1: '活动未开始或已结束',
    2: '今日次数已用完',
    3: '货币（点券/金币/活动币）不足',
    4: '参数错误',
    5: '奖励已领取',
    6: '背包已满',
    7: '需要消耗点券或付费次数不足',
  }
  return map[r] || `服务器返回状态码 ${r}`
}

// 错误信息简单中文化
function friendlyError(msg: string): string {
  if (!msg) return '操作失败'
  if (msg.includes('code=1034016')) return '抽奖次数已用完'
  if (msg.includes('code=1034005')) return '活动参数错误，请检查兑换参数或商品编号'
  if (msg.includes('code=1000020')) return '请求参数错误'
  if (msg.includes('Internal Server Error')) return '服务器内部错误，请刷新页面或查看日志'
  return msg
}

// 获取 accountId
function getAccountId(): string {
  return localStorage.getItem('current_account_id') || ''
}

// 按名称查背包数量
function getBagCountByName(name: string): number {
  const item = bagItems.value.find((it: any) => it.name === name || it.itemName === name)
  return item ? Number(item.count || 0) : 0
}

// 货币余额列表
const currencyList = computed(() => {
  const list: any[] = []
  const ticket = bagItems.value.find((it: any) => it.name === '点券' || it.itemName === '点券')
  list.push({ name: '点券', value: ticket ? Number(ticket.count || 0) : undefined })
  list.push({ name: '金币', value: basicInfo.value?.gold })
  list.push({ name: '荷露', value: getBagCountByName('荷露') })
  list.push({ name: '助威粽叶', value: getBagCountByName('助威粽叶') })
  return list
})

// 获取货币余额
async function fetchCurrency() {
  try {
    const { data } = await api.get('/api/activity/currency', {
      headers: { 'x-account-id': getAccountId() },
    })
    if (data.ok) {
      basicInfo.value = data.data?.status?.status || null
      bagItems.value = data.data?.bag?.items || []
    }
  }
  catch {}
}

// 获取活动组
async function fetchActivityGroup() {
  loading.value = true
  try {
    const { data } = await api.get(`/api/activity/group/${groupId.value}`, {
      headers: { 'x-account-id': getAccountId() },
    })
    if (data.ok) {
      activities.value = data.data || []
      // 从活动组中直接获取抽奖信息
      const lottery = activities.value.find(a => a.type === 8)
      if (lottery?.drawInfo) {
        drawInfo.value = lottery.drawInfo
      }
    }
  }
  catch {}
  loading.value = false
}

// 获取赛季信息
async function fetchSeasonInfo() {
  try {
    const { data } = await api.get('/api/activity/season', {
      headers: { 'x-account-id': getAccountId() },
    })
    if (data.ok) {
      seasonInfo.value = data.data
    }
  }
  catch {}
}

// 获取节令活动
async function fetchSolarTerms() {
  try {
    const { data } = await api.get('/api/activity/solar-terms', {
      headers: { 'x-account-id': getAccountId() },
    })
    if (data.ok) {
      solarTerms.value = data.data?.terms || []
    }
  }
  catch {}
}

// 获取商店列表与商品
async function fetchShopData() {
  shopLoading.value = true
  try {
    const { data } = await api.get('/api/shop/profiles', {
      headers: { 'x-account-id': getAccountId() },
    })
    if (data.ok) {
      const profiles = data.data?.shop_profiles || []
      shopProfiles.value = profiles
      // 拉取每个商店的商品
      for (const p of profiles) {
        try {
          const shopId = Number(p.shop_id)
          const { data: shopData } = await api.get(`/api/shop/${shopId}`, {
            headers: { 'x-account-id': getAccountId() },
          })
          if (shopData.ok) {
            shopGoodsList.value[shopId] = shopData.data?.goods_list || []
          }
        }
        catch {}
      }
    }
  }
  catch {}
  shopLoading.value = false
}

// 抽奖按钮点击
function onDrawClick(activityId: number, count: number) {
  // drawInfo 未加载或免费次数还有，直接抽
  if (!drawInfo.value || freeRemain.value >= count) {
    // 免费抽: param=count (1=单抽, 4=连抽)
    doOperate(activityId, OPERATE_DRAW, count)
    return
  }
  // 免费用完，需要付费确认
  pendingActivityId.value = activityId
  pendingDrawType.value = count
  showPaidConfirm.value = true
}

// 确认付费抽奖 (付费时 param=0，让服务器自动用点券)
async function confirmPaidDraw() {
  showPaidConfirm.value = false
  const count = pendingDrawType.value
  // 付费连抽逐次单抽，每次 param=0 让服务器自动扣点券
  if (count > 1) {
    for (let i = 0; i < count; i++) {
      await doOperate(pendingActivityId.value, OPERATE_DRAW, 0)
      if (operateResult.value?.result !== 0) break
    }
  }
  else {
    await doOperate(pendingActivityId.value, OPERATE_DRAW, 0)
  }
}

// 通用活动运行 (查看/领取/兑换等)
async function runActivity(activityId: number, operateType: number, param: number = 0, label = '操作') {
  operateLoading.value = true
  operateResult.value = null
  try {
    const { data } = await api.post('/api/activity/operate', {
      activityId,
      operateType,
      param,
    }, {
      headers: { 'x-account-id': getAccountId() },
    })
    if (data.ok) {
      operateResult.value = { ...data.data, _label: label }
      if (data.data?.drawInfo) {
        drawInfo.value = data.data.drawInfo
      }
      await fetchCurrency()
      const rewards = data.data?.rewards || []
      if (rewards.length > 0) {
        toast.success(`${label}成功: ${rewards.map((p: any) => (p.seedName || `#${p.seedId}`) + (p.count > 1 ? ` x${p.count}` : '')).join(', ')}`)
      }
      else if (data.data?.result === 0) {
        toast.success(`${label}成功`)
      }
      else {
        toast.info(resultText(data.data?.result))
      }
    }
    else {
      toast.error(data.error || `${label}失败`)
    }
  }
  catch (e: any) {
    const errData = e.response?.data
    toast.error(friendlyError(errData?.error || e.message || '网络错误'))
  }
  operateLoading.value = false
}

// 领取战令等级奖励 (调用独立的 SeasonService.ClaimBattlePassRewards 接口)
async function claimBattlePass(levelIds: number[], label = '领取战令奖励') {
  if (!levelIds || levelIds.length === 0)
    return
  operateLoading.value = true
  try {
    const { data } = await api.post('/api/activity/battlepass/claim', { levelIds }, {
      headers: { 'x-account-id': getAccountId() },
    })
    if (data.ok) {
      toast.success(`${label}成功`)
      // 刷新赛季信息
      await fetchSeasonInfo()
    }
    else {
      toast.error(data.error || `${label}失败`)
    }
  }
  catch (e: any) {
    const errData = e.response?.data
    toast.error(friendlyError(errData?.error || e.message || '网络错误'))
  }
  operateLoading.value = false
}

// 购买商店商品 (ShopService.BuyGoods)
async function buyShopGoods(shopId: number, goods: any) {
  const goodsId = Number(goods.id || goods.goods_id)
  const price = Number(goods.price || 0)
  const num = 1
  if (!goodsId) {
    toast.error('商品 ID 无效')
    return
  }
  operateLoading.value = true
  try {
    const { data } = await api.post('/api/shop/buy', {
      goodsId,
      num,
      price,
    }, {
      headers: { 'x-account-id': getAccountId() },
    })
    if (data.ok) {
      const getItems = data.data?.get_items || []
      if (getItems.length > 0) {
        toast.success(`购买成功: 获得 ${getItems.map((it: any) => `${it.itemId || it.item_id} x${it.count || it.num || 1}`).join(', ')}`)
      }
      else {
        toast.success('购买成功')
      }
      // 刷新该商店的商品 (更新 bought_num 和 unlocked)
      try {
        const { data: shopData } = await api.get(`/api/shop/${shopId}`, {
          headers: { 'x-account-id': getAccountId() },
        })
        if (shopData.ok) {
          shopGoodsList.value = { ...shopGoodsList.value, [shopId]: shopData.data?.goods_list || [] }
        }
      }
      catch {}
      await fetchCurrency()
    }
    else {
      toast.error(data.error || '购买失败')
    }
  }
  catch (e: any) {
    const errData = e.response?.data
    toast.error(friendlyError(errData?.error || e.message || '网络错误'))
  }
  operateLoading.value = false
}

// 一键领取所有已达成等级的战令奖励
function claimAllBattlePass() {
  const levels = battlePassLevels.value
  if (!levels || levels.length === 0) {
    toast.info('没有可领取的等级奖励')
    return
  }
  // 收集所有已达成等级 (level <= 当前等级) 且有奖励的 level
  const claimableLevels = levels
    .filter((lvl: any) => lvl.level <= battlePassLevel.value && (lvl.freeReward || (lvl.premiumRewards?.length && seasonInfo.value?.isPremium)))
    .map((lvl: any) => lvl.level)
  if (claimableLevels.length === 0) {
    toast.info('没有可领取的等级奖励')
    return
  }
  claimBattlePass(claimableLevels, `一键领取 ${claimableLevels.length} 个等级奖励`)
}

// 活动操作
async function doOperate(activityId: number, operateType: number, param: number = 1) {
  operateLoading.value = true
  operateResult.value = null
  try {
    const { data } = await api.post('/api/activity/operate', {
      activityId,
      operateType,
      param,
    }, {
      headers: { 'x-account-id': getAccountId() },
    })
    if (data.ok) {
      operateResult.value = data.data
      // 更新抽奖信息
      if (data.data?.drawInfo) {
        drawInfo.value = data.data.drawInfo
      }
      // 刷新货币
      await fetchCurrency()
    }
    else {
      toast.error(data.error || '操作失败')
    }
  }
  catch (e: any) {
    const errData = e.response?.data
    toast.error(friendlyError(errData?.error || e.message || '网络错误'))
  }
  operateLoading.value = false
}

// 抽奖活动 (活动组中 type=8)
const lotteryActivities = computed(() =>
  activities.value.filter(a => a.type === ACTIVITY_TYPE_LOTTERY),
)

// 每日任务活动
const dailyActivities = computed(() =>
  activities.value.filter(a => a.type === ACTIVITY_TYPE_DAILY),
)

// 其他类型活动 (非抽奖/非商店/非每日)
const otherActivities = computed(() =>
  activities.value.filter(a =>
    a.type !== ACTIVITY_TYPE_LOTTERY
    && a.type !== ACTIVITY_TYPE_SHOP
    && a.type !== ACTIVITY_TYPE_DAILY,
  ),
)

// 活动类型标签
function activityTypeLabel(type: number): { text: string; color: string } {
  const map: Record<number, { text: string; color: string }> = {
    1: { text: '每日任务', color: '#3b82f6' },
    3: { text: '商店', color: '#f59e0b' },
    8: { text: '抽奖', color: '#8b5cf6' },
  }
  return map[type] || { text: `类型${type}`, color: '#6b7280' }
}

// 总剩余次数
const totalRemaining = computed(() => {
  if (!drawInfo.value)
    return '-'
  return freeRemain.value + paidRemain.value
})

// 免费剩余 (只用 freeRemaining，不回退到 freeLimit)
const freeRemain = computed(() => {
  if (!drawInfo.value)
    return 0
  return drawInfo.value.freeRemaining ?? 0
})

// 付费剩余 (只用 paidRemaining，不回退到 paidLimit)
const paidRemain = computed(() => {
  if (!drawInfo.value)
    return 0
  return drawInfo.value.paidRemaining ?? 0
})

// 战令等级/积分（后端已解析 battle_pass）
const battlePassLevel = computed(() => Number(seasonInfo.value?.level) || 1)
const battlePassScore = computed(() => Number(seasonInfo.value?.score) || 0)
const battlePassScoreNeed = computed(() => Number(seasonInfo.value?.scoreNeed) || 1200)
const battlePassLevels = computed(() => seasonInfo.value?.battlePass?.levels || [])

// 战令状态文本
function seasonStatusText(status: number): string {
  if (status === 1) return '进行中'
  if (status === 2) return '已结束/未开始'
  return `状态${status}`
}

// 格式化奖励物品
function formatReward(reward: any): string {
  if (!reward) return ''
  const name = reward.itemName || `物品#${reward.itemId}`
  return `${name} x${reward.count || 1}`
}

// 把 protobuf long 对象 {low, high} 转成数字
function toLongNumber(val: any): number {
  if (val === null || val === undefined) return 0
  if (typeof val === 'number') return val
  if (typeof val === 'string') return Number(val) || 0
  if (typeof val === 'object' && 'low' in val) {
    // 简单的 32 位处理，游戏 ID 通常不会超过 32 位
    return Number(val.low) || 0
  }
  return 0
}

onMounted(() => {
  fetchActivityGroup()
  fetchSeasonInfo()
  fetchSolarTerms()
  fetchCurrency()
  fetchShopData()
})
</script>

<template>
  <div class="activity-page">
    <!-- Tab 栏 -->
    <div class="tabs">
      <button
        v-for="tab in [
          { key: 'lottery', label: '奇遇礼莲', icon: '🎰' },
          { key: 'battlepass', label: '荷风游记', icon: '📜' },
          { key: 'shop', label: '荷露商店', icon: '🛒' },
          { key: 'solar', label: '节令小礼', icon: '🌿' },
          { key: 'all', label: '全部活动', icon: '🎁' },
        ]"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key as any"
      >
        <span class="tab-icon">{{ tab.icon }}</span>
        <span class="tab-label">{{ tab.label }}</span>
      </button>
    </div>

    <!-- 货币余额 -->
    <div class="currency-card">
      <div class="currency-title">
        货币余额
      </div>
      <div class="currency-list">
        <div v-for="c in currencyList" :key="c.name" class="currency-item">
          <span class="currency-icon">{{ currencyConfig[c.name]?.icon || '💰' }}</span>
          <span class="currency-value" :style="{ color: currencyConfig[c.name]?.color || '#111827' }">{{ c.value !== undefined ? formatNumber(c.value) : '?' }}</span>
          <span class="currency-name">{{ c.name }}</span>
        </div>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="content">
      <!-- 奇遇礼莲 (抽奖) -->
      <div v-if="activeTab === 'lottery'" class="tab-content">
        <div v-if="loading" class="loading">
          加载中...
        </div>
        <div v-else-if="lotteryActivities.length === 0" class="empty">
          暂无抽奖活动
        </div>
        <div v-else>
          <div v-for="act in lotteryActivities" :key="act.activityId" class="lottery-card">
            <div class="card-header">
              <div class="card-title">
                {{ act.name }}
              </div>
              <div v-if="act.beginTime" class="card-time">
                {{ formatDate(act.beginTime) }} ~ {{ formatDate(act.endTime) }}
              </div>
            </div>

            <!-- 抽奖次数 -->
            <div class="lottery-limits">
              <div class="limit-item">
                <span class="limit-label">免费</span>
                <span class="limit-value" :class="freeRemain > 0 ? 'free' : 'used'">{{ freeRemain }} / {{ drawInfo?.freeLimit ?? '-' }}</span>
              </div>
              <div class="limit-item">
                <span class="limit-label">付费</span>
                <span class="limit-value" :class="paidRemain > 0 ? 'paid' : 'used'">{{ paidRemain }} / {{ drawInfo?.paidLimit ?? '-' }}</span>
              </div>
              <div class="limit-hint">
                付费抽奖每次需要30点券
              </div>
            </div>

            <!-- 活动说明 -->
            <div v-if="act.extra" class="activity-desc">
              <div v-for="(txt, i) in parseExtra(act.extra)?.tips?.txt || []" :key="i" v-html="txt" />
            </div>

            <!-- 抽奖按钮 -->
            <div v-if="totalRemaining > 0" class="card-actions">
              <button
                class="btn btn-primary"
                :disabled="operateLoading || (freeRemain + paidRemain) < 1"
                @click="onDrawClick(act.activityId, 1)"
              >
                {{ operateLoading ? '抽奖中...' : (freeRemain > 0 ? '免费单抽' : '30点券单抽') }}
              </button>
              <button
                class="btn btn-accent"
                :disabled="operateLoading || (freeRemain + paidRemain) < 4"
                @click="onDrawClick(act.activityId, 4)"
              >
                {{ operateLoading ? '抽奖中...' : (freeRemain >= 4 ? '免费连抽' : '120点券连抽') }}
              </button>
            </div>
            <div v-else class="draw-empty">
              今日次数已用完
            </div>

            <!-- 付费确认弹窗 -->
            <Teleport to="body">
              <div v-if="showPaidConfirm" class="modal-overlay" @click.self="showPaidConfirm = false">
                <div class="modal-box">
                  <div class="modal-title">
                    确认抽奖
                  </div>
                  <div class="modal-body">
                    当前免费次数已用完，将消耗点券。
                    <br><br>
                    本次抽奖将花费 <b>{{ pendingDrawType * 30 }}</b> 点券
                  </div>
                  <div class="modal-actions">
                    <button class="btn btn-secondary" @click="showPaidConfirm = false">
                      取消
                    </button>
                    <button class="btn btn-primary" @click="confirmPaidDraw">
                      确认
                    </button>
                  </div>
                </div>
              </div>
            </Teleport>

            <!-- 奖品池 -->
            <div v-if="drawInfo?.prizes?.length" class="prize-pool">
              <div class="prize-title">
                奖品池
              </div>
              <div class="prize-list">
                <div
                  v-for="(prize, i) in drawInfo.prizes"
                  :key="i"
                  class="prize-item"
                  :class="`quality-${prize.quality}`"
                >
                  <div class="prize-name">
                    {{ prize.seedName || `种子#${prize.seedId}` }}
                  </div>
                  <div class="prize-meta">
                    <span class="prize-quality">{{ qualityLabel(prize.quality) }}</span>
                    <span class="prize-prob">{{ prize.probability }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 抽奖结果 -->
          <div v-if="operateResult" class="result-card">
            <div class="result-title">
              抽奖结果
            </div>
            <div class="result-data">
              <div class="result-status" :class="`status-${operateResult.result}`">
                {{ resultText(operateResult.result) }}
              </div>
              <template v-if="operateResult.rewards?.length">
                获得: {{ operateResult.rewards.map((p: any) => (p.seedName || `#${p.seedId}`) + (p.count > 1 ? ` x${p.count}` : '')).join(', ') }}
              </template>
              <template v-else-if="operateResult.result === 0">
                未获得奖励
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- 荷风游记 (战令) -->
      <div v-if="activeTab === 'battlepass'" class="tab-content">
        <div v-if="!seasonInfo" class="loading">
          加载中...
        </div>
        <div v-else class="season-card">
          <div class="card-title">
            {{ seasonInfo.name }}
          </div>
          <div class="card-time">
            {{ formatDate(seasonInfo.start_time) }} ~ {{ formatDate(seasonInfo.end_time) }}
          </div>
          <div class="season-info">
            <div>状态: {{ seasonStatusText(seasonInfo.status) }}</div>
          </div>

          <div v-if="seasonInfo.battlePass" class="battlepass-section">
            <div class="bp-header">
              <div class="bp-level">
                Lv{{ battlePassLevel }} → Lv{{ battlePassLevel + 1 }}
              </div>
              <button
                class="btn btn-gold btn-sm"
                :disabled="operateLoading"
                @click="claimAllBattlePass"
              >
                🎁 一键领取
              </button>
            </div>
            <div class="bp-score-bar">
              <div class="bp-score-fill" :style="{ width: `${Math.min(100, (battlePassScore / battlePassScoreNeed) * 100)}%` }" />
            </div>
            <div class="bp-score-text">
              {{ formatNumber(battlePassScore) }} / {{ formatNumber(battlePassScoreNeed) }} 积分
            </div>

            <div class="bp-rewards">
              <div class="rewards-title">
                等级奖励
              </div>
              <div class="bp-levels">
                <div
                  v-for="lvl in battlePassLevels"
                  :key="lvl.level"
                  class="bp-level-row"
                  :class="{ current: lvl.level === battlePassLevel, passed: lvl.level < battlePassLevel }"
                >
                  <div class="bp-level-num">
                    {{ lvl.level }} 级
                  </div>
                  <div class="bp-level-rewards">
                    <div v-if="lvl.freeReward" class="reward-tag free">
                      免费: {{ formatReward(lvl.freeReward) }}
                    </div>
                    <div v-for="(pr, idx) in lvl.premiumRewards" :key="idx" class="reward-tag premium">
                      付费: {{ formatReward(pr) }}
                    </div>
                  </div>
                  <div v-if="lvl.level <= battlePassLevel" class="bp-claim-actions">
                    <button
                      v-if="lvl.freeReward"
                      class="btn btn-primary btn-sm"
                      :disabled="operateLoading"
                      @click="claimBattlePass([lvl.level], `领取Lv${lvl.level}免费奖励`)"
                    >
                      领取免费
                    </button>
                    <button
                      v-if="lvl.premiumRewards?.length && seasonInfo?.isPremium"
                      class="btn btn-gold btn-sm"
                      :disabled="operateLoading"
                      @click="claimBattlePass([lvl.level], `领取Lv${lvl.level}付费奖励`)"
                    >
                      领取付费
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="seasonInfo.battlePassRaw" class="battlepass-raw">
            battle_pass(hex): {{ seasonInfo.battlePassRaw.slice(0, 64) }}...
          </div>
        </div>
      </div>

      <!-- 荷露商店 (兑换) -->
      <div v-if="activeTab === 'shop'" class="tab-content">
        <div class="shop-toolbar">
          <button
            class="btn btn-secondary btn-sm"
            :disabled="shopLoading"
            @click="fetchShopData"
          >
            🔄 刷新商店
          </button>
        </div>
        <div v-if="shopLoading" class="loading">
          加载中...
        </div>
        <div v-else-if="shopProfiles.length === 0" class="empty">
          暂无商店
        </div>
        <div v-else>
          <div v-for="shop in shopProfiles" :key="shop.shop_id" class="shop-card">
            <div class="card-title">
              {{ shop.shop_name }} <span class="shop-id">#{{ shop.shop_id }}</span>
            </div>
            <div class="shop-type">
              类型: {{ shop.shop_type === 1 ? '道具商店' : shop.shop_type === 2 ? '种子商店' : shop.shop_type === 3 ? '宠物商店' : `类型${shop.shop_type}` }}
            </div>

            <div v-if="(shopGoodsList[shop.shop_id] || []).length" class="shop-goods">
              <div
                v-for="g in (shopGoodsList[shop.shop_id] || [])"
                :key="g.id"
                class="goods-item"
                :class="{ locked: !g.unlocked }"
              >
                <div class="goods-info">
                  <div class="goods-name">
                    物品 #{{ g.item_id }}
                    <span v-if="!g.unlocked" class="locked-tag">🔒 未解锁</span>
                  </div>
                  <div class="goods-price">
                    <span class="price-value">{{ formatNumber(g.price) }}</span>
                    <span class="price-currency">金币</span>
                  </div>
                  <div class="goods-meta">
                    <span>每次: x{{ g.item_count || 1 }}</span>
                    <span v-if="g.limit_count > 0" class="goods-limit">
                      限购 {{ g.bought_num || 0 }} / {{ g.limit_count }}
                    </span>
                    <span v-else class="goods-unlimited">不限购</span>
                  </div>
                </div>
                <button
                  class="btn btn-primary btn-sm"
                  :disabled="operateLoading || !g.unlocked"
                  @click="buyShopGoods(Number(shop.shop_id), g)"
                >
                  {{ operateLoading ? '购买中...' : (g.unlocked ? '购买' : '未解锁') }}
                </button>
              </div>
            </div>
            <div v-else class="shop-debug">
              <div class="debug-title">该商店暂无商品</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 节令小礼 -->
      <div v-if="activeTab === 'solar'" class="tab-content">
        <div v-if="solarTerms.length === 0" class="empty">
          暂无节令活动
        </div>
        <div v-else>
          <div v-for="term in solarTerms" :key="term.term_id" class="solar-card">
            <div class="card-title">
              {{ term.name }}
            </div>
            <div class="card-time">
              {{ formatDate(term.start_time) }} ~ {{ formatDate(term.end_time) }}
            </div>
            <div class="solar-info">
              <div>状态: {{ term.status === 1 ? '进行中' : '已结束' }}</div>
            </div>
            <div v-if="term.rewards?.length" class="solar-rewards">
              <div class="rewards-title">
                节令奖励
              </div>
              <div v-for="(r, i) in term.rewards" :key="i" class="reward-item">
                物品 #{{ toLongNumber(r.item_id) }} x{{ toLongNumber(r.count) }}
              </div>
            </div>
            <div v-if="term.status === 1" class="card-actions">
              <button
                class="btn btn-primary"
                :disabled="operateLoading"
                @click="runActivity(toLongNumber(term.term_id), OPERATE_VIEW, 0, '查看节令')"
              >
                👁 查看
              </button>
              <button
                class="btn btn-accent"
                :disabled="operateLoading"
                @click="runActivity(toLongNumber(term.term_id), OPERATE_CLAIM, 0, '领取节令奖励')"
              >
                🎁 领取奖励
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 全部活动 -->
      <div v-if="activeTab === 'all'" class="tab-content">
        <div v-if="loading" class="loading">
          加载中...
        </div>
        <div v-else-if="activities.length === 0" class="empty">
          暂无活动
        </div>
        <div v-else>
          <!-- 每日任务 -->
          <div v-if="dailyActivities.length > 0" class="section-title">
            📋 每日任务 ({{ dailyActivities.length }})
          </div>
          <div
            v-for="act in dailyActivities"
            :key="act.activityId"
            class="all-activity-card"
          >
            <div class="all-activity-header">
              <span class="type-badge" :style="{ background: activityTypeLabel(act.type).color }">
                {{ activityTypeLabel(act.type).text }}
              </span>
              <span class="all-activity-name">{{ act.name }}</span>
            </div>
            <div v-if="act.beginTime" class="card-time">
              {{ formatDate(act.beginTime) }} ~ {{ formatDate(act.endTime) }}
            </div>
            <div class="card-actions">
              <button
                class="btn btn-primary"
                :disabled="operateLoading"
                @click="runActivity(act.activityId, OPERATE_CLAIM, 0, '领取奖励')"
              >
                🎁 领取奖励
              </button>
              <button
                class="btn btn-secondary"
                :disabled="operateLoading"
                @click="runActivity(act.activityId, OPERATE_VIEW, 0, '查看活动')"
              >
                👁 查看
              </button>
            </div>
          </div>

          <!-- 其他类型活动 -->
          <div v-if="otherActivities.length > 0" class="section-title">
            🎁 其他活动 ({{ otherActivities.length }})
          </div>
          <div
            v-for="act in otherActivities"
            :key="act.activityId"
            class="all-activity-card"
          >
            <div class="all-activity-header">
              <span class="type-badge" :style="{ background: activityTypeLabel(act.type).color }">
                {{ activityTypeLabel(act.type).text }}
              </span>
              <span class="all-activity-name">{{ act.name }}</span>
            </div>
            <div v-if="act.beginTime" class="card-time">
              {{ formatDate(act.beginTime) }} ~ {{ formatDate(act.endTime) }}
            </div>
            <div class="card-actions">
              <button
                class="btn btn-primary"
                :disabled="operateLoading"
                @click="runActivity(act.activityId, OPERATE_CLAIM, 0, '领取奖励')"
              >
                🎁 领取
              </button>
              <button
                class="btn btn-secondary"
                :disabled="operateLoading"
                @click="runActivity(act.activityId, OPERATE_VIEW, 0, '查看活动')"
              >
                👁 查看
              </button>
            </div>
          </div>

          <!-- 全部活动汇总列表 -->
          <div class="section-title">
            📦 全部活动汇总 ({{ activities.length }})
          </div>
          <div
            v-for="act in activities"
            :key="`sum-${act.activityId}`"
            class="all-activity-card compact"
          >
            <div class="all-activity-header">
              <span class="type-badge" :style="{ background: activityTypeLabel(act.type).color }">
                {{ activityTypeLabel(act.type).text }}
              </span>
              <span class="all-activity-name">{{ act.name }}</span>
              <span class="activity-id">ID: {{ act.activityId }}</span>
            </div>
            <div class="card-actions">
              <button
                class="btn btn-primary btn-sm"
                :disabled="operateLoading"
                @click="runActivity(act.activityId, OPERATE_CLAIM, 0, `领取-${act.name}`)"
              >
                领取
              </button>
              <button
                class="btn btn-secondary btn-sm"
                :disabled="operateLoading"
                @click="runActivity(act.activityId, OPERATE_VIEW, 0, `查看-${act.name}`)"
              >
                查看
              </button>
              <button
                v-if="act.type === ACTIVITY_TYPE_LOTTERY"
                class="btn btn-accent btn-sm"
                :disabled="operateLoading"
                @click="runActivity(act.activityId, OPERATE_DRAW, 1, `单抽-${act.name}`)"
              >
                单抽
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 16px;
}

.tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 10px;
  background: var(--bg-primary, #fff);
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}

.tab-btn:hover {
  background: var(--bg-hover, #f3f4f6);
}

.tab-btn.active {
  background: var(--accent-bg, #ecfdf5);
  border-color: var(--accent-color, #059669);
  color: var(--accent-color, #059669);
  font-weight: 600;
}

.tab-icon {
  font-size: 18px;
}

.content {
  flex: 1;
  overflow-y: auto;
}

.tab-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.loading,
.empty {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary, #9ca3af);
}

.lottery-card,
.shop-card,
.season-card,
.solar-card,
.result-card {
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 12px;
  padding: 20px;
}

.card-header {
  margin-bottom: 16px;
}

.card-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #111827);
}

.card-time {
  font-size: 13px;
  color: var(--text-secondary, #9ca3af);
  margin-top: 4px;
}

.activity-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary, #6b7280);
  padding: 12px;
  background: var(--bg-secondary, #f9fafb);
  border-radius: 8px;
  margin-bottom: 16px;
}

.activity-desc :deep(b) {
  color: var(--text-primary, #111827);
  font-weight: 600;
}

.activity-desc :deep(br) {
  display: block;
  margin-top: 4px;
}

.card-actions {
  display: flex;
  gap: 12px;
}

.btn {
  padding: 10px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  border: none;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent-color, #059669);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover, #047857);
}

.btn-accent {
  background: #8b5cf6;
  color: #fff;
}

.btn-accent:hover:not(:disabled) {
  background: #7c3aed;
}

.btn-gold {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
}

.btn-gold:hover:not(:disabled) {
  background: linear-gradient(135deg, #d97706, #b45309);
}

.btn-sm {
  padding: 6px 14px;
  font-size: 12px;
}

.section-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary, #111827);
  margin-top: 16px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 2px solid var(--border-color, #e5e7eb);
}

.section-title:first-child {
  margin-top: 0;
}

.all-activity-card {
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 10px;
}

.all-activity-card.compact {
  padding: 10px 14px;
}

.all-activity-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.all-activity-card.compact .all-activity-header {
  margin-bottom: 6px;
}

.type-badge {
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}

.all-activity-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #111827);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-id {
  font-size: 11px;
  color: var(--text-secondary, #9ca3af);
  font-family: monospace;
}

.season-info,
.solar-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
}

.battlepass-data {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-secondary, #f9fafb);
  border-radius: 8px;
  color: var(--text-secondary, #6b7280);
  font-size: 13px;
}

.battlepass-section {
  margin-top: 16px;
}

.bp-level {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary, #111827);
  margin-bottom: 10px;
}

.bp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.bp-header .bp-level {
  margin-bottom: 0;
}

.bp-score-bar {
  height: 10px;
  background: var(--bg-secondary, #f3f4f6);
  border-radius: 5px;
  overflow: hidden;
  margin-bottom: 6px;
}

.bp-score-fill {
  height: 100%;
  background: linear-gradient(90deg, #34d399, #059669);
  border-radius: 5px;
  transition: width 0.3s;
}

.bp-score-text {
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
  margin-bottom: 16px;
}

.bp-levels {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bp-level-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--bg-secondary, #f9fafb);
  border-radius: 8px;
  border-left: 3px solid transparent;
}

.bp-level-row.current {
  border-left-color: #f59e0b;
  background: #fffbeb;
}

.bp-level-row.passed {
  opacity: 0.7;
}

.bp-level-num {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #6b7280);
  min-width: 40px;
}

.bp-level-row.current .bp-level-num {
  color: #f59e0b;
}

.bp-level-rewards {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
}

.reward-tag {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
}

.reward-tag.free {
  background: #dcfce7;
  color: #15803d;
}

.reward-tag.premium {
  background: #fef3c7;
  color: #b45309;
}

.bp-claim-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.battlepass-raw {
  margin-top: 12px;
  padding: 10px;
  background: var(--bg-secondary, #f9fafb);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-secondary, #9ca3af);
  word-break: break-all;
}

.solar-rewards {
  margin-top: 12px;
}

.rewards-title {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 8px;
  color: var(--text-primary, #111827);
}

.reward-item {
  padding: 6px 12px;
  background: var(--bg-secondary, #f9fafb);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
  margin-bottom: 4px;
}

.lottery-limits {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.limit-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-secondary, #f9fafb);
  border-radius: 8px;
}

.limit-label {
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}

.limit-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--accent-color, #059669);
}

.limit-value.free {
  color: var(--accent-color, #059669);
}

.limit-value.paid {
  color: #f59e0b;
}

.limit-value.used {
  color: var(--text-secondary, #9ca3af);
  text-decoration: line-through;
}

.limit-hint {
  font-size: 12px;
  color: var(--text-secondary, #9ca3af);
  margin-left: 4px;
  align-self: center;
}

.draw-empty {
  font-size: 14px;
  color: var(--text-secondary, #9ca3af);
  padding: 10px 0;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-box {
  background: var(--bg-primary, #fff);
  border-radius: 16px;
  padding: 24px;
  width: 320px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}

.modal-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 16px;
  color: var(--text-primary, #111827);
}

.modal-body {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary, #6b7280);
  margin-bottom: 20px;
}

.modal-body b {
  color: #f59e0b;
  font-weight: 700;
  font-size: 16px;
}

.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.btn-secondary {
  background: var(--bg-secondary, #f3f4f6);
  color: var(--text-secondary, #6b7280);
}

.prize-pool {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color, #e5e7eb);
}

.prize-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--text-primary, #111827);
}

.prize-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.prize-item {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-secondary, #f9fafb);
  border-left: 3px solid #9ca3af;
}

.prize-item.quality-2 {
  border-left-color: #3b82f6;
}

.prize-item.quality-3 {
  border-left-color: #a855f7;
}

.prize-item.quality-4 {
  border-left-color: #f59e0b;
}

.prize-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #111827);
  margin-bottom: 4px;
}

.prize-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.prize-quality {
  color: var(--text-secondary, #6b7280);
}

.prize-prob {
  font-weight: 600;
  color: var(--accent-color, #059669);
}

.currency-card {
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 12px;
  padding: 16px 20px;
}

.currency-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #111827);
  margin-bottom: 12px;
}

.currency-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}

.currency-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
  background: var(--bg-secondary, #f9fafb);
  border-radius: 10px;
}

.currency-icon {
  font-size: 22px;
}

.currency-value {
  font-size: 18px;
  font-weight: 700;
}

.currency-name {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.shop-goods {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.goods-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: var(--bg-secondary, #f9fafb);
  border-radius: 10px;
}

.goods-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #111827);
}

.goods-price {
  font-size: 13px;
  margin-top: 4px;
}

.price-value {
  font-weight: 700;
  color: #f59e0b;
}

.price-currency {
  color: var(--text-secondary, #6b7280);
  margin-left: 4px;
}

.goods-limit {
  font-size: 12px;
  color: var(--text-secondary, #9ca3af);
  margin-top: 2px;
}

.shop-debug {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-secondary, #f9fafb);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  overflow-x: auto;
}

.shop-debug pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.debug-raw {
  margin-top: 8px;
  padding: 8px;
  background: #fef3c7;
  border-radius: 6px;
  font-size: 11px;
  color: #92400e;
  word-break: break-all;
  font-family: monospace;
}

.shop-toolbar {
  margin-bottom: 12px;
}

.shop-id {
  font-size: 12px;
  color: var(--text-secondary, #9ca3af);
  font-weight: normal;
}

.shop-type {
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
  margin-bottom: 12px;
}

.goods-item.locked {
  opacity: 0.6;
  background: #f3f4f6;
}

.goods-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary, #9ca3af);
  margin-top: 4px;
}

.goods-unlimited {
  color: #10b981;
}

.locked-tag {
  display: inline-block;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #fbbf24;
  color: #78350f;
  margin-left: 6px;
}

.result-card {
  background: #f0fdf4;
  border-color: #86efac;
}

.result-title {
  font-size: 16px;
  font-weight: 600;
  color: #166534;
  margin-bottom: 12px;
}

.result-data {
  font-size: 14px;
  color: #15803d;
}

.result-status {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 10px;
  padding: 6px 10px;
  border-radius: 8px;
  display: inline-block;
}

.result-status.status-0 {
  color: #15803d;
  background: #dcfce7;
}

.result-status:not(.status-0) {
  color: #b91c1c;
  background: #fee2e2;
}
</style>
