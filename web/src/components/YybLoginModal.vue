<script setup lang="ts">
import { ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'
import { useYybLoginStore } from '@/stores/yyb-login'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits(['close', 'saved'])

const yybStore = useYybLoginStore()
const accountStore = useAccountStore()
const toast = useToastStore()

const loadingOpenId = ref<string | null>(null)
const accountNames = ref<Record<string, string>>({})

function resetNames() {
  const next: Record<string, string> = {}
  for (const openid of yybStore.config.openIds) {
    next[openid] = accountNames.value[openid] || ''
  }
  accountNames.value = next
}

watch(() => props.show, (show) => {
  if (show) {
    yybStore.loadConfig().then(resetNames)
  }
})

async function loginOne(openid: string) {
  loadingOpenId.value = openid
  try {
    const result = await yybStore.fetchCode(openid)
    if (!result.ok || !result.code) {
      toast.error(result.error || '获取 Code 失败')
      return false
    }

    const name = accountNames.value[openid]?.trim() || `应用宝_${openid.slice(-6)}`
    const platform = 'wx'

    // 查找是否已存在同 OpenID 的账号，存在则更新 code
    const existing = accountStore.accounts.find((a: any) => a.openid === openid || a.name === name)
    try {
      if (existing) {
        await accountStore.updateAccount(String(existing.id), {
          name,
          code: result.code,
          platform,
          loginType: 'yyb',
          openid,
        })
        toast.success(`已更新账号: ${name}`)
      }
      else {
        await accountStore.addAccount({
          name,
          code: result.code,
          platform,
          loginType: 'yyb',
          openid,
        })
        toast.success(`已添加账号: ${name}`)
      }

      // 登录成功后自动启动账号
      const started = accountStore.accounts.find((a: any) => a.openid === openid)
      if (started && !started.running) {
        await accountStore.startAccount(String(started.id))
        toast.success(`账号已启动: ${name}`)
      }

      emit('saved')
      return true
    }
    catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || '保存账号失败')
      return false
    }
  }
  finally {
    loadingOpenId.value = null
  }
}

async function loginAll() {
  const openIds = yybStore.config.openIds
  if (openIds.length === 0) {
    toast.warning('请先配置 OpenID')
    return
  }
  loadingOpenId.value = 'all'
  let successCount = 0
  try {
    for (const openid of openIds) {
      const ok = await loginOne(openid)
      if (ok)
        successCount++
    }
  }
  finally {
    loadingOpenId.value = null
  }
  toast.success(`一键登录完成，成功 ${successCount}/${openIds.length}`)
  emit('close')
}

function close() {
  emit('close')
}
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div class="max-h-[90vh] max-w-md w-full overflow-hidden rounded-2xl" :style="{ background: 'var(--theme-bg)', boxShadow: 'var(--theme-shadow-lg, 0 8px 32px rgba(0,0,0,0.16))' }">
      <div class="flex items-center justify-between p-4" style="border-bottom: 1px solid color-mix(in srgb, var(--theme-text) 10%, transparent)">
        <div>
          <h3 class="text-lg font-semibold" style="color: var(--theme-primary, var(--theme-text))">
            应用宝一键登录
          </h3>
          <p class="mt-1 text-xs opacity-70" style="color: var(--theme-text)">
            为已配置的 OpenID 自动获取 Code 并添加/更新账号
          </p>
        </div>
        <BaseButton variant="ghost" class="!p-1" @click="close">
          <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
        </BaseButton>
      </div>

      <div class="max-h-[calc(90vh-80px)] overflow-y-auto p-4 space-y-4">
        <div v-if="yybStore.config.openIds.length === 0" class="py-8 text-center text-sm text-gray-500">
          尚未配置 OpenID，请先进入“应用宝配置”添加
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="openid in yybStore.config.openIds"
            :key="openid"
            class="border border-gray-200 rounded-xl bg-white p-3 space-y-2 dark:border-gray-600 dark:bg-gray-800"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="min-w-0 flex-1 truncate text-sm font-medium" :style="{ color: 'var(--theme-text)' }">
                {{ openid }}
              </span>
              <BaseButton
                variant="primary"
                size="sm"
                :loading="loadingOpenId === openid"
                :disabled="loadingOpenId !== null"
                @click="loginOne(openid)"
              >
                登录
              </BaseButton>
            </div>
            <BaseInput
              v-model="accountNames[openid]"
              placeholder="账号备注（可选）"
              class="farm-input"
            />
          </div>
        </div>

        <div class="flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
          <BaseButton variant="outline" class="cartoon-btn" @click="close">
            关闭
          </BaseButton>
          <BaseButton
            v-if="yybStore.config.openIds.length > 0"
            variant="primary"
            class="cartoon-btn"
            :loading="loadingOpenId === 'all'"
            :disabled="loadingOpenId !== null"
            @click="loginAll"
          >
            一键登录全部
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
