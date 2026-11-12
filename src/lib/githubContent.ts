export interface GithubContentConfig {
  repo: string;
  branch: string;
  token?: string;
}

export async function requestGithubContent(
  fetcher: typeof fetch,
  config: GithubContentConfig,
  path: string,
  signal: AbortSignal,
  { raw = false, userAgent }: { raw?: boolean; userAgent: string }
) {
  const response = await fetcher(`https://api.github.com/repos/${config.repo}/${path}`, {
    headers: {
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "User-Agent": userAgent,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {})
    },
    // Reject redirects before a credential could be forwarded to a different origin.
    redirect: "manual", signal, cache: "no-store"
  });
  if (!response.ok) throw new Error(`GitHub content request failed (${response.status}).`);
  return response;
}

export async function limitedBody(response: Response, maxBytes: number) {
  if (Number(response.headers.get("Content-Length")) > maxBytes) throw new Error("GitHub content is too large.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty GitHub response.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("GitHub content is too large.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
