<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const userStore = useUserStore()
const toastStore = useToastStore()

const DEFAULT_AVATAR = 'https://free.picui.cn/free/2026/03/10/69affe5755149.jpg'

const form = reactive({
  nickname: '',
  avatar: '',
})

const loading = ref(false)
const errorMessage = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const avatarPreviewFailed = ref(false)

const previewAvatar = computed(() => form.avatar?.trim() || '')

function resetForm() {
  form.nickname = userStore.nickname || ''
  form.avatar = userStore.avatar || ''
  avatarPreviewFailed.value = false
  errorMessage.value = ''
}

watch(() => props.show, (val) => {
  if (val)
    resetForm()
})

function close() {
  if (loading.value)
    return
  emit('close')
}

function onAvatarError(e: Event) {
  const img = e.target as HTMLImageElement
  if (img.src !== DEFAULT_AVATAR) {
    avatarPreviewFailed.value = true
    img.src = DEFAULT_AVATAR
  }
}

function pickFile() {
  fileInputRef.value?.click()
}

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file)
    return

  if (!file.type.startsWith('image/')) {
    errorMessage.value = '请选择图片文件'
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    errorMessage.value = '图片大小不能超过 2MB'
    return
  }

  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = String(reader.result || '')
    if (dataUrl.length > 2 * 1024 * 1024) {
      errorMessage.value = '图片数据过大，请压缩后再试'
      return
    }
    form.avatar = dataUrl
    avatarPreviewFailed.value = false
  }
  reader.onerror = () => {
    errorMessage.value = '读取图片失败'
  }
  reader.readAsDataURL(file)
}

function clearAvatar() {
  form.avatar = ''
  avatarPreviewFailed.value = false
}

async function save() {
  errorMessage.value = ''
  const nickname = form.nickname.trim()
  if (nickname.length > 20) {
    errorMessage.value = '昵称长度不能超过 20 个字符'
    return
  }
  if (form.avatar && !/^(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,)/i.test(form.avatar.trim())) {
    errorMessage.value = '头像地址必须为 http(s) 链接或 data:image base64'
    return
  }

  loading.value = true
  try {
    const res = await userStore.updateProfile({
      nickname: form.nickname,
      avatar: form.avatar,
    })
    if (res?.ok) {
      toastStore.success('个人资料已更新')
      emit('saved')
      emit('close')
    }
    else {
      errorMessage.value = res?.error || '保存失败'
    }
  }
  catch (e: any) {
    errorMessage.value = e?.response?.data?.error || e?.message || '保存失败'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click.self="close" />
      <div
        class="absolute left-1/2 top-1/2 z-10 max-w-md w-[calc(100%-2rem)] flex flex-col rounded-2xl -translate-x-1/2 -translate-y-1/2"
        style="background: var(--theme-bg); box-shadow: 0 8px 32px rgba(0,0,0,0.24), 0 0 0 1px rgba(0,0,0,0.08); max-height: min(90dvh, 640px);"
        @click.stop
      >
        <div class="flex shrink-0 items-center justify-between p-4" style="border-bottom: 1px solid color-mix(in srgb, var(--theme-text) 10%, transparent)">
          <h3 class="text-lg font-semibold" style="color: var(--theme-primary, var(--theme-text))">
            修改个人资料
          </h3>
          <BaseButton variant="ghost" class="!p-1" :disabled="loading" @click="close">
            <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
          </BaseButton>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div v-if="errorMessage" class="mb-4 rounded-xl p-3 text-sm" style="background: rgba(239, 68, 68, 0.1); color: #ef4444">
            {{ errorMessage }}
          </div>

          <div class="mb-5 flex flex-col items-center">
            <div class="farm-avatar-ring relative h-20 w-20 overflow-hidden rounded-full shadow-md" style="background: linear-gradient(135deg, var(--theme-primary), var(--theme-grass, #4CAF50)); padding: 2px;">
              <div class="h-full w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
                <img
                  :src="previewAvatar || DEFAULT_AVATAR"
                  class="h-full w-full object-cover"
                  @error="onAvatarError"
                >
              </div>
            </div>
            <div class="mt-3 flex items-center gap-2">
              <BaseButton size="sm" variant="outline" class="cartoon-btn" @click="pickFile">
                <div class="i-carbon-image-search mr-1 text-base" />
                上传图片
              </BaseButton>
              <BaseButton v-if="form.avatar" size="sm" variant="ghost" :disabled="loading" @click="clearAvatar">
                <div class="i-carbon-trash-can mr-1 text-base" />
                恢复默认
              </BaseButton>
            </div>
            <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onFileChange">
            <p class="mt-2 text-xs text-gray-400">
              支持 jpg / png / gif / webp，2MB 以内
            </p>
          </div>

          <div class="space-y-3">
            <BaseInput
              v-model="form.nickname"
              label="显示昵称（不影响登录用户名）"
              placeholder="留空则使用登录用户名"
              class="farm-input"
            />
            <BaseInput
              v-model="form.avatar"
              label="头像图片地址（可选）"
              placeholder="https://... 或留空使用默认"
              class="farm-input"
            />
            <div class="rounded-xl bg-gray-100/60 p-3 text-xs text-gray-500 leading-relaxed dark:bg-gray-700/40 dark:text-gray-400">
              <div>
                登录用户名：
                <span class="font-mono" style="color: var(--theme-text)">{{ userStore.username || '—' }}</span>
                （不可修改）
              </div>
              <div class="mt-1">
                角色：
                <span style="color: var(--theme-text)">{{ userStore.role || 'user' }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="flex shrink-0 justify-end gap-2 p-4" style="border-top: 1px solid color-mix(in srgb, var(--theme-text) 10%, transparent)">
          <BaseButton variant="outline" class="cartoon-btn" :disabled="loading" @click="close">
            取消
          </BaseButton>
          <BaseButton
            variant="primary"
            class="cartoon-btn"
            :loading="loading"
            @click="save"
          >
            保存
          </BaseButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>
