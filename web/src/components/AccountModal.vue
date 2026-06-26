<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { useYybLoginStore } from '@/stores/yyb-login'

const props = defineProps<{
  show: boolean
  editData?: any
}>()

const emit = defineEmits(['close', 'saved', 'yyb-login', 'yyb-config'])

const loading = ref(false)
const yybLoading = ref(false)
const errorMessage = ref('')

const yybStore = useYybLoginStore()

// 表单数据
const form = reactive({
  name: '',
  code: '',
  platform: 'qq' as 'qq' | 'wx',
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

    if (onlyNameChanged) {
      payload = { id: props.editData.id, name: form.name }
    }
    else {
      payload = {
        id: props.editData.id,
        name: form.name,
        code,
        platform: form.platform,
        loginType: 'manual',
      }
    }
  }
  else {
    payload = {
      name: form.name,
      code,
      platform: form.platform,
      loginType: 'manual',
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

watch(() => props.show, (newVal) => {
  if (newVal) {
    errorMessage.value = ''
    if (props.editData) {
      form.name = props.editData.name || ''
      form.code = props.editData.code || ''
      form.platform = props.editData.platform || 'qq'
    }
    else {
      form.name = ''
      form.code = ''
      form.platform = 'qq'
    }
  }
})
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div class="max-h-[90vh] max-w-md w-full overflow-hidden rounded-2xl" :style="{ background: 'var(--theme-bg)', boxShadow: 'var(--theme-shadow-lg, 0 8px 32px rgba(0,0,0,0.16))' }">
      <!-- Header -->
      <div class="flex items-center justify-between p-4" style="border-bottom: 1px solid color-mix(in srgb, var(--theme-text) 10%, transparent)">
        <h3 class="text-lg font-semibold" style="color: var(--theme-primary, var(--theme-text))">
          {{ editData ? '编辑账号' : '添加账号' }}
        </h3>
        <BaseButton variant="ghost" class="!p-1" @click="close">
          <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
        </BaseButton>
      </div>

      <div class="max-h-[calc(90vh-80px)] overflow-y-auto p-4">
        <!-- 错误信息 -->
        <div v-if="errorMessage" class="mb-4 rounded-xl p-3 text-sm" style="background: rgba(239, 68, 68, 0.1); color: #ef4444">
          {{ errorMessage }}
        </div>

        <div class="space-y-4">
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
                @click="emit('yyb-config'); close()"
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
      </div>
    </div>
  </div>
</template>
