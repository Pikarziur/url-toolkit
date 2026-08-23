<template>
  <div>
    <div class="header">
      <h1>🔗 链接工具箱</h1>
      <p>展开短链 · 抓取参数 · 模板替换 · 一键复制</p>
    </div>

    <!-- -------- 输入区 -------- -->
    <section class="card">
      <h2 class="card-title"><span class="icon">🧭</span> 粘贴短链</h2>
      <div class="input-with-action">
        <input
          v-model="inputUrl"
          type="text"
          placeholder="输入短链，如 https://e.tb.cn/h.xxx 或 https://t.cn/xxx"
          @keyup.enter="expand"
          spellcheck="false"
        />
        <button class="btn-primary" :disabled="loading || !canExpand" @click="expand">
          <span v-if="loading" class="spinner"></span>
          <span v-else>✨ 展开</span>
        </button>
      </div>
      <p v-if="error" class="muted" style="color: var(--danger); margin-top: 10px;">
        ❌ {{ error }}
      </p>
    </section>

    <div class="grid-2">
      <!-- 左侧：展开结果 + 参数 -->
      <div>
        <!-- 跳转链 -->
        <section v-if="result" class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
            <h2 class="card-title" style="margin: 0;"><span class="icon">🛤️</span> 跳转链（共 {{ result.chain.length }} 步）</h2>
            <div style="display: flex; gap: 6px;">
              <span v-if="result.recommendedIsLanding" class="landing-badge">🎯 命中真链接</span>
              <span class="badge badge-success">完成</span>
            </div>
          </div>
          <div class="chain-list">
            <div
              v-for="(step, idx) in result.chain"
              :key="idx"
              class="chain-step"
              :class="{ landing: step.isLanding }"
              :title="step.reasons?.length ? '判定理由：\n' + step.reasons.join('\\n') : ''"
            >
              <span class="idx">{{ idx + 1 }}</span>
              <span class="via tag" :class="step.via === 'HTML-parse' ? 'badge-warn' : ''">
                {{ step.via }}
              </span>
              <span v-if="step.isLanding" class="landing-badge" title="疑似你要的真实完整链接">🎯 真链接</span>
              <span class="url">{{ step.url }}</span>
            </div>
          </div>
          <p v-if="result.landingScore < 10" class="muted" style="margin-top: 10px; font-size: 12px;">
            💡 如果这次没有命中"真链接"，通常是链接不是电商详情页，你可以把常见域名告诉我，我加进识别规则里。
          </p>
        </section>

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

        <!-- 最终URL（当和推荐链接不一致时降级显示，标"走完所有跳转的最后一步"） -->
        <section v-if="result" class="card">
          <h2 class="card-title">
            <span class="icon">{{ result.recommendedIsLanding ? '🪂' : '🎯' }}</span>
            {{ result.recommendedIsLanding ? '最终跳转结果（走完所有跳转的最后一步）' : '最终链接' }}
          </h2>
          <p v-if="result.recommendedIsLanding" class="muted" style="margin-top: -8px; margin-bottom: 12px; font-size: 12px;">
            这是严格跟随完所有跳转后的最后一步，通常是埋点/追踪页，<strong>不推荐</strong>复制，上面的"推荐真实链接"才是带商品参数的完整长链。
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

        <!-- 参数列表 -->
        <section v-if="result" class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h2 class="card-title" style="margin: 0;">
              <span class="icon">🔍</span> URL 参数
              <span class="badge">{{ Object.keys(result.params).length }} 个</span>
              <span v-if="result.recommendedIsLanding" class="landing-badge" style="margin-left: 6px;">来自🎯真链接</span>
              <span v-else class="tag" style="margin-left: 6px;">来自最终链接</span>
            </h2>
            <span v-if="selectedKey" class="muted">
              已选参数：<code class="code" style="color: var(--primary);">{{ selectedKey }}</code>
            </span>
          </div>

          <div v-if="Object.keys(result.params).length === 0" class="empty-state">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            没有查询到任何 URL 参数
          </div>

          <div v-else class="param-grid">
            <div
              v-for="(v, k) in result.params"
              :key="k"
              class="param-chip"
              :class="{ selected: selectedKey === k }"
              @click="selectedKey = (selectedKey === k ? '' : k)"
            >
              <div class="row" style="justify-content: space-between;">
                <span class="k">{{ k }}</span>
                <button
                  class="btn-copy"
                  style="padding: 2px 8px; font-size: 11px;"
                  :class="{ copied: copied['param_' + k] }"
                  @click.stop="copy(v, 'param_' + k)"
                >
                  {{ copied['param_' + k] ? '✓' : '复制值' }}
                </button>
              </div>
              <span class="v">{{ v }}</span>
            </div>
          </div>

          <p v-if="Object.keys(result.params).length && !selectedKey" class="muted" style="margin-top: 14px;">
            💡 点击上方任意参数卡片，即可在右侧用它来生成替换后的链接
          </p>
        </section>
      </div>

      <!-- 右侧：模板 + 结果 -->
      <div>
        <!-- 模板管理 -->
        <section class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h2 class="card-title" style="margin: 0;"><span class="icon">📝</span> 链接模板</h2>
            <button class="btn-ghost" @click="openTplModal()">+ 新增模板</button>
          </div>

          <div v-if="templates.length === 0" class="empty-state">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            还没有模板，点右上角「新增模板」
            <div style="margin-top: 8px; font-size: 12px;">
              占位符写法示例：<code class="code">https://a.com/?id={activityId}</code>
            </div>
          </div>

          <div v-else style="display: flex; flex-direction: column; gap: 10px;">
            <div
              v-for="(tpl, idx) in templates"
              :key="idx"
              class="tpl-item"
              :class="{ selected: selectedTplIdx === idx }"
              @click="selectedTplIdx = (selectedTplIdx === idx ? -1 : idx)"
            >
              <div class="tpl-head">
                <div class="row gap-sm">
                  <span class="tpl-name">{{ tpl.name }}</span>
                </div>
                <div class="row gap-sm">
                  <button class="btn-ghost" style="padding: 4px 8px; font-size: 12px;" @click.stop="openTplModal(idx)">编辑</button>
                  <button class="btn-danger" @click.stop="removeTpl(idx)">删除</button>
                </div>
              </div>
              <div class="tpl-body">{{ tpl.tpl }}</div>
            </div>
          </div>
        </section>

        <!-- 生成结果 -->
        <section class="card">
          <h2 class="card-title"><span class="icon">🚀</span> 生成结果</h2>

          <div v-if="!selectedKey" class="empty-state">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            请先在左侧点击选择一个参数
          </div>
          <div v-else-if="selectedTplIdx < 0" class="empty-state">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>
            请在上方选择一个链接模板
          </div>
          <div v-else-if="renderedErrors" class="empty-state" style="color: var(--danger);">
            ⚠️ 模板中用到的占位符没有匹配的参数。<br/>
            模板用到了：<span v-for="p in tplPlaceholders" :key="p" class="tag" style="margin: 0 4px;">{{ p }}</span>
          </div>
          <div v-else>
            <div style="margin-bottom: 14px;" class="muted">
              使用参数 <span class="tag" style="margin-right:6px;">{{ selectedKey }} = {{ selectedValue }}</span>
              + 模板 <span class="tag" style="margin-left:6px;">{{ selectedTemplate?.name }}</span>
            </div>

            <div v-if="multipleRendered.length === 1">
              <div class="result-box">
                <div class="val code">{{ multipleRendered[0].url }}</div>
                <div class="foot">
                  <button class="btn-copy" :class="{ copied: copied.result_0 }" @click="copy(multipleRendered[0].url, 'result_0')">
                    {{ copied.result_0 ? '✓ 已复制' : '📋 复制' }}
                  </button>
                </div>
              </div>
            </div>

            <div v-else style="display: flex; flex-direction: column; gap: 10px;">
              <div v-for="(r, i) in multipleRendered" :key="i" class="result-box">
                <div class="lbl">{{ r.label }}</div>
                <div class="val code">{{ r.url }}</div>
                <div class="foot">
                  <button class="btn-copy" :class="{ copied: copied['result_' + i] }" @click="copy(r.url, 'result_' + i)">
                    {{ copied['result_' + i] ? '✓ 已复制' : '📋 复制' }}
                  </button>
                </div>
              </div>
              <div v-if="multipleRendered.length > 1">
                <button class="btn-primary" style="width: 100%;" :class="{ copied: copied.allResults }" @click="copyAllResults">
                  {{ copied.allResults ? '✓ 已复制全部到剪贴板（每行一条）' : '📋 一键复制全部结果' }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 模板编辑弹窗 -->
    <div v-if="tplModalOpen" class="modal-backdrop" @click.self="tplModalOpen = false">
      <div class="modal">
        <h3>{{ editingTplIdx >= 0 ? '编辑模板' : '新增模板' }}</h3>
        <div class="field">
          <label>模板名称</label>
          <input v-model="editingTpl.name" placeholder="例如：淘宝客推广、京粉转链" />
        </div>
        <div class="field">
          <label>
            链接模板
            <span v-if="selectedKey" style="color: var(--primary);">（当前可用占位符: <code>{ {{ selectedKey }} }</code>）</span>
          </label>
          <textarea
            v-model="editingTpl.tpl"
            rows="3"
            placeholder="https://your-domain.com/promotion?pid={activityId}&amp;uid={uid}
也支持每行一条模板，批量生成多个链接"
            spellcheck="false"
          ></textarea>
          <p class="muted" style="margin-top: 6px; font-size: 12px;">
            用 <code>{参数名}</code> 作为占位符，可写多个占位符；
            <strong>每行写一条模板</strong>可以一次生成多个链接
          </p>
        </div>
        <div class="actions">
          <button class="btn-ghost" @click="tplModalOpen = false">取消</button>
          <button class="btn-primary" @click="saveTpl">保存</button>
        </div>
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
import { computed, reactive, ref, watch } from 'vue'

// ---------- state ----------
const inputUrl = ref('')
const loading = ref(false)
const error = ref('')
const result = ref(null)
const selectedKey = ref('')
const selectedTplIdx = ref(0)

const copied = reactive({})
const toasts = ref([])
let toastId = 0

const TPL_KEY = 'url_toolkit_templates_v1'

const DEFAULT_TEMPLATES = [
  { name: '🤖 示例：单参数（id）', tpl: 'https://example.com/track?id={id}' },
  {
    name: '📦 示例：批量多个模板',
    tpl: 'https://a.com/go?code={id}\nhttps://b.com/r?p={id}',
  },
]

const templates = ref(loadTemplates())
function loadTemplates() {
  try {
    const raw = localStorage.getItem(TPL_KEY)
    if (!raw) return [...DEFAULT_TEMPLATES]
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length) return parsed
    return [...DEFAULT_TEMPLATES]
  } catch {
    return [...DEFAULT_TEMPLATES]
  }
}
watch(templates, (v) => {
  localStorage.setItem(TPL_KEY, JSON.stringify(v))
}, { deep: true })

// ---------- computed ----------
const canExpand = computed(() => /^https?:\/\//i.test(inputUrl.value.trim()))

const selectedValue = computed(() => {
  if (!selectedKey.value || !result.value) return ''
  return result.value.params[selectedKey.value] ?? ''
})

const selectedTemplate = computed(() =>
  selectedTplIdx.value >= 0 ? templates.value[selectedTplIdx.value] : null
)

const tplPlaceholders = computed(() => {
  if (!selectedTemplate.value) return []
  const set = new Set()
  const re = /\{([a-zA-Z_$][a-zA-Z0-9_$]*)\}/g
  let m
  while ((m = re.exec(selectedTemplate.value.tpl)) !== null) set.add(m[1])
  return [...set]
})

// 把选中的「单个参数」智能展开：同时也允许模板用到其它已抓出的URL参数
const renderedErrors = computed(() => {
  if (!selectedTemplate.value || !result.value) return false
  for (const p of tplPlaceholders.value) {
    if (!(p in result.value.params)) return true
  }
  return false
})

/**
 * 支持多行模板 → 返回数组 [{label, url}]
 */
const multipleRendered = computed(() => {
  if (!selectedTemplate.value || !result.value || renderedErrors.value) return []
  const lines = selectedTemplate.value.tpl
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return []

  const out = []
  lines.forEach((line, i) => {
    let rendered = line
    for (const [k, v] of Object.entries(result.value.params)) {
      rendered = rendered.split('{' + k + '}').join(encodeURIComponent(v))
    }
    // 为向后兼容：也把 {选中参数名} 做一次兜底替换（防止大小写/拼写）
    if (selectedKey.value && selectedValue.value) {
      rendered = rendered
        .split('{' + selectedKey.value + '}')
        .join(encodeURIComponent(selectedValue.value))
    }
    const label = lines.length > 1 ? `模板 ${i + 1}` : '生成结果'
    out.push({ label, url: rendered })
  })
  return out
})

// ---------- methods ----------
async function expand() {
  if (!canExpand.value) {
    showToast('请输入以 http:// 或 https:// 开头的链接', 'error')
    return
  }
  loading.value = true
  error.value = ''
  result.value = null
  selectedKey.value = ''
  try {
    const api = '/api/expand?url=' + encodeURIComponent(inputUrl.value.trim())
    const resp = await fetch(api)
    const data = await resp.json()
    if (!resp.ok || !data.ok) throw new Error(data.error || '请求失败')
    result.value = data
    // 默认选第一个参数
    const keys = Object.keys(data.params || {})
    if (keys.length > 0) selectedKey.value = keys[0]
    showToast(`展开成功，共 ${keys.length} 个参数`, 'success')
  } catch (e) {
    error.value = e.message || '展开失败'
    showToast(e.message || '展开失败', 'error')
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

// ---------- 模板管理 ----------
const tplModalOpen = ref(false)
const editingTplIdx = ref(-1)
const editingTpl = reactive({ name: '', tpl: '' })

function openTplModal(idx = -1) {
  editingTplIdx.value = idx
  if (idx >= 0) {
    const t = templates.value[idx]
    editingTpl.name = t.name
    editingTpl.tpl = t.tpl
  } else {
    editingTpl.name = ''
    editingTpl.tpl = selectedKey.value
      ? `https://example.com/path?${selectedKey.value}={${selectedKey.value}}`
      : 'https://example.com/?id={id}'
  }
  tplModalOpen.value = true
}
function saveTpl() {
  if (!editingTpl.name.trim() || !editingTpl.tpl.trim()) {
    showToast('名称和模板都不能为空', 'error')
    return
  }
  if (editingTplIdx.value >= 0) {
    templates.value.splice(editingTplIdx.value, 1, {
      name: editingTpl.name.trim(),
      tpl: editingTpl.tpl,
    })
  } else {
    templates.value.push({
      name: editingTpl.name.trim(),
      tpl: editingTpl.tpl,
    })
    if (selectedTplIdx.value < 0) selectedTplIdx.value = templates.value.length - 1
  }
  tplModalOpen.value = false
  showToast('模板已保存', 'success')
}
function removeTpl(idx) {
  if (!confirm('确定删除该模板？')) return
  templates.value.splice(idx, 1)
  if (selectedTplIdx.value === idx) selectedTplIdx.value = templates.value.length ? 0 : -1
  else if (selectedTplIdx.value > idx) selectedTplIdx.value--
  showToast('已删除', 'success')
}
</script>
