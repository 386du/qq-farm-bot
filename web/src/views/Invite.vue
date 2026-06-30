<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

interface InviteRule {
  count: number
  rewardDays: number
  rewardAccountLimit?: number
  description?: string
}

interface InviteInfo {
  code: string
  count: number
  invitees: string[]
  availableRewards: InviteRule[]
  claimed: number[]
  totalRewardDays: number
  totalRewardAccountLimit: number
  enabled: boolean
  rules: InviteRule[]
}

const toast = useToastStore()
const userStore = useUserStore()

const loading = ref(false)
const claiming = ref<number | null>(null)
const inviteInfo = ref<InviteInfo | null>(null)

const inviteUrl = computed(() => {
  if (!inviteInfo.value?.code)
    return ''
  return `${window.location.origin}/login?invite=${inviteInfo.value.code}`
})

const rewardList = computed(() => {
  if (!inviteInfo.value)
    return []
  return inviteInfo.value.rules.map((rule) => {
    const claimed = inviteInfo.value!.claimed.includes(rule.count)
    const available = !claimed && inviteInfo.value!.count >= rule.count
    return { ...rule, claimed, available }
  })
})

async function fetchInviteInfo() {
  loading.value = true
  try {
    const res = await api.get('/api/invite/me')
    if (res.data.ok) {
      inviteInfo.value = res.data.data
    }
    else {
      toast.error(res.data.error || '获取邀请信息失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取邀请信息失败')
  }
  finally {
    loading.value = false
  }
}

async function copyCode() {
  if (!inviteInfo.value?.code)
    return
  try {
    await navigator.clipboard.writeText(inviteInfo.value.code)
    toast.success('邀请码已复制')
  }
  catch {
    toast.error('复制失败，请手动复制')
  }
}

async function copyLink() {
  if (!inviteUrl.value)
    return
  try {
    await navigator.clipboard.writeText(inviteUrl.value)
    toast.success('邀请链接已复制')
  }
  catch {
    toast.error('复制失败，请手动复制')
  }
}

async function claimReward(count: number) {
  claiming.value = count
  try {
    const res = await api.post('/api/invite/claim', { count })
    if (res.data.ok) {
      toast.success('奖励领取成功')
      await fetchInviteInfo()
      await userStore.fetchUserInfo()
    }
    else {
      toast.error(res.data.error || '领取失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '领取失败')
  }
  finally {
    claiming.value = null
  }
}

function formatReward(rule: InviteRule): string {
  const parts: string[] = []
  if (rule.rewardDays > 0)
    parts.push(`+${rule.rewardDays} 天时长`)
  if (rule.rewardAccountLimit && rule.rewardAccountLimit > 0)
    parts.push(`+${rule.rewardAccountLimit} 账号额度`)
  return parts.join('、') || '无奖励'
}

onMounted(() => {
  fetchInviteInfo()
})
</script>

<template>
  <div class="invite-page">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon">🎁</span>
        邀请好友
      </h1>
      <p class="page-subtitle">
        邀请好友加入，解锁丰厚奖励
      </p>
    </div>

    <div v-if="!inviteInfo?.enabled" class="disabled-banner">
      <span class="banner-icon">⏸️</span>
      邀请功能当前未开启，请联系管理员
    </div>

    <div v-else class="invite-content">
      <!-- 邀请码卡片 -->
      <div class="invite-card">
        <div class="card-title">
          <span class="card-icon">🎫</span>
          我的邀请码
        </div>
        <div class="invite-code-section">
          <div class="invite-code">
            {{ inviteInfo?.code || '加载中...' }}
          </div>
          <BaseButton variant="primary" size="sm" :disabled="!inviteInfo?.code" @click="copyCode">
            复制邀请码
          </BaseButton>
        </div>
        <div class="invite-link-section">
          <BaseInput v-model="inviteUrl" readonly placeholder="邀请链接" />
          <BaseButton variant="secondary" size="sm" :disabled="!inviteUrl" @click="copyLink">
            复制链接
          </BaseButton>
        </div>
        <div class="invite-stats">
          <div class="stat-item">
            <div class="stat-value">
              {{ inviteInfo?.count || 0 }}
            </div>
            <div class="stat-label">
              已邀请人数
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-value">
              {{ inviteInfo?.totalRewardDays || 0 }}
            </div>
            <div class="stat-label">
              累计奖励天数
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-value">
              {{ inviteInfo?.totalRewardAccountLimit || 0 }}
            </div>
            <div class="stat-label">
              累计奖励额度
            </div>
          </div>
        </div>
      </div>

      <!-- 奖励档位 -->
      <div class="invite-card">
        <div class="card-title">
          <span class="card-icon">🏆</span>
          邀请奖励
        </div>
        <div v-if="rewardList.length === 0" class="empty-state">
          暂无奖励配置，敬请期待
        </div>
        <div v-else class="reward-list">
          <div
            v-for="rule in rewardList"
            :key="rule.count"
            class="reward-item"
            :class="{ claimed: rule.claimed, available: rule.available }"
          >
            <div class="reward-info">
              <div class="reward-count">
                邀请 {{ rule.count }} 人
              </div>
              <div class="reward-desc">
                {{ formatReward(rule) }}
              </div>
              <div v-if="rule.description" class="reward-note">
                {{ rule.description }}
              </div>
            </div>
            <div class="reward-status">
              <span v-if="rule.claimed" class="status-badge claimed">已领取</span>
              <span v-else-if="rule.available" class="status-badge available">可领取</span>
              <span v-else class="status-badge locked">未达成</span>
            </div>
            <BaseButton
              v-if="rule.available"
              variant="primary"
              size="sm"
              :loading="claiming === rule.count"
              @click="claimReward(rule.count)"
            >
              领取
            </BaseButton>
          </div>
        </div>
      </div>

      <!-- 已邀请用户 -->
      <div v-if="inviteInfo?.invitees && inviteInfo.invitees.length > 0" class="invite-card">
        <div class="card-title">
          <span class="card-icon">👥</span>
          已邀请用户
        </div>
        <div class="invitees-list">
          <div v-for="name in inviteInfo.invitees" :key="name" class="invitee-item">
            <span class="invitee-avatar">{{ name.charAt(0).toUpperCase() }}</span>
            <span class="invitee-name">{{ name }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.invite-page {
  padding: 1.5rem;
  max-width: 800px;
  margin: 0 auto;
}

.page-header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--theme-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.title-icon {
  font-size: 1.75rem;
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.disabled-banner {
  background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%);
  border: 1px solid #ffcc80;
  border-radius: 1rem;
  padding: 1.5rem;
  text-align: center;
  color: #e65100;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.invite-content {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.invite-card {
  background: var(--card-bg);
  border-radius: 1rem;
  padding: 1.25rem;
  box-shadow: var(--card-shadow);
  border: 1px solid var(--border-color);
}

.card-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.card-icon {
  font-size: 1.25rem;
}

.invite-code-section {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.invite-code {
  flex: 1;
  background: linear-gradient(135deg, var(--theme-primary) 0%, color-mix(in srgb, var(--theme-primary) 80%, #000) 100%);
  color: white;
  font-family: 'Courier New', monospace;
  font-size: 1.5rem;
  font-weight: 700;
  text-align: center;
  padding: 0.875rem 1rem;
  border-radius: 0.75rem;
  letter-spacing: 0.1em;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.invite-link-section {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.invite-link-section :deep(.base-input) {
  flex: 1;
  font-size: 0.8125rem;
}

.invite-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}

.stat-item {
  text-align: center;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--theme-primary);
}

.stat-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.reward-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.reward-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 0.75rem;
  background: var(--bg-secondary);
  border: 2px solid transparent;
  transition: all 0.2s ease;
}

.reward-item.available {
  border-color: var(--theme-primary);
  background: color-mix(in srgb, var(--theme-primary) 8%, var(--bg-secondary));
}

.reward-item.claimed {
  opacity: 0.7;
}

.reward-info {
  flex: 1;
}

.reward-count {
  font-weight: 600;
  color: var(--text-primary);
}

.reward-desc {
  font-size: 0.875rem;
  color: var(--theme-primary);
  font-weight: 500;
  margin-top: 0.25rem;
}

.reward-note {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
}

.reward-status {
  margin-right: 0.5rem;
}

.status-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}

.status-badge.claimed {
  background: #e8f5e9;
  color: #2e7d32;
}

.status-badge.available {
  background: color-mix(in srgb, var(--theme-primary) 15%, white);
  color: var(--theme-primary);
}

.status-badge.locked {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.invitees-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.invitee-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  border-radius: 9999px;
  font-size: 0.875rem;
}

.invitee-avatar {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  background: var(--theme-primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
}

.invitee-name {
  color: var(--text-primary);
}

@media (max-width: 640px) {
  .invite-page {
    padding: 1rem;
  }

  .invite-code-section {
    flex-direction: column;
  }

  .invite-code {
    width: 100%;
    font-size: 1.25rem;
  }

  .invite-link-section {
    flex-direction: column;
  }

  .invite-stats {
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .stat-value {
    font-size: 1.25rem;
  }

  .reward-item {
    flex-wrap: wrap;
  }
}
</style>
