<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { menuRoutes } from '@/router/menu'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const userStore = useUserStore()
const activeKey = ref('')

const visibleItems = computed(() => {
  return menuRoutes.filter(item => !item.adminOnly || userStore.isAdminPanelUser)
})

function isActive(path: string) {
  if (!path)
    return route.path === '/'
  return route.path === `/${path}` || route.path.startsWith(`/${path}/`)
}

watch(() => route.path, () => {
  activeKey.value = route.path
}, { immediate: true })
</script>

<template>
  <nav class="fixed bottom-0 left-0 right-0 z-40 px-4 pb-4 lg:hidden">
    <div
      class="flex items-center justify-around rounded-2xl px-2 py-2"
      style="
        background: color-mix(in srgb, var(--theme-bg) 35%, transparent);
        backdrop-filter: blur(24px) saturate(200%);
        -webkit-backdrop-filter: blur(24px) saturate(200%);
        border: 1px solid color-mix(in srgb, var(--theme-primary) 12%, transparent);
        box-shadow: 0 -4px 24px color-mix(in srgb, var(--theme-primary) 5%, transparent), 0 -1px 0 color-mix(in srgb, white 15%, transparent) inset;
      "
    >
      <RouterLink
        v-for="item in visibleItems"
        :key="item.path"
        :to="item.path ? `/${item.path}` : '/'"
        class="relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-xs transition-all duration-300"
        :class="isActive(item.path)
          ? 'bottom-nav-item-active font-bold'
          : 'opacity-60 hover:opacity-100'"
        :style="{ color: isActive(item.path) ? 'var(--theme-primary)' : 'var(--theme-text)' }"
      >
        <span
          :class="isActive(item.path) ? 'bottom-nav-icon-bounce' : ''"
          class="text-xl transition-transform"
          :style="isActive(item.path) ? 'transform: scale(1.1)' : ''"
        >{{ item.icon }}</span>
        <span class="scale-90 font-bold">{{ item.label }}</span>
        <div
          v-if="isActive(item.path)"
          class="absolute h-1 w-6 rounded-full -bottom-0.5"
          :style="{ backgroundColor: 'var(--theme-primary)', boxShadow: `0 0 8px var(--theme-primary)` }"
        />
      </RouterLink>
    </div>
  </nav>
</template>
