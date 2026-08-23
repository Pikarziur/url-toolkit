// Cloudflare Pages Functions: GET /api/expand?url=<短链>
// Workers runtime - 仅使用标准 fetch / Web 标准 API

const MAX_RECURSION = 8;   // 最多处理步数（手动细粒度，所以上限放宽）
const REQUEST_TIMEOUT_MS = 15000;

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
 * HTML跳转链接解析器：从HTML文本里提取真实跳转URL
 */
function extractJumpUrls(html, baseUrl) {
  const urls = new Set();
  const add = (u) => {
    if (!u) return;
    try { urls.add(new URL(u, baseUrl).href); } catch (_) {}
  };

  // 1) meta refresh
  const metaMatch = html.match(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/i);
  if (metaMatch) {
    const content = metaMatch[0].match(/content\s*=\s*["']([^"']+)["']/i);
    if (content) {
      const m = content[1].match(/url\s*=\s*(\S+)/i);
      if (m) add(m[1].replace(/['")]/g, '').trim());
    }
  }

  // 2) JS 跳转 - 多种写法
  const jsPatterns = [
    /(?:window\.)?location\s*\.\s*href\s*=\s*["']([^"']+)["']/g,
    /location\s*\.\s*replace\s*\(\s*["']([^"']+)["']\s*\)/g,
    /location\s*\.\s*assign\s*\(\s*["']([^"']+)["']\s*\)/g,
    /window\.location\s*=\s*["']([^"']+)["']/g,
    /self\.location\s*=\s*["']([^"']+)["']/g,
    /top\.location\s*=\s*["']([^"']+)["']/g,
  ];
  for (const re of jsPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) add(m[1]);
  }

  // 3) data-url / href 属性带明显跳转 id 的链接
  const attrPatterns = [
    /data-url\s*=\s*["']([^"']+)["']/g,
    /data-href\s*=\s*["']([^"']+)["']/g,
    /<a[^>]+id\s*=\s*["'](?:skip|jump|J_Link|J_SubmitStatic|btn-open)[^"']*["'][^>]+href\s*=\s*["']([^"']+)["']/gi,
    /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]+id\s*=\s*["'](?:skip|jump|J_Link|J_SubmitStatic|btn-open)[^"']*["']/gi,
  ];
  for (const re of attrPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) add(m[1]);
  }

  // 4) 通用 JSON 片段里的 url 字段
  const jsonUrlRe = /["']?url["']?\s*[:=]\s*["']((?:https?:)?\/\/[^"'\s]+)["']/g;
  let jm;
  while ((jm = jsonUrlRe.exec(html)) !== null) {
    let u = jm[1];
    if (u.startsWith('//')) u = 'https:' + u;
    add(u);
  }

  return [...urls];
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
async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
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

  const chain = [];
  const visited = new Set();
  let currentUrl = parsedTarget.href;
  let landing = null; // 当前发现的最高分落地页

  try {
    for (let hops = 0; hops < MAX_RECURSION; hops++) {
      if (visited.has(currentUrl)) break;
      visited.add(currentUrl);

      // ===== 关键：redirect:'manual'，每一次请求只处理 1 次跳转，chain 精准不重复 =====
      const resp = await fetchWithTimeout(currentUrl, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      });
      const status = resp.status;
      let via = 'HTTP-direct';
      let nextUrl = null;

      // --- A. HTTP 3xx 重定向 ---
      if (status >= 300 && status < 400) {
        const loc = resp.headers.get('location');
        if (loc) { try { nextUrl = new URL(loc, currentUrl).href; via = 'HTTP-3xx'; } catch (_) {} }
      }

      // --- B. 200 HTML 解析 DOM/JS 跳转 ---
      const ct = resp.headers.get('content-type') || '';
      const isHtml = /text\/html|application\/xhtml\+xml/i.test(ct);
      if ((status === 200 || status === 304 || (status >= 400 && status < 500)) && isHtml) {
        const html = await resp.text();
        const candidates = extractJumpUrls(html, currentUrl).filter(u => u !== currentUrl && !visited.has(u));
        if (candidates.length > 0) {
          const curHost = new URL(currentUrl).hostname;
          const scored = candidates.map((u) => {
            const p = new URL(u);
            let s = 0;
            if (p.hostname !== curHost) s += 10;
            s += scoreLandingPage(p).score; // 落地页分也纳入候选选择
            if (p.searchParams.size > 0) s += 2;
            return { u, s };
          });
          scored.sort((a, b) => b.s - a.s);
          nextUrl = scored[0].u;
          if (via === 'HTTP-direct') via = 'HTML-parse';
        }
      }

      // ===== 给这步打分，记录是否是"疑似落地页" =====
      let stepScore = 0, stepReasons = [];
      try {
        const r = scoreLandingPage(new URL(currentUrl));
        stepScore = r.score; stepReasons = r.reasons;
      } catch (_) {}
      const isLanding = stepScore >= 18;
      const stepInfo = {
        url: currentUrl,
        status,
        via,
        landingScore: stepScore,
        isLanding,
        reasons: stepReasons,
      };
      chain.push(stepInfo);

      if (!landing || stepInfo.landingScore > landing.landingScore) {
        landing = { ...stepInfo, params: paramsFromUrl(currentUrl) };
      }

      if (!nextUrl) break; // 没下一步，停

      // 即使已经找到了高分落地页，也继续把后续跳转展示出来
      // 但推荐结果会锁定在高分落地页，不再以"最后一步"为准
      currentUrl = nextUrl;
    }

    const finalUrl = currentUrl;
    // 如果发现了高分落地页，而且它不在最后一步 → 优先推荐落地页
    const useLanding = !!(landing && landing.url !== finalUrl && landing.landingScore >= 18);
    const recommendedUrl = useLanding ? landing.url : finalUrl;
    const recommendedParams = useLanding ? landing.params : paramsFromUrl(finalUrl);

    return okJson({
      ok: true,
      finalUrl,                         // 跳转链严格意义上的最后一步
      recommendedUrl,                   // 推荐的"你要的真链接"
      recommendedIsLanding: useLanding, // 是不是靠落地页识别命中的
      landingScore: landing?.landingScore ?? 0,
      chain,                            // 精简后的跳转链（每一步只记 1 条，不再虚高）
      params: recommendedParams,        // 优先从"真链接"解析参数
      paramsFromFinalOnly: paramsFromUrl(finalUrl), // 兜底：最后一步的参数
    });
  } catch (e) {
    const msg = e.name === 'AbortError' ? '请求超时，短链服务器响应过慢' : (e.message || '未知错误');
    return errJson(`展开失败: ${msg}`, 500);
  }
}
