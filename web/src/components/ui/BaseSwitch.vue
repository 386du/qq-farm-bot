<script setup lang="ts">
defineProps<{
  label?: string
}>()
const model = defineModel<boolean>()
</script>

<template>
  <label class="inline-flex cursor-pointer items-center gap-3">
    <div class="relative inline-flex items-center">
      <input v-model="model" type="checkbox" class="peer sr-only">
      <div class="h-7 w-12 border-2 border-black/10 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-[22px] after:w-[22px] after:border-2 after:border-black/10 peer-checked:border-[#3a6b2e] after:rounded-full after:bg-white dark:bg-gray-600 peer-checked:bg-[#4a8c3f] after:shadow-[0_2px_0_rgba(0,0,0,0.15)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#4a8c3f]/30 after:transition-all after:duration-200 after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white/50 dark:after:bg-gray-200 dark:peer-checked:bg-[#6dbf5b]" />
    </div>
    <span v-if="label" class="select-none text-sm text-gray-700 font-semibold dark:text-gray-300">
      {{ label }}
    </span>
  </label>
</template>
