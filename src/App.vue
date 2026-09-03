<template>
  <div>
    <div class="header">
      <h1>🔗 链接工具箱</h1>
      <p>转换链接 · 秒杀肥料 · 查禁拍 · 一键复制</p>
    </div>

    <!-- ===== 顶部 Tab 切换栏（强化视觉效果） ===== -->
    <div class="tab-bar" role="tablist">
      <button
        class="tab-btn"
        :class="{ active: currentTab === 'link' }"
        role="tab"
        :aria-selected="currentTab === 'link'"
        @click="currentTab = 'link'"
      >
        <span class="tab-icon">🔗</span>
        <span class="tab-text">转链接</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: currentTab === 'ban' }"
        role="tab"
        :aria-selected="currentTab === 'ban'"
        @click="currentTab = 'ban'"
      >
        <span class="tab-icon">🛑</span>
        <span class="tab-text">查禁拍</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: currentTab === 'addr' }"
        role="tab"
        :aria-selected="currentTab === 'addr'"
        @click="currentTab = 'addr'"
      >
        <span class="tab-icon">📍</span>
        <span class="tab-text">虚拟址</span>
      </button>
    </div>

    <!-- ===== Tab 1: 转链接（原功能） ===== -->
    <div v-show="currentTab === 'link'">
      <!-- 输入区 -->
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
              <span v-if="result.totalMs != null" class="tag" style="margin-left: 8px; background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--primary); font-size: 11px;">
                ⏱ {{ result.totalMs }}ms{{ result.cached ? ' · 缓存命中' : '' }}{{ result.fastMode ? ' · ⚡️极速' : '' }}
              </span>
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
    </div>

    <!-- ===== Tab 2: 查禁拍 ===== -->
    <div v-show="currentTab === 'ban'">
      <section class="card">
        <h2 class="card-title"><span class="icon">🔍</span> 输入店铺名/关键词 查禁拍</h2>

        <!-- 加载中 -->
        <p v-if="banLoading" class="muted" style="margin-top: -6px; margin-bottom: 14px; font-size: 13px;">
          ⏳ 正在从云端拉取禁拍数据库…
        </p>

        <!-- 加载失败 -->
        <div v-else-if="banLoadError" class="ban-load-error">
          <span>❌ 数据加载失败：{{ banLoadError }}</span>
          <button class="btn-ghost" @click="loadBanData" style="margin-left: 10px;">🔄 重试</button>
        </div>

        <!-- 已加载 -->
        <template v-else>
          <p class="muted" style="margin-top: -6px; margin-bottom: 14px; font-size: 13px;">
            实时搜索 <strong>{{ banTotalLoaded }}</strong> 条禁拍数据（{{ banSrcStats.anheng }} + {{ banSrcStats.error }} + {{ banSrcStats.long }}）
            <button class="btn-ghost ban-reload-btn" title="刷新数据" @click="loadBanData" style="margin-left: 6px;">🔄</button>
          </p>
        </template>

        <div class="input-with-action ban-search-wrap">
          <input
            v-model="banKeyword"
            type="text"
            placeholder="输入店铺名称或任意字符片段，支持模糊匹配…"
            spellcheck="false"
            class="ban-search-input"
          />
          <button
            v-if="banKeyword"
            class="btn-ghost ban-clear-btn"
            title="清空输入"
            @click="banKeyword = ''"
          >✕ 清空</button>
        </div>

        <!-- 搜索结果统计 -->
        <div v-if="banKeyword.trim()" class="ban-stats">
          <span class="badge" :class="{ 'badge-danger': banMatched.length > 0 }">
            {{ banMatched.length > 0 ? `⚠️ 命中 ${banMatched.length} 条禁拍` : '✅ 未命中禁拍' }}
          </span>
          <span v-if="banMatched.length > 0" class="muted" style="font-size: 12.5px;">
            共搜索 {{ banTotalLoaded }} 条，耗时 {{ banSearchTime }}ms
          </span>
        </div>
      </section>

      <!-- 命中结果列表 -->
      <section v-if="banMatched.length > 0" class="card">
        <h2 class="card-title"><span class="icon" style="color: var(--danger);">🚨</span> 命中的禁拍条目（{{ banMatched.length }}）</h2>
        <ul class="ban-result-list">
          <li
            v-for="(item, idx) in banMatched"
            :key="idx"
            class="ban-result-item"
          >
            <span class="ban-text">{{ item.text }}</span>
            <span
              v-for="(src, sIdx) in item.sources"
              :key="sIdx"
              class="ban-src-tag"
              :data-src="src"
            >【{{ src }}】</span>
            <button
              class="btn-copy ban-copy-btn"
              :class="{ copied: copied['ban_' + idx] }"
              @click="copy(item.text, 'ban_' + idx)"
            >{{ copied['ban_' + idx] ? '✓' : '📋' }}</button>
          </li>
        </ul>
      </section>

      <!-- 空状态：没输入 / 没命中 -->
      <section v-else class="card" style="border-style: dashed;">
        <div v-if="!banKeyword.trim()" class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          输入店铺名或关键词，实时查询是否属于禁拍
        </div>
        <div v-else class="empty-state" style="color: var(--success);">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
          关键词 <strong>「{{ banKeyword.trim() }}」</strong> 在所有禁拍库中<strong>未命中</strong> ✅
        </div>
      </section>
    </div>

    <!-- ===== Tab 3: 虚拟址 ===== -->
    <div v-show="currentTab === 'addr'" class="addr-panel">
      <section class="card">
        <h2 class="card-title"><span class="icon">📍</span> 信息配置</h2>

        <div class="addr-field">
          <label class="addr-label">固定地址</label>
          <input v-model="addrForm.fixedAddress" type="text" placeholder="请输入固定地址（省市区/街道）" />
        </div>

        <div class="addr-field">
          <label class="addr-label">手机尾号</label>
          <input v-model="addrForm.tailNumber" type="text" maxlength="4" placeholder="请输入尾号（后 4 位）" />
        </div>

        <div class="addr-divider"></div>

        <p class="addr-sub-label">额外功能</p>
        <div class="addr-option-row">
          <div class="addr-radio-group" role="radiogroup">
            <button
              class="addr-radio"
              :class="{ active: addrForm.type === 'community' }"
              @click="addrForm.type = 'community'"
            >🏘 小区</button>
            <button
              class="addr-radio"
              :class="{ active: addrForm.type === 'shop' }"
              @click="addrForm.type = 'shop'"
            >🏪 店铺</button>
          </div>
          <label class="addr-checkbox">
            <input type="checkbox" v-model="addrForm.multiNumber" />
            <span>多号（6 组）</span>
          </label>
        </div>
      </section>

      <button class="btn-primary addr-generate-btn" @click="generateRandomAddress">
        🎲 生成地址
      </button>

      <div class="addr-result-list" v-if="addrResults.length > 0">
        <section
          v-for="(info, index) in addrResults"
          :key="index"
          class="card addr-result-card"
        >
          <div class="addr-result-header">
            <span class="addr-result-index">NO.{{ index + 1 }}</span>
            <button
              class="btn-copy"
              :class="{ copied: addrCopied[index] }"
              @click="copyAddrInfo(index)"
            >
              {{ addrCopied[index] ? '✓ 已复制' : '📋 复制' }}
            </button>
          </div>
          <div class="addr-result-row">
            <span class="addr-result-prefix">姓名</span>
            <span class="addr-result-val">{{ info.name }}</span>
          </div>
          <div class="addr-result-row">
            <span class="addr-result-prefix">地址</span>
            <span class="addr-result-val">{{ info.address }}</span>
          </div>
          <div class="addr-result-row">
            <span class="addr-result-prefix">手机</span>
            <span class="addr-result-val">{{ info.phone }}</span>
          </div>
        </section>

        <button
          v-if="addrResults.length > 1"
          class="btn-primary addr-copy-all"
          :class="{ copied: addrAllCopied }"
          @click="copyAllAddrResults"
        >
          {{ addrAllCopied ? '✓ 已复制全部' : '📋 一键复制全部' }}
        </button>
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
import { computed, onMounted, reactive, ref } from 'vue'

// ===== 查禁拍数据：GitHub 加速链接（运行时 fetch） =====
const BAN_URLS = {
  anheng: 'https://gh-proxy.org/https://raw.githubusercontent.com/Pikarziur/Data/refs/heads/main/BanShop/anheng.json',
  error:  'https://gh-proxy.org/https://raw.githubusercontent.com/Pikarziur/Data/refs/heads/main/BanShop/error.json',
  long:   'https://gh-proxy.org/https://raw.githubusercontent.com/Pikarziur/Data/refs/heads/main/BanShop/long.json',
}

const anhengList = ref([])
const errorList  = ref([])
const longList   = ref([])
const banLoading = ref(false)
const banLoadError = ref('')

async function loadBanData() {
  banLoading.value = true
  banLoadError.value = ''
  const entries = Object.entries(BAN_URLS)
  try {
    const results = await Promise.all(
      entries.map(async ([key, url]) => {
        const resp = await fetch(url, { cache: 'no-cache' })
        if (!resp.ok) throw new Error(`${key} HTTP ${resp.status}`)
        const json = await resp.json()
        return [key, Array.isArray(json) ? json : []]
      })
    )
    for (const [key, arr] of results) {
      if (key === 'anheng') anhengList.value = arr
      else if (key === 'error') errorList.value = arr
      else if (key === 'long') longList.value = arr
    }
  } catch (e) {
    banLoadError.value = e.message || '加载失败'
  } finally {
    banLoading.value = false
  }
}

onMounted(loadBanData)

const BAN_SOURCES = computed(() => [
  { key: 'anheng', data: anhengList.value },
  { key: 'error',  data: errorList.value },
  { key: 'long',   data: longList.value },
])

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

// ---------- Tab 状态 ----------
const currentTab = ref('link')

// ---------- 虚拟址：state ----------
const addrForm = reactive({
  fixedAddress: '',
  tailNumber: '',
  type: 'community',   // 'community' | 'shop'
  multiNumber: false,
})
const addrResults = ref([])
const addrCopied = reactive({})
const addrAllCopied = ref(false)

// ---------- 转链接：state ----------
const inputUrl = ref('')
const loading = ref(false)
const error = ref('')
const result = ref(null)
const selectedTplIdx = ref(0)

const copied = reactive({})
const toasts = ref([])
let toastId = 0

// ---------- 查禁拍：state ----------
const banKeyword = ref('')
const banSearchTime = ref(0)

const banSrcStats = computed(() => ({
  anheng: anhengList.value.length,
  error:  errorList.value.length,
  long:   longList.value.length,
}))
const banTotalLoaded = computed(() =>
  anhengList.value.length + errorList.value.length + longList.value.length
)

/**
 * 查禁拍：根据 banKeyword 在 3 个 JSON 中做模糊匹配（不区分大小写）
 * 返回 { text, sources: [anheng|error|long] } 的数组，sources 按命中库顺序
 */
const banMatched = computed(() => {
  const raw = banKeyword.value
  const kw = raw ? raw.trim().toLowerCase() : ''
  if (!kw) {
    banSearchTime.value = 0
    return []
  }
  const t0 = performance.now()
  // 用 Map 按"条目文本"聚合来源，避免同一条目在多个库命中时重复显示
  const map = new Map()
  for (const src of BAN_SOURCES.value) {
    for (const item of src.data) {
      if (!item) continue
      const s = String(item)
      if (s.toLowerCase().includes(kw)) {
        if (!map.has(s)) map.set(s, [])
        const arr = map.get(s)
        if (!arr.includes(src.key)) arr.push(src.key)
      }
    }
  }
  const out = []
  for (const [text, sources] of map) {
    out.push({ text, sources })
  }
  // 按来源数量（多的在前）+ 匹配长度（短的在前，更精准）排序
  out.sort((a, b) => {
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length
    return a.text.length - b.text.length
  })
  banSearchTime.value = Math.round(performance.now() - t0)
  return out
})

// ---------- URL 提取 ----------
function extractFirstUrl(text) {
  if (!text) return ''
  const raw = String(text)
  const wrappedRe = /[`'"](https?:\/\/[^\s`'"<>]+)[`'"]/i
  let m = raw.match(wrappedRe)
  let candidate = m ? m[1] : null
  if (!candidate) {
    const looseRe = /https?:\/\/[^\s`"'<>，。、；：【】（）「」《》！？,;()[\]]+/i
    m = raw.match(looseRe)
    candidate = m ? m[0] : null
  }
  if (!candidate) return ''
  let s = candidate.trim()
  s = s.replace(/^[`"'<>]+|[`"'<>]+$/g, '')
  s = s.replace(/&quot;/g, '"')
  s = s.replace(/&#39;/g, "'")
  s = s.replace(/&amp;/g, '&')
  s = s.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  s = s.trim()
  if (!/^https?:\/\//i.test(s)) return ''
  return s
}

// ---------- 转链接：computed ----------
const canExpand = computed(() => !!extractFirstUrl(inputUrl.value))

const functions = FUNCTIONS
const selectedFunction = FUNCTIONS[selectedTplIdx.value]

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

const multipleRendered = computed(() => {
  if (!extractedItemId.value) return []
  const itemId = extractedItemId.value
  const out = []
  for (const link of selectedFunction.links) {
    const url = link.tpl.replace(/商品/g, encodeURIComponent(itemId))
    out.push({ label: link.label, url })
  }
  return out
})

// ---------- 转链接：methods ----------
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
    const originalTrim = inputUrl.value.trim()
    inputUrl.value = ''
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

// ---------- 虚拟址：生成 & 复制 ----------

const ADDR_DATA = {
  surnames: ['王','李','张','刘','陈','杨','赵','黄','周','吴','徐','孙','胡','朱','高','林','何','郭','马','罗','梁','宋','郑','谢','韩','唐','冯','于','董','萧','程','曹','袁','邓','许','傅','沈','曾','彭','吕','苏','卢','蒋','蔡','贾','丁','魏','薛','叶','阎','余'],
  names: ['伟','芳','秀英','娜','敏','静','丽','强','磊','军','洋','勇','艳','杰','娟','涛','明','超','秀兰','霞','平','刚','华','桂','芳','蓉','秀梅','秀菊','秀珍','秀荣','秀华','秀云','秀玉','秀芬','秀英'],
  community: ['阳光','花园','丽景','祥瑞','和谐','幸福','安康','富贵','宜居','温馨','家园','佳苑','华庭','雅苑','逸园','沁园','御园','尚城','名城','世家','公馆','国际','中心','广场','天地','时代','未来','梦想','星光','月光','春风','夏雨','秋实','冬韵','山水','湖景','海景','公园','森林','绿地'],
  shopAdj: ['新','好','优','佳','美','顺','兴','盛','昌','隆','福','禄','寿','喜','吉','祥','瑞','泰','安','康','宏','发','达','旺','福','贵','富','豪','雅','尚'],
  shopTypes: ['便利店','生鲜超市','服装店','鞋靴店','箱包店','美妆护肤品店','饰品店','文具店','书店','玩具店','母婴用品店','家电专卖店','手机数码店','眼镜店','药店','咖啡店','奶茶店','面包烘焙店','面馆','火锅店','快餐店','水果店','鲜花店','宠物店','理发店','美甲美睫店','干洗店','五金店','茶叶店','零食专营店'],
  phonePrefixes: ['140','143','160','161','164'],
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

function generateRandomAddress() {
  if (!addrForm.fixedAddress.trim()) {
    showToast('请先填写固定地址', 'error')
    return
  }
  if (!addrForm.tailNumber.trim()) {
    showToast('请先填写手机尾号', 'error')
    return
  }

  const count = addrForm.multiNumber ? 6 : 1
  const list = []

  for (let i = 0; i < count; i++) {
    // 随机姓名（三字，确保名两个字不同）
    const surname = pick(ADDR_DATA.surnames)
    let n1, n2
    do {
      n1 = pick(ADDR_DATA.names)[0]
      n2 = pick(ADDR_DATA.names)[0]
    } while (n1 === n2)
    const name = `${surname}${n1}${n2}`

    // 随机地址
    let address
    if (addrForm.type === 'community') {
      const cm = pick(ADDR_DATA.community)
      const building = 1 + Math.floor(Math.random() * 50)
      const floor = 1 + Math.floor(Math.random() * 30)
      const unit = 1 + Math.floor(Math.random() * 20)
      const house = `${floor}${String(unit).padStart(2, '0')}`
      address = `${addrForm.fixedAddress} ${cm}小区${building}号楼${house}室`
    } else {
      let c1, c2
      do {
        c1 = pick(ADDR_DATA.shopAdj)
        c2 = pick(ADDR_DATA.shopAdj)
      } while (c1 === c2)
      const type = pick(ADDR_DATA.shopTypes)
      address = `${addrForm.fixedAddress} ${c1}${c2}${type}`
    }

    // 随机手机号
    const prefix = pick(ADDR_DATA.phonePrefixes)
    const middle = 1000 + Math.floor(Math.random() * 9000)
    const phone = `${prefix}${middle}${addrForm.tailNumber}`

    // 去重检查
    const dup = list.some(x => x.name === name || x.address === address || x.phone === phone)
    if (dup) { i--; continue }

    list.push({ name, address, phone })
  }

  addrResults.value = list
  // 重置复制状态
  for (const k of Object.keys(addrCopied)) delete addrCopied[k]
  addrAllCopied.value = false
  showToast(`✅ 已生成 ${list.length} 组虚拟信息`, 'success')
}

async function copyAddrInfo(index) {
  const info = addrResults.value[index]
  const text = `姓名：${info.name}\n地址：${info.address}\n手机号：${info.phone}`
  await copy(text, `addr_${index}`)
  addrCopied[index] = true
  setTimeout(() => { delete addrCopied[index] }, 1600)
}

async function copyAllAddrResults() {
  const text = addrResults.value.map((info, i) => {
    return `NO.${i + 1}  姓名：${info.name}\n地址：${info.address}\n手机号：${info.phone}`
  }).join('\n\n')
  await copy(text, 'addr_all')
  addrAllCopied.value = true
  setTimeout(() => { addrAllCopied.value = false }, 1600)
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
/* 本组件基础样式复用 src/style.css 中的全局样式；
   Tab、查禁拍专属样式在 style.css 的 .tab-bar / .ban-* 区块中 */
</style>
