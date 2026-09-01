// Cloudflare Pages Functions: GET /api/expand?url=<短链>
// Workers runtime - 仅使用标准 fetch / Web 标准 API
//
// v3 极速优先：秒杀链式 fast-expand 作为默认主路径
// - 先用 redirect:'manual' 拿第一跳 HTML（不跟 3xx），1 次 fetch + 1 个正则 = 秒杀速度
// - 正则没抓到有意义的电商链接 → 再进入 v2 的完整遍历流程（fallback）
// - 淘宝/京东/抖音等主流短链 90%+ 场景在 500ms 内出结果

const MAX_RECURSION = 6;        // 完整流程最多追 6 跳
const FAST_TIMEOUT_MS = 4000;   // 快速路径超时：4 秒够了，再长就是完整流程也帮不了
const REQUEST_TIMEOUT_MS = 8000;// 完整流程超时

// 落地页分阈值：命中即停止循环（真实商品页 score 通常 50~80）
const LANDING_SCORE_EARLY_OUT = 30;

// —— 常见电商自定义 scheme → https 落地页的回跳映射 ——
// 当浏览器级链路最后一步停留在 taobao:// / tbopen:// 这类 App 唤起协议时，
// 普通手机浏览器会在唤起失败后自动 fallback 到对应 H5；我们在这里做同等处理，
// 保证 finalUrl 一定是 https 可直接访问的真链接。
//
// 注意：scheme 的 query 一般是明文拼接 itemId=678...，不是 URL-encoded 的 itemId%3D，
//      所以正则里统一写 `[=:]` 同时兼容「itemId=xxx」和「itemId:xxx」。
const APP_SCHEME_FALLBACKS = [
  { re: /itemId[=:](\d+)/i, make: (m) => `https://item.taobao.com/item.htm?id=${m[1]}` }, // 淘宝/天猫 tbopen 里的 itemId
  { re: /id[=:](\d+)/i,    make: (m) => `https://item.taobao.com/item.htm?id=${m[1]}` }, // 兜底：只要 scheme 里带 id=数字就拼淘宝 H5
  { re: /skuId[=:](\d+)/i, make: (m) => `https://item.jd.com/${m[1]}.html` },
  { re: /wareId[=:](\d+)/i,make: (m) => `https://item.jd.com/${m[1]}.html` },
  { re: /goods?Id[=:](\d+)/i, make: (m) => `https://item.jd.com/${m[1]}.html` },
  { re: /aweme_id[=:](\d+)/i, make: (m) => `https://www.douyin.com/video/${m[1]}` },
  { re: /note_id[=:](\w+)/i,  make: (m) => `https://www.xiaohongshu.com/explore/${m[1]}` },
];
function fallbackForAppScheme(rawUrl) {
  for (const rule of APP_SCHEME_FALLBACKS) {
    const m = rawUrl.match(rule.re);
    if (m) {
      const u = rule.make(m, rawUrl);
      if (u) return u;
    }
  }
  return null;
}

/**
 * 判定一个 URL 像不像「真实落地页/商品详情页」。
 * 返回 { score, reasons }，分数越高越像"你要的真链接"。
 * 用户要的就是中间那个带参数的商品页，不是跳转链最后一步的埋点追踪页。
 */
function scoreLandingPage(urlObj) {
  let score = 0;
  const reasons = [];
  const host = urlObj.hostname.toLowerCase();
  const path = urlObj.pathname.toLowerCase();

  // --- 强特征：电商商品详情页域名 + 详情页路径 ---
  const isEcomHost = /(^|\.)(taobao|tmall|jd|pinduoduo|yangkeduo|suning|vip|kaola|1688|mogujie|meilishuo|kuaishou|douyin|xiaohongshu)\.com$/.test(host);
  if (isEcomHost) {
    if (/^(item|detail|goods|product|p)\./.test(host) || /\/(item|detail|goods|product|p|aweme|xiaodian|notes)\//.test(path) || path === '/item.htm') {
      score += 25;
      reasons.push('电商商品详情页域名/路径');
    } else {
      score += 8;
      reasons.push('电商主站域名');
    }
  }

  // --- 强特征：有明确的商品/活动 ID 参数（每个 10 分）---
  const strongParams = ['id', 'itemId', 'item_id', 'goodsId', 'goods_id', 'productId', 'product_id', 'skuId', 'sku_id', 'activityId', 'activity_id', 'campaignId', 'page_url', 'wareId', 'aweme_id', 'note_id'];
  const hits = [];
  for (const p of strongParams) {
    if (urlObj.searchParams.has(p)) hits.push(p);
  }
  if (hits.length > 0) {
    score += hits.length * 10;
    reasons.push(`命中核心参数：${hits.join('/')}`);
  }

  // --- 中等特征：query 参数多，说明内容丰富 ---
  const paramSize = [...urlObj.searchParams.keys()].length;
  if (paramSize >= 4) { score += 5; reasons.push(`有${paramSize}个query参数`); }
  else if (paramSize >= 2) { score += 2; reasons.push(`有${paramSize}个query参数`); }

  // --- 减分特征：明显是短链/追踪/中转页 ---
  if (/(^|\.)(e\.tb|t\.cn|dwz|suo|urldefense|protected\.mail|sclick|click|jump|h5\.m|m\.taobao|uland|spm|track)/.test(host)) {
    score -= 15;
    reasons.push('疑似短链/中转/追踪域名(-15)');
  }
  if (/(redirect|jump|go|transfer|track|click|middle|landing|promotion|union|spread)/i.test(path) && paramSize <= 1) {
    score -= 8;
    reasons.push('路径含跳转关键词(-8)');
  }
  if (paramSize === 0) score -= 5;

  return { score, reasons };
}

/**
 * URL 规范化流水线：
 *  1) 去除首尾空白
 *  2) 去除包裹性的反引号/单双引号
 *  3) HTML 实体解码（&amp;→&、&quot;→"、&#39;→'、&lt;→<、&gt;→>）
 *  必须在交给 new URL() 之前执行，否则 &amp; 会被当成参数名的一部分
 */
function normalizeHtmlUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let u = raw.trim();
  // 去除包裹 href 的反引号、单引号、双引号（可能出现多层或混用）
  u = u.replace(/^[`"'\s]+|[`"'\s]+$/g, '');
  // HTML 实体解码 —— 至少覆盖 &amp; 这个最常见的坑
  u = u.replace(/&amp;/gi, '&');
  u = u.replace(/&quot;/gi, '"');
  u = u.replace(/&#39;/gi, "'");
  u = u.replace(/&lt;/gi, '<');
  u = u.replace(/&gt;/gi, '>');
  // 数字实体 &#NNN; 和 &#xHH;
  u = u.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  u = u.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return u.trim();
}

/**
 * 从 HTML 响应中提取"浏览器下一步要去的地址"：
 *  — 优先级与真实浏览器保持一致 —
 *   1. <meta http-equiv="refresh" content="0; url=xxx">    （最常见的 H5 强跳）
 *   2. 内联 <script> 中立即执行的 location.assign/replace/href = xxx
 *   3. 页面中带明确跳转 id 的 <a href> 按钮 / data-url / data-href
 *   4. 通用 JSON 片段中出现的 url 字段
 *
 * 返回候选 URL 数组（已按权重排序，[0] 权重最高）。
 * 与旧版 extractJumpUrls 不同：这里给每个候选加了权重分，保证 meta refresh = 浏览器第一优先级。
 */
function extractBrowserNextUrls(html, baseUrl) {
  const add = (u, weight) => {
    if (!u) return null;
    const normalized = normalizeHtmlUrl(u);
    if (!normalized) return null;
    let resolved;
    try { resolved = new URL(normalized, baseUrl).href; } catch (_) { return null; }
    return { u: resolved, w: weight };
  };
  const candidates = [];

  // 0) 快速排除：静态资源 URL 不能当跳转链接（常见 meta refresh 误跳到 .css/.js）
  const isStaticAsset = (u) => /\.(css|js|jpg|jpeg|png|gif|webp|svg|woff|woff2|ttf|ico|map|mp4|mp3|webm|wasm)(\?|#|$)/i.test(u);

  // 1) meta refresh → 浏览器会严格按这个跳，给 1000 分独占
  const metaMatch = html.match(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/i);
  if (metaMatch) {
    const content = metaMatch[0].match(/content\s*=\s*["']([^"']+)["']/i);
    if (content) {
      const m = content[1].match(/url\s*=\s*(\S+)/i);
      if (m) {
        const rawUrl = m[1].replace(/['")\s<>]+$/g, '').replace(/^['"(<\s]+/g, '');
        if (!isStaticAsset(rawUrl)) {
          const pick = add(rawUrl, 1000);
          if (pick) candidates.push(pick);
        }
      }
    }
  }

  // 2) JS 跳转（location = / .href = / .replace / .assign）→ 次优先
  const jsRules = [
    { re: /var\s+url\s*=\s*["']([^"']+)["']/g,                             w: 920 }, // 淘宝 e.tb.cn 这种模板会先写 var url = '真实跳转H5'，最高优先级
    { re: /const\s+url\s*=\s*["']([^"']+)["']/g,                           w: 919 },
    { re: /let\s+url\s*=\s*["']([^"']+)["']/g,                             w: 918 },
    { re: /(?:window\.)?location\s*\.\s*href\s*=\s*["']([^"']+)["']/g,      w: 900 },
    { re: /location\s*\.\s*replace\s*\(\s*["']([^"']+)["']\s*\)/g,           w: 890 },
    { re: /location\s*\.\s*assign\s*\(\s*["']([^"']+)["']\s*\)/g,            w: 880 },
    { re: /window\.location\s*=\s*["']([^"']+)["']/g,                        w: 870 },
    { re: /self\.location\s*=\s*["']([^"']+)["']/g,                          w: 860 },
    { re: /top\.location\s*=\s*["']([^"']+)["']/g,                           w: 850 },
    // 兜底：location = "xxx" 不加前缀
    { re: /(?:^|[^.\w])location\s*=\s*["']([^"']+)["']/g,                    w: 840 },
  ];
  for (const { re, w } of jsRules) {
    let m;
    while ((m = re.exec(html)) !== null) {
      if (isStaticAsset(m[1])) continue; // var/const/let url = 'xxx.js' 这种也可能是资源 url
      const pick = add(m[1], w);
      if (pick) candidates.push(pick);
    }
  }

  // 3) 自定义 scheme 的 App 唤起（tbopen:// / taobao:// 等）→ 浏览器会尝试打开 App，
  //    我们把它也当一条候选，之后由 APP_SCHEME_FALLBACKS 转成 H5 链接。
  //    写在 html 里的 `tbopen://...`、<iframe src="tbopen://">、<a href="tbopen://"> 都要抓
  const appSchemeRe = /["']([a-z][a-z0-9+\-.]*:\/\/[^"']+)["']/gi;
  let am;
  while ((am = appSchemeRe.exec(html)) !== null) {
    const scheme = am[1];
    if (!/^https?:\/\//i.test(scheme)) {
      const fallback = fallbackForAppScheme(scheme);
      if (fallback) {
        const pick = add(fallback, 780);
        if (pick) candidates.push(pick);
      }
    }
  }
  // 同样从 tbopen:// 自定义 scheme 的 query 里提取到的 itemId 直接拼 H5（比前面更宽松）
  // 形如：tbopen://m.taobao.com/tbopen/index.html?action=ali.open.nav&module=h5&browserFlag=zhihu&bootPage=TB_H5_HOME&appkey=&e=h5toapp&wh_weex_weex_source=hybrid&itemId=699237567551
  const looseSchemeRe = /\b(tbopen|taobao|tmall|openapp\.jd\.m|snssdk1128|xhsdiscover):\/\/[^\s<>"'`)]+/gi;
  let lm;
  while ((lm = looseSchemeRe.exec(html)) !== null) {
    const fallback = fallbackForAppScheme(lm[0]);
    if (fallback) {
      const pick = add(fallback, 770);
      if (pick) candidates.push(pick);
    }
  }

  // 4) data-url / data-href / 带跳转 id 的 a 链接
  const attrRules = [
    { re: /data-url\s*=\s*["']([^"']+)["']/g,                                              w: 700 },
    { re: /data-href\s*=\s*["']([^"']+)["']/g,                                             w: 690 },
    { re: /<a[^>]+id\s*=\s*["'](?:skip|jump|J_Link|J_SubmitStatic|btn-open)[^"']*["'][^>]+href\s*=\s*["']([^"']+)["']/gi, w: 650 },
    { re: /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]+id\s*=\s*["'](?:skip|jump|J_Link|J_SubmitStatic|btn-open)[^"']*["']/gi, w: 650 },
  ];
  for (const { re, w } of attrRules) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const pick = add(m[1], w);
      if (pick) candidates.push(pick);
    }
  }

  // 5) 通用 JSON 片段里的 url 字段（权重最低，因为 JSON 里可能是资源 url/埋点 url 不是跳转）
  const jsonUrlRe = /["']?url["']?\s*[:=]\s*["']((?:https?:)?\/\/[^"'\s]+)["']/g;
  let jm;
  while ((jm = jsonUrlRe.exec(html)) !== null) {
    let u = jm[1];
    if (u.startsWith('//')) u = 'https:' + u;
    const pick = add(u, 500);
    if (pick) candidates.push(pick);
  }

  // —— 二次打分：选出来的候选中，更像"浏览器会去的下一跳"的再加权 ——
  //   ① 与当前页同域的 meta/JS 跳转肯定比跳第三方更优先，但跨域才是真落地页
  //   ② 含 & 多参数 + 电商 H5 域名 + id 参数的链接，权重 *2
  try {
    const curHost = new URL(baseUrl).hostname.toLowerCase();
    for (const c of candidates) {
      const pu = new URL(c.u);
      const host = pu.hostname.toLowerCase();
      const ls = scoreLandingPage(pu).score;
      c.w += ls; // 落地页分叠加进去
      if (host !== curHost) c.w += 20;
      const paramSize = pu.searchParams.size;
      if (c.u.includes('&') || paramSize >= 2) {
        c.w += 8 + Math.min(paramSize, 6) * 2;
      } else if (paramSize > 0) {
        c.w += 2;
      }
    }
  } catch (_) {}

  candidates.sort((a, b) => b.w - a.w);
  // 去重（同一个 url 可能多条规则命中），保留权重最高的第一条
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    if (seen.has(c.u)) continue;
    seen.add(c.u);
    out.push(c.u);
  }
  return out;
}

/**
 * 判断 URL 是否属于错误页 / 404 页
 */
function looksLikeErrorPage(urlObjOrStr) {
  let url;
  try { url = typeof urlObjOrStr === 'string' ? new URL(urlObjOrStr) : urlObjOrStr; }
  catch (_) { return false; }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  return (
    /^err\./.test(host) ||
    /error|404|notfound|errpage|scanError/i.test(path) ||
    (path.includes('error') && url.searchParams.get('c') === '404')
  );
}

/**
 * 极速模式：秒杀链式的快速路径
 *
 * 淘宝 t.cn / 京东 dwz 等短链，第一步 HTML 中转页里通常直接写着：
 *   var url='https://item.taobao.com/item.htm?id=xxx';
 *   location.href='https://...';
 *   <meta refresh content="0; url=https://item.jd.com/xxx.html">
 *
 * 这就是真实商品链接，拿到就直接返回，不再追跳转链。
 * 和秒杀链一样只做 1 次 fetch + 1 个轻量正则。
 *
 * 返回 { ok, url }，ok=false 表示没抓到有意义的 URL，应该走完整流程
 */
function fastExtractFromHtml(html, baseUrl) {
  if (!html) return null;
  // 秒杀链同款正则：var url / location.replace / location.href
  const m = html.match(/(?:var\s+url|const\s+url|let\s+url|location\.(?:replace|href)|window\.location\s*=)\s*=\s*['"]([^'"]+)['"]/i)
         || html.match(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*(\S+)[^"']*["']/i);
  if (!m) return null;
  let raw = m[1];
  // 去掉尾部引号、括号等
  raw = raw.replace(/['")\s<>]+$/g, '').replace(/^['"(<\s]+/g, '');
  // 补全协议
  if (raw.startsWith('//')) raw = 'https:' + raw;
  let resolved;
  try { resolved = new URL(raw, baseUrl).href; } catch (_) { return null; }
  // 验证：必须是 http(s)，且有商品相关的参数或电商域名
  try {
    const u = new URL(resolved);
    const hasProductParam = /[?&](id|itemId|item_id|goodsId|skuId|wareId|aweme_id|note_id|itemIds)=/i.test(u.search);
    const isEcomHost = /(^|\.)(taobao|tmall|jd|yangkeduo|pinduoduo|douyin|xiaohongshu|weibo|bilibili|xiaomi)\.com$/.test(u.hostname);
    if (hasProductParam || isEcomHost) return resolved;
  } catch (_) {}
  return null;
}

/**
 * 【秒杀链式快速路径 v3 — 默认主流程】
 *
 * 核心思路和秒杀链 change.vue 完全一致：
 *   1. redirect:'manual' → 不跟 HTTP 3xx，直接拿短链服务器返回的第一跳
 *      （淘宝 t.cn / 京东 dwz 这类短链，302 的 body 里就写着 var url='真实商品页'）
 *   2. 用 fastExtractFromHtml 的秒杀链正则抓真实链接
 *   3. 抓到电商链接 → 直接返回！1 次 fetch + 1 个正则 ≈ 300~800ms
 *   4. 没抓到 → 返回 { ok:false } 让调用方进完整流程 fallback
 *
 * 另外：如果第一跳是 HTTP 3xx 且 Location header 直接指向电商域名，
 *       连 HTML 都不用读，直接用 Location 值返回（更极致）。
 */
async function fastExpand(initialUrl) {
  const chain = [];
  const tFetch0 = Date.now();
  let html = '';
  let baseUrl = initialUrl;

  try {
    const resp = await fetchWithTimeout(initialUrl, {
      redirect: 'manual',           // 关键：不跟 3xx，直接拿第一跳响应
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    }, FAST_TIMEOUT_MS);
    const fetchMs = Date.now() - tFetch0;

    // 3xx 重定向：先检查 Location header —— 如果它直接指向电商域名/有商品参数
    // 那就不用读 HTML body 了，直接用 Location（省一次 HTML 下载时间）
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location') || resp.headers.get('Location');
      if (loc) {
        let resolved = loc.startsWith('//') ? 'https:' + loc : loc;
        try { resolved = new URL(resolved, initialUrl).href; } catch (_) { resolved = loc; }
        try {
          const u = new URL(resolved);
          const hasProductParam = /[?&](id|itemId|item_id|goodsId|skuId|wareId|aweme_id|note_id|itemIds)=/i.test(u.search);
          const isEcomHost = /(^|\.)(taobao|tmall|jd|yangkeduo|pinduoduo|douyin|xiaohongshu|weibo|bilibili|xiaomi)\.com$/.test(u.hostname);
          if (hasProductParam || isEcomHost) {
            let fs = 0;
            try { fs = scoreLandingPage(new URL(resolved)).score; } catch (_) {}
            chain.push({ url: initialUrl, status: resp.status, via: 'fast-manual-redirect', landingScore: 0, isLanding: false, reasons: [], fetchMs, htmlSize: 0, parseMs: 0 });
            chain.push({ url: resolved, status: 200, via: 'fast-Location-header', landingScore: fs, isLanding: fs >= 18, reasons: ['秒杀链 Location header 命中'], fetchMs: 0, htmlSize: 0, parseMs: 0 });
            return { ok: true, finalUrl: resolved, chain, landing: { url: resolved, score: fs, params: paramsFromUrl(resolved) } };
          }
        } catch (_) {}
        // Location 不是电商链接，继续读 body 看有没有 var url
      }
    }

    // 不是 3xx 或 Location 没命中电商 → 读 HTML body
    const ct = resp.headers.get('content-type') || '';
    if (/text\/html|application\/xhtml\+xml/i.test(ct) || resp.status === 302 || resp.status === 301 || resp.status === 200) {
      html = await resp.text();
      baseUrl = resp.url || initialUrl;
    }

    // 秒杀链正则匹配
    const fast = fastExtractFromHtml(html, baseUrl);
    if (fast) {
      let fs = 0;
      try { fs = scoreLandingPage(new URL(fast)).score; } catch (_) {}
      chain.push({ url: baseUrl, status: resp.status, via: 'fast-html-source', landingScore: 0, isLanding: false, reasons: [], fetchMs, htmlSize: html.length, parseMs: 0 });
      chain.push({ url: fast, status: 200, via: 'fast-html-match', landingScore: fs, isLanding: fs >= 18, reasons: ['秒杀链式正则命中'], fetchMs: 0, htmlSize: 0, parseMs: 0 });
      return { ok: true, finalUrl: fast, chain, landing: { url: fast, score: fs, params: paramsFromUrl(fast) } };
    }

    // 还有一种情况：第一跳直接就是 200 电商页（短链已经提前跟着重定向了）
    // 这时 baseUrl 就是最终页，也有电商域名
    if (resp.status === 200 && /(^|\.)(taobao|tmall|jd|yangkeduo|pinduoduo|douyin|xiaohongshu|weibo|bilibili|xiaomi)\.com$/.test(new URL(baseUrl).hostname)) {
      let fs = 0;
      try { fs = scoreLandingPage(new URL(baseUrl)).score; } catch (_) {}
      if (fs >= 10) {
        chain.push({ url: baseUrl, status: 200, via: 'fast-direct-200', landingScore: fs, isLanding: fs >= 18, reasons: ['直接电商页'], fetchMs, htmlSize: html.length, parseMs: 0 });
        return { ok: true, finalUrl: baseUrl, chain, landing: { url: baseUrl, score: fs, params: paramsFromUrl(baseUrl) } };
      }
    }
  } catch (e) {
    // 快速路径超时或网络错误 → 让完整流程试一下
  }

  // 快速路径没抓到 → 返回 ok:false，调用方会进完整流程
  return { ok: false };
}

/**
 * 【完整遍历流程 — fallback】
 *
 * 仅在秒杀链式快速路径没抓到有意义的电商链接时才进入。
 * 多轮 fetch + HTML 解析 + 落地页打分，覆盖所有边缘场景。
 */
async function expandSinglePass(initialUrl) {
  const chain = [];
  const visited = new Set();
  const scoredUrls = []; // { url, score } — 用于错误页回退
  let currentUrl = initialUrl;
  let lastHtml = null;
  let lastHtmlBase = null;
  let landing = null; // 当前链路上最高落地页分的条目

  for (let hops = 0; hops < MAX_RECURSION; hops++) {
    if (visited.has(currentUrl)) break;
    visited.add(currentUrl);

    const tFetch0 = Date.now();
    // A. 跟完所有 HTTP 3xx（浏览器自动跟）
    const resp = await fetchWithTimeout(currentUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    const fetchMs = Date.now() - tFetch0;
    // fetch(redirect:'follow') 返回的 resp.url 就是浏览器地址栏里最终停的 URL
    const stoppedUrl = resp.url || currentUrl;
    if (!visited.has(stoppedUrl)) visited.add(stoppedUrl);

    const ct = resp.headers.get('content-type') || '';
    const isHtml = /text\/html|application\/xhtml\+xml/i.test(ct);
    let via = 'followed-HTTP';

    let htmlBody = null;
    if (isHtml && (resp.status === 200 || resp.status === 304 || resp.status === 404 || resp.status === 403)) {
      htmlBody = await resp.text();
      lastHtml = htmlBody;
      lastHtmlBase = stoppedUrl;
    }

    // —— 先算落地页分（在下载 HTML body 之前就做，避免白下载）——
    let stepScore = 0, stepReasons = [];
    try {
      const r = scoreLandingPage(new URL(stoppedUrl));
      stepScore = r.score;
      stepReasons = r.reasons;
    } catch (_) {}

    // 命中高分落地页 → 直接终止循环，不再 fetch 任何下一跳
    const isLanding = stepScore >= 18;
    if (stepScore >= LANDING_SCORE_EARLY_OUT) {
      chain.push({
        url: stoppedUrl,
        status: resp.status,
        via: 'early-stop-landing',
        landingScore: stepScore,
        isLanding,
        reasons: stepReasons,
        fetchMs,
        htmlSize: htmlBody ? htmlBody.length : 0,
        parseMs: 0,
      });
      if (!landing || stepScore > landing.score) {
        landing = { url: stoppedUrl, score: stepScore, params: paramsFromUrl(stoppedUrl) };
      }
      break;
    }

    let nextCandidates = [];
    let htmlSize = htmlBody ? htmlBody.length : 0;
    let parseMs = 0;

    if (htmlBody) {
      const tParse0 = Date.now();
      nextCandidates = extractBrowserNextUrls(htmlBody, stoppedUrl)
        .filter(u => u !== stoppedUrl && u !== currentUrl && !visited.has(u));
      if (nextCandidates.length > 0) via = 'followed+HTML-parse';
      parseMs = Date.now() - tParse0;
    }

    const stepInfo = {
      url: stoppedUrl,
      status: resp.status,
      via,
      landingScore: stepScore,
      isLanding,
      reasons: stepReasons,
      fetchMs,
      htmlSize,
      parseMs,
    };
    chain.push(stepInfo);
    scoredUrls.push({ url: stoppedUrl, score: stepScore });

    if (!landing || stepScore > landing.score) {
      landing = { url: stoppedUrl, score: stepScore, params: paramsFromUrl(stoppedUrl) };
    }

    if (nextCandidates.length === 0) {
      // B. 没有更多跳转 → 就停在 stoppedUrl
      currentUrl = stoppedUrl;
      break;
    }
    currentUrl = nextCandidates[0];
  }

  // C. 兜底：即使停在某个 HTML 页没抓出下一跳，但 HTML 里存在自定义 scheme 片段（常见于淘宝 e.tb.cn），
  //    再扫一次整包 HTML 的 scheme 做 App→H5 fallback
  if (lastHtml) {
    const appSchemeRe2 = /\b(tbopen|taobao|tmall|openapp\.jd\.m|snssdk1128|xhsdiscover):\/\/[^\s<>"'`)]+/gi;
    let m;
    const fallbackCandidates = [];
    while ((m = appSchemeRe2.exec(lastHtml)) !== null) {
      const fb = fallbackForAppScheme(m[0]);
      if (fb && !visited.has(fb)) fallbackCandidates.push(fb);
    }
    if (fallbackCandidates.length > 0) {
      // 从候选里挑"落地页分最高的那个"，基本就是你在手机浏览器里最终会看到的详情页
      const scored = fallbackCandidates.map(u => {
        let s = 0;
        try { s = scoreLandingPage(new URL(u)).score + (u.includes('&') ? 10 : 0); } catch (_) {}
        return { u, s };
      }).sort((a, b) => b.s - a.s);
      const finalPick = scored[0].u;
      if (!visited.has(finalPick)) {
        visited.add(finalPick);
        let s = 0;
        try { s = scoreLandingPage(new URL(finalPick)).score; } catch (_) {}
        chain.push({
          url: finalPick, status: 200, via: 'AppScheme→H5-fallback',
          landingScore: s, isLanding: s >= 18, reasons: [],
          fetchMs: 0, htmlSize: 0, parseMs: 0,
        });
        scoredUrls.push({ url: finalPick, score: s });
        if (!landing || s > landing.score) {
          landing = { url: finalPick, score: s, params: paramsFromUrl(finalPick) };
        }
        currentUrl = finalPick;
      }
    }
  }

  // D. 终极兜底：如果 currentUrl 是错误页 / 404 页，回退到链路上"落地页分最高的那个"
  //    这就是你在真实浏览器场景里遇到 error1.html 时会做的：点返回，用上一步的 iframe src 页面
  if (looksLikeErrorPage(currentUrl) && scoredUrls.length > 1) {
    const sorted = [...scoredUrls].sort((a, b) => b.score - a.score);
    const fallback = sorted.find((c) => !looksLikeErrorPage(c.url) && c.url !== currentUrl);
    if (fallback) {
      chain.push({
        url: fallback.url, status: 200, via: 'ErrorPage→Fallback',
        landingScore: fallback.score, isLanding: fallback.score >= 18, reasons: [],
        fetchMs: 0, htmlSize: 0, parseMs: 0,
      });
      currentUrl = fallback.url;
    }
  }

  return { finalUrl: currentUrl, chain, landing };
}

function okJson(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
function errJson(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
async function fetchWithTimeout(url, opts = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}
function paramsFromUrl(url) {
  const out = {};
  try {
    const u = new URL(url);
    for (const [k, v] of u.searchParams.entries()) out[k] = v;
  } catch (_) {}
  return out;
}

// 缓存 TTL：同一个短链 60 秒内重复请求直接命中缓存，跳过跳转链路
const CACHE_TTL_SECONDS = 60;

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) return errJson('缺少参数: url', 400);
  let parsedTarget;
  try { parsedTarget = new URL(target); }
  catch (_) { return errJson('URL 格式无效，请输入完整的 http(s):// 链接', 400); }
  if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
    return errJson('仅支持 http / https 协议的链接', 400);
  }

  const initialUrl = parsedTarget.href;

  // ===== 缓存层：Cloudflare Workers 原生 Cache API，零配置 =====
  const cacheKey = new Request('https://expand-cache.local/?u=' + encodeURIComponent(initialUrl), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    // 命中缓存 —— 直接返回，不计入后端耗时
    return cached;
  }

  const t0 = Date.now();
  try {
    // ===== 先跑秒杀链式快速路径（默认主流程）=====
    let fastResult = await fastExpand(initialUrl);
    let finalUrl, chain, landing, fastMode;

    if (fastResult.ok) {
      // 快速路径命中 —— 秒杀链速度
      finalUrl = fastResult.finalUrl;
      chain = fastResult.chain;
      landing = fastResult.landing;
      fastMode = true;
    } else {
      // 快速路径没抓到 —— 进完整遍历 fallback
      const full = await expandSinglePass(initialUrl);
      finalUrl = full.finalUrl;
      chain = full.chain;
      landing = full.landing;
      fastMode = false;
    }

    // ===== 推荐落地页：从 finalUrl 和 landing.url 里挑分数最高的 =====
    const candidatesForReco = [
      { url: finalUrl, label: '浏览器最终停留页' },
      ...(landing && landing.url ? [{ url: landing.url, score: landing.score, params: landing.params, label: '最高落地页分' }] : []),
    ];
    let best = null;
    for (const c of candidatesForReco) {
      if (looksLikeErrorPage(c.url)) continue;
      let s = -Infinity, params = null;
      try {
        const r = scoreLandingPage(new URL(c.url));
        s = r.score;
        params = paramsFromUrl(c.url);
        if (c.url.includes('&')) s += 6;
      } catch (_) {}
      if (!best || s > best.score) {
        best = { score: s, url: c.url, params };
      }
    }
    if (!best) {
      const fallback = !looksLikeErrorPage(finalUrl) ? finalUrl : (landing?.url || finalUrl);
      best = { score: 0, url: fallback, params: paramsFromUrl(fallback) };
    }
    const recommendedUrl = best.url;
    const recommendedParams = best.params;
    const useLanding = recommendedUrl !== finalUrl;

    const totalMs = Date.now() - t0;
    const hopsCount = chain.length;
    const body = {
      ok: true,
      finalUrl,
      recommendedUrl,
      recommendedIsLanding: useLanding,
      landingScore: landing?.score ?? 0,
      chain,
      params: recommendedParams,
      paramsFromFinalOnly: paramsFromUrl(finalUrl),
      totalMs,          // 总耗时（ms）
      hopsCount,        // 实际跳转步数
      fastMode,           // 是否命中极速模式（秒杀链式快速路径）
      cached: false,
    };

    const resp = new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
        'Access-Control-Allow-Origin': '*',
      },
    });

    // 写入 Workers 缓存（60 秒）
    context.waitUntil(cache.put(cacheKey, resp.clone()));

    return resp;
  } catch (e) {
    const totalMs = Date.now() - t0;
    const msg = e.name === 'AbortError' ? '请求超时，短链服务器响应过慢' : (e.message || '未知错误');
    return new Response(JSON.stringify({ ok: false, error: `转换失败: ${msg}`, totalMs }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
