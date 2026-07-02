<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useChangelogStore } from '@/stores/changelog'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

interface ChangelogGroup {
  type: string
  icon: string
  items: string[]
}

interface ChangelogSection {
  version: string
  date: string
  title: string
  groups: ChangelogGroup[]
}

interface ChangelogData {
  version: string
  updatedAt: string
  updatedBy: string
  sections: ChangelogSection[]
}

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const toastStore = useToastStore()
const userStore = useUserStore()
const changelogStore = useChangelogStore()

const loading = ref(false)
const saving = ref(false)
const resetting = ref(false)
const errorMessage = ref('')
const data = ref<ChangelogData | null>(null)
const isAdmin = computed(() => userStore.isAdmin)
const mode = ref<'view' | 'edit' | 'json'>('view')
const showResetConfirm = ref(false)

// 用于在编辑模式下追踪脏数据
const dirty = ref(false)

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.get('/api/changelog', { skipErrorToast: true } as any)
    if (res.data?.ok) {
      data.value = res.data.data
    }
    else {
      errorMessage.value = res.data?.error || '加载失败'
    }
  }
  catch (e: any) {
    errorMessage.value = e?.response?.data?.error || e?.message || '加载失败'
  }
  finally {
    loading.value = false
  }
}

watch(() => props.show, (v) => {
  if (v) {
    mode.value = 'view'
    dirty.value = false
    errorMessage.value = ''
    loadData()
  }
})

function close() {
  if (dirty.value && mode.value !== 'view') {
    if (!window.confirm('有未保存的修改，确定要关闭吗？'))
      return
  }
  // 关闭即视为已读，记录当前 version 和 updatedAt
  if (data.value) {
    changelogStore.markSeen(data.value.version, data.value.updatedAt)
  }
  emit('close')
}

function switchMode(target: 'view' | 'edit' | 'json') {
  if (mode.value === target)
    return
  if (target === 'view' && dirty.value) {
    if (!window.confirm('放弃当前修改并返回查看模式？'))
      return
  }
  mode.value = target
  if (target === 'view') {
    dirty.value = false
    loadData()
  }
}

function markDirty() {
  dirty.value = true
}

// ----- 编辑辅助 -----

function addSection() {
  if (!data.value)
    return
  const today = new Date().toISOString().slice(0, 10)
  data.value.sections.unshift({
    version: `v${today.replace(/-/g, '')}`,
    date: today,
    title: '新版本',
    groups: [
      { type: '新功能', icon: '✨', items: [''] },
    ],
  })
  markDirty()
}

function removeSection(idx: number) {
  if (!data.value)
    return
  if (!window.confirm('确定要删除这个版本吗？'))
    return
  data.value.sections.splice(idx, 1)
  markDirty()
}

function moveSection(idx: number, dir: -1 | 1) {
  if (!data.value)
    return
  const arr = data.value.sections
  const j = idx + dir
  if (j < 0 || j >= arr.length)
    return
  const item = arr[idx]
  const target = arr[j]
  if (!item || !target)
    return
  arr.splice(idx, 1)
  arr.splice(j, 0, item)
  markDirty()
}

function addGroup(sIdx: number) {
  if (!data.value)
    return
  const sec = data.value.sections[sIdx]
  if (!sec)
    return
  sec.groups.push({ type: '新分类', icon: '📌', items: [''] })
  markDirty()
}

function removeGroup(sIdx: number, gIdx: number) {
  if (!data.value)
    return
  const sec = data.value.sections[sIdx]
  if (!sec)
    return
  sec.groups.splice(gIdx, 1)
  markDirty()
}

function addItem(sIdx: number, gIdx: number) {
  if (!data.value)
    return
  const sec = data.value.sections[sIdx]
  if (!sec)
    return
  const grp = sec.groups[gIdx]
  if (!grp)
    return
  grp.items.push('')
  markDirty()
}

function removeItem(sIdx: number, gIdx: number, iIdx: number) {
  if (!data.value)
    return
  const sec = data.value.sections[sIdx]
  if (!sec)
    return
  const grp = sec.groups[gIdx]
  if (!grp)
    return
  grp.items.splice(iIdx, 1)
  markDirty()
}

// ----- 渲染辅助 -----

function renderInline(text: string): string {
  if (!text)
    return ''
  // 支持 **加粗** 简单转换
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

// ----- 保存 -----

async function save() {
  if (!data.value)
    return
  if (!isAdmin.value) {
    toastStore.error('需要管理员权限')
    return
  }
  // 简单校验
  for (const s of data.value.sections) {
    if (!s.version || !s.title) {
      toastStore.error('每个版本必须填写 version 和 title')
      return
    }
    for (const g of s.groups) {
      // 过滤空字符串
      g.items = (g.items || []).map(x => (x || '').trim()).filter(x => x.length > 0)
      if (g.items.length === 0) {
        toastStore.error(`版本 ${s.version} 的分组「${g.type}」至少需要 1 条内容`)
        return
      }
    }
  }

  saving.value = true
  errorMessage.value = ''
  try {
    const res = await api.put(
      '/api/changelog',
      { version: data.value.version, sections: data.value.sections },
      { skipErrorToast: true } as any,
    )
    if (res.data?.ok) {
      data.value = res.data.data
      dirty.value = false
      mode.value = 'view'
      toastStore.success('版本更新已保存')
    }
    else {
      errorMessage.value = res.data?.error || '保存失败'
      toastStore.error(errorMessage.value)
    }
  }
  catch (e: any) {
    const msg = e?.response?.data?.error || e?.message || '保存失败'
    errorMessage.value = msg
    toastStore.error(msg)
  }
  finally {
    saving.value = false
  }
}

// JSON 编辑器的内容
const jsonText = ref('')

watch(mode, (m) => {
  if (m === 'json' && data.value) {
    jsonText.value = JSON.stringify(
      { version: data.value.version, sections: data.value.sections },
      null,
      2,
    )
  }
})

function applyJson() {
  if (!data.value)
    return
  try {
    const parsed = JSON.parse(jsonText.value || '{}')
    if (!Array.isArray(parsed.sections)) {
      toastStore.error('JSON 必须包含 sections 数组')
      return
    }
    // 基本兜底
    for (const s of parsed.sections) {
      if (!s.groups || !Array.isArray(s.groups))
        s.groups = []
      for (const g of s.groups) {
        if (!g.items || !Array.isArray(g.items))
          g.items = []
      }
    }
    data.value.version = parsed.version || data.value.version
    data.value.sections = parsed.sections
    mode.value = 'edit'
    markDirty()
    toastStore.success('JSON 已应用，切换到编辑模式（记得保存）')
  }
  catch (e: any) {
    toastStore.error(`JSON 解析失败: ${e.message}`)
  }
}

// ----- 重置 -----

async function resetToDefault() {
  showResetConfirm.value = false
  if (!isAdmin.value) {
    toastStore.error('需要管理员权限')
    return
  }
  resetting.value = true
  errorMessage.value = ''
  try {
    const res = await api.post('/api/changelog/reset', {}, { skipErrorToast: true } as any)
    if (res.data?.ok) {
      data.value = res.data.data
      dirty.value = false
      mode.value = 'view'
      toastStore.success('已重置为初始内容')
    }
    else {
      errorMessage.value = res.data?.error || '重置失败'
      toastStore.error(errorMessage.value)
    }
  }
  catch (e: any) {
    const msg = e?.response?.data?.error || e?.message || '重置失败'
    errorMessage.value = msg
    toastStore.error(msg)
  }
  finally {
    resetting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="close" />
      <div
        class="absolute left-1/2 top-1/2 z-10 flex w-[min(900px,calc(100%-1rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl"
        :style="{
          background: 'var(--theme-bg)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.24), 0 0 0 1px rgba(0,0,0,0.08)',
          maxHeight: 'min(92dvh, 800px)',
          marginTop: 'max(env(safe-area-inset-top), 0.5rem)',
          marginBottom: 'max(env(safe-area-inset-bottom), 0.5rem)',
        }"
        @click.stop
      >
        <!-- Header -->
        <div
          class="flex flex-col gap-2 rounded-t-2xl p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:p-4"
          style="border-bottom: 1px solid color-mix(in srgb, var(--theme-text) 10%, transparent)"
        >
          <h3 class="flex flex-wrap items-center gap-1.5 text-base font-bold sm:gap-2 sm:text-lg" style="color: var(--theme-primary, var(--theme-text))">
            <span class="text-lg sm:text-xl">📋</span>
            <span>版本更新</span>
            <span
              v-if="data?.updatedAt"
              class="rounded-full px-2 py-0.5 text-xs font-medium"
              style="background: color-mix(in srgb, var(--theme-text) 8%, transparent); color: color-mix(in srgb, var(--theme-text) 60%, transparent)"
            >
              更新于 {{ new Date(data.updatedAt).toLocaleString('zh-CN') }}
              <span v-if="data.updatedBy && data.updatedBy !== 'system'"> · by {{ data.updatedBy }}</span>
            </span>
            <span
              v-if="dirty"
              class="rounded-full px-2 py-0.5 text-xs font-bold"
              style="background: rgba(245, 158, 11, 0.15); color: #d97706"
            >
              ● 未保存
            </span>
          </h3>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            <!-- 模式切换 -->
            <div v-if="isAdmin" class="flex overflow-hidden rounded-lg" style="border: 1px solid color-mix(in srgb, var(--theme-text) 15%, transparent)">
              <button
                class="px-2.5 py-1 text-xs font-bold transition-colors"
                :style="mode === 'view' ? { background: 'var(--theme-primary)', color: '#fff' } : { color: 'color-mix(in srgb, var(--theme-text) 70%, transparent)' }"
                @click="switchMode('view')"
              >
                查看
              </button>
              <button
                class="px-2.5 py-1 text-xs font-bold transition-colors"
                :style="mode === 'edit' ? { background: 'var(--theme-primary)', color: '#fff' } : { color: 'color-mix(in srgb, var(--theme-text) 70%, transparent)' }"
                @click="switchMode('edit')"
              >
                编辑
              </button>
              <button
                class="px-2.5 py-1 text-xs font-bold transition-colors"
                :style="mode === 'json' ? { background: 'var(--theme-primary)', color: '#fff' } : { color: 'color-mix(in srgb, var(--theme-text) 70%, transparent)' }"
                @click="switchMode('json')"
              >
                JSON
              </button>
            </div>
            <BaseButton variant="ghost" class="!p-1" @click="close">
              <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
            </BaseButton>
          </div>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-4">
          <div v-if="loading" class="py-12 text-center" style="color: color-mix(in srgb, var(--theme-text) 50%, transparent)">
            <div class="i-svg-spinners-90-ring-with-bg mx-auto text-2xl" />
            <div class="mt-2 text-sm">
              加载中...
            </div>
          </div>

          <div
            v-else-if="errorMessage && !data"
            class="rounded-xl p-3 text-sm"
            style="background: rgba(239, 68, 68, 0.1); color: #ef4444"
          >
            {{ errorMessage }}
          </div>

          <!-- 查看模式 -->
          <template v-else-if="data && mode === 'view'">
            <div
              v-for="(section, sIdx) in data.sections"
              :key="sIdx"
              class="mb-5 overflow-hidden rounded-2xl"
              style="border: 1px solid color-mix(in srgb, var(--theme-text) 10%, transparent); background: color-mix(in srgb, var(--theme-bg) 50%, transparent)"
            >
              <!-- 版本头 -->
              <div
                class="flex items-center justify-between gap-2 px-4 py-3"
                style="background: color-mix(in srgb, var(--theme-primary) 8%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--theme-text) 8%, transparent)"
              >
                <div class="flex items-center gap-2">
                  <span class="rounded-full px-2 py-0.5 text-xs font-extrabold" style="background: var(--theme-primary); color: #fff">
                    {{ section.version }}
                  </span>
                  <span class="text-sm font-medium" style="color: color-mix(in srgb, var(--theme-text) 60%, transparent)">
                    {{ section.date }}
                  </span>
                  <span class="text-base font-bold" style="color: var(--theme-text)">
                    {{ section.title }}
                  </span>
                </div>
              </div>
              <!-- 分组 -->
              <div class="p-4 space-y-3">
                <div v-for="(group, gIdx) in section.groups" :key="gIdx">
                  <div class="mb-1.5 flex items-center gap-1.5 text-sm font-bold" style="color: var(--theme-text)">
                    <span>{{ group.icon || '📌' }}</span>
                    <span>{{ group.type }}</span>
                  </div>
                  <ul class="space-y-1 pl-2">
                    <li
                      v-for="(item, iIdx) in group.items"
                      :key="iIdx"
                      class="flex items-start gap-2 text-sm leading-relaxed"
                      style="color: color-mix(in srgb, var(--theme-text) 85%, transparent)"
                    >
                      <span class="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full" style="background: color-mix(in srgb, var(--theme-primary) 60%, transparent)" />
                      <span v-html="renderInline(item)" />
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <div
              v-if="!data.sections.length"
              class="py-12 text-center"
              style="color: color-mix(in srgb, var(--theme-text) 40%, transparent)"
            >
              暂无更新日志
            </div>
          </template>

          <!-- 编辑模式 -->
          <template v-else-if="data && mode === 'edit'">
            <div class="mb-3 flex items-center justify-between">
              <div class="text-sm font-medium" style="color: color-mix(in srgb, var(--theme-text) 65%, transparent)">
                🛠 编辑模式 - 增删改后记得点保存
              </div>
              <div class="flex gap-2">
                <BaseButton variant="outline" size="sm" @click="addSection">
                  ➕ 新版本
                </BaseButton>
              </div>
            </div>
            <div
              v-for="(section, sIdx) in data.sections"
              :key="sIdx"
              class="mb-4 rounded-2xl p-3"
              style="border: 1px solid color-mix(in srgb, var(--theme-text) 12%, transparent)"
            >
              <!-- 版本信息 -->
              <div class="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-12">
                <BaseInput
                  v-model="section.version"
                  label="版本号"
                  placeholder="v20260701"
                  class="farm-input min-w-0 sm:col-span-3"
                  @update:model-value="markDirty"
                />
                <BaseInput
                  v-model="section.date"
                  label="日期"
                  placeholder="2026-07-01"
                  class="farm-input min-w-0 sm:col-span-3"
                  @update:model-value="markDirty"
                />
                <BaseInput
                  v-model="section.title"
                  label="标题"
                  placeholder="护主犬好友 + 同气连枝礼包"
                  class="farm-input min-w-0 sm:col-span-4"
                  @update:model-value="markDirty"
                />
                <div class="flex items-center gap-1 sm:col-span-2 sm:items-end">
                  <BaseButton variant="ghost" size="sm" title="上移" @click="moveSection(sIdx, -1)">
                    ↑
                  </BaseButton>
                  <BaseButton variant="ghost" size="sm" title="下移" @click="moveSection(sIdx, 1)">
                    ↓
                  </BaseButton>
                  <BaseButton variant="danger" size="sm" @click="removeSection(sIdx)">
                    🗑️
                  </BaseButton>
                </div>
              </div>
              <!-- 分组 -->
              <div class="space-y-3 pl-2" style="border-left: 2px solid color-mix(in srgb, var(--theme-primary) 25%, transparent)">
                <div
                  v-for="(group, gIdx) in section.groups"
                  :key="gIdx"
                  class="rounded-xl p-2"
                  style="background: color-mix(in srgb, var(--theme-bg) 60%, transparent); border: 1px dashed color-mix(in srgb, var(--theme-text) 12%, transparent)"
                >
                  <div class="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-12">
                    <BaseInput
                      v-model="group.icon"
                      label="图标"
                      placeholder="✨"
                      class="farm-input min-w-0 sm:col-span-2"
                      @update:model-value="markDirty"
                    />
                    <BaseInput
                      v-model="group.type"
                      label="分类"
                      placeholder="新功能"
                      class="farm-input min-w-0 sm:col-span-6"
                      @update:model-value="markDirty"
                    />
                    <div class="flex items-center sm:items-end sm:justify-end sm:col-span-4">
                      <BaseButton variant="danger" size="sm" @click="removeGroup(sIdx, gIdx)">
                        🗑️ 删除分类
                      </BaseButton>
                    </div>
                  </div>
                  <div class="space-y-1.5">
                    <div
                      v-for="(_item, iIdx) in group.items"
                      :key="iIdx"
                      class="flex items-start gap-1.5"
                    >
                      <BaseTextarea
                        v-model="group.items[iIdx]"
                        placeholder="更新内容（支持 **加粗**）"
                        :rows="1"
                        class="min-w-0 flex-1"
                        @update:model-value="markDirty"
                      />
                      <BaseButton variant="ghost" size="sm" class="mt-1 shrink-0" @click="removeItem(sIdx, gIdx, iIdx)">
                        ✕
                      </BaseButton>
                    </div>
                    <BaseButton variant="outline" size="sm" @click="addItem(sIdx, gIdx)">
                      ➕ 添加条目
                    </BaseButton>
                  </div>
                </div>
                <BaseButton variant="outline" size="sm" @click="addGroup(sIdx)">
                  ➕ 新增分类
                </BaseButton>
              </div>
            </div>
            <div
              v-if="!data.sections.length"
              class="py-8 text-center"
              style="color: color-mix(in srgb, var(--theme-text) 50%, transparent)"
            >
              还没有任何版本，点击「新版本」开始添加
            </div>
          </template>

          <!-- JSON 模式 -->
          <template v-else-if="data && mode === 'json'">
            <div class="mb-2 text-sm font-medium" style="color: color-mix(in srgb, var(--theme-text) 65%, transparent)">
              🧬 JSON 高级编辑 - 直接编辑原始结构，编辑后点「应用」切到编辑模式预览，再保存
            </div>
            <BaseTextarea
              v-model="jsonText"
              :rows="20"
              class="font-mono text-xs"
              placeholder='{"version":"v...","sections":[...]}'
            />
            <div class="mt-2 flex justify-end gap-2">
              <BaseButton variant="outline" size="sm" @click="switchMode('view')">
                取消
              </BaseButton>
              <BaseButton variant="primary" size="sm" @click="applyJson">
                应用到编辑模式
              </BaseButton>
            </div>
          </template>
        </div>

        <!-- Footer -->
        <div
          v-if="!loading"
          class="flex items-center justify-between gap-2 rounded-b-2xl p-4"
          style="border-top: 1px solid color-mix(in srgb, var(--theme-text) 10%, transparent)"
        >
          <div>
            <BaseButton
              v-if="isAdmin"
              variant="ghost"
              size="sm"
              :loading="resetting"
              @click="showResetConfirm = true"
            >
              ♻️ 重置为初始内容
            </BaseButton>
            <span v-else class="text-xs" style="color: color-mix(in srgb, var(--theme-text) 40%, transparent)">
              只读模式
            </span>
          </div>
          <div class="flex gap-2">
            <BaseButton variant="outline" @click="close">
              关闭
            </BaseButton>
            <BaseButton
              v-if="isAdmin && (mode === 'edit' || mode === 'json')"
              variant="primary"
              :loading="saving"
              :disabled="!dirty"
              @click="save"
            >
              💾 保存
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="showResetConfirm"
      title="重置版本更新"
      message="将丢弃当前所有修改并恢复为初始内容（v20260701），确定要继续吗？"
      confirm-text="重置"
      type="danger"
      :loading="resetting"
      @confirm="resetToDefault"
      @cancel="showResetConfirm = false"
    />
  </Teleport>
</template>
