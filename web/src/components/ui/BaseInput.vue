<script setup lang="ts">
import { computed, ref } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  type?: string
  placeholder?: string
  label?: string
  disabled?: boolean
  clearable?: boolean
}>()
const emit = defineEmits<{
  (e: 'clear'): void
}>()
const model = defineModel<string | number>()
const showPassword = ref(false)
const inputType = computed(() => {
  if (props.type === 'password' && showPassword.value) {
    return 'text'
  }
  return props.type || 'text'
})
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" class="text-sm text-gray-700 font-medium dark:text-gray-300">
      {{ label }}
    </label>
    <div class="relative">
      <input
        v-model="model"
        v-bind="$attrs"
        :type="inputType"
        :placeholder="placeholder"
        :disabled="disabled"
        class="base-input w-full border-3 border-black/10 rounded-xl bg-white px-4 py-2.5 text-gray-900 outline-none transition-all duration-200 focus:scale-[1.01] dark:border-gray-600 focus:border-[#4a8c3f] dark:bg-gray-800 dark:text-gray-100 disabled:bg-gray-50 disabled:text-gray-400 focus:ring-2 focus:ring-[#4a8c3f]/30 dark:focus:border-[#6dbf5b] dark:disabled:bg-gray-800/50"
        :class="{ 'pr-10': type === 'password' || (clearable && model) }"
      >
      <button
        v-if="type === 'password'"
        type="button"
        class="absolute right-3 top-1/2 text-gray-400 -translate-y-1/2 hover:text-gray-600 dark:hover:text-gray-300"
        @click="showPassword = !showPassword"
      >
        <div v-if="showPassword" class="i-carbon-view-off" />
        <div v-else class="i-carbon-view" />
      </button>

      <button
        v-else-if="clearable && model"
        type="button"
        class="absolute right-3 top-1/2 text-gray-400 -translate-y-1/2 hover:text-gray-600 dark:hover:text-gray-300"
        @click="model = ''; emit('clear')"
      >
        <div class="i-carbon-close" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.base-input::-ms-reveal,
.base-input::-ms-clear {
  display: none;
}

/* ===== iOS Safari / Chrome 密码管理器自动填充样式覆盖 =====
   解决登录页输入框被填充为黄色背景 / 看不见文字的问题 */
.base-input:-webkit-autofill,
.base-input:-webkit-autofill:hover,
.base-input:-webkit-autofill:focus,
.base-input:-webkit-autofill:active {
  -webkit-text-fill-color: #1f2937 !important;
  -webkit-box-shadow: 0 0 0 1000px #ffffff inset !important;
  box-shadow: 0 0 0 1000px #ffffff inset !important;
  transition: background-color 5000s ease-in-out 0s;
  caret-color: #1f2937;
}

.dark .base-input:-webkit-autofill,
.dark .base-input:-webkit-autofill:hover,
.dark .base-input:-webkit-autofill:focus,
.dark .base-input:-webkit-autofill:active {
  -webkit-text-fill-color: #f1f5f9 !important;
  -webkit-box-shadow: 0 0 0 1000px #1f2937 inset !important;
  box-shadow: 0 0 0 1000px #1f2937 inset !important;
  caret-color: #f1f5f9;
}
</style>
