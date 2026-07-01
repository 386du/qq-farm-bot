<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { menuRoutes } from '@/router/menu'
import { useAppStore } from '@/stores/app'
import { useUserStore } from '@/stores/user'

interface MenuBadge {
  count: number
  dot?: boolean
}

const route = useRoute()
const userStore = useUserStore()
const appStore = useAppStore()

const ripplePos = ref<Record<string, { x: number; y: number; key: number }>>({})
const isMobile = ref(true)

/** 各菜单项的徽标（红点 / 数字） */
const badges = computed<Record<string, MenuBadge>>(() => ({}))

/** 中心 FAB 入口（始终固定） */
const centerEntry = {
  key: '__fab__',
  path: 'personal',
  label: '农场',
  icon: 'i-carbon-crop-growth',
  isFab: true,
}

/** 显示在 dock 中的菜单项：管理员可见 + 启用的，排除中心 FAB 目标 */
const visibleItems = computed(() => {
  return menuRoutes
    .filter(item => !item.adminOnly || userStore.isAdminPanelUser)
    .filter(item => appStore.isBottomNavVisible(item.path, true))
    .filter(item => item.path !== centerEntry.path)
    .slice(0, 4) // 左右各 2 个，加中心 FAB = 5 槽
})

function isActive(path: string) {
  if (!path)
    return route.path === '/' || route.path === ''
  return route.path === `/${path}` || route.path.startsWith(`/${path}/`)
}

/** 路由变化时通过 view-transitions API 触发丝滑切换（支持的浏览器） */
function triggerViewTransition(_path: string) {
  if (typeof document === 'undefined')
    return
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => void
  }
  if (typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(() => {})
  }
}

/** 触觉反馈：点击 ripple 中心 */
function handlePointer(e: PointerEvent, item: typeof visibleItems.value[number] | typeof centerEntry) {
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  // 通过 key 区分 FAB：centerEntry 有 key='__fab__'，普通菜单项没有
  const isFabEntry = 'isFab' in item && item.isFab === true
  const key = isFabEntry ? '__fab__' : (item.path || 'home')
  ripplePos.value = {
    ...ripplePos.value,
    [key]: {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      key: Date.now() + Math.random(),
    },
  }
  if (!isFabEntry) {
    triggerViewTransition(item.path)
  }
  // 650ms 后清除这个 ripple
  setTimeout(() => {
    const next = { ...ripplePos.value }
    delete next[key]
    ripplePos.value = next
  }, 650)
}

/** 检测屏幕宽度，移动端才显示（lg 以上隐藏） */
function updateIsMobile() {
  if (typeof window === 'undefined')
    return
  isMobile.value = window.matchMedia('(max-width: 1023px)').matches
}

onMounted(() => {
  updateIsMobile()
  window.addEventListener('resize', updateIsMobile)
})

onUnmounted(() => {
  if (typeof window !== 'undefined')
    window.removeEventListener('resize', updateIsMobile)
})

/** 拆分左右两侧菜单，让中央 FAB 始终居中 */
const leftItems = computed(() => visibleItems.value.slice(0, Math.floor(visibleItems.value.length / 2)))
const rightItems = computed(() => visibleItems.value.slice(Math.floor(visibleItems.value.length / 2)))

function linkTarget(path: string) {
  return path ? `/${path}` : '/'
}

function activeStyle(item: typeof visibleItems.value[number]): CSSProperties {
  const active = isActive(item.path)
  return {
    color: active ? 'var(--theme-primary)' : 'var(--theme-text)',
  }
}
</script>

<template>
  <nav
    v-if="isMobile"
    class="bottom-dock-wrap"
    aria-label="主导航"
  >
    <div class="bottom-dock">
      <!-- 左侧菜单 -->
      <div class="dock-side dock-left">
        <RouterLink
          v-for="(item, idx) in leftItems"
          :key="item.path || 'home'"
          :to="linkTarget(item.path)"
          class="dock-item"
          :class="[isActive(item.path) ? 'is-active' : '', `dock-stagger-${idx + 1}`]"
          :style="activeStyle(item)"
          @pointerdown="handlePointer($event, item)"
        >
          <div class="dock-icon-wrap">
            <div :class="[item.icon, 'dock-icon', isActive(item.path) ? 'dock-icon-bounce' : '']" />
            <span
              v-if="badges[item.path]?.dot"
              class="dock-badge dock-badge-dot"
              :style="{ backgroundColor: '#ef4444' }"
            />
            <span
              v-else-if="badges[item.path] && badges[item.path]!.count > 0"
              class="dock-badge dock-badge-num"
              :style="{ backgroundColor: '#ef4444' }"
            >
              {{ badges[item.path]!.count > 99 ? '99+' : badges[item.path]!.count }}
            </span>
          </div>
          <span class="dock-label">{{ item.label }}</span>
          <span
            v-if="ripplePos[item.path || 'home']"
            class="dock-ripple"
            :key="ripplePos[item.path || 'home']!.key"
            :style="{
              left: `${ripplePos[item.path || 'home']!.x}px`,
              top: `${ripplePos[item.path || 'home']!.y}px`,
            }"
          />
        </RouterLink>
      </div>

      <!-- 中央 FAB 凸起按钮 -->
      <RouterLink
        :to="linkTarget(centerEntry.path)"
        class="dock-fab"
        :class="[isActive(centerEntry.path) ? 'is-active' : '']"
        @pointerdown="handlePointer($event, centerEntry)"
      >
        <span class="dock-fab-ring" />
        <span class="dock-fab-inner">
          <div :class="[centerEntry.icon, 'dock-fab-icon']" />
        </span>
        <span class="dock-fab-label">{{ centerEntry.label }}</span>
        <span
          v-if="ripplePos['__fab__']"
          class="dock-ripple dock-ripple-fab"
          :key="ripplePos['__fab__']!.key"
          :style="{
            left: `${ripplePos['__fab__']!.x}px`,
            top: `${ripplePos['__fab__']!.y}px`,
          }"
        />
      </RouterLink>

      <!-- 右侧菜单 -->
      <div class="dock-side dock-right">
        <RouterLink
          v-for="(item, idx) in rightItems"
          :key="item.path || 'home'"
          :to="linkTarget(item.path)"
          class="dock-item"
          :class="[isActive(item.path) ? 'is-active' : '', `dock-stagger-${idx + 1}`]"
          :style="activeStyle(item)"
          @pointerdown="handlePointer($event, item)"
        >
          <div class="dock-icon-wrap">
            <div :class="[item.icon, 'dock-icon', isActive(item.path) ? 'dock-icon-bounce' : '']" />
            <span
              v-if="badges[item.path]?.dot"
              class="dock-badge dock-badge-dot"
              :style="{ backgroundColor: '#ef4444' }"
            />
            <span
              v-else-if="badges[item.path] && badges[item.path]!.count > 0"
              class="dock-badge dock-badge-num"
              :style="{ backgroundColor: '#ef4444' }"
            >
              {{ badges[item.path]!.count > 99 ? '99+' : badges[item.path]!.count }}
            </span>
          </div>
          <span class="dock-label">{{ item.label }}</span>
          <span
            v-if="ripplePos[item.path || 'home']"
            class="dock-ripple"
            :key="ripplePos[item.path || 'home']!.key"
            :style="{
              left: `${ripplePos[item.path || 'home']!.x}px`,
              top: `${ripplePos[item.path || 'home']!.y}px`,
            }"
          />
        </RouterLink>
      </div>
    </div>
  </nav>
</template>

<style scoped>
/* ============================================================
   Bottom Dock — 现代化悬浮底栏
   - 玻璃拟态 + 滑动高亮 pill + 中心 FAB + 触觉 ripple
   ============================================================ */

.bottom-dock-wrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  padding: 0 12px;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
  pointer-events: none;
  animation: dock-slide-up 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.bottom-dock {
  position: relative;
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  pointer-events: auto;
  width: 100%;
  max-width: 460px;
  height: 64px;
  border-radius: 22px;
  background: color-mix(in srgb, var(--theme-bg) 60%, transparent);
  backdrop-filter: blur(28px) saturate(220%);
  -webkit-backdrop-filter: blur(28px) saturate(220%);
  border: 1px solid color-mix(in srgb, var(--theme-primary) 14%, transparent);
  box-shadow:
    0 -4px 24px color-mix(in srgb, var(--theme-primary) 8%, transparent),
    0 -1px 0 color-mix(in srgb, white 20%, transparent) inset,
    0 8px 32px color-mix(in srgb, black 18%, transparent);
  overflow: visible;
  padding: 6px 4px;
}

.dark .bottom-dock {
  background: color-mix(in srgb, var(--theme-bg) 50%, transparent);
  border-color: color-mix(in srgb, var(--theme-primary) 22%, transparent);
  box-shadow:
    0 -4px 24px color-mix(in srgb, black 35%, transparent),
    0 8px 32px color-mix(in srgb, black 45%, transparent);
}

/* 顶部高光描边 */
.bottom-dock::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 22px;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, white 25%, transparent) 0%,
    transparent 30%
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  padding: 1px;
}

.dock-side {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 2px;
}

.dock-left {
  padding-left: 4px;
  padding-right: 0;
}

.dock-right {
  padding-right: 4px;
  padding-left: 0;
  justify-content: flex-end;
}

/* ------------------- 普通菜单项 ------------------- */
.dock-item {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 52px;
  border-radius: 16px;
  font-weight: 600;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  overflow: hidden;
  isolation: isolate;
}

.dock-item:active {
  transform: scale(0.92);
}

.dock-item.is-active::before {
  content: '';
  position: absolute;
  inset: 4px;
  border-radius: 14px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--theme-primary) 22%, transparent) 0%,
    color-mix(in srgb, var(--theme-primary) 8%, transparent) 100%
  );
  z-index: -2;
  animation: dock-pill-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  box-shadow:
    0 2px 8px color-mix(in srgb, var(--theme-primary) 25%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 25%, transparent);
}

.dock-item.is-active::after {
  content: '';
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 18px;
  height: 3px;
  border-radius: 9999px;
  background: var(--theme-primary);
  box-shadow: 0 0 10px var(--theme-primary);
  animation: dock-indicator-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.dock-icon-wrap {
  position: relative;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2px;
}

.dock-icon {
  font-size: 22px;
  line-height: 1;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.dock-item.is-active .dock-icon {
  transform: translateY(-2px) scale(1.15);
  filter: drop-shadow(0 2px 6px color-mix(in srgb, var(--theme-primary) 50%, transparent));
}

.dock-icon-bounce {
  animation: dock-icon-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.dock-label {
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.02em;
  opacity: 0.7;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dock-item.is-active .dock-label {
  opacity: 1;
  transform: scale(1.05);
  font-weight: 800;
}

/* ------------------- 红点 / 数字徽章 ------------------- */
.dock-badge {
  position: absolute;
  top: -2px;
  right: -4px;
  pointer-events: none;
  border: 2px solid color-mix(in srgb, var(--theme-bg) 80%, transparent);
  animation: dock-badge-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.dock-badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.6);
  animation:
    dock-badge-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
    dock-badge-pulse 1.8s ease-out infinite;
}

.dock-badge-num {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 9999px;
  color: white;
  font-size: 9px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

/* ------------------- 触觉 ripple ------------------- */
.dock-ripple {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--theme-primary) 35%, transparent);
  transform: translate(-50%, -50%) scale(0);
  pointer-events: none;
  animation: dock-ripple 0.6s ease-out forwards;
  z-index: -1;
}

/* ------------------- 中央 FAB ------------------- */
.dock-fab {
  position: relative;
  flex: 0 0 auto;
  width: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  margin: 0 -4px;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.dock-fab:active {
  transform: scale(0.95);
}

.dock-fab-ring {
  position: absolute;
  top: -22px;
  left: 50%;
  transform: translateX(-50%);
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--theme-gradient, var(--theme-primary));
  box-shadow:
    0 6px 16px color-mix(in srgb, var(--theme-primary) 50%, transparent),
    inset 0 -3px 0 color-mix(in srgb, black 25%, transparent),
    inset 0 2px 0 color-mix(in srgb, white 30%, transparent);
  animation: dock-fab-pulse 2.4s ease-in-out infinite;
}

.dock-fab-inner {
  position: relative;
  z-index: 2;
  top: -22px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--theme-primary) 100%, white 15%) 0%,
    var(--theme-primary) 100%
  );
  box-shadow:
    0 4px 12px color-mix(in srgb, var(--theme-primary) 50%, transparent);
}

.dock-fab-icon {
  font-size: 30px;
  color: white;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.2));
  animation: dock-fab-spin 8s linear infinite;
  animation-play-state: paused;
}

.dock-fab:hover .dock-fab-icon,
.dock-fab:active .dock-fab-icon {
  animation-play-state: running;
}

.dock-fab.is-active .dock-fab-ring {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--theme-primary) 100%, white 30%) 0%,
    var(--theme-primary) 100%
  );
  box-shadow:
    0 6px 20px color-mix(in srgb, var(--theme-primary) 70%, transparent),
    inset 0 -3px 0 color-mix(in srgb, black 25%, transparent),
    inset 0 2px 0 color-mix(in srgb, white 30%, transparent);
}

.dock-fab-label {
  position: absolute;
  bottom: 4px;
  font-size: 10px;
  font-weight: 800;
  color: var(--theme-primary);
  letter-spacing: 0.02em;
  text-shadow: 0 1px 2px color-mix(in srgb, var(--theme-bg) 80%, transparent);
}

/* ------------------- 入场 / 错峰动画 ------------------- */
.dock-stagger-1 { animation-delay: 0.05s; }
.dock-stagger-2 { animation-delay: 0.10s; }
.dock-stagger-3 { animation-delay: 0.15s; }
.dock-stagger-4 { animation-delay: 0.20s; }

.dock-side .dock-item {
  animation: dock-item-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.dock-fab {
  animation: dock-fab-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s both;
}

/* ------------------- keyframes ------------------- */
@keyframes dock-slide-up {
  0% {
    opacity: 0;
    transform: translateY(40px) scale(0.95);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes dock-item-in {
  0% {
    opacity: 0;
    transform: translateY(20px) scale(0.8);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes dock-fab-in {
  0% {
    opacity: 0;
    transform: translateY(30px) scale(0.5) rotate(-180deg);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1) rotate(0);
  }
}

@keyframes dock-pill-in {
  0% {
    opacity: 0;
    transform: scale(0.6);
  }
  60% {
    opacity: 1;
    transform: scale(1.05);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes dock-indicator-in {
  0% {
    opacity: 0;
    transform: translateX(-50%) scaleX(0);
  }
  100% {
    opacity: 1;
    transform: translateX(-50%) scaleX(1);
  }
}

@keyframes dock-icon-pop {
  0% {
    transform: scale(1) translateY(0);
  }
  40% {
    transform: scale(1.35) translateY(-6px) rotate(-8deg);
  }
  70% {
    transform: scale(0.95) translateY(0) rotate(4deg);
  }
  100% {
    transform: scale(1.15) translateY(-2px) rotate(0);
  }
}

@keyframes dock-badge-pop {
  0% {
    opacity: 0;
    transform: scale(0);
  }
  60% {
    opacity: 1;
    transform: scale(1.25);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes dock-badge-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, #ef4444 60%, transparent);
  }
  100% {
    box-shadow: 0 0 0 8px color-mix(in srgb, #ef4444 0%, transparent);
  }
}

@keyframes dock-ripple {
  0% {
    transform: translate(-50%, -50%) scale(0);
    opacity: 0.6;
  }
  100% {
    transform: translate(-50%, -50%) scale(40);
    opacity: 0;
  }
}

@keyframes dock-fab-pulse {
  0%, 100% {
    transform: translateX(-50%) scale(1);
    box-shadow:
      0 6px 16px color-mix(in srgb, var(--theme-primary) 50%, transparent),
      inset 0 -3px 0 color-mix(in srgb, black 25%, transparent),
      inset 0 2px 0 color-mix(in srgb, white 30%, transparent);
  }
  50% {
    transform: translateX(-50%) scale(1.05);
    box-shadow:
      0 8px 24px color-mix(in srgb, var(--theme-primary) 70%, transparent),
      inset 0 -3px 0 color-mix(in srgb, black 25%, transparent),
      inset 0 2px 0 color-mix(in srgb, white 30%, transparent);
  }
}

@keyframes dock-fab-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* 路由切换 view-transitions */
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 0.3s;
}
</style>
