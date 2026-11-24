import type { APIRoute } from "astro";

export const prerender = false;

const cookieName = "rio_eudic";
const path = "/api/rio/eudic";
const api = "https://api.frdic.com/api/open/v1/studylist/";
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

async function fetchList(token: string, resource: "category" | "words", params: URLSearchParams) {
  params.set("language", "en");
  try {
    const response = await fetch(api + resource + "?" + params, {
      headers: { Authorization: token, "User-Agent": "Voluki-RIO/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(20000)
    });
    if (response.status === 401) return json({ error: "欧路授权无效或已过期，请重新填写 API Key。" }, 401);
    if ([403, 429].includes(response.status)) return json({ error: "欧路暂时限制访问，请稍后再试。" }, 429);
    if (!response.ok) return json({ error: "欧路读取失败，请稍后重试。" }, 502);
    const body = await response.json() as { data?: Record<string, unknown>[] };
    if (!Array.isArray(body.data)) return json({ error: "欧路返回的数据格式有误。" }, 502);
    return body.data;
  } catch {
    return json({ error: "暂时无法连接欧路，请稍后再试。" }, 502);
  }
}

async function mappingScope(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function categories(token: string) {
  const rows = await fetchList(token, "category", new URLSearchParams());
  if (rows instanceof Response) return rows;
  return json({
    scope: await mappingScope(token),
    books: rows.filter((row) => row && (typeof row.id === "string" || Number.isSafeInteger(row.id)) && typeof row.name === "string")
      .map((row) => ({ id: String(row.id), name: row.name }))
  });
}

export const GET: APIRoute = async ({ cookies, url, request }) => {
  const token = cookies.get(cookieName)?.value;
  const book = url.searchParams.get("book");
  if (!token) return book === null ? json({ books: [], scope: null }) : json({ error: "请先连接欧路词典。" }, 401);
  if (book === null) return categories(token);
  if (request.headers.get("X-RIO-Scope") !== await mappingScope(token)) {
    return json({ error: "欧路账号已切换，请刷新页面。" }, 409);
  }
  const page = url.searchParams.get("page") ?? "0";
  if (!book || book.length > 100 || !/^\d{1,2}$/.test(page) || Number(page) > 50) {
    return json({ error: "生词本或页码无效。" }, 400);
  }
  const rows = await fetchList(token, "words", new URLSearchParams({
    category_id: book, page, page_size: "100", sort: "desc"
  }));
  if (rows instanceof Response) return rows;
  return json({
    words: rows.flatMap((row) => typeof row?.word === "string" && row.word.trim() ? [row.word.trim()] : []),
    hasMore: rows.length >= 100 && Number(page) < 50,
    atLimit: rows.length >= 100 && Number(page) === 50
  });
};

export const POST: APIRoute = async ({ request, cookies, url }) => {
  if (request.headers.get("Origin") !== url.origin || !request.headers.get("Content-Type")?.startsWith("application/json")) {
    return json({ error: "请从 RIO 页面配置欧路。" }, 403);
  }
  const body = await request.json().catch(() => null);
  const value = typeof body?.key === "string" ? body.key.trim() : "";
  const raw = value.replace(/^NIS\s+/i, "");
  if (!/^[!-~]{1,2048}$/.test(raw)) return json({ error: "请输入完整的欧路 API Key。" }, 400);
  const token = "NIS " + raw;
  const result = await categories(token);
  if (result.ok) cookies.set(cookieName, token, {
    path, httpOnly: true, secure: url.protocol === "https:", sameSite: "strict", maxAge: 60 * 60 * 24 * 30
  });
  return result;
};

export const DELETE: APIRoute = ({ request, cookies, url }) => {
  if (request.headers.get("Origin") !== url.origin) return json({ error: "请从 RIO 页面断开连接。" }, 403);
  cookies.delete(cookieName, { path });
  return json({ disconnected: true });
};
