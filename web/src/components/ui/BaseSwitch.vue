<script setup lang="ts">
import { ref } from 'vue'

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

const rippleKey = ref(0)
let rippleTimer: ReturnType<typeof setTimeout> | null = null

function flip() {
  if (props.disabled || props.readonly)
    return
  rippleKey.value++
  if (rippleTimer)
    clearTimeout(rippleTimer)
  rippleTimer = setTimeout(() => {
    rippleKey.value = 0
  }, 500)
  model.value = !model.value
}

function toggle(e: MouseEvent) {
  if (props.disabled || props.readonly)
    return
  // 触发涟漪：从点击点扩散
  if (e.currentTarget instanceof HTMLElement) {
    const rect = e.currentTarget.getBoundingClientRect()
    const style = e.currentTarget.style
    style.setProperty('--ripple-x', `${e.clientX - rect.left}px`)
    style.setProperty('--ripple-y', `${e.clientY - rect.top}px`)
  }
  flip()
}

function onKeydown() {
  // 键盘触发时不带坐标，涟漪从中心扩散
  flip()
}

const dims: Record<NonNullable<typeof props.size>, { track: string, thumb: string, inner: string, translate: string }> = {
  sm: { track: 'h-5 w-9',  thumb: 'h-4 w-4', inner: 'h-1.5 w-1.5', translate: 'translate-x-4' },
  md: { track: 'h-6 w-11', thumb: 'h-5 w-5', inner: 'h-2 w-2',   translate: 'translate-x-5' },
  lg: { track: 'h-7 w-13', thumb: 'h-6 w-6', inner: 'h-2.5 w-2.5', translate: 'translate-x-6' },
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
      class="base-switch-track relative inline-flex shrink-0 items-center rounded-full transition-all duration-300 ease-out outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      :class="[
        d().track,
        model ? 'base-switch-on' : 'base-switch-off',
        !disabled && !readonly && 'active:scale-[0.96]',
        disabled && 'opacity-50',
      ]"
      :style="{ '--tw-ring-color': 'var(--theme-primary)' }"
      @click="toggle"
      @keydown.space.prevent="onKeydown"
      @keydown.enter.prevent="onKeydown"
    >
      <!-- 点击涟漪层 -->
      <span
        v-if="rippleKey"
        :key="rippleKey"
        class="base-switch-ripple pointer-events-none"
      />

      <span
        class="base-switch-thumb pointer-events-none absolute top-1/2 left-0.5 flex -translate-y-1/2 items-center justify-center rounded-full transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        :class="[d().thumb, model ? d().translate : 'translate-x-0']"
      >
        <!-- 内部符号：开=实心圆点（主题色），关=空心圆环（灰色） -->
        <span
          class="rounded-full transition-all duration-300"
          :class="[d().inner, model ? 'scale-100' : 'scale-90']"
          :style="model
            ? { backgroundColor: 'var(--theme-primary)' }
            : { backgroundColor: 'transparent', boxShadow: 'inset 0 0 0 1.5px #94a3b8' }"
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
/* ============ 关闭态：浅灰 + 凹槽 + 顶部高光线 ============ */
.base-switch-off {
  background: linear-gradient(180deg, #e5e7eb 0%, #d1d5db 100%);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.08),
    inset 0 -1px 0 rgba(255, 255, 255, 0.5);
}

.dark .base-switch-off {
  background: linear-gradient(180deg, #4b5563 0%, #374151 100%);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.3),
    inset 0 -1px 0 rgba(255, 255, 255, 0.05);
}

/* ============ 开启态：主题色渐变 + 顶部高光 + 柔光 ============ */
.base-switch-on {
  background: linear-gradient(180deg, var(--theme-primary) 0%, color-mix(in srgb, var(--theme-primary) 70%, #000) 100%);
  box-shadow:
    /* 顶部镜面高光线（特色 1：高端产品感） */
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    inset 0 2px 0 rgba(255, 255, 255, 0.1),
    /* 底部阴影 */
    inset 0 -1px 0 rgba(0, 0, 0, 0.12),
    /* 主题色柔光 */
    0 0 14px 0 color-mix(in srgb, var(--theme-primary) 35%, transparent);
}

.base-switch-on:hover {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    inset 0 2px 0 rgba(255, 255, 255, 0.12),
    inset 0 -1px 0 rgba(0, 0, 0, 0.14),
    0 0 20px 2px color-mix(in srgb, var(--theme-primary) 50%, transparent);
}

/* ============ 液态玻璃拇指 ============ */
.base-switch-thumb {
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 1) 0%,
    rgba(255, 255, 255, 0.78) 100%
  );
  /* 主高光（左上角，模拟自然光） */
  background-image:
    radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.95) 0%, transparent 35%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.75) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 1),
    inset 0 -1px 0 rgba(0, 0, 0, 0.06),
    0 0 0 1px rgba(0, 0, 0, 0.04),
    0 2px 4px rgba(0, 0, 0, 0.12);
}

.dark .base-switch-thumb {
  background-image:
    radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.85) 0%, transparent 35%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(229, 231, 235, 0.75) 100%);
}

/* ============ 点击涟漪（特色 3） ============ */
.base-switch-ripple {
  position: absolute;
  top: var(--ripple-y, 50%);
  left: var(--ripple-x, 50%);
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.7);
  transform: translate(-50%, -50%) scale(0);
  animation: switch-ripple 0.5s ease-out forwards;
  pointer-events: none;
}

@keyframes switch-ripple {
  to {
    transform: translate(-50%, -50%) scale(15);
    opacity: 0;
  }
}

/* ============ focus ring 偏移色跟主题 ============ */
.base-switch-track:focus-visible {
  --tw-ring-offset-color: var(--theme-bg, #ffffff);
}
</style>
