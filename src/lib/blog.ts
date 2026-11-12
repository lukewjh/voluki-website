import { getEnv } from "./env";
import { contentEdgeCache } from "./blogCache";
import { parseBlogPost, publicBlogPosts } from "./blogMarkdown";
import { createGithubBlogClient, githubBlogConfig } from "./githubBlog";

const github = createGithubBlogClient();
const localPosts = import.meta.env.DEV
  ? import.meta.glob<string>("../content/blog/*.md", { query: "?raw", import: "default", eager: true })
  : {};

export function useLocalBlog(locals: unknown) {
  return import.meta.env.DEV && getEnv(locals, "BLOG_SOURCE") !== "github";
}

export async function getBlog(context: { locals: unknown; url: URL }) {
  if (useLocalBlog(context.locals)) {
    return {
      revision: "local", stale: false, media: {} as Record<string, string>,
      posts: publicBlogPosts(Object.entries(localPosts).map(([path, source]) =>
        parseBlogPost(path.replace("../content/blog/", "src/content/blog/"), source)))
    };
  }
  return github.snapshot(githubBlogConfig(context.locals), context.url.origin, contentEdgeCache());
}

export async function getBlogImage(context: { locals: unknown; url: URL }, path: string, sha: string) {
  return github.image(githubBlogConfig(context.locals), context.url.origin, path, sha, contentEdgeCache());
}
