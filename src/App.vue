<template>
  <div>
    <div class="header">
      <h1>🔗 链接工具箱</h1>
      <p>转换链接 · 秒杀肥料 · 一键复制</p>
    </div>

    <!-- -------- 输入区 -------- -->
    <section class="card">
      <h2 class="card-title"><span class="icon">🧭</span> 粘贴短链</h2>
      <div class="input-with-action">
        <input
          v-model="inputUrl"
          type="text"
          placeholder="粘贴淘宝分享文案、短链或包含 https:// 链接的任意文本"
          @keyup.enter="expand"
          spellcheck="false"
        />
        <button class="btn-primary" :disabled="loading || !canExpand" @click="expand">
          <span v-if="loading" class="spinner"></span>
          <span v-else>✨ 转换链接</span>
        </button>
      </div>
      <p v-if="error" class="muted" style="color: var(--danger); margin-top: 10px;">
        ❌ {{ error }}
      </p>
    </section>

    <div class="grid-2">
      <!-- 左侧：转换结果 -->
      <div>
        <!-- 推荐真实链接（命中时优先显示在最上方，最大最醒目的卡片） -->
        <section v-if="result && result.recommendedIsLanding" class="card" style="border-color: var(--success); box-shadow: 0 6px 22px color-mix(in srgb, var(--success) 14%, transparent);">
          <h2 class="card-title"><span class="icon">🎯</span> 推荐真实链接（这就是你要的）</h2>
          <p class="muted" style="margin-top: -8px; margin-bottom: 12px; font-size: 12px;">
            根据「电商详情页域名/路径 + 核心参数(id/itemId/activityId)」智能识别，跳过后续无意义的埋点追踪跳转
          </p>
          <div class="result-box recommended">
            <div class="val code">{{ result.recommendedUrl }}</div>
            <div class="foot">
              <button class="btn-copy" :class="{ copied: copied.recommended }" @click="copy(result.recommendedUrl, 'recommended')">
                {{ copied.recommended ? '✓ 已复制（直接用这个）' : '📋 复制这个链接' }}
              </button>
            </div>
          </div>
        </section>

        <!-- 完整链接 -->
        <section v-if="result" class="card">
          <h2 class="card-title">
            <span class="icon">{{ result.recommendedIsLanding ? '🪂' : '🎯' }}</span>
            {{ result.recommendedIsLanding ? '完整跳转结果（走完所有跳转的最后一步）' : '完整链接' }}
          </h2>
          <p v-if="result.recommendedIsLanding" class="muted" style="margin-top: -8px; margin-bottom: 12px; font-size: 12px;">
            这是严格跟随完所有跳转后的最后一步，通常是埋点/追踪页，<strong>不推荐</strong>复制，上面的"推荐真实链接"才是带商品参数的完整长链。
          </p>
          <p v-if="extractedItemId" class="muted" style="margin-top: -4px; margin-bottom: 12px; font-size: 13px;">
            ✅ 已提取商品ID：<code class="code" style="color: var(--primary);">{{ extractedItemId }}</code>
          </p>
          <div class="result-box" :class="{ subtle: result.recommendedIsLanding }">
            <div class="val code">{{ result.finalUrl }}</div>
            <div class="foot">
              <button class="btn-copy" :class="{ copied: copied.final }" @click="copy(result.finalUrl, 'final')">
                {{ copied.final ? '✓ 已复制' : '📋 复制链接' }}
              </button>
            </div>
          </div>
        </section>
      </div>

      <!-- 右侧：选择功能 + 转换结果 -->
      <div>
        <!-- 选择功能 -->
        <section class="card">
          <h2 class="card-title" style="margin-bottom: 16px;"><span class="icon">⚙️</span> 选择功能</h2>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            <div
              v-for="(fn, idx) in functions"
              :key="idx"
              class="tpl-item selected"
            >
              <div class="tpl-head">
                <div class="row gap-sm">
                  <span class="tpl-name">{{ fn.icon }} {{ fn.name }}</span>
                  <span class="tag" style="margin-left: 4px;">默认</span>
                </div>
              </div>
              <div class="tpl-body">
                将完整链接中的商品ID（itemIds/id/itemId）自动填入下方 {{ fn.links.length }} 条秒杀肥料链接中的 <code class="code">itemIds=商品</code>
              </div>
            </div>
          </div>
        </section>

        <!-- 转换结果 -->
        <section class="card">
          <h2 class="card-title"><span class="icon">🚀</span> 转换结果</h2>

          <div v-if="!result" class="empty-state">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            请先在上方粘贴短链并点击「转换链接」获取商品ID
          </div>
          <div v-else-if="!extractedItemId" class="empty-state" style="color: var(--danger);">
            ⚠️ 未从完整链接中提取到商品ID。<br/>
            请确认短链是淘宝/天猫商品详情页链接，链接参数中需包含 <code class="code">itemIds</code>、<code class="code">id</code> 或 <code class="code">itemId</code>。
          </div>
          <div v-else>
            <div style="margin-bottom: 14px;" class="muted">
              功能 <span class="tag">{{ selectedFunction.name }}</span> · 商品ID
              <code class="code" style="color: var(--primary);">{{ extractedItemId }}</code>
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px;">
              <div v-for="(r, i) in multipleRendered" :key="i" class="result-box">
                <div class="lbl">
                  <span class="tag" style="background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--primary);">{{ r.label }}</span>
                </div>
                <div class="val code">{{ r.url }}</div>
                <div class="foot">
                  <button class="btn-copy" :class="{ copied: copied['result_' + i] }" @click="copy(r.url, 'result_' + i)">
                    {{ copied['result_' + i] ? '✓ 已复制' : '📋 复制' }}
                  </button>
                </div>
              </div>
              <div v-if="multipleRendered.length > 1">
                <button class="btn-primary" style="width: 100%;" :class="{ copied: copied.allResults }" @click="copyAllResults">
                  {{ copied.allResults ? '✓ 已复制全部到剪贴板（每行一条）' : '📋 一键复制全部转换结果' }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- Toast -->
    <div class="toast-stack">
      <transition-group name="list">
        <div v-for="t in toasts" :key="t.id" class="toast" :class="{ error: t.type === 'error' }">
          {{ t.msg }}
        </div>
      </transition-group>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'

// ---------- 固定功能配置：秒杀肥料 ----------
const FUNCTIONS = [
  {
    name: '秒杀肥料',
    icon: '🌱',
    links: [
      {
        label: '6W',
        tpl: 'https://pages-fast.m.taobao.com/wow/z/app/ltao-fe/tjb-ssr/home?spma=mspd&spmb=qdmsxiadan&sceneId=7506&deliveryId=68206&itemIds=商品&spm=a2141.7631565.tbshopmod-photo_retouch.25',
      },
      {
        label: '5W',
        tpl: 'https://pages-fast.m.taobao.com/wow/z/app/ltao-fe/tjb-ssr/home?spma=mspd&spmb=qdmsxiadan&sceneId=7310&deliveryId=69029&itemIds=商品&spm=a2141.7631565.tbshopmod-photo_retouch.26',
      },
      {
        label: '5W/4W',
        tpl: 'https://pages-fast.m.taobao.com/wow/z/app/ltao-fe/tjb-ssr/home?spma=mspd&spmb=qdmsxiadan&sceneId=7506&deliveryId=70424&itemIds=商品&spm=a2141.7631565.tbshopmod-photo_retouch.27',
      },
      {
        label: '4W',
        tpl: 'https://pages-fast.m.taobao.com/wow/z/app/ltao-fe/tjb-ssr/home?spma=mspd&spmb=qdmsxiadan&sceneId=7506&deliveryId=74994&itemIds=商品&spm=a2141.7631565.tbshopmod-photo_retouch.28',
      },
      {
        label: '4W',
        tpl: 'https://pages-fast.m.taobao.com/wow/z/app/ltao-fe/tjb-ssr/home?spma=mspd&spmb=qdmsxiadan&sceneId=7506&deliveryId=68422&itemIds=商品&spm=a2141.7631565.tbshopmod-photo_retouch.29',
      },
    ],
  },
]

// ---------- state ----------
const inputUrl = ref('')
const loading = ref(false)
const error = ref('')
const result = ref(null)
// 只一个功能，默认选中第 0 个，不可取消
const selectedTplIdx = ref(0)

const copied = reactive({})
const toasts = ref([])
let toastId = 0

/**
 * 从任意文本中提取出「第一个 http/https 链接」，并做规范化：
 *   1. 用正则取最长合法的 http(s) URL（直到遇到空白、中文、换行、反引号、引号等边界）
 *   2. 去首尾空白 & 包裹性的反引号/引号
 *   3. HTML 实体解码（&amp; / &quot; / &#39; / &#NNN; / &#xHH;）
 *   4. 校验 scheme 必须是 http/https
 * 返回提取到的纯净 URL 字符串；找不到则返回 ''
 */
function extractFirstUrl(text) {
  if (!text) return ''
  const raw = String(text)
  // 先尝试匹配「反引号/双引号/单引号包裹」的链接（淘宝分享常见 `...`）
  const wrappedRe = /[`'"](https?:\/\/[^\s`'"<>]+)[`'"]/i
  let m = raw.match(wrappedRe)
  let candidate = m ? m[1] : null
  if (!candidate) {
    // 兜底：直接取第一个 http/https 开始的连续字符（遇到空白/换行/中文/常见截断符就停）
    const looseRe = /https?:\/\/[^\s`"'<>，。、；：【】（）「」《》！？,;()[\]]+/i
    m = raw.match(looseRe)
    candidate = m ? m[0] : null
  }
  if (!candidate) return ''
  // 规范化流水线（和 expand.js 中 normalizeHtmlUrl 对齐）
  let s = candidate.trim()
  s = s.replace(/^[`"'<>]+|[`"'<>]+$/g, '')
  // HTML 实体解码
  s = s.replace(/&quot;/g, '"')
  s = s.replace(/&#39;/g, "'")
  s = s.replace(/&amp;/g, '&')
  s = s.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  s = s.trim()
  if (!/^https?:\/\//i.test(s)) return ''
  return s
}

// ---------- computed ----------
const canExpand = computed(() => !!extractFirstUrl(inputUrl.value))

const functions = FUNCTIONS
const selectedFunction = FUNCTIONS[selectedTplIdx.value]

/**
 * 从完整链接/推荐链接的参数中提取商品ID：
 *   优先级：itemIds → id → itemId  （仅此三个，其他一律不提取）
 * 同时兼容 result.params（推荐优先用的参数解析）和 paramsFromFinalOnly 兜底
 */
const extractedItemId = computed(() => {
  if (!result.value) return ''
  const params = { ...(result.value.paramsFromFinalOnly || {}), ...(result.value.params || {}) }
  const priorityKeys = ['itemIds', 'id', 'itemId']
  for (const k of priorityKeys) {
    const v = params[k]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
})

/**
 * 将选中功能的每条模板中的「商品」二字替换为提取到的 itemId
 */
const multipleRendered = computed(() => {
  if (!extractedItemId.value) return []
  const itemId = extractedItemId.value
  const out = []
  for (const link of selectedFunction.links) {
    // 替换模板中的「商品」二字，同时对替换值做 URL 编码（不过商品ID通常是纯数字，保险起见）
    const url = link.tpl.replace(/商品/g, encodeURIComponent(itemId))
    out.push({ label: link.label, url })
  }
  return out
})

// ---------- methods ----------
async function expand() {
  const targetUrl = extractFirstUrl(inputUrl.value)
  if (!targetUrl) {
    showToast('没识别到 http/https 链接，请粘贴包含链接的分享文案或纯链接', 'error')
    return
  }
  loading.value = true
  error.value = ''
  result.value = null
  try {
    const api = '/api/expand?url=' + encodeURIComponent(targetUrl)
    const resp = await fetch(api)
    const data = await resp.json()
    if (!resp.ok || !data.ok) throw new Error(data.error || '请求失败')
    result.value = data
    // 提示：如果原输入文本比识别出来的 URL 更长，说明是分享文案，告知用户识别到的链接
    const originalTrim = inputUrl.value.trim()
    if (originalTrim.length > targetUrl.length + 4) {
      showToast('✅ 已识别链接，转换中…', 'success')
    }
    let info = `转换成功`
    const keys = Object.keys(data.params || {})
    info += `，共 ${keys.length} 个参数`
    showToast(info, 'success')
  } catch (e) {
    error.value = e.message || '转换失败'
    showToast(e.message || '转换失败', 'error')
  } finally {
    loading.value = false
  }
}

async function copy(text, key) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    copied[key] = true
    showToast('已复制到剪贴板', 'success')
    setTimeout(() => (copied[key] = false), 1600)
  } catch {
    showToast('复制失败，请手动复制', 'error')
  }
}

async function copyAllResults() {
  const text = multipleRendered.value.map((r) => r.url).join('\n')
  await copy(text, 'allResults')
}

function showToast(msg, type = 'success') {
  const id = ++toastId
  toasts.value.push({ id, msg, type })
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 2200)
}
</script>

<style>
/* 本组件样式复用 src/style.css 中的全局样式 */
</style>
