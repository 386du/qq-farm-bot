<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()

const activeTab = ref<'lottery' | 'battlepass' | 'shop' | 'solar'>('lottery')
const loading = ref(false)

// 活动组数据
const activities = ref<any[]>([])
const groupId = ref(2026060100)

// 赛季数据
const seasonInfo = ref<any>(null)

// 节令数据
const solarTerms = ref<any[]>([])

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

// 抽奖按钮点击
function onDrawClick(activityId: number, count: number) {
  // drawInfo 未加载或免费次数还有，直接抽
  if (!drawInfo.value || freeRemain.value >= count) {
    doOperate(activityId, 7, count)
    return
  }
  // 免费用完，需要付费确认
  pendingActivityId.value = activityId
  pendingDrawType.value = count
  showPaidConfirm.value = true
}

// 确认付费抽奖
async function confirmPaidDraw() {
  showPaidConfirm.value = false
  const count = pendingDrawType.value
  // 付费时服务器可能不接受 param=4，改为逐次单抽
  if (count > 1) {
    for (let i = 0; i < count; i++) {
      await doOperate(pendingActivityId.value, 7, 1)
      if (operateResult.value?.result !== 0) break
    }
  }
  else {
    await doOperate(pendingActivityId.value, 7, 1)
  }
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

// 按类型筛选活动
const lotteryActivities = computed(() =>
  activities.value.filter(a => a.type === 8),
)
const shopActivities = computed(() =>
  activities.value.filter(a => a.type === 3),
)

// 商店商品列表（尝试从 extra 解析）
const shopGoods = computed(() => {
  const act = shopActivities.value[0]
  if (!act) return []
  const extra = parseExtra(act.extra)
  if (!extra) return []
  const goods = extra.goods || extra.items || extra.shop || extra.products || extra.exchangeItems || extra.shopItems || extra.commodities
  if (Array.isArray(goods)) {
    return goods.map((g: any, idx: number) => ({
      id: g.id || g.itemId || g.item_id || g.goodsId || idx + 1,
      name: g.name || g.itemName || `商品#${idx + 1}`,
      icon: g.icon || g.image || g.itemId || g.id,
      price: Number(g.price || g.cost || g.need || 0),
      currency: g.currency || g.currencyName || '荷露',
      limit: g.limit ?? g.limitCount ?? g.buyLimit ?? null,
      bought: g.bought ?? g.buyCount ?? 0,
      param: g.param ?? g.index ?? (idx + 1),
    }))
  }
  return []
})

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
            <div class="bp-level">
              Lv{{ battlePassLevel }} → Lv{{ battlePassLevel + 1 }}
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
        <div v-if="loading" class="loading">
          加载中...
        </div>
        <div v-else-if="shopActivities.length === 0" class="empty">
          暂无商店活动
        </div>
        <div v-else>
          <div v-for="act in shopActivities" :key="act.activityId" class="shop-card">
            <div class="card-title">
              {{ act.name }}
            </div>
            <div class="activity-info">
              <div v-if="act.beginTime" class="info-row">
                <span class="info-label">活动时间</span>
                <span class="info-value">{{ formatDate(act.beginTime) }} ~ {{ formatDate(act.endTime) }}</span>
              </div>
            </div>

            <div v-if="shopGoods.length" class="shop-goods">
              <div v-for="g in shopGoods" :key="g.id" class="goods-item">
                <div class="goods-info">
                  <div class="goods-name">{{ g.name }}</div>
                  <div class="goods-price">
                    <span class="price-value">{{ formatNumber(g.price) }}</span>
                    <span class="price-currency">{{ g.currency }}</span>
                  </div>
                  <div v-if="g.limit !== null" class="goods-limit">
                    限购 {{ g.bought }} / {{ g.limit }}
                  </div>
                </div>
                <button
                  class="btn btn-primary"
                  :disabled="operateLoading"
                  @click="doOperate(act.activityId, 1, g.param)"
                >
                  {{ operateLoading ? '兑换中...' : '兑换' }}
                </button>
              </div>
            </div>
            <div v-else class="shop-debug">
              <div class="debug-title">未解析到商品，extra 原始数据：</div>
              <pre>{{ JSON.stringify(parseExtra(act.extra), null, 2) }}</pre>
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
