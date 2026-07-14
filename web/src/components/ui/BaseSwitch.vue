<script setup lang="ts">
const props = withDefaults(defineProps<{
  label?: string
  description?: string
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** 开关与文字同行（默认）/ 上下排 */
  inline?: boolean
  /** 关闭时不响应点击，仅显示 */
  readonly?: boolean
}>(), {
  size: 'md',
  inline: true,
  disabled: false,
  readonly: false,
})

const model = defineModel<boolean>({ default: false })

function toggle() {
  if (props.disabled || props.readonly)
    return
  model.value = !model.value
}

// 各档位尺寸：轨道 / 滑块 / 滑块平移距离
const dims: Record<NonNullable<typeof props.size>, { track: string, thumb: string, translate: string }> = {
  sm: { track: 'h-5 w-9',  thumb: 'h-4 w-4', translate: 'translate-x-4' },
  md: { track: 'h-6 w-11', thumb: 'h-5 w-5', translate: 'translate-x-5' },
  lg: { track: 'h-7 w-13', thumb: 'h-6 w-6', translate: 'translate-x-6' },
}
const d = () => dims[props.size]
</script>

<template>
  <label
    class="inline-flex items-center select-none"
    :class="[
      inline ? 'flex-row gap-3' : 'flex-col items-start gap-2',
      (disabled || readonly) ? 'cursor-not-allowed' : 'cursor-pointer',
    ]"
  >
    <button
      type="button"
      role="switch"
      :aria-checked="model"
      :aria-disabled="disabled || readonly"
      :disabled="disabled"
      class="base-switch-track relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 ease-out outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      :class="[
        d().track,
        model
          ? 'bg-[var(--theme-primary)]'
          : 'bg-gray-300 dark:bg-gray-600',
        !disabled && !readonly && 'hover:brightness-110 active:scale-[0.97]',
        disabled && 'opacity-50',
      ]"
      :style="{ '--tw-ring-color': 'var(--theme-primary)' }"
      @click="toggle"
      @keydown.space.prevent="toggle"
      @keydown.enter.prevent="toggle"
    >
      <span
        class="base-switch-thumb pointer-events-none absolute top-1/2 left-0.5 flex -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.04)] transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        :class="[d().thumb, model ? d().translate : 'translate-x-0']"
      >
        <svg
          v-if="model"
          class="base-switch-check h-full w-full p-0.5"
          :style="{ color: 'var(--theme-primary)' }"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="5 10 9 14 15 6" />
        </svg>
      </span>
    </button>

    <span v-if="label || description || $slots.default" class="flex min-w-0 flex-col">
      <span
        v-if="label || $slots.default"
        class="text-sm font-medium leading-snug"
        :class="[disabled || readonly ? 'opacity-60' : '', 'text-[var(--theme-text)]']"
      >
        <slot>{{ label }}</slot>
      </span>
      <span
        v-if="description"
        class="mt-0.5 text-xs leading-snug"
        :class="[disabled || readonly ? 'opacity-50' : 'opacity-70']"
        style="color: var(--theme-text)"
      >
        {{ description }}
      </span>
    </span>
  </label>
</template>

<style scoped>
/* 滑块颜色变化（激活时更白，未激活时略带灰） */
.base-switch-thumb {
  background-color: #ffffff;
}

.dark .base-switch-thumb {
  background-color: #f9fafb;
}

/* 按下时滑块更扁，模拟真实按压感 */
.base-switch-track:active .base-switch-thumb {
  width: calc(var(--thumb-size, 1.25rem) + 0.15rem);
}

/* 选中时滑块轻微缩放 */
.base-switch-track[aria-checked="true"] .base-switch-thumb {
  transform: translateY(-50%) var(--tw-translate-x, 0) scale(1.02);
}

/* focus ring 偏移色跟主题 */
.base-switch-track:focus-visible {
  --tw-ring-offset-color: var(--theme-bg, #ffffff);
}
</style>
