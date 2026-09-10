// Cloudflare Pages Functions: /api/ban-custom
// 自定义禁拍数据管理（基于 KV）
//
// GET    → 返回自定义禁拍列表（公开，不鉴权）
// POST   → 添加一条（需密码，Authorization header）
// DELETE → 删除一条（需密码，Authorization header）

const KV_KEY = 'list';
const DEFAULT_PASSWORD = '123';

function okJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
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

async function readList(kv) {
  const raw = await kv.get(KV_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeList(kv, list) {
  await kv.put(KV_KEY, JSON.stringify(list));
}

function verifyPassword(request, env) {
  const expected = env.BAN_WRITE_PASSWORD || DEFAULT_PASSWORD;
  const auth = request.headers.get('Authorization');
  if (!auth) return false;
  // 支持两种格式：Bearer <pwd> 或直接 <pwd>
  const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim();
  return provided === expected;
}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.BAN_CUSTOM;
  if (!kv) return errJson('KV namespace 未绑定，请在 Cloudflare Pages 设置中绑定 BAN_CUSTOM', 500);

  const url = new URL(request.url);
  // 处理 CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    if (request.method === 'GET') {
      // 公开读取
      const list = await readList(kv);
      return okJson({ ok: true, list });
    }

    if (request.method === 'POST') {
      if (!verifyPassword(request, env)) return errJson('密码错误', 401);
      let body;
      try { body = await request.json(); } catch { return errJson('请求体需为 JSON'); }
      const text = (body.text || '').trim();
      if (!text) return errJson('店铺名不能为空');
      if (text.length > 200) return errJson('店铺名过长（最多 200 字）');

      const list = await readList(kv);
      if (list.includes(text)) return errJson('该条目已存在');
      list.push(text);
      await writeList(kv, list);
      return okJson({ ok: true, list, added: text });
    }

    if (request.method === 'DELETE') {
      if (!verifyPassword(request, env)) return errJson('密码错误', 401);
      let body;
      try { body = await request.json(); } catch { return errJson('请求体需为 JSON'); }
      const text = (body.text || '').trim();
      if (!text) return errJson('店铺名不能为空');

      const list = await readList(kv);
      const idx = list.indexOf(text);
      if (idx === -1) return errJson('该条目不存在');
      list.splice(idx, 1);
      await writeList(kv, list);
      return okJson({ ok: true, list, removed: text });
    }

    return errJson('不支持的方法', 405);
  } catch (e) {
    return errJson('服务器错误：' + (e.message || e), 500);
  }
}
