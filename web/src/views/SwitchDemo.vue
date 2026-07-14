<script setup lang="ts">
import { ref } from 'vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

const a = ref(true)
const b = ref(false)
const c = ref(true)
const d = ref(false)
const e = ref(true)
const f = ref(false)
</script>

<template>
  <div class="min-h-screen p-8" style="background: var(--theme-bg); color: var(--theme-text)">
    <h1 class="mb-2 text-2xl font-bold">
      BaseSwitch 新版预览
    </h1>
    <p class="mb-8 text-sm opacity-60">
      改动了：跟主题色 / 三档大小 / hover+focus 反馈 / 按压缩放 / ✓ 图标 / disabled 半透明 / 可选描述 / 键盘可达
    </p>

    <section class="mb-8 rounded-2xl p-6" style="background: color-mix(in srgb, var(--theme-text) 4%, transparent)">
      <h2 class="mb-4 text-lg font-semibold">
        1. 默认 md 档 · 横排 · 跟主题
      </h2>
      <div class="space-y-3">
        <BaseSwitch v-model="a" label="自动种植" />
        <BaseSwitch v-model="b" label="自动收获" />
        <BaseSwitch
          v-model="c"
          label="自动施肥"
          description="使用前请确认背包里已有化肥"
        />
        <BaseSwitch
          v-model="d"
          label="自动帮忙"
          description="会消耗少量体力"
        />
      </div>
    </section>

    <section class="mb-8 rounded-2xl p-6" style="background: color-mix(in srgb, var(--theme-text) 4%, transparent)">
      <h2 class="mb-4 text-lg font-semibold">
        2. 三档大小对比
      </h2>
      <div class="flex items-end gap-8">
        <div>
          <div class="mb-2 text-xs opacity-60">
            sm
          </div>
          <BaseSwitch v-model="e" size="sm" label="小" />
        </div>
        <div>
          <div class="mb-2 text-xs opacity-60">
            md (默认)
          </div>
          <BaseSwitch v-model="f" size="md" label="中" />
        </div>
        <div>
          <div class="mb-2 text-xs opacity-60">
            lg
          </div>
          <BaseSwitch v-model="a" size="lg" label="大" />
        </div>
      </div>
    </section>

    <section class="mb-8 rounded-2xl p-6" style="background: color-mix(in srgb, var(--theme-text) 4%, transparent)">
      <h2 class="mb-4 text-lg font-semibold">
        3. 上下排布局（带描述）
      </h2>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BaseSwitch
          v-model="c"
          :inline="false"
          label="静默时段"
          description="在指定时间段内不执行任何自动操作（夜间不打扰）"
        />
        <BaseSwitch
          v-model="b"
          :inline="false"
          label="推送触发巡田"
          description="收到好友访问推送时立即触发一次巡田检查"
        />
      </div>
    </section>

    <section class="mb-8 rounded-2xl p-6" style="background: color-mix(in srgb, var(--theme-text) 4%, transparent)">
      <h2 class="mb-4 text-lg font-semibold">
        4. 禁用态
      </h2>
      <div class="space-y-3">
        <BaseSwitch v-model="a" disabled label="禁用的开关（开）" />
        <BaseSwitch v-model="b" disabled label="禁用的开关（关）" />
        <BaseSwitch
          v-model="c"
          disabled
          :inline="false"
          label="禁用的开关带描述"
          description="当前账号无权限启用此功能"
        />
      </div>
    </section>

    <section class="mb-8 rounded-2xl p-6" style="background: color-mix(in srgb, var(--theme-text) 4%, transparent)">
      <h2 class="mb-4 text-lg font-semibold">
        5. 与旧版对比（视觉差异）
      </h2>
      <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <div class="mb-2 text-xs opacity-60">
            旧版（参考行为）
          </div>
          <div class="space-y-3 rounded-xl p-4" style="background: var(--theme-bg)">
            <label class="inline-flex cursor-pointer items-center gap-3">
              <div class="relative inline-flex items-center">
                <input type="checkbox" checked class="peer sr-only">
                <div class="h-7 w-12 border-2 border-black/10 rounded-full bg-[#4a8c3f] after:absolute after:left-[18px] after:top-[2px] after:h-[22px] after:w-[22px] after:border-2 after:border-white/50 after:rounded-full after:bg-white after:shadow-[0_2px_0_rgba(0,0,0,0.15)] after:transition-all after:duration-200 after:content-['']" />
              </div>
              <span class="text-sm font-semibold">写死绿色 · 双边框</span>
            </label>
            <label class="inline-flex cursor-pointer items-center gap-3">
              <div class="relative inline-flex items-center">
                <input type="checkbox" class="peer sr-only">
                <div class="h-7 w-12 border-2 border-black/10 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-[22px] after:w-[22px] after:border-2 after:border-black/10 after:rounded-full after:bg-white after:shadow-[0_2px_0_rgba(0,0,0,0.15)] after:transition-all after:duration-200 after:content-['']" />
              </div>
              <span class="text-sm font-semibold">关 · 灰</span>
            </label>
          </div>
        </div>
        <div>
          <div class="mb-2 text-xs opacity-60">
            新版
          </div>
          <div class="space-y-3 rounded-xl p-4" style="background: var(--theme-bg)">
            <BaseSwitch v-model="a" label="跟主题色 · 单边阴影" />
            <BaseSwitch v-model="b" label="关 · 灰 + 阴影" />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
