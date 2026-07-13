<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import ChangelogModal from '@/components/ChangelogModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const appVersion = __APP_VERSION__
const customWebVersion = ref('') // 管理员在「侧边栏版本号」中配置的自定义版本号
const gameVersion = ref('')
const coreVersion = ref('')
const showChangelog = ref(false)

const displayWebVersion = computed(() => {
  return (customWebVersion.value || String(appVersion || '')).trim()
})

function openChangelog() {
  showChangelog.value = true
}

function closeChangelog() {
  showChangelog.value = false
}

const isLogin = ref(true)
const username = ref('')
const password = ref('')
const cardCode = ref('')
const inviteCode = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)
const showPasswordStrength = ref(false)
const lockoutRemaining = ref(0)
const rateLimitRemaining = ref(0)
const rememberMe = ref(false)

const cardClaimEnabled = ref(false)
const cardClaimLoading = ref(false)
const showClaimModal = ref(false)
const claimModalContent = ref({
  success: true,
  title: '',
  message: '',
  cardCode: '',
  days: 0,
})

// 忘记密码弹窗
const showForgotPassword = ref(false)
const forgotUsername = ref('')
const forgotCardCode = ref('')
const forgotNewPassword = ref('')
const forgotConfirmPassword = ref('')
const forgotLoading = ref(false)
const forgotError = ref('')
const forgotSuccess = ref('')
const showForgotPasswordStrength = ref(false)

// 账号续费弹窗
const showRenew = ref(false)
const renewUsername = ref('')
const renewCardCode = ref('')
const renewLoading = ref(false)
const renewError = ref('')
const renewSuccess = ref('')

function calcPasswordStrength(pwd: string) {
  if (!pwd)
    return { score: 0, level: '', valid: false }

  let score = 0

  if (pwd.length >= 6)
    score++
  if (pwd.length >= 10)
    score++

  let typeCount = 0
  if (/[a-z]/.test(pwd))
    typeCount++
  if (/[A-Z]/.test(pwd))
    typeCount++
  if (/\d/.test(pwd))
    typeCount++
  if (/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;'/`~]/.test(pwd))
    typeCount++

  if (typeCount >= 2)
    score += 2

  if (typeCount >= 3)
    score++
  if (typeCount >= 4)
    score++

  const commonPasswords = ['password', '123456', 'qwerty', 'abc123', '111111']
  if (commonPasswords.some(p => pwd.toLowerCase().includes(p))) {
    score = Math.max(0, score - 2)
  }

  const level = score <= 2 ? '弱' : score <= 4 ? '中' : score <= 6 ? '强' : '非常强'
  const color = score <= 2 ? '#ef5350' : score <= 4 ? '#ffa726' : score <= 6 ? '#66bb6a' : '#43a047'
  const valid = pwd.length >= 6 && typeCount >= 2

  return { score, level, color, valid }
}

const passwordStrength = computed(() => calcPasswordStrength(password.value))

const forgotPasswordStrength = computed(() => calcPasswordStrength(forgotNewPassword.value))

const usernameValid = computed(() => {
  const name = username.value
  if (!name)
    return { valid: false, message: '' }
  if (name.length < 3)
    return { valid: false, message: '用户名至少3位' }
  if (name.length > 32)
    return { valid: false, message: '用户名最多32位' }
  if (!/^\w+$/.test(name))
    return { valid: false, message: '只能包含字母、数字、下划线' }
  return { valid: true, message: '' }
})

watch(password, () => {
  if (!isLogin.value && password.value) {
    showPasswordStrength.value = true
  }
})

function validateForm(): boolean {
  if (!username.value) {
    error.value = '请输入用户名'
    return false
  }

  if (!usernameValid.value.valid) {
    error.value = usernameValid.value.message
    return false
  }

  if (!password.value) {
    error.value = '请输入密码'
    return false
  }

  if (!isLogin.value) {
    if (password.value.length < 6) {
      error.value = '密码长度至少6位'
      return false
    }

    if (!passwordStrength.value.valid) {
      error.value = '密码强度不足：需包含大写字母、小写字母、数字、特殊符号中的至少两种'
      return false
    }

    if (!cardCode.value) {
      error.value = '请输入卡密'
      return false
    }
  }

  return true
}

async function handleSubmit() {
  if (!validateForm())
    return

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    if (isLogin.value) {
      const result = await userStore.login(username.value, password.value)
      if (result.ok) {
        if (rememberMe.value) {
          localStorage.setItem('remembered_username', username.value)
          localStorage.setItem('remembered_password', password.value)
        }
        else {
          localStorage.removeItem('remembered_username')
          localStorage.removeItem('remembered_password')
        }
        if (result.data?.mustChangePassword) {
          success.value = '登录成功！请修改默认密码以确保账户安全'
        }
        setTimeout(() => {
          window.location.href = '/'
        }, 500)
      }
      else {
        if (result.errorType === 'rate_limit') {
          error.value = result.error || '请求过于频繁，请稍后重试'
          if (result.remainingMs) {
            rateLimitRemaining.value = Math.ceil(result.remainingMs / 1000)
          }
        }
        else if (result.errorType === 'locked') {
          error.value = result.error || '账户已被锁定'
          if (result.remainingMs) {
            lockoutRemaining.value = Math.ceil(result.remainingMs / 1000 / 60)
          }
        }
        else {
          error.value = result.error || '登录失败'
        }
      }
    }
    else {
      const result = await userStore.register(username.value, password.value, cardCode.value, inviteCode.value)
      if (result.ok) {
        success.value = '注册成功，请登录'
        if (result.inviteError) {
          success.value += `（邀请码提示：${result.inviteError}）`
        }
        isLogin.value = true
        cardCode.value = ''
        inviteCode.value = ''
        password.value = ''
      }
      else {
        error.value = result.error || '注册失败'
      }
    }
  }
  catch (e: any) {
    const data = e.response?.data
    if (data?.errorType === 'rate_limit') {
      error.value = data.error || '请求过于频繁'
      if (data.remainingMs) {
        rateLimitRemaining.value = Math.ceil(data.remainingMs / 1000)
      }
    }
    else if (data?.errorType === 'locked') {
      error.value = data.error || '账户已被锁定'
      if (data.remainingMs) {
        lockoutRemaining.value = Math.ceil(data.remainingMs / 1000 / 60)
      }
    }
    else {
      error.value = data?.error || e.message || '操作异常'
    }
  }
  finally {
    loading.value = false
  }
}

function toggleMode() {
  isLogin.value = !isLogin.value
  error.value = ''
  success.value = ''
  showPasswordStrength.value = false
  lockoutRemaining.value = 0
  rateLimitRemaining.value = 0
}

async function checkCardClaimStatus() {
  try {
    const res = await api.get('/api/card-claim/status')
    if (res.data.ok) {
      cardClaimEnabled.value = res.data.enabled === true
    }
  }
  catch (e) {
    console.error('检查卡密领取状态失败:', e)
  }
}

async function claimFreeCard() {
  if (cardClaimLoading.value)
    return

  cardClaimLoading.value = true
  error.value = ''

  try {
    const res = await api.post('/api/card-claim/claim')

    if (res.data.ok) {
      cardCode.value = res.data.cardCode
      claimModalContent.value = {
        success: true,
        title: '领取成功',
        message: `成功领取 ${res.data.days} 天卡密！`,
        cardCode: res.data.cardCode,
        days: res.data.days,
      }
      showClaimModal.value = true
    }
    else {
      claimModalContent.value = {
        success: false,
        title: '领取失败',
        message: res.data.error || '领取失败，请稍后重试',
        cardCode: '',
        days: 0,
      }
      showClaimModal.value = true
    }
  }
  catch (e: any) {
    const data = e.response?.data
    claimModalContent.value = {
      success: false,
      title: '领取失败',
      message: data?.error || e.message || '领取失败',
      cardCode: '',
      days: 0,
    }
    showClaimModal.value = true
  }
  finally {
    cardClaimLoading.value = false
  }
}

function closeClaimModal() {
  showClaimModal.value = false
}

// 忘记密码
function openForgotPassword() {
  showForgotPassword.value = true
  forgotUsername.value = ''
  forgotCardCode.value = ''
  forgotNewPassword.value = ''
  forgotConfirmPassword.value = ''
  forgotError.value = ''
  forgotSuccess.value = ''
  showForgotPasswordStrength.value = false
}

function closeForgotPassword() {
  showForgotPassword.value = false
}

function validateForgotForm(): boolean {
  if (!forgotUsername.value) {
    forgotError.value = '请输入用户名'
    return false
  }

  if (!forgotCardCode.value) {
    forgotError.value = '请输入卡密'
    return false
  }

  if (!forgotNewPassword.value) {
    forgotError.value = '请输入新密码'
    return false
  }

  if (forgotNewPassword.value.length < 6) {
    forgotError.value = '密码长度至少6位'
    return false
  }

  if (!forgotPasswordStrength.value.valid) {
    forgotError.value = '密码强度不足：需包含大写字母、小写字母、数字、特殊符号中的至少两种'
    return false
  }

  if (forgotNewPassword.value !== forgotConfirmPassword.value) {
    forgotError.value = '两次输入的密码不一致'
    return false
  }

  return true
}

async function handleResetPassword() {
  if (!validateForgotForm())
    return

  forgotLoading.value = true
  forgotError.value = ''
  forgotSuccess.value = ''

  try {
    const res = await api.post('/api/user/reset-password', {
      username: forgotUsername.value,
      cardCode: forgotCardCode.value,
      newPassword: forgotNewPassword.value,
    })

    if (res.data.ok) {
      forgotSuccess.value = '密码重置成功！请使用新密码登录'
      setTimeout(() => {
        closeForgotPassword()
        password.value = forgotNewPassword.value
        username.value = forgotUsername.value
        isLogin.value = true
      }, 1500)
    }
    else {
      forgotError.value = res.data.error || '密码重置失败'
    }
  }
  catch (e: any) {
    const data = e.response?.data
    forgotError.value = data?.error || e.message || '操作异常'
  }
  finally {
    forgotLoading.value = false
  }
}

watch(forgotNewPassword, () => {
  if (forgotNewPassword.value) {
    showForgotPasswordStrength.value = true
  }
})

// 账号续费
function openRenew() {
  showRenew.value = true
  renewUsername.value = username.value || ''
  renewCardCode.value = ''
  renewLoading.value = false
  renewError.value = ''
  renewSuccess.value = ''
}

function closeRenew() {
  showRenew.value = false
}

function validateRenewForm(): boolean {
  if (!renewUsername.value) {
    renewError.value = '请输入用户名'
    return false
  }

  if (!renewCardCode.value) {
    renewError.value = '请输入卡密'
    return false
  }

  return true
}

async function handleRenew() {
  if (!validateRenewForm())
    return

  renewLoading.value = true
  renewError.value = ''
  renewSuccess.value = ''

  try {
    const res = await api.post('/api/user/renew-public', {
      username: renewUsername.value,
      cardCode: renewCardCode.value,
    })

    if (res.data.ok) {
      renewSuccess.value = '续费成功，请使用账号密码登录'
      setTimeout(() => {
        closeRenew()
        username.value = renewUsername.value
        password.value = ''
        isLogin.value = true
      }, 1500)
    }
    else {
      renewError.value = res.data.error || '续费失败'
    }
  }
  catch (e: any) {
    const data = e.response?.data
    renewError.value = data?.error || e.message || '操作异常'
  }
  finally {
    renewLoading.value = false
  }
}

onMounted(() => {
  checkCardClaimStatus()
  fetchGameVersion()
  fetchCoreVersion()
  fetchDisplayConfig()

  // 从 URL 读取邀请码
  const urlParams = new URLSearchParams(window.location.search)
  const urlInviteCode = urlParams.get('invite')
  if (urlInviteCode) {
    inviteCode.value = urlInviteCode
  }

  const savedUsername = localStorage.getItem('remembered_username')
  const savedPassword = localStorage.getItem('remembered_password')
  if (savedUsername) {
    username.value = savedUsername
    rememberMe.value = true
  }
  if (savedPassword) {
    password.value = savedPassword
  }
})

async function fetchGameVersion() {
  try {
    const res = await api.get('/api/game-version')
    if (res.data.ok) {
      gameVersion.value = res.data.clientVersion
    }
  }
  catch (e) {
    console.error('获取游戏版本失败:', e)
  }
}

async function fetchCoreVersion() {
  try {
    const res = await api.get('/api/ping')
    if (res.data?.ok && res.data?.data?.version) {
      coreVersion.value = res.data.data.version
    }
  }
  catch (e) {
    console.error('获取核心版本失败:', e)
  }
}

async function fetchDisplayConfig() {
  try {
    const res = await api.get('/api/display-config', { skipErrorToast: true } as any)
    if (res.data?.ok && res.data?.data) {
      customWebVersion.value = String(res.data.data.webVersion || '').trim()
    }
  }
  catch {
    // 静默失败，使用默认版本号
  }
}
</script>

<template>
  <div class="login-page">
    <!-- 流动光：底层 mesh 渐变 -->
    <div class="login-mesh" />
    <!-- 流动光：横扫的高光带 -->
    <div class="login-streak login-streak-1" />
    <div class="login-streak login-streak-2" />
    <!-- 流动光：漂浮的色斑 -->
    <div class="login-aurora" />
    <div class="login-container">
      <div class="login-card">
        <div class="login-header">
          <div class="login-logo">
            <div class="i-carbon-sprout" />
          </div>
          <h1 class="login-title">
            QQ农场智能助手
          </h1>
          <p class="login-subtitle">
            {{ isLogin ? '欢迎回来，请登录' : '创建新账户' }}
          </p>
        </div>

        <!-- 关闭整张表单的 autofill，避免 iOS 登录成功后弹"储存密码"弹窗 -->
        <form
          class="login-form"
          autocomplete="off"
          data-form-type="other"
          @submit.prevent="handleSubmit"
        >
          <div v-if="error" class="login-alert login-alert-error">
            <span>{{ error }}</span>
            <span v-if="lockoutRemaining > 0" class="login-alert-meta">({{ lockoutRemaining }} 分钟后解锁)</span>
            <span v-if="rateLimitRemaining > 0" class="login-alert-meta">({{ rateLimitRemaining }} 秒后可重试)</span>
          </div>
          <div v-if="success" class="login-alert login-alert-success">
            <span>{{ success }}</span>
          </div>

          <div class="login-field">
            <label for="username" class="login-label">用户名</label>
            <BaseInput
              id="username"
              v-model="username"
              type="text"
              placeholder="3-32位字母数字下划线"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              data-form-type="other"
            />
            <p v-if="username && !usernameValid.valid" class="login-hint">
              {{ usernameValid.message }}
            </p>
          </div>

          <div class="login-field">
            <label for="password" class="login-label">密码</label>
            <BaseInput
              id="password"
              v-model="password"
              type="password"
              placeholder="请输入密码"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              data-form-type="other"
            />
            <div v-if="showPasswordStrength && password" class="login-strength">
              <div class="login-strength-bar">
                <div
                  class="login-strength-fill"
                  :style="{ width: `${Math.min(passwordStrength.score * 12.5, 100)}%`, backgroundColor: passwordStrength.color }"
                />
              </div>
              <span class="login-strength-text" :style="{ color: passwordStrength.color }">
                {{ passwordStrength.level }}
              </span>
            </div>
          </div>

          <div v-if="!isLogin" class="login-field">
            <label for="cardCode" class="login-label">卡密</label>
            <BaseInput
              id="cardCode"
              v-model="cardCode"
              type="text"
              placeholder="请输入卡密"
            />
            <button
              v-if="cardClaimEnabled"
              type="button"
              class="login-claim-btn"
              :disabled="cardClaimLoading"
              @click="claimFreeCard"
            >
              <span v-if="cardClaimLoading" class="i-svg-spinners-90-ring-with-bg" />
              <span v-else>免费领取卡密</span>
            </button>
          </div>

          <div v-if="!isLogin" class="login-field">
            <label for="inviteCode" class="login-label">邀请码 <span class="login-label-opt">（选填）</span></label>
            <BaseInput
              id="inviteCode"
              v-model="inviteCode"
              type="text"
              placeholder="有邀请码？填写可帮对方获得奖励"
            />
          </div>

          <div v-if="isLogin" class="login-row">
            <label class="login-remember">
              <input
                v-model="rememberMe"
                type="checkbox"
                class="login-checkbox"
              >
              <span>记住我</span>
            </label>
            <div class="login-links">
              <button type="button" class="login-link" @click="openRenew">账号续费</button>
              <span class="login-link-sep">·</span>
              <button type="button" class="login-link" @click="openForgotPassword">忘记密码？</button>
            </div>
          </div>

          <BaseButton
            type="submit"
            variant="primary"
            block
            :loading="loading"
            class="login-submit"
          >
            {{ isLogin ? '登 录' : '注 册' }}
          </BaseButton>
        </form>

        <div class="login-switch">
          <button type="button" class="login-switch-btn" @click="toggleMode">
            {{ isLogin ? '没有账号？立即注册' : '已有账号？立即登录' }}
          </button>
        </div>

        <div class="login-footer">
          <div class="login-versions">
            <span>Web v{{ displayWebVersion }}</span>
            <span v-if="coreVersion" class="login-version-sep">·</span>
            <span v-if="coreVersion">Core v{{ coreVersion }}</span>
          </div>
          <div v-if="gameVersion" class="login-game-version">
            游戏版本 {{ gameVersion }}
          </div>
          <button type="button" class="login-changelog" @click="openChangelog">
            查看版本更新
          </button>
        </div>
      </div>
    </div>

    <ChangelogModal :show="showChangelog" @close="closeChangelog" />

    <!-- 卡密领取结果弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showClaimModal"
          class="login-modal-overlay"
          @click.self="closeClaimModal"
        >
          <div class="login-modal">
            <div class="login-modal-header">
              <div class="login-modal-icon">
                {{ claimModalContent.success ? '✓' : '!' }}
              </div>
              <h3 class="login-modal-title">
                {{ claimModalContent.title }}
              </h3>
            </div>
            <div class="login-modal-body">
              <p class="login-modal-message">
                {{ claimModalContent.message }}
              </p>
              <div v-if="claimModalContent.success && claimModalContent.cardCode" class="login-modal-cardcode">
                <div class="login-modal-cardcode-label">
                  卡密已自动填入
                </div>
                <div class="login-modal-cardcode-value">
                  {{ claimModalContent.cardCode }}
                </div>
              </div>
            </div>
            <div class="login-modal-footer">
              <button class="login-modal-btn" @click="closeClaimModal">
                {{ claimModalContent.success ? '开始注册' : '我知道了' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 忘记密码弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showForgotPassword"
          class="login-modal-overlay"
          @click.self="closeForgotPassword"
        >
          <div class="login-modal">
            <div class="login-modal-header">
              <h3 class="login-modal-title">
                忘记密码
              </h3>
            </div>
            <div class="login-modal-body">
              <p class="login-modal-message">
                输入用户名和你使用过的卡密来重置密码
              </p>

              <div v-if="forgotError" class="login-alert login-alert-error">
                {{ forgotError }}
              </div>
              <div v-if="forgotSuccess" class="login-alert login-alert-success">
                {{ forgotSuccess }}
              </div>

              <div class="login-field">
                <label class="login-label">用户名</label>
                <BaseInput v-model="forgotUsername" type="text" placeholder="请输入用户名" />
              </div>

              <div class="login-field">
                <label class="login-label">卡密</label>
                <BaseInput v-model="forgotCardCode" type="text" placeholder="请输入你使用过的卡密" />
              </div>

              <div class="login-field">
                <label class="login-label">新密码</label>
                <BaseInput v-model="forgotNewPassword" type="password" placeholder="请输入新密码" />
                <div v-if="showForgotPasswordStrength && forgotNewPassword" class="login-strength">
                  <div class="login-strength-bar">
                    <div
                      class="login-strength-fill"
                      :style="{ width: `${Math.min(forgotPasswordStrength.score * 12.5, 100)}%`, backgroundColor: forgotPasswordStrength.color }"
                    />
                  </div>
                  <span class="login-strength-text" :style="{ color: forgotPasswordStrength.color }">
                    {{ forgotPasswordStrength.level }}
                  </span>
                </div>
              </div>

              <div class="login-field">
                <label class="login-label">确认密码</label>
                <BaseInput v-model="forgotConfirmPassword" type="password" placeholder="请再次输入新密码" />
              </div>
            </div>
            <div class="login-modal-footer">
              <button
                class="login-modal-btn"
                :disabled="forgotLoading"
                @click="handleResetPassword"
              >
                <span v-if="forgotLoading" class="i-svg-spinners-90-ring-with-bg" />
                <span v-else>确认重置</span>
              </button>
              <button class="login-modal-btn-secondary" @click="closeForgotPassword">
                取消
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 账号续费弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showRenew"
          class="login-modal-overlay"
          @click.self="closeRenew"
        >
          <div class="login-modal">
            <div class="login-modal-header">
              <h3 class="login-modal-title">
                账号续费
              </h3>
            </div>
            <div class="login-modal-body">
              <p class="login-modal-message">
                输入用户名和新卡密为账号续费
              </p>

              <div v-if="renewError" class="login-alert login-alert-error">
                {{ renewError }}
              </div>
              <div v-if="renewSuccess" class="login-alert login-alert-success">
                {{ renewSuccess }}
              </div>

              <div class="login-field">
                <label class="login-label">用户名</label>
                <BaseInput v-model="renewUsername" type="text" placeholder="请输入用户名" />
              </div>

              <div class="login-field">
                <label class="login-label">卡密</label>
                <BaseInput v-model="renewCardCode" type="text" placeholder="请输入新卡密" />
              </div>
            </div>
            <div class="login-modal-footer">
              <button
                class="login-modal-btn"
                :disabled="renewLoading"
                @click="handleRenew"
              >
                <span v-if="renewLoading" class="i-svg-spinners-90-ring-with-bg" />
                <span v-else>确认续费</span>
              </button>
              <button class="login-modal-btn-secondary" @click="closeRenew">
                取消
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ===== 流动光背景登录页 ===== */
.login-page {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  overflow: hidden;
  background:
    radial-gradient(ellipse 90% 55% at 50% 0%, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0) 65%),
    linear-gradient(180deg, #f5f7fb 0%, #e8ebf3 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
  padding-bottom: env(safe-area-inset-bottom);
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'PingFang SC',
    'Hiragino Sans GB',
    'Microsoft YaHei',
    sans-serif;
  color: #1f2937;
  isolation: isolate;
}

/* ====== 简约背景：柔和 mesh 渐变 ====== */
.login-mesh {
  position: absolute;
  inset: -20%;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(at 20% 20%, rgba(99, 102, 241, 0.12) 0px, transparent 50%),
    radial-gradient(at 80% 10%, rgba(56, 189, 248, 0.1) 0px, transparent 50%),
    radial-gradient(at 10% 80%, rgba(236, 72, 153, 0.08) 0px, transparent 50%),
    radial-gradient(at 90% 70%, rgba(168, 85, 247, 0.08) 0px, transparent 50%);
  filter: blur(80px) saturate(110%);
  animation: meshFlow 25s ease-in-out infinite alternate;
  will-change: transform, filter;
  opacity: 0.8;
}

@keyframes meshFlow {
  0% {
    transform: translate3d(0, 0, 0) scale(1) rotate(0deg);
    filter: blur(80px) saturate(110%) hue-rotate(0deg);
  }
  50% {
    transform: translate3d(-2%, 2%, 0) scale(1.02) rotate(3deg);
    filter: blur(90px) saturate(120%) hue-rotate(10deg);
  }
  100% {
    transform: translate3d(2%, -1%, 0) scale(1.03) rotate(-2deg);
    filter: blur(75px) saturate(115%) hue-rotate(-8deg);
  }
}

/* ====== 简约背景：柔和高光带 ====== */
.login-streak {
  position: absolute;
  z-index: 0;
  pointer-events: none;
  top: 0;
  left: -50%;
  width: 60%;
  height: 100%;
  transform: skewX(-20deg);
  background: linear-gradient(
    100deg,
    transparent 0%,
    transparent 40%,
    rgba(255, 255, 255, 0.18) 48%,
    rgba(255, 255, 255, 0.25) 50%,
    rgba(255, 255, 255, 0.18) 52%,
    transparent 60%,
    transparent 100%
  );
  filter: blur(30px);
  opacity: 0.5;
  will-change: transform, left;
}

.login-streak-1 {
  animation: streakSweep 15s ease-in-out infinite;
}

.login-streak-2 {
  animation: streakSweep 20s ease-in-out infinite;
  animation-delay: -7.5s;
  opacity: 0.3;
  background: linear-gradient(
    100deg,
    transparent 0%,
    transparent 45%,
    rgba(186, 230, 253, 0.2) 48%,
    rgba(196, 181, 253, 0.25) 50%,
    rgba(186, 230, 253, 0.2) 52%,
    transparent 55%,
    transparent 100%
  );
}

@keyframes streakSweep {
  0% {
    left: -60%;
  }
  100% {
    left: 140%;
  }
}

/* ====== 简约背景：中央柔光 ====== */
.login-aurora {
  position: absolute;
  top: -180px;
  left: 50%;
  transform: translateX(-50%);
  width: 720px;
  height: 360px;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(56, 189, 248, 0.08) 0%, rgba(56, 189, 248, 0) 70%);
  filter: blur(100px);
  pointer-events: none;
  z-index: 0;
  animation: auroraPulse 12s ease-in-out infinite alternate;
  opacity: 0.7;
}

@keyframes auroraPulse {
  0% {
    transform: translateX(-50%) scale(1);
    opacity: 0.6;
  }
  100% {
    transform: translateX(-50%) scale(1.08);
    opacity: 0.8;
  }
}

/* 细点阵网格作为肌理（更淡） */
.login-page::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, rgba(15, 23, 42, 0.03) 1px, transparent 1.2px);
  background-size: 28px 28px;
  pointer-events: none;
  z-index: 0;
}

.login-container {
  width: 100%;
  max-width: 380px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
}

.login-card {
  position: relative;
  width: 100%;
  background:
    linear-gradient(180deg, #ffffff 0%, #fcfcfd 100%);
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 16px;
  padding: 36px 32px;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 8px 24px -8px rgba(15, 23, 42, 0.08),
    0 24px 48px -16px rgba(15, 23, 42, 0.06);
  /* 卡片顶部一道高光线，模拟光线从上方打下来的反光 */
}

.login-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 12%;
  right: 12%;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.9) 50%, transparent 100%);
  pointer-events: none;
  border-radius: 1px;
}

.login-header {
  text-align: center;
  margin-bottom: 28px;
}

.login-logo {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  background: linear-gradient(135deg, #1f2937 0%, #0f172a 100%);
  color: #ffffff;
  border-radius: 12px;
  margin-bottom: 16px;
  box-shadow:
    0 4px 12px -2px rgba(15, 23, 42, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.login-logo::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, transparent 50%);
  pointer-events: none;
}

.login-logo .i-carbon-sprout {
  font-size: 30px;
  position: relative;
  z-index: 1;
  color: #ffffff;
  filter:
    drop-shadow(0 1px 1px rgba(255, 255, 255, 0.25))
    drop-shadow(0 2px 4px rgba(0, 0, 0, 0.18));
}

.login-title {
  font-size: 20px;
  font-weight: 600;
  color: #111827;
  margin: 0 0 6px;
  letter-spacing: 0.2px;
}

.login-subtitle {
  font-size: 13px;
  color: #6b7280;
  margin: 0;
  font-weight: 400;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.login-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 高级感：让所有 input 与登录页的深灰主题对齐 */
.login-field :deep(.base-input) {
  background: #fbfcfd !important;
  border-color: rgba(15, 23, 42, 0.1) !important;
  color: #1f2937 !important;
  -webkit-text-fill-color: #1f2937;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: all 0.2s ease;
}

.login-field :deep(.base-input:hover) {
  border-color: rgba(15, 23, 42, 0.18) !important;
}

.login-field :deep(.base-input:focus) {
  border-color: #1f2937 !important;
  background: #ffffff !important;
  color: #1f2937 !important;
  -webkit-text-fill-color: #1f2937;
  box-shadow:
    inset 0 1px 2px rgba(15, 23, 42, 0.04),
    0 0 0 4px rgba(15, 23, 42, 0.06) !important;
  transform: none !important;
}

.login-field :deep(.base-input:focus + button) {
  color: #1f2937;
}

/* 修复 iOS 自动填充后文字看不见的问题 */
.login-field :deep(.base-input:-webkit-autofill),
.login-field :deep(.base-input:-webkit-autofill:hover),
.login-field :deep(.base-input:-webkit-autofill:focus),
.login-field :deep(.base-input:-webkit-autofill:active) {
  -webkit-text-fill-color: #1f2937 !important;
  -webkit-box-shadow: 0 0 0 1000px #ffffff inset !important;
  box-shadow: 0 0 0 1000px #ffffff inset !important;
  caret-color: #1f2937;
}

@media (prefers-color-scheme: dark) {
  .login-field :deep(.base-input) {
    background: rgba(15, 23, 42, 0.4) !important;
    border-color: rgba(255, 255, 255, 0.08) !important;
    color: #e2e8f0 !important;
    -webkit-text-fill-color: #e2e8f0;
  }

  .login-field :deep(.base-input:hover) {
    border-color: rgba(255, 255, 255, 0.15) !important;
  }

  .login-field :deep(.base-input:focus) {
    border-color: #e2e8f0 !important;
    background: rgba(15, 23, 42, 0.6) !important;
    color: #f1f5f9 !important;
    -webkit-text-fill-color: #f1f5f9;
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.3),
      0 0 0 4px rgba(255, 255, 255, 0.06) !important;
  }

  .login-field :deep(.base-input:-webkit-autofill),
  .login-field :deep(.base-input:-webkit-autofill:hover),
  .login-field :deep(.base-input:-webkit-autofill:focus),
  .login-field :deep(.base-input:-webkit-autofill:active) {
    -webkit-text-fill-color: #f1f5f9 !important;
    -webkit-box-shadow: 0 0 0 1000px #1f2937 inset !important;
    box-shadow: 0 0 0 1000px #1f2937 inset !important;
    caret-color: #f1f5f9;
  }
}

/* 同时支持通过 .dark class 切换的暗色模式（侧边栏主题切换会加 .dark 到 html） */
:global(html.dark) .login-field :deep(.base-input) {
  background: rgba(15, 23, 42, 0.4) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
  color: #e2e8f0 !important;
  -webkit-text-fill-color: #e2e8f0;
}

:global(html.dark) .login-field :deep(.base-input:hover) {
  border-color: rgba(255, 255, 255, 0.15) !important;
}

:global(html.dark) .login-field :deep(.base-input:focus) {
  border-color: #e2e8f0 !important;
  background: rgba(15, 23, 42, 0.6) !important;
  color: #f1f5f9 !important;
  -webkit-text-fill-color: #f1f5f9;
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.3),
    0 0 0 4px rgba(255, 255, 255, 0.06) !important;
}

:global(html.dark) .login-field :deep(.base-input:-webkit-autofill),
:global(html.dark) .login-field :deep(.base-input:-webkit-autofill:hover),
:global(html.dark) .login-field :deep(.base-input:-webkit-autofill:focus),
:global(html.dark) .login-field :deep(.base-input:-webkit-autofill:active) {
  -webkit-text-fill-color: #f1f5f9 !important;
  -webkit-box-shadow: 0 0 0 1000px #1f2937 inset !important;
  box-shadow: 0 0 0 1000px #1f2937 inset !important;
  caret-color: #f1f5f9;
}

.login-label {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}

.login-label-opt {
  color: #9ca3af;
  font-weight: 400;
  font-size: 12px;
}

.login-hint {
  font-size: 12px;
  color: #ef4444;
  margin: 0;
}

.login-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: -4px;
}

.login-remember {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #4b5563;
  cursor: pointer;
  user-select: none;
}

.login-checkbox {
  width: 14px;
  height: 14px;
  accent-color: #1f2937;
  cursor: pointer;
}

.login-links {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.login-link {
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  color: #4b5563;
  font-size: 13px;
  cursor: pointer;
  padding: 4px 10px;
  transition: all 0.15s ease;
}

.login-link:hover {
  color: #1f2937;
  border-color: #1f2937;
}

.login-link-sep {
  color: #d1d5db;
  font-size: 12px;
}

.login-claim-btn {
  background: none;
  border: 1px dashed #d1d5db;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: #4b5563;
  cursor: pointer;
  align-self: flex-start;
  margin-top: 4px;
  transition: all 0.15s ease;
}

.login-claim-btn:hover:not(:disabled) {
  border-color: #1f2937;
  color: #1f2937;
}

.login-claim-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.login-submit {
  margin-top: 6px;
  height: 44px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 12px;
  /* 双层 background 实现"渐变描边"：
     - border-box 槽位填渐变作为边框色
     - padding-box 槽位填深色作为按钮底色
     配合 transparent 边框，让中间只露出 2px 渐变边 */
  background:
    linear-gradient(135deg, #1f2937 0%, #0f172a 100%) padding-box,
    linear-gradient(135deg, #6366f1 0%, #38bdf8 50%, #ec4899 100%) border-box;
  color: #ffffff !important;
  border: 2px solid transparent;
  transition: all 0.25s ease;
  letter-spacing: 0.5px;
  box-shadow:
    0 2px 4px rgba(15, 23, 42, 0.1),
    0 4px 12px -2px rgba(15, 23, 42, 0.18),
    0 0 0 0 rgba(99, 102, 241, 0),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.login-submit:hover:not(:disabled) {
  background:
    linear-gradient(135deg, #111827 0%, #020617 100%) padding-box,
    linear-gradient(135deg, #818cf8 0%, #7dd3fc 50%, #f472b6 100%) border-box;
  transform: translateY(-1px);
  box-shadow:
    0 4px 8px rgba(15, 23, 42, 0.12),
    0 8px 20px -4px rgba(15, 23, 42, 0.22),
    0 0 0 4px rgba(99, 102, 241, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.login-submit:active:not(:disabled) {
  transform: translateY(0);
}

.login-submit:disabled {
  background:
    #9ca3af padding-box,
    #d1d5db border-box !important;
  color: #ffffff !important;
  cursor: not-allowed;
}

.login-strength {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.login-strength-bar {
  flex: 1;
  height: 3px;
  background: #f3f4f6;
  border-radius: 2px;
  overflow: hidden;
}

.login-strength-fill {
  height: 100%;
  transition: width 0.3s ease, background-color 0.3s ease;
}

.login-strength-text {
  font-size: 12px;
  font-weight: 500;
  min-width: 36px;
  text-align: right;
}

.login-alert {
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 13px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  line-height: 1.5;
}

.login-alert-error {
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fecaca;
}

.login-alert-success {
  background: #f0fdf4;
  color: #15803d;
  border: 1px solid #bbf7d0;
}

.login-alert-meta {
  font-size: 12px;
  opacity: 0.85;
}

.login-switch {
  text-align: center;
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid #f3f4f6;
}

.login-switch-btn {
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  color: #4b5563;
  font-size: 13px;
  cursor: pointer;
  padding: 6px 14px;
  transition: all 0.15s ease;
}

.login-switch-btn:hover {
  color: #1f2937;
  border-color: #1f2937;
}

.login-footer {
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid #f3f4f6;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.login-versions {
  font-size: 12px;
  color: #9ca3af;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}

.login-version-sep {
  color: #d1d5db;
}

.login-game-version {
  font-size: 11px;
  color: #9ca3af;
}

.login-changelog {
  margin-top: 4px;
  background: none;
  border: 1px solid #d1d5db;
  color: #4b5563;
  font-size: 12px;
  cursor: pointer;
  padding: 5px 12px;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.login-changelog:hover {
  color: #1f2937;
  border-color: #1f2937;
}

/* ===== 弹窗样式 ===== */
.login-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
  backdrop-filter: blur(2px);
}

.login-modal {
  background: #ffffff;
  border-radius: 12px;
  max-width: 360px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.15);
  animation: modalFadeIn 0.2s ease;
}

@keyframes modalFadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.login-modal-header {
  padding: 24px 20px 12px;
  text-align: center;
}

.login-modal-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: #1f2937;
  color: #ffffff;
  border-radius: 50%;
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 12px;
}

.login-modal-title {
  font-size: 16px;
  font-weight: 600;
  color: #111827;
  margin: 0;
}

.login-modal-body {
  padding: 0 20px 16px;
  text-align: center;
}

.login-modal-message {
  font-size: 13px;
  color: #4b5563;
  margin: 0 0 12px;
  line-height: 1.5;
}

.login-modal-cardcode {
  background: #f9fafb;
  border: 1px solid #f3f4f6;
  border-radius: 6px;
  padding: 12px;
  margin-top: 8px;
}

.login-modal-cardcode-label {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 6px;
}

.login-modal-cardcode-value {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  color: #1f2937;
  background: #ffffff;
  padding: 8px;
  border-radius: 4px;
  word-break: break-all;
}

.login-modal-footer {
  padding: 0 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.login-modal-btn {
  width: 100%;
  padding: 11px;
  background: #1f2937;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.login-modal-btn:hover:not(:disabled) {
  background: #111827;
}

.login-modal-btn:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.login-modal-btn-secondary {
  width: 100%;
  padding: 10px;
  background: #f3f4f6;
  color: #4b5563;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.login-modal-btn-secondary:hover {
  background: #e5e7eb;
}

/* 弹窗过渡 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

/* 暗色模式 */
@media (prefers-color-scheme: dark) {
  .login-page {
    background:
      radial-gradient(ellipse 90% 55% at 50% 0%, rgba(99, 102, 241, 0.12) 0%, rgba(99, 102, 241, 0) 65%),
      linear-gradient(180deg, #0b1220 0%, #060912 100%);
    color: #e2e8f0;
  }

  /* 暗色点阵肌理（更淡） */
  .login-page::before {
    background-image: radial-gradient(circle, rgba(255, 255, 255, 0.025) 1px, transparent 1.2px);
    background-size: 28px 28px;
  }

  /* 暗色 mesh 渐变：更柔和 */
  .login-mesh {
    background:
      radial-gradient(at 20% 20%, rgba(99, 102, 241, 0.2) 0px, transparent 50%),
      radial-gradient(at 80% 10%, rgba(56, 189, 248, 0.18) 0px, transparent 50%),
      radial-gradient(at 10% 80%, rgba(236, 72, 153, 0.15) 0px, transparent 50%),
      radial-gradient(at 90% 70%, rgba(168, 85, 247, 0.18) 0px, transparent 50%);
    filter: blur(90px) saturate(120%);
    opacity: 0.6;
  }

  .login-aurora {
    background: radial-gradient(ellipse, rgba(56, 189, 248, 0.12) 0%, rgba(56, 189, 248, 0) 70%);
  }

  .login-card {
    background: linear-gradient(180deg, rgba(30, 41, 59, 0.92) 0%, rgba(15, 23, 42, 0.92) 100%);
    border-color: rgba(255, 255, 255, 0.08);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.3),
      0 8px 24px -8px rgba(0, 0, 0, 0.5),
      0 24px 48px -16px rgba(0, 0, 0, 0.4);
  }

  .login-card::before {
    background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.12) 50%, transparent 100%);
  }

  .login-logo {
    background: linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 100%);
    color: #0f172a;
    box-shadow:
      0 4px 12px -2px rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }

  .login-logo .i-carbon-sprout {
    color: #0f172a;
    filter:
      drop-shadow(0 1px 1px rgba(255, 255, 255, 0.4))
      drop-shadow(0 2px 3px rgba(0, 0, 0, 0.1));
  }

  .login-title {
    color: #f1f5f9;
  }

  .login-subtitle {
    color: #94a3b8;
  }

  .login-label {
    color: #cbd5e1;
  }

  .login-remember {
    color: #cbd5e1;
  }

  .login-link {
    color: #94a3b8;
    border-color: #475569;
  }

  .login-link:hover {
    color: #e2e8f0;
    border-color: #e2e8f0;
  }

  .login-claim-btn {
    background: none;
    border-color: #475569;
    color: #cbd5e1;
  }

  .login-claim-btn:hover:not(:disabled) {
    border-color: #e2e8f0;
    color: #e2e8f0;
  }

  .login-submit {
    background:
      linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 100%) padding-box,
      linear-gradient(135deg, #818cf8 0%, #7dd3fc 50%, #f472b6 100%) border-box !important;
    color: #0f172a !important;
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.3),
      0 4px 12px -2px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }

  .login-submit:hover:not(:disabled) {
    background:
      linear-gradient(135deg, #ffffff 0%, #e2e8f0 100%) padding-box,
      linear-gradient(135deg, #a5b4fc 0%, #bae6fd 50%, #fbcfe8 100%) border-box !important;
    transform: translateY(-1px);
    box-shadow:
      0 4px 8px rgba(0, 0, 0, 0.35),
      0 8px 20px -4px rgba(0, 0, 0, 0.45),
      0 0 0 4px rgba(129, 140, 248, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.3);
  }

  .login-submit:disabled {
    background:
      #475569 padding-box,
      #334155 border-box !important;
    color: #94a3b8 !important;
  }

  .login-switch {
    border-top-color: #334155;
  }

  .login-switch-btn {
    color: #94a3b8;
    border-color: #475569;
  }

  .login-switch-btn:hover {
    color: #e2e8f0;
    border-color: #e2e8f0;
  }

  .login-footer {
    border-top-color: #334155;
  }

  .login-versions,
  .login-game-version {
    color: #64748b;
  }

  .login-version-sep {
    color: #475569;
  }

  .login-changelog {
    color: #94a3b8;
    border-color: #475569;
    background: none;
  }

  .login-changelog:hover {
    color: #e2e8f0;
    border-color: #e2e8f0;
    background: none;
  }

  .login-strength-bar {
    background: #334155;
  }

  .login-modal {
    background: #1e293b;
  }

  .login-modal-icon {
    background: #e2e8f0;
    color: #0f172a;
  }

  .login-modal-title {
    color: #f1f5f9;
  }

  .login-modal-message {
    color: #cbd5e1;
  }

  .login-modal-cardcode {
    background: #0f172a;
    border-color: #334155;
  }

  .login-modal-cardcode-label {
    color: #94a3b8;
  }

  .login-modal-cardcode-value {
    background: #1e293b;
    color: #e2e8f0;
  }

  .login-modal-btn {
    background: #e2e8f0;
    color: #0f172a;
  }

  .login-modal-btn:hover:not(:disabled) {
    background: #f1f5f9;
  }

  .login-modal-btn-secondary {
    background: #334155;
    color: #cbd5e1;
  }

  .login-modal-btn-secondary:hover {
    background: #475569;
  }
}

/* 移动端适配 */
@media (max-width: 480px) {
  .login-card {
    padding: 28px 22px;
  }

  .login-title {
    font-size: 18px;
  }
}
</style>
