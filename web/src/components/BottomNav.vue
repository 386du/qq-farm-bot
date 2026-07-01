<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { menuRoutes } from '@/router/menu'
import { useAppStore } from '@/stores/app'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const userStore = useUserStore()
const appStore = useAppStore()

/** 角色 */
const isAdminPanelUser = computed(() => userStore.isAdminPanelUser)
const isLogin = computed(() => userStore.isLoggedIn)

const visibleItems = computed(() => {
  return menuRoutes
    .filter(item => !item.adminOnly || isAdminPanelUser.value)
    .filter(item => appStore.isBottomNavVisible(item.path, true))
})

function isActive(path: string) {
  if (!path)
    return route.path === '/' || route.path === ''
  return route.path === `/${path}` || route.path.startsWith(`/${path}/`)
}

/** 外观设置（响应式） */
const navStyle = computed(() => appStore.bottomNavStyle)
const iconSizeClass = computed(() => {
  switch (navStyle.value.iconSize) {
    case 'sm': return 'text-xl'
    case 'lg': return 'text-3xl'
    default: return 'text-2xl'
  }
})
const borderClass = computed(() => navStyle.value.showTopBorder ? 'border-t border-white/20 dark:border-gray-700/50' : '')

/** 容器内联样式：圆角 + 背景透明度（亮 / 暗） */
const containerStyle = computed(() => ({
  borderRadius: `${navStyle.value.borderRadius}px`,
  '--bn-light-alpha': `${navStyle.value.backgroundOpacity}%`,
  '--bn-dark-alpha': `${navStyle.value.backgroundOpacityDark}%`,
}) as Record<string, string | number>)
</script>

<template>
  <nav
    v-if="isLogin"
    class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 transition-colors duration-300 md:hidden"
    aria-label="主导航"
  >
    <div
      class="bn-container pointer-events-auto flex w-full max-w-md items-center justify-around border-t border-white/20 px-2 pt-2 pb-3 backdrop-blur-md transition-colors duration-300 dark:border-gray-700/50"
      :class="borderClass"
      :style="containerStyle"
    >
      <RouterLink
        v-for="item in visibleItems"
        :key="item.path || 'home'"
        :to="item.path ? `/${item.path}` : '/'"
        class="relative flex flex-col items-center justify-center rounded-xl px-2 py-1 text-gray-600 transition-all duration-200 hover:text-[color:var(--theme-primary)] dark:text-gray-300"
        :class="isActive(item.path) ? 'text-[color:var(--theme-primary)] bottom-nav-item-active' : ''"
      >
        <div
          :key="`${item.path}-${isActive(item.path) ? 'a' : 'i'}`"
          :class="[item.icon, 'mb-1 leading-none bottom-nav-icon', iconSizeClass, isActive(item.path) ? 'bottom-nav-icon-bounce' : '']"
        />
        <span v-if="navStyle.showLabel" class="text-xs font-medium">{{ item.label }}</span>
        <div
          v-if="isActive(item.path)"
          class="bottom-nav-indicator"
        />
      </RouterLink>
    </div>
  </nav>
</template>
