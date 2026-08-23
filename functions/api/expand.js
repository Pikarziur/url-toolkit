// Cloudflare Pages Functions: GET /api/expand?url=<短链>
// Workers runtime - 仅使用标准 fetch / Web 标准 API

const MAX_RECURSION = 6; // 最多跟随跳转次数（含HTTP重定向+HTML解析跳转）
const REQUEST_TIMEOUT_MS = 15000;

/**
 * HTML跳转链接解析器：从HTML文本里提取真实跳转URL
 * 覆盖场景：
 *  1. meta refresh: <meta http-equiv="refresh" content="0; url=XXX">
 *  2. JS跳转: location.href= / location.replace( / location.assign( / window.location=
 *  3. 淘宝e.tb.cn常见: <a id="J_..."> 跳转按钮 / JSONP中的 "url":"..." / data-url 属性
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

  // 3) data-url / href 属性带明显跳转id的链接
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

  // 4) 通用 JSON 片段里的 url 字段 (如淘宝的 var url = "..." 或 "url":"...")
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

// 带超时的 fetch（Workers 里用 AbortController）
async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) return errJson('缺少参数: url', 400);

  let parsedTarget;
  try {
    parsedTarget = new URL(target);
  } catch (_) {
    return errJson('URL 格式无效，请输入完整的 http(s):// 链接', 400);
  }
  if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
    return errJson('仅支持 http / https 协议的链接', 400);
  }

  const chain = []; // 跳转链 [{url, status, via}]
  let currentUrl = parsedTarget.href;
  let hops = 0;

  try {
    while (hops < MAX_RECURSION) {
      hops++;

      // 优先用 redirect: 'follow' 让 fetch 自动跟 HTTP 30x
      const resp = await fetchWithTimeout(currentUrl, {
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      });

      const finalAfterHttp = resp.url; // fetch follow 之后的最终URL
      const via = finalAfterHttp !== currentUrl ? 'HTTP-redirect' : 'direct';
      if (finalAfterHttp !== currentUrl) {
        chain.push({ url: currentUrl, status: resp.status, via });
      }
      chain.push({ url: finalAfterHttp, status: resp.status, via });
      currentUrl = finalAfterHttp;

      // 如果 Content-Type 不是 HTML，就到这里结束
      const ct = resp.headers.get('content-type') || '';
      const isHtml = /text\/html|application\/xhtml\+xml/i.test(ct);
      if (!isHtml) break;

      const html = await resp.text();

      // 从 HTML 里找进一步的跳转
      const candidates = extractJumpUrls(html, currentUrl);

      // 过滤：不要自己跳自己
      const nextCandidates = candidates.filter((u) => {
        try {
          return new URL(u).href !== new URL(currentUrl).href;
        } catch (_) {
          return false;
        }
      });

      if (nextCandidates.length === 0) break;

      // 挑选最优候选：
      // 优先选 非当前域名 / 包含 item / id= 等明显参数的链接
      const curHost = new URL(currentUrl).hostname;
      const scored = nextCandidates.map((u) => {
        const p = new URL(u);
        let score = 0;
        if (p.hostname !== curHost) score += 10;
        if (/[?&](id|itemId|activity_id|skuId|goods_id|product_id|page_url|go)=/i.test(p.search)) score += 8;
        if (/\.(taobao|tmall|jd|pinduoduo|yangkeduo|suning|vip)\.com/i.test(p.hostname)) score += 5;
        if (p.searchParams.size > 0) score += 2;
        return { u, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const next = scored[0].u;

      // 避免死循环：跳转链里已经有这个URL就停
      if (chain.some((c) => c.url === next)) break;

      chain.push({ url: currentUrl, status: 200, via: 'HTML-parse' });
      currentUrl = next;
    }

    // 解析最终 URL 的 query 参数
    let finalParams = {};
    try {
      const fu = new URL(currentUrl);
      for (const [k, v] of fu.searchParams.entries()) {
        finalParams[k] = v;
      }
    } catch (_) {}

    return okJson({
      ok: true,
      finalUrl: currentUrl,
      chain,
      params: finalParams,
      hops,
    });
  } catch (e) {
    const msg = e.name === 'AbortError'
      ? '请求超时，短链服务器响应过慢'
      : (e.message || '未知错误');
    return errJson(`展开失败: ${msg}`, 500);
  }
}
