<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { menuRoutes } from '@/router/menu'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const userStore = useUserStore()

const visibleItems = computed(() => {
  return menuRoutes.filter(item => !item.adminOnly || userStore.isAdmin)
})

function isActive(path: string) {
  if (!path)
    return route.path === '/'
  return route.path === `/${path}` || route.path.startsWith(`/${path}/`)
}
</script>

<template>
  <nav class="fixed bottom-0 left-0 right-0 z-40 px-4 pb-4 lg:hidden">
    <div
      class="flex items-center justify-around border border-[#8b6914]/20 rounded-2xl bg-white/95 px-2 py-2 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur-sm dark:border-gray-700/40 dark:bg-gray-900/95"
      style="background: var(--theme-bg, rgba(255,255,255,0.95))"
    >
      <RouterLink
        v-for="item in visibleItems"
        :key="item.path"
        :to="item.path ? `/${item.path}` : '/'"
        class="flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-xs transition-all"
        :class="isActive(item.path)
          ? 'font-medium'
          : 'opacity-60'"
        :style="{ color: isActive(item.path) ? 'var(--theme-primary, #4a8c3f)' : 'var(--theme-text, #3d2b1f)' }"
      >
        <span class="text-lg">{{ item.icon }}</span>
        <span class="scale-90">{{ item.label }}</span>
      </RouterLink>
    </div>
  </nav>
</template>
