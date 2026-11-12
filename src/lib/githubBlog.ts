import { getEnv } from "./env";
import { createBlogCache } from "./blogCache";
import { parseBlogPost, publicBlogPosts, type BlogPost } from "./blogMarkdown";
import { blogSchema } from "./blogSchema";
import { limitedBody, requestGithubContent, type GithubContentConfig } from "./githubContent";

export const blogContentPrefix = "src/content/blog/";
export const blogMediaPrefix = "public/content_imgs/";
const imageTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif"
};

export type GithubBlogConfig = GithubContentConfig;
export type BlogSnapshot = { revision: string; posts: BlogPost[]; media: Record<string, string> };
type TreeEntry = { path: string; sha: string; type: string; mode: string };

export function githubBlogConfig(locals: unknown): GithubBlogConfig {
  const repo = String(getEnv(locals, "BLOG_GITHUB_REPO") ?? "lukewjh/voluki-website").trim();
  const branch = String(getEnv(locals, "BLOG_GITHUB_BRANCH") ?? "main").trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !branch || branch.length > 200 || /[\x00-\x1f\x7f]/.test(branch)) {
    throw new Error("Invalid blog repository configuration.");
  }
  return { repo, branch, token: getEnv(locals, "BLOG_GITHUB_TOKEN") || undefined };
}

export function isBlogMediaPath(path: string) {
  return Boolean(path) && !/[\\\x00-\x1f\x7f?#%]/.test(path)
    && path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
    && Object.hasOwn(imageTypes, path.split(".").pop()!.toLowerCase());
}

function decodeSnapshot(value: BlogSnapshot): BlogSnapshot {
  return { ...value, posts: value.posts.map((post) => ({ ...post, data: blogSchema.parse(post.data) })) };
}

export function createGithubBlogClient(fetcher: typeof fetch = fetch, cache = createBlogCache()) {
  const cacheKey = (origin: string, config: GithubBlogConfig, resource: string) =>
    new URL(`/__voluki-blog-cache/v1/${encodeURIComponent(config.repo)}/${encodeURIComponent(config.branch)}/${resource}`, origin).href;

  const upstream = (config: GithubBlogConfig, path: string, signal: AbortSignal, raw = false) =>
    requestGithubContent(fetcher, config, path, signal, { raw, userAgent: "Voluki-Blog" });

  return {
    async snapshot(config: GithubBlogConfig, origin: string, edge?: Cache) {
      const result = await cache.get(cacheKey(origin, config, "snapshot"), async (previous) => {
        const old = previous ? decodeSnapshot(await previous.json()) : undefined;
        const signal = AbortSignal.timeout(10000);
        const treeResponse = await upstream(config, `git/trees/${encodeURIComponent(config.branch)}?recursive=1`, signal);
        const tree = JSON.parse(new TextDecoder().decode(await limitedBody(treeResponse, 8 * 1024 * 1024)));
        if (!Array.isArray(tree.tree) || tree.truncated || typeof tree.sha !== "string") throw new Error("Incomplete GitHub content tree.");
        const entries: TreeEntry[] = tree.tree.filter((entry: TreeEntry) =>
          entry.type === "blob" && ["100644", "100755"].includes(entry.mode)
          && typeof entry.path === "string" && /^[a-f\d]{40}$/i.test(entry.sha));
        const files = entries.filter((entry) => entry.path.startsWith(blogContentPrefix)
          && /^[^/]+\.md$/i.test(entry.path.slice(blogContentPrefix.length)));
        if (files.length > 500) throw new Error("Too many blog posts.");
        const reusable = new Map(old?.posts.map((post) => [`${post.path}:${post.sha}`, post]));
        const posts: BlogPost[] = [];
        let renderedSize = 0;
        // Limit concurrent fetches so a large initial import stays within Worker limits.
        for (let index = 0; index < files.length; index += 4) {
          const batch = await Promise.all(files.slice(index, index + 4).map(async (file) => {
            const reused = reusable.get(`${file.path}:${file.sha}`);
            if (reused) return reused;
            const response = await upstream(config, `git/blobs/${file.sha}`, signal, true);
            const source = new TextDecoder().decode(await limitedBody(response, 256 * 1024));
            try { return parseBlogPost(file.path, source, file.sha); }
            catch { console.warn(`Skipping invalid blog post: ${file.path}`); return null; }
          }));
          for (const post of batch) {
            if (!post || post.data.draft) continue;
            renderedSize += post.html.length;
            if (renderedSize > 2 * 1024 * 1024) throw new Error("Blog snapshot is too large.");
            posts.push(post);
          }
        }
        const media = Object.fromEntries(entries.filter((entry) => entry.path.startsWith(blogMediaPrefix)
          && isBlogMediaPath(entry.path.slice(blogMediaPrefix.length)))
          .map((entry) => [entry.path.slice(blogMediaPrefix.length), entry.sha]));
        return Response.json({ revision: tree.sha, posts: publicBlogPosts(posts), media });
      }, edge);
      return { ...decodeSnapshot(await result.response.json()), stale: result.stale };
    },

    async image(config: GithubBlogConfig, origin: string, path: string, sha: string, edge?: Cache) {
      if (!isBlogMediaPath(path) || !/^[a-f\d]{40}$/i.test(sha)) throw new Error("Invalid blog image.");
      const extension = path.split(".").pop()!.toLowerCase();
      const result = await cache.get(cacheKey(origin, config, `image/${sha}/${extension}`), async () => {
        const response = await upstream(config, `git/blobs/${sha}`, AbortSignal.timeout(10000), true);
        const bytes = await limitedBody(response, 8 * 1024 * 1024);
        return new Response(bytes, { headers: { "Content-Type": imageTypes[extension] } });
      }, edge, { freshSeconds: 604800, retainSeconds: 604800 });
      return result.response;
    }
  };
}
