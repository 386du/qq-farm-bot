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
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click.self="!loading && emit('cancel')" />
      <div
        class="absolute left-1/2 top-1/2 z-10 max-w-md w-[calc(100%-2rem)] flex flex-col rounded-2xl p-6 -translate-x-1/2 -translate-y-1/2"
        style="background: var(--theme-bg); box-shadow: 0 8px 32px rgba(0,0,0,0.24), 0 0 0 1px rgba(0,0,0,0.08);"
        @click.stop
      >
        <h3 class="mb-3 text-xl font-bold" style="color: var(--theme-primary, var(--theme-text));">
          {{ title || '确认操作' }}
        </h3>
        <p class="mb-8 whitespace-pre-line leading-relaxed" style="color: var(--theme-text);">
          {{ message || '确定要执行此操作吗？' }}
        </p>
        <div class="flex justify-end gap-3">
          <BaseButton
            v-if="!isAlert"
            variant="outline"
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
  </Teleport>
</template>
