<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import AccountModal from '@/components/AccountModal.vue'
import BottomNav from '@/components/BottomNav.vue'
import Sidebar from '@/components/Sidebar.vue'
import YybConfigModal from '@/components/YybConfigModal.vue'
import YybLoginModal from '@/components/YybLoginModal.vue'
import { getPlatformClass, getPlatformLabel, useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const accountStore = useAccountStore()
const { sidebarOpen } = storeToRefs(appStore)
const { accounts, currentAccount } = storeToRefs(accountStore)

const showAccountDropdown = ref(false)
const showAccountModal = ref(false)
const showYybConfig = ref(false)
const showYybLogin = ref(false)
const accountToEdit = ref<any>(null)
const accountTriggerRef = ref<HTMLElement | null>(null)

function closeYybConfig() {
  showYybConfig.value = false
}
const accountDropdownRef = ref<HTMLElement | null>(null)
const dropdownStyle = ref<Record<string, string>>({
  top: '0px',
  right: '0px',
  backgroundColor: '',
  border: '',
})

const platform = computed(() => getPlatformLabel(currentAccount.value?.platform))
const displayName = computed(() => {
  const acc = currentAccount.value
  if (!acc)
    return '选择账号'
  return acc.name || acc.nick || acc.uin || acc.id
})

function selectAccount(acc: any) {
  accountStore.setCurrentAccount(acc)
  showAccountDropdown.value = false
}

function openAccountEditModal(acc: any) {
  accountToEdit.value = acc
  showAccountModal.value = true
  showAccountDropdown.value = false
}

function handleAccountSaved() {
  accountStore.fetchAccounts()
  showAccountModal.value = false
  accountToEdit.value = null
}

function updateDropdownPosition() {
  if (!accountTriggerRef.value || !showAccountDropdown.value)
    return
  nextTick(() => {
    const trigger = accountTriggerRef.value
    if (!trigger)
      return
    const rect = trigger.getBoundingClientRect()
    let right = window.innerWidth - rect.right
    if (right < 8)
      right = 8
    dropdownStyle.value = {
      top: `${rect.bottom + 8}px`,
      right: `${right}px`,
      backgroundColor: 'color-mix(in srgb, var(--theme-bg) 95%, transparent)',
      border: '2px solid color-mix(in srgb, var(--theme-primary) 20%, transparent)',
    }
  })
}

watch(showAccountDropdown, (val) => {
  if (val)
    updateDropdownPosition()
})

function handleClickOutside(e: MouseEvent) {
  if (!showAccountDropdown.value)
    return
  const trigger = accountTriggerRef.value
  const dropdown = accountDropdownRef.value
  if (
    trigger && !trigger.contains(e.target as Node)
    && dropdown && !dropdown.contains(e.target as Node)
  ) {
    showAccountDropdown.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  window.addEventListener('resize', updateDropdownPosition)
  window.addEventListener('scroll', updateDropdownPosition, true)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('resize', updateDropdownPosition)
  window.removeEventListener('scroll', updateDropdownPosition, true)
})
</script>

<template>
  <div class="w-screen flex overflow-hidden" style="height: 100dvh; background-color: var(--theme-bg)">
    <!-- 背景漂浮装饰 -->
    <div class="bg-decorations">
      <span class="bg-cloud animate-float-slow" style="top: 5%; left: 10%; animation-delay: 0s; font-size: 50px;">☁️</span>
      <span class="bg-cloud animate-float-medium" style="top: 12%; left: 75%; animation-delay: 1s; font-size: 40px;">☁️</span>
      <span class="bg-cloud animate-float-slow" style="top: 25%; left: 45%; animation-delay: 2s; font-size: 35px;">☁️</span>
      <span class="bg-petal animate-float-fast" style="top: 8%; left: 25%; animation-delay: 0.5s;">🌸</span>
      <span class="bg-petal animate-float-medium" style="top: 20%; left: 60%; animation-delay: 1.5s;">🍃</span>
      <span class="bg-petal animate-float-slow" style="top: 35%; left: 85%; animation-delay: 2.5s;">✨</span>
      <span class="bg-petal animate-float-fast" style="top: 15%; left: 90%; animation-delay: 3s;">🌾</span>
    </div>

    <!-- Mobile Sidebar Overlay -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-sm transition-opacity lg:hidden"
      @click="appStore.closeSidebar"
    />

    <Sidebar />

    <main class="relative z-10 h-full min-w-0 flex flex-1 flex-col overflow-hidden">
      <!-- Top Bar (Mobile/Tablet only or for additional actions) -->
      <header
        class="h-16 flex shrink-0 items-center justify-between px-4 lg:hidden"
        :style="{
          background: `color-mix(in srgb, var(--theme-bg) 35%, transparent)`,
          backdropFilter: 'blur(24px) saturate(200%)',
          WebkitBackdropFilter: 'blur(24px) saturate(200%)',
          borderBottom: '1px solid color-mix(in srgb, var(--theme-primary) 12%, transparent)',
          boxShadow: '0 2px 20px color-mix(in srgb, var(--theme-primary) 5%, transparent)',
        }"
      >
        <div class="flex items-center gap-2">
          <span class="title-wheat text-2xl">🌾</span>
          <div class="text-lg font-bold font-display" style="color: var(--theme-primary)">
            QQ农场智能助手
          </div>
          <span class="animate-sparkle text-sm" style="animation-delay: 0.5s">✨</span>
        </div>
        <div class="flex items-center gap-2">
          <div
            v-if="currentAccount"
            ref="accountTriggerRef"
            class="relative max-w-[180px] flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 transition-all duration-200 hover:scale-105"
            :style="{
              backgroundColor: 'color-mix(in srgb, var(--theme-primary) 8%, var(--theme-bg))',
              border: '2px solid color-mix(in srgb, var(--theme-primary) 25%, transparent)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            }"
            @click="showAccountDropdown = !showAccountDropdown"
          >
            <div
              class="relative h-7 w-7 flex shrink-0 items-center justify-center overflow-hidden rounded-full"
              :style="{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 18%, transparent)' }"
            >
              <img
                v-if="currentAccount.uin"
                :src="`https://q1.qlogo.cn/g?b=qq&nk=${currentAccount.uin}&s=100`"
                class="h-full w-full object-cover"
                @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
              >
              <div v-else class="i-carbon-user" :style="{ color: 'var(--theme-primary)' }" />
            </div>
            <div class="min-w-0 flex flex-1 flex-col">
              <span class="truncate text-xs font-bold" style="color: var(--theme-primary)">
                {{ displayName }}
              </span>
              <div class="flex items-center gap-1">
                <span
                  v-if="platform"
                  class="rounded px-1 py-0 text-[9px] font-bold leading-tight"
                  :class="getPlatformClass(currentAccount.platform)"
                >
                  {{ platform }}
                </span>
                <span
                  v-if="currentAccount.level"
                  class="rounded px-1 py-0 text-[9px] font-bold leading-tight"
                  :style="{ backgroundColor: 'color-mix(in srgb, var(--theme-secondary) 15%, transparent)', color: 'var(--theme-secondary)' }"
                >
                  Lv.{{ currentAccount.level }}
                </span>
                <span class="text-[9px]" style="color: color-mix(in srgb, var(--theme-text) 50%, transparent)">{{ currentAccount.uin || currentAccount.id }}</span>
              </div>
            </div>
            <div
              class="i-carbon-chevron-down transition-transform duration-200"
              :class="{ 'rotate-180': showAccountDropdown }"
              :style="{ color: 'var(--theme-primary)' }"
            />

            <!-- Account Dropdown Menu -->
            <Teleport to="body">
              <div
                v-if="showAccountDropdown"
                ref="accountDropdownRef"
                class="fixed z-[100] w-64 overflow-hidden rounded-2xl py-1 shadow-2xl backdrop-blur-md"
                :style="dropdownStyle"
                @click.stop
              >
                <div class="custom-scrollbar max-h-60 overflow-y-auto">
                  <template v-if="accounts.length > 0">
                    <button
                      v-for="acc in accounts"
                      :key="acc.id || acc.uin"
                      class="mx-1 w-full flex items-center gap-3 rounded-xl px-4 py-2 transition-all duration-200 hover:scale-[1.02]"
                      :style="{
                        backgroundColor: currentAccount?.id === acc.id ? 'color-mix(in srgb, var(--theme-primary) 10%, transparent)' : undefined,
                        color: 'var(--theme-text)',
                      }"
                      @click="selectAccount(acc)"
                    >
                      <div
                        class="h-6 w-6 flex shrink-0 items-center justify-center overflow-hidden rounded-full shadow-sm"
                        :style="{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, transparent)' }"
                      >
                        <img
                          v-if="acc.uin"
                          :src="`https://q1.qlogo.cn/g?b=qq&nk=${acc.uin}&s=100`"
                          class="h-full w-full object-cover"
                          @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
                        >
                        <div v-else class="i-carbon-user" :style="{ color: 'var(--theme-primary)' }" />
                      </div>
                      <div class="min-w-0 flex flex-1 flex-col items-start">
                        <span class="w-full truncate text-left text-sm font-bold" style="color: 'var(--theme-text)'">
                          {{ acc.name || acc.nick || acc.uin || acc.id }}
                        </span>
                        <div class="flex items-center gap-1.5">
                          <span
                            v-if="getPlatformLabel(acc.platform)"
                            class="rounded-lg px-1.5 py-0.2 text-[10px] font-bold leading-tight"
                            :class="getPlatformClass(acc.platform)"
                          >
                            {{ getPlatformLabel(acc.platform) }}
                          </span>
                          <span
                            v-if="acc.level"
                            class="rounded-lg px-1.5 py-0.2 text-[10px] font-bold leading-tight"
                            :style="{ backgroundColor: 'color-mix(in srgb, var(--theme-secondary) 15%, transparent)', color: 'var(--theme-secondary)' }"
                          >
                            Lv.{{ acc.level }}
                          </span>
                          <span class="text-xs" style="color: color-mix(in srgb, var(--theme-text) 50%, transparent)">{{ acc.uin || acc.id }}</span>
                        </div>
                      </div>
                      <div class="flex items-center gap-1">
                        <button
                          class="rounded-full p-1 transition-colors hover:bg-black/5"
                          title="编辑账号"
                          :style="{ color: 'color-mix(in srgb, var(--theme-text) 60%, transparent)' }"
                          @click.stop="openAccountEditModal(acc)"
                        >
                          <div class="i-carbon-edit" />
                        </button>
                        <div v-if="currentAccount?.id === acc.id" class="i-carbon-checkmark" :style="{ color: 'var(--theme-primary)' }" />
                      </div>
                    </button>
                  </template>
                  <div v-else class="px-4 py-3 text-center text-sm" style="color: color-mix(in srgb, var(--theme-text) 50%, transparent)">
                    暂无账号
                  </div>
                </div>
                <div class="mt-1 border-t pt-1" style="borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)'">
                  <button
                    class="mx-1 w-full flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors hover:scale-[1.02]"
                    :style="{ color: 'var(--theme-primary)' }"
                    @click="showAccountModal = true; showAccountDropdown = false"
                  >
                    <div class="i-carbon-add" />
                    <span>添加账号</span>
                  </button>
                  <router-link
                    to="/settings"
                    class="mx-1 w-full flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors hover:scale-[1.02]"
                    :style="{ color: 'var(--theme-primary)' }"
                    @click="showAccountDropdown = false"
                  >
                    <div class="i-carbon-add-alt" />
                    <span>管理账号</span>
                  </router-link>
                </div>
              </div>
            </Teleport>
          </div>
          <button
            class="flex items-center justify-center rounded-xl p-2 transition-all duration-200 hover:scale-110"
            :style="{
              color: 'var(--theme-secondary)',
            }"
            @mouseenter="($event.target as HTMLElement).style.backgroundColor = 'color-mix(in srgb, var(--theme-secondary) 15%, transparent)'"
            @mouseleave="($event.target as HTMLElement).style.backgroundColor = ''"
            @click="appStore.toggleSidebar"
          >
            <div class="i-carbon-menu text-xl" />
          </button>
        </div>
      </header>

      <!-- Main Content Area -->
      <div class="flex flex-1 flex-col overflow-hidden">
        <div class="custom-scrollbar flex flex-1 flex-col overflow-y-auto p-2 pb-24 md:p-6 sm:p-4 lg:pb-6">
          <RouterView v-slot="{ Component, route }">
            <Transition name="slide-fade" mode="out-in">
              <component :is="Component" :key="route.path" />
            </Transition>
          </RouterView>
        </div>
      </div>

      <BottomNav />
    </main>

    <!-- Account dropdown overlay -->
    <div
      v-if="showAccountDropdown"
      class="fixed inset-0 z-40 bg-transparent"
      @click="showAccountDropdown = false"
    />

    <AccountModal
      :show="showAccountModal"
      :edit-data="accountToEdit"
      @close="showAccountModal = false; accountToEdit = null"
      @saved="handleAccountSaved"
      @yyb-login="showAccountModal = false; showYybLogin = true"
      @yyb-config="showAccountModal = false; showYybConfig = true"
    />

    <YybConfigModal
      :show="showYybConfig"
      @close="closeYybConfig"
    />

    <YybLoginModal
      :show="showYybLogin"
      @close="showYybLogin = false"
      @saved="handleAccountSaved"
    />
  </div>
</template>

<style scoped>
/* 弹窗动画 */
.modal-fade-enter-active {
  animation: modal-in 0.4s ease-out;
}

.modal-fade-leave-active {
  animation: modal-out 0.3s ease-in;
}

@keyframes modal-in {
  0% {
    opacity: 0;
    transform: scale(0.9);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes modal-out {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(0.9);
  }
}

/* 弹窗样式 */
.warning-modal {
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-5px);
  }
}

/* 水波纹背景 */
.ripple-bg {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
}

.ripple {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(239, 68, 68, 0.1) 0%, transparent 70%);
  animation: ripple-effect 4s ease-out infinite;
}

.ripple-1 {
  width: 200px;
  height: 200px;
  animation-delay: 0s;
}

.ripple-2 {
  width: 300px;
  height: 300px;
  animation-delay: 1.3s;
}

.ripple-3 {
  width: 400px;
  height: 400px;
  animation-delay: 2.6s;
}

/* Slide Fade Transition — 弹性动画 */
.slide-fade-enter-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.slide-fade-leave-active {
  transition: all 0.2s ease-in;
}

.slide-fade-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
}

.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 3px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
}
</style>
