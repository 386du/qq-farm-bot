<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref } from 'vue'
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

onMounted(() => {
  // 移除了强制警告弹窗
})

onUnmounted(() => {
  // 清理逻辑
})
</script>

<template>
  <div class="w-screen flex overflow-hidden bg-[#fef9ef] dark:bg-gray-900" style="height: 100dvh;">
    <!-- Mobile Sidebar Overlay -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-sm transition-opacity lg:hidden"
      @click="appStore.closeSidebar"
    />

    <Sidebar />

    <main class="relative h-full min-w-0 flex flex-1 flex-col overflow-hidden">
      <!-- Top Bar (Mobile/Tablet only or for additional actions) -->
      <header class="h-16 flex shrink-0 items-center justify-between border-b-3 border-[#8b6914]/30 from-[#f5e6c8] to-[#fef9ef] bg-gradient-to-r px-4 lg:hidden dark:border-gray-700/50 dark:bg-gray-800">
        <div class="text-lg text-[#3d2b1f] font-display">
          🌾 QQ农场智能助手
        </div>
        <div class="flex items-center gap-2">
          <div
            v-if="currentAccount"
            class="relative max-w-[180px] flex cursor-pointer items-center gap-2 border border-pink-300 rounded-xl bg-pink-50 px-2.5 py-1.5 shadow-sm dark:border-pink-700/50 dark:bg-pink-900/20"
            @click="showAccountDropdown = !showAccountDropdown"
          >
            <div class="h-7 w-7 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-pink-200 dark:bg-pink-800">
              <img
                v-if="currentAccount.uin"
                :src="`https://q1.qlogo.cn/g?b=qq&nk=${currentAccount.uin}&s=100`"
                class="h-full w-full object-cover"
                @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
              >
              <div v-else class="i-carbon-user text-pink-500" />
            </div>
            <div class="min-w-0 flex flex-1 flex-col">
              <span class="truncate text-xs text-pink-700 font-medium dark:text-pink-200">
                {{ displayName }}
              </span>
              <div class="flex items-center gap-1">
                <span
                  v-if="platform"
                  class="rounded px-1 py-0 text-[9px] font-medium leading-tight"
                  :class="getPlatformClass(currentAccount.platform)"
                >
                  {{ platform }}
                </span>
                <span class="text-[9px] text-pink-400">{{ currentAccount.uin || currentAccount.id }}</span>
              </div>
            </div>
            <div
              class="i-carbon-chevron-down text-pink-400 transition-transform duration-200"
              :class="{ 'rotate-180': showAccountDropdown }"
            />

            <!-- Account Dropdown Menu -->
            <div
              v-if="showAccountDropdown"
              class="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden border border-pink-200 rounded-2xl bg-white/95 py-1 shadow-xl backdrop-blur-sm dark:border-pink-800/40 dark:bg-gray-900/95"
              @click.stop
            >
              <div class="custom-scrollbar max-h-60 overflow-y-auto">
                <template v-if="accounts.length > 0">
                  <button
                    v-for="acc in accounts"
                    :key="acc.id || acc.uin"
                    class="mx-1 w-full flex items-center gap-3 rounded-xl px-4 py-2 transition-all duration-200 hover:bg-pink-50/50 dark:hover:bg-pink-900/20"
                    :style="{ backgroundColor: currentAccount?.id === acc.id ? 'color-mix(in srgb, var(--theme-primary) 10%, transparent)' : undefined }"
                    @click="selectAccount(acc)"
                  >
                    <div class="h-6 w-6 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 shadow-sm dark:bg-gray-600">
                      <img
                        v-if="acc.uin"
                        :src="`https://q1.qlogo.cn/g?b=qq&nk=${acc.uin}&s=100`"
                        class="h-full w-full object-cover"
                        @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
                      >
                      <div v-else class="i-carbon-user text-gray-400" />
                    </div>
                    <div class="min-w-0 flex flex-1 flex-col items-start">
                      <span class="w-full truncate text-left text-sm font-medium">
                        {{ acc.name || acc.nick || acc.uin || acc.id }}
                      </span>
                      <div class="flex items-center gap-1.5">
                        <span
                          v-if="getPlatformLabel(acc.platform)"
                          class="rounded-lg px-1.5 py-0.2 text-[10px] font-medium leading-tight"
                          :class="getPlatformClass(acc.platform)"
                        >
                          {{ getPlatformLabel(acc.platform) }}
                        </span>
                        <span class="text-xs text-gray-400">{{ acc.uin || acc.id }}</span>
                      </div>
                    </div>
                    <div class="flex items-center gap-1">
                      <button
                        class="rounded-full p-1 text-gray-400 transition-colors hover:bg-pink-50/50 hover:text-pink-500 dark:hover:bg-pink-900/20"
                        title="编辑账号"
                        @click.stop="openAccountEditModal(acc)"
                      >
                        <div class="i-carbon-edit" />
                      </button>
                      <div v-if="currentAccount?.id === acc.id" class="i-carbon-checkmark" :style="{ color: 'var(--theme-primary)' }" />
                    </div>
                  </button>
                </template>
                <div v-else class="px-4 py-3 text-center text-sm text-gray-400">
                  暂无账号
                </div>
              </div>
              <div class="mt-1 border-t border-gray-100/60 pt-1 dark:border-gray-700/60">
                <button
                  class="mx-1 w-full flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition-colors hover:bg-pink-50/50 dark:hover:bg-pink-900/20"
                  :style="{ color: 'var(--theme-primary)' }"
                  @click="showAccountModal = true; showAccountDropdown = false"
                >
                  <div class="i-carbon-add" />
                  <span>添加账号</span>
                </button>
                <router-link
                  to="/settings"
                  class="mx-1 w-full flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition-colors hover:bg-pink-50/50 dark:hover:bg-pink-900/20"
                  :style="{ color: 'var(--theme-primary)' }"
                  @click="showAccountDropdown = false"
                >
                  <div class="i-carbon-add-alt" />
                  <span>管理账号</span>
                </router-link>
              </div>
            </div>
          </div>
          <button
            class="flex items-center justify-center rounded-xl p-2 text-[#8b6914] transition-colors hover:bg-[#f0c040]/20 dark:text-[#f0c040] dark:hover:bg-gray-700"
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
      @close="showYybConfig = false"
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
