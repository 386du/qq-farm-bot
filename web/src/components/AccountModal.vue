<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import GoLoginPanel from '@/components/GoLoginPanel.vue'
import WxLoginPanel from '@/components/WxLoginPanel.vue'
import { useGoLoginStore } from '@/stores/go-login'
import { useYybLoginStore } from '@/stores/yyb-login'

const props = defineProps<{
  show: boolean
  editData?: any
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
  (e: 'yyb-login'): void
  (e: 'yyb-config', anchor: null): void
  (e: 'go-config'): void
}>()

const loading = ref(false)
const yybLoading = ref(false)
const errorMessage = ref('')

const yybStore = useYybLoginStore()
const goStore = useGoLoginStore()

type TabKey = 'manual' | 'qq' | 'go' | 'yyb'
const activeTab = ref<TabKey>('manual')

function openYybConfig() {
  emit('yyb-config', null)
  close()
}

function openGoConfig() {
  emit('go-config')
}

// 表单数据
const form = reactive({
  name: '',
  code: '',
  platform: 'qq' as 'qq' | 'wx',
  codeRefreshIntervalMinutes: 0,
})

// 加载 go 服务配置,用于判断是否显示「Go 扫码」Tab
const goReady = computed(() => !!goStore.config.enabled && !!String(goStore.config.apiBase || '').trim())
const showGoTab = ref(false)

watch(() => props.show, async (newVal) => {
  if (newVal) {
    errorMessage.value = ''
    activeTab.value = 'manual'
    if (props.editData) {
      form.name = props.editData.name || ''
      form.code = props.editData.code || ''
      form.platform = props.editData.platform || 'qq'
      form.codeRefreshIntervalMinutes = Number(props.editData.codeRefreshIntervalMinutes) || 0
    }
    else {
      form.name = ''
      form.code = ''
      form.platform = 'qq'
      form.codeRefreshIntervalMinutes = 0
    }
    // 异步加载 Go 配置,决定是否显示 Go Tab
    try {
      await goStore.loadConfig()
      showGoTab.value = goReady.value
    }
    catch {
      showGoTab.value = false
    }
  }
})

// 添加账号
async function addAccount(data: any) {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.post('/api/accounts', data)
    if (res.data.ok) {
      emit('saved')
      close()
    }
    else {
      errorMessage.value = `保存失败: ${res.data.error}`
    }
  }
  catch (e: any) {
    errorMessage.value = `保存失败: ${e.response?.data?.error || e.message}`
  }
  finally {
    loading.value = false
  }
}

// 手动提交
async function submitManual() {
  errorMessage.value = ''
  if (!form.code) {
    errorMessage.value = '请输入Code'
    return
  }

  let code = form.code.trim()
  const match = code.match(/[?&]code=([^&]+)/i)
  if (match && match[1]) {
    code = decodeURIComponent(match[1])
    form.code = code
  }

  let payload: any = {}
  if (props.editData) {
    const onlyNameChanged = form.name !== props.editData.name
      && form.code === (props.editData.code || '')
      && form.platform === (props.editData.platform || 'qq')
      && form.codeRefreshIntervalMinutes === (Number(props.editData.codeRefreshIntervalMinutes) || 0)

    if (onlyNameChanged) {
      payload = { id: props.editData.id, name: form.name }
    }
    else {
      payload = {
        id: props.editData.id,
        name: form.name,
        code,
        platform: form.platform,
        loginType: props.editData.loginType || 'manual',
        openid: props.editData.openid || '',
        codeRefreshIntervalMinutes: Math.max(0, Math.floor(form.codeRefreshIntervalMinutes) || 0),
      }
    }
  }
  else {
    payload = {
      name: form.name,
      code,
      platform: form.platform,
      loginType: 'manual',
      codeRefreshIntervalMinutes: Math.max(0, Math.floor(form.codeRefreshIntervalMinutes) || 0),
    }
  }

  await addAccount(payload)
}

async function reloginYyb() {
  if (!props.editData)
    return
  const openid = String(props.editData.openid || '').trim()
  if (!openid) {
    errorMessage.value = '该账号没有绑定应用宝 OpenID'
    return
  }

  yybLoading.value = true
  errorMessage.value = ''
  try {
    const result = await yybStore.fetchCode(openid)
    if (!result.ok || !result.code) {
      errorMessage.value = result.error || '获取 Code 失败'
      return
    }

    await addAccount({
      id: props.editData.id,
      name: form.name || props.editData.name,
      code: result.code,
      platform: 'wx',
      loginType: 'yyb',
      openid,
    })
  }
  finally {
    yybLoading.value = false
  }
}

function close() {
  emit('close')
}

const panelStyle = computed(() => ({
  background: 'var(--theme-bg)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.24), 0 0 0 1px rgba(0,0,0,0.08)',
  maxHeight: 'min(85dvh, 720px)',
}))

const showGoScanRefresh = computed(() => String(props.editData?.loginType || '') === 'go_scan')
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click.self="close" />
      <div
        class="absolute left-1/2 top-1/2 z-10 max-w-md w-[calc(100%-2rem)] flex flex-col rounded-2xl -translate-x-1/2 -translate-y-1/2"
        :style="panelStyle"
        @click.stop
      >
        <div class="flex shrink-0 items-center justify-between p-4" style="border-bottom: 1px solid color-mix(in srgb, var(--theme-text) 10%, transparent)">
          <h3 class="text-lg font-semibold" style="color: var(--theme-primary, var(--theme-text))">
            {{ editData ? '编辑账号' : '添加账号' }}
          </h3>
          <BaseButton variant="ghost" class="!p-1" @click="close">
            <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
          </BaseButton>
        </div>

        <div v-if="!editData" class="shrink-0 flex border-b" style="border-color: color-mix(in srgb, var(--theme-text) 10%, transparent)">
          <button
            v-for="t in [
              { key: 'manual', label: '手动填码' },
              { key: 'qq', label: 'QQ扫码' },
              ...(showGoTab ? [{ key: 'go', label: 'Go扫码' }] : []),
              { key: 'yyb', label: '应用宝对接' },
            ]"
            :key="t.key"
            type="button"
            class="flex-1 py-3 text-sm font-medium transition relative"
            :style="{
              color: activeTab === t.key ? 'var(--theme-primary, var(--theme-text))' : 'var(--theme-text)',
              opacity: activeTab === t.key ? 1 : 0.6,
            }"
            @click="activeTab = t.key as TabKey"
          >
            {{ t.label }}
            <span
              v-if="activeTab === t.key"
              class="absolute left-1/2 -translate-x-1/2 bottom-0 h-0.5 w-12 rounded-full"
              :style="{ background: 'var(--theme-primary, currentColor)' }"
            />
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div v-if="errorMessage" class="mb-4 rounded-xl p-3 text-sm" style="background: rgba(239, 68, 68, 0.1); color: #ef4444">
            {{ errorMessage }}
          </div>

          <!-- 手动填码 Tab -->
          <div v-if="activeTab === 'manual'" class="space-y-4">
            <BaseInput
              v-model="form.name"
              label="账号备注（可选）"
              placeholder="留空默认账号"
              class="farm-input"
            />

            <BaseTextarea
              v-model="form.code"
              label="Code"
              placeholder="请输入登录 Code"
              :rows="3"
              class="farm-input"
            />

            <div v-if="!editData" class="flex gap-4">
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  v-model="form.platform"
                  type="radio"
                  value="qq"
                  class="h-4 w-4"
                  :style="{ accentColor: 'var(--theme-primary)' }"
                >
                <span class="text-sm" :style="{ color: 'var(--theme-text)' }">QQ小程序</span>
              </label>
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  v-model="form.platform"
                  type="radio"
                  value="wx"
                  class="h-4 w-4"
                  :style="{ accentColor: 'var(--theme-primary)' }"
                >
                <span class="text-sm" :style="{ color: 'var(--theme-text)' }">微信小程序</span>
              </label>
            </div>

            <BaseInput
              v-if="!editData || showGoScanRefresh"
              v-model.number="form.codeRefreshIntervalMinutes"
              :label="showGoScanRefresh ? 'Code刷新间隔（分钟）' : 'Code刷新间隔（分钟,仅 Go 扫码账号生效）'"
              type="number"
              placeholder="0 表示不自动刷新"
              class="farm-input"
            />

            <div v-if="!editData" class="border rounded-xl border-dashed p-3 dark:border-gray-600" style="border-color: color-mix(in srgb, var(--theme-text) 15%, transparent)">
              <p class="mb-2 text-xs opacity-70" :style="{ color: 'var(--theme-text)' }">
                其他登录方式
              </p>
              <div class="flex gap-2">
                <BaseButton
                  variant="outline"
                  size="sm"
                  class="flex-1"
                  @click="emit('yyb-login'); close()"
                >
                  应用宝一键登录
                </BaseButton>
                <BaseButton
                  variant="ghost"
                  size="sm"
                  @click="openYybConfig()"
                >
                  配置
                </BaseButton>
              </div>
            </div>

            <div v-if="editData" class="border rounded-xl border-dashed p-3 dark:border-gray-600" style="border-color: color-mix(in srgb, var(--theme-text) 15%, transparent)">
              <p class="mb-2 text-xs opacity-70" :style="{ color: 'var(--theme-text)' }">
                应用宝登录
              </p>
              <BaseButton
                variant="outline"
                size="sm"
                class="w-full"
                :loading="yybLoading"
                :disabled="!editData.openid"
                @click="reloginYyb"
              >
                {{ editData.openid ? '应用宝一键登录' : '未绑定应用宝 OpenID' }}
              </BaseButton>
            </div>

            <div class="flex justify-end gap-2 pt-4">
              <BaseButton variant="outline" class="cartoon-btn" @click="close">
                取消
              </BaseButton>
              <BaseButton variant="primary" class="cartoon-btn" :loading="loading" @click="submitManual">
                {{ editData ? '保存' : '添加' }}
              </BaseButton>
            </div>
          </div>

          <!-- QQ扫码 Tab -->
          <div v-else-if="activeTab === 'qq'" class="space-y-4">
            <WxLoginPanel
              :embedded="true"
              @saved="emit('saved'); close()"
            />
          </div>

          <!-- Go扫码 Tab -->
          <div v-else-if="activeTab === 'go' && showGoTab" class="space-y-4">
            <GoLoginPanel
              :embedded="true"
              @saved="emit('saved'); close()"
              @open-config="openGoConfig"
            />
          </div>

          <!-- 应用宝对接 Tab -->
          <div v-else-if="activeTab === 'yyb'" class="space-y-4">
            <div
              class="rounded-xl p-4 text-sm"
              style="background: color-mix(in srgb, var(--theme-primary) 8%, transparent); color: var(--theme-text)"
            >
              <p class="mb-2 font-medium">应用宝一键登录</p>
              <p class="text-xs opacity-80">通过应用宝外部 API 根据 OpenID 自动获取 Code 并添加/更新账号。</p>
            </div>
            <div class="flex flex-col gap-2">
              <BaseButton
                variant="primary"
                class="cartoon-btn"
                @click="emit('yyb-login'); close()"
              >
                打开应用宝一键登录
              </BaseButton>
              <BaseButton
                variant="outline"
                class="cartoon-btn"
                @click="openYybConfig()"
              >
                应用宝配置
              </BaseButton>
            </div>
            <p class="text-xs opacity-60" style="color: var(--theme-text)">
              需先在「应用宝配置」中填写接口地址并为每个 OpenID 绑定 API Token
            </p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
