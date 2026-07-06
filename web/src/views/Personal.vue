<script setup lang="ts">
import { ref } from 'vue'
import BagPanel from '@/components/BagPanel.vue'
import FarmPanel from '@/components/FarmPanel.vue'
import ProfileModulesPanel from '@/components/ProfileModulesPanel.vue'
import TaskPanel from '@/components/TaskPanel.vue'

const currentTab = ref<'farm' | 'bag' | 'task' | 'modules'>('farm')
</script>

<template>
  <div class="h-full flex flex-col p-4">
    <div class="farm-card-enhanced mb-4 overflow-hidden p-2">
      <div class="flex gap-1.5">
        <button
          class="relative flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-bold transition-all duration-300"
          :class="currentTab === 'farm'
            ? 'text-white shadow-md scale-105'
            : 'hover:scale-105'"
          :style="currentTab === 'farm'
            ? {
              backgroundColor: 'var(--theme-primary)',
              boxShadow: `0 4px 12px color-mix(in srgb, var(--theme-primary), 40%, transparent)`,
            }
            : {
              color: 'color-mix(in srgb, var(--theme-text) 60%, transparent)',
            }"
          @click="currentTab = 'farm'"
        >
          <div class="i-carbon-sprout text-lg" :class="[{ 'animate-sparkle': currentTab === 'farm' }]" />
          <span>我的农场</span>
          <div
            v-if="currentTab === 'farm'"
            class="pointer-events-none absolute inset-0"
            style="background: linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 50%);"
          />
        </button>
        <button
          class="relative flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-bold transition-all duration-300"
          :class="currentTab === 'bag'
            ? 'text-white shadow-md scale-105'
            : 'hover:scale-105'"
          :style="currentTab === 'bag'
            ? {
              backgroundColor: 'var(--theme-primary)',
              boxShadow: `0 4px 12px color-mix(in srgb, var(--theme-primary), 40%, transparent)`,
            }
            : {
              color: 'color-mix(in srgb, var(--theme-text) 60%, transparent)',
            }"
          @click="currentTab = 'bag'"
        >
          <div class="i-carbon-box text-lg" :class="[{ 'animate-sparkle': currentTab === 'bag' }]" />
          <span>我的背包</span>
          <div
            v-if="currentTab === 'bag'"
            class="pointer-events-none absolute inset-0"
            style="background: linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 50%);"
          />
        </button>
        <button
          class="relative flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-bold transition-all duration-300"
          :class="currentTab === 'task'
            ? 'text-white shadow-md scale-105'
            : 'hover:scale-105'"
          :style="currentTab === 'task'
            ? {
              backgroundColor: 'var(--theme-primary)',
              boxShadow: `0 4px 12px color-mix(in srgb, var(--theme-primary), 40%, transparent)`,
            }
            : {
              color: 'color-mix(in srgb, var(--theme-text) 60%, transparent)',
            }"
          @click="currentTab = 'task'"
        >
          <div class="i-carbon-task text-lg" :class="[{ 'animate-sparkle': currentTab === 'task' }]" />
          <span>我的任务</span>
          <div
            v-if="currentTab === 'task'"
            class="pointer-events-none absolute inset-0"
            style="background: linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 50%);"
          />
        </button>
        <button
          class="relative flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-bold transition-all duration-300"
          :class="currentTab === 'modules'
            ? 'text-white shadow-md scale-105'
            : 'hover:scale-105'"
          :style="currentTab === 'modules'
            ? {
              backgroundColor: 'var(--theme-primary)',
              boxShadow: `0 4px 12px color-mix(in srgb, var(--theme-primary), 40%, transparent)`,
            }
            : {
              color: 'color-mix(in srgb, var(--theme-text) 60%, transparent)',
            }"
          @click="currentTab = 'modules'"
        >
          <div class="i-carbon-chip text-lg" :class="[{ 'animate-sparkle': currentTab === 'modules' }]" />
          <span>新版模块</span>
          <div
            v-if="currentTab === 'modules'"
            class="pointer-events-none absolute inset-0"
            style="background: linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 50%);"
          />
        </button>
      </div>
    </div>

    <div class="custom-scrollbar flex-1 overflow-hidden overflow-y-auto">
      <Transition
        mode="out-in"
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="transform opacity-0 translate-y-4"
        enter-to-class="transform opacity-100 translate-y-0"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="transform opacity-100 translate-y-0"
        leave-to-class="transform opacity-0 -translate-y-4"
      >
        <component
          :is="currentTab === 'farm'
            ? FarmPanel
            : (currentTab === 'bag'
              ? BagPanel
              : (currentTab === 'task' ? TaskPanel : ProfileModulesPanel))"
        />
      </Transition>
    </div>
  </div>
</template>
