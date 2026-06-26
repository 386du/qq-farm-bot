<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'

defineProps<{
  show: boolean
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  type?: 'danger' | 'primary'
  isAlert?: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm transition-opacity" @click="emit('cancel')">
    <div class="max-w-sm w-full scale-100 transform border-4 border-[#8b6914] rounded-2xl bg-[#fef9ef] p-6 transition-all dark:border-gray-600 dark:bg-gray-800" style="box-shadow: 0 6px 0 #6b4f0e, 0 8px 24px rgba(0,0,0,0.2)" @click.stop>
      <h3 class="mb-3 text-xl text-[#3d2b1f] font-bold font-display dark:text-[#f0c040]">
        {{ title || '确认操作' }}
      </h3>
      <p class="mb-8 whitespace-pre-line text-[#5a4a3a] leading-relaxed dark:text-gray-300">
        {{ message || '确定要执行此操作吗？' }}
      </p>
      <div class="flex justify-end gap-3">
        <BaseButton
          v-if="!isAlert"
          variant="secondary"
          class="cartoon-btn"
          :disabled="loading"
          @click="emit('cancel')"
        >
          {{ cancelText || '取消' }}
        </BaseButton>
        <BaseButton
          :variant="type === 'danger' ? 'danger' : 'primary'"
          class="cartoon-btn"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ confirmText || '确定' }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>
