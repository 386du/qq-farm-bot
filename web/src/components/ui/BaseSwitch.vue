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

// 各档位尺寸：轨道 / 滑块 / 滑块平移距离 / 内部圆点
const dims: Record<NonNullable<typeof props.size>, { track: string, thumb: string, dot: string, translate: string }> = {
  sm: { track: 'h-5 w-9',  thumb: 'h-4 w-4', dot: 'h-1.5 w-1.5', translate: 'translate-x-4' },
  md: { track: 'h-6 w-11', thumb: 'h-5 w-5', dot: 'h-2 w-2',   translate: 'translate-x-5' },
  lg: { track: 'h-7 w-13', thumb: 'h-6 w-6', dot: 'h-2.5 w-2.5', translate: 'translate-x-6' },
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
      class="base-switch-track relative inline-flex shrink-0 items-center rounded-full transition-all duration-200 ease-out outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      :class="[
        d().track,
        model
          ? 'base-switch-on'
          : 'base-switch-off',
        !disabled && !readonly && 'active:scale-[0.97]',
        disabled && 'opacity-50',
      ]"
      :style="{
        '--tw-ring-color': 'var(--theme-primary)',
        '--switch-glow': model
          ? `0 0 12px 0 var(--theme-primary), 0 0 2px 0 var(--theme-primary)`
          : 'none',
      }"
      @click="toggle"
      @keydown.space.prevent="toggle"
      @keydown.enter.prevent="toggle"
    >
      <span
        class="base-switch-thumb pointer-events-none absolute top-1/2 left-0.5 flex -translate-y-1/2 items-center justify-center rounded-full bg-white transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        :class="[d().thumb, model ? d().translate : 'translate-x-0']"
        :style="{
          boxShadow: model
            ? '0 2px 6px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04), 0 0 8px 1px var(--theme-primary)'
            : '0 1px 3px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.6), 0 0 0 1px rgba(0,0,0,0.04)',
        }"
      >
        <!-- 内部小圆点：开启=主题色，关闭=浅灰 -->
        <span
          class="rounded-full transition-all duration-200"
          :class="[d().dot, model ? 'scale-100' : 'scale-75']"
          :style="{
            backgroundColor: model ? 'var(--theme-primary)' : '#cbd5e1',
          }"
        />
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
/* 关闭态：浅灰 + 内阴影（凹陷感） */
.base-switch-off {
  background: linear-gradient(180deg, #d1d5db 0%, #e5e7eb 100%);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.1),
    inset 0 -1px 1px rgba(255, 255, 255, 0.6),
    0 1px 1px rgba(255, 255, 255, 0.4);
}

.dark .base-switch-off {
  background: linear-gradient(180deg, #4b5563 0%, #374151 100%);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.3),
    inset 0 -1px 1px rgba(255, 255, 255, 0.04);
}

/* 开启态：主题色 + 凸起 + 彩色光晕 */
.base-switch-on {
  background: linear-gradient(180deg, var(--theme-primary) 0%, color-mix(in srgb, var(--theme-primary) 80%, #000) 100%);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.25),
    inset 0 -1px 1px rgba(0, 0, 0, 0.1),
    0 0 14px 0 color-mix(in srgb, var(--theme-primary) 35%, transparent);
}

.base-switch-on:hover {
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.25),
    inset 0 -1px 1px rgba(0, 0, 0, 0.1),
    0 0 18px 2px color-mix(in srgb, var(--theme-primary) 50%, transparent);
}

/* 拇指颜色（暗色主题下用更亮的白） */
.dark .base-switch-thumb {
  background-color: #f9fafb;
}

/* focus ring 偏移色跟主题 */
.base-switch-track:focus-visible {
  --tw-ring-offset-color: var(--theme-bg, #ffffff);
}
</style>
