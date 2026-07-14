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
      class="base-switch-track relative inline-flex shrink-0 items-center rounded-full transition-all duration-300 ease-out outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      :class="[
        d().track,
        model ? 'base-switch-on' : 'base-switch-off',
        !disabled && !readonly && 'active:scale-[0.95]',
        disabled && 'opacity-50',
      ]"
      :style="{ '--tw-ring-color': 'var(--theme-primary)' }"
      @click="toggle"
      @keydown.space.prevent="toggle"
      @keydown.enter.prevent="toggle"
    >
      <!-- 能量流光层（开启时显示） -->
      <span
        v-if="model"
        class="base-switch-energy pointer-events-none absolute inset-0 overflow-hidden rounded-full"
      >
        <span class="base-switch-energy-strip" />
      </span>

      <span
        class="base-switch-thumb pointer-events-none absolute top-1/2 left-0.5 flex -translate-y-1/2 items-center justify-center rounded-full bg-white/90 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        :class="[d().thumb, model ? d().translate : 'translate-x-0']"
        :style="{
          backdropFilter: 'blur(6px) saturate(180%)',
          WebkitBackdropFilter: 'blur(6px) saturate(180%)',
        }"
      >
        <!-- 内部 LED：开启=主题色脉冲，关闭=浅灰 -->
        <span
          class="rounded-full transition-all duration-300"
          :class="[d().dot, model ? 'base-switch-led' : 'scale-75']"
          :style="{
            backgroundColor: model ? 'var(--theme-primary)' : '#cbd5e1',
            boxShadow: model
              ? '0 0 4px var(--theme-primary), 0 0 8px color-mix(in srgb, var(--theme-primary) 70%, transparent)'
              : 'inset 0 1px 1px rgba(0,0,0,0.15)',
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
/* ============ 关闭态：凹陷、深邃、带扫描纹理 ============ */
.base-switch-off {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, transparent 50%),
    linear-gradient(180deg, #4b5563 0%, #1f2937 100%);
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.5),
    inset 0 -1px 1px rgba(255, 255, 255, 0.08),
    inset 0 0 0 1px rgba(0, 0, 0, 0.4),
    0 1px 0 rgba(255, 255, 255, 0.05);
}

.base-switch-off::before {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: inherit;
  background: repeating-linear-gradient(
    90deg,
    transparent 0px,
    transparent 3px,
    rgba(0, 0, 0, 0.12) 3px,
    rgba(0, 0, 0, 0.12) 4px
  );
  pointer-events: none;
  opacity: 0.6;
}

/* ============ 开启态：凸起、主题色渐变 + 三层霓虹光晕 ============ */
.base-switch-on {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.18) 0%, transparent 50%),
    linear-gradient(180deg, var(--theme-primary) 0%, color-mix(in srgb, var(--theme-primary) 60%, #000) 100%);
  box-shadow:
    /* 顶层高光 */
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    /* 底层阴影 */
    inset 0 -1px 0 rgba(0, 0, 0, 0.18),
    /* 边缘描边 */
    inset 0 0 0 1px color-mix(in srgb, var(--theme-primary) 40%, transparent),
    /* 三层霓虹光晕：近 / 中 / 远 */
    0 0 4px 0 color-mix(in srgb, var(--theme-primary) 80%, transparent),
    0 0 12px 2px color-mix(in srgb, var(--theme-primary) 50%, transparent),
    0 0 24px 4px color-mix(in srgb, var(--theme-primary) 25%, transparent);
  animation: switch-breathe 2.4s ease-in-out infinite;
}

.base-switch-on:hover {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    inset 0 -1px 0 rgba(0, 0, 0, 0.2),
    inset 0 0 0 1px color-mix(in srgb, var(--theme-primary) 50%, transparent),
    0 0 6px 1px color-mix(in srgb, var(--theme-primary) 90%, transparent),
    0 0 18px 4px color-mix(in srgb, var(--theme-primary) 60%, transparent),
    0 0 36px 8px color-mix(in srgb, var(--theme-primary) 35%, transparent);
}

/* ============ 能量流光：开启时一道光从左扫到右 ============ */
.base-switch-energy-strip {
  position: absolute;
  top: 0;
  left: 0;
  width: 60%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.55) 50%,
    transparent 100%
  );
  filter: blur(2px);
  animation: switch-energy-sweep 2.2s ease-in-out infinite;
}

@keyframes switch-energy-sweep {
  0% {
    transform: translateX(-100%);
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  80% {
    opacity: 1;
  }
  100% {
    transform: translateX(200%);
    opacity: 0;
  }
}

/* ============ 呼吸光晕 ============ */
@keyframes switch-breathe {
  0%, 100% {
    filter: brightness(1) saturate(1);
  }
  50% {
    filter: brightness(1.08) saturate(1.15);
  }
}

/* ============ 拇指：液态玻璃 + 主题色光晕阴影 ============ */
.base-switch-thumb {
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.98) 0%,
    rgba(255, 255, 255, 0.75) 100%
  );
  box-shadow:
    /* 顶部高光（液态玻璃反光） */
    inset 0 1px 0 rgba(255, 255, 255, 1),
    /* 底部内阴影 */
    inset 0 -1px 0 rgba(0, 0, 0, 0.08),
    /* 描边 */
    0 0 0 1px rgba(0, 0, 0, 0.06),
    /* 主投影 */
    0 2px 6px rgba(0, 0, 0, 0.18),
    /* 主题色光晕 */
    0 0 10px 1px color-mix(in srgb, var(--theme-primary) 50%, transparent);
}

.dark .base-switch-thumb {
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.95) 0%,
    rgba(229, 231, 235, 0.7) 100%
  );
}

/* ============ LED 脉冲 ============ */
.base-switch-led {
  animation: switch-led-pulse 1.6s ease-in-out infinite;
}

@keyframes switch-led-pulse {
  0%, 100% {
    transform: scale(1);
    filter: brightness(1);
  }
  50% {
    transform: scale(1.15);
    filter: brightness(1.3);
  }
}

/* ============ focus ring 偏移色跟主题 ============ */
.base-switch-track:focus-visible {
  --tw-ring-offset-color: var(--theme-bg, #ffffff);
}
</style>
