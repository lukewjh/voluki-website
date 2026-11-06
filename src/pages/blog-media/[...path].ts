import type { APIRoute } from "astro";
import { getBlog, getBlogImage, useLocalBlog } from "../../lib/blog";
import { isBlogMediaPath } from "../../lib/githubBlog";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const path = context.params.path ?? "";
  const plain = (message: string, status: number) => new Response(message, {
    status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
  });
  if (!isBlogMediaPath(path)) return plain("Not found", 404);
  if (useLocalBlog(context.locals)) {
    return new Response(null, { status: 302, headers: {
      Location: `/content_imgs/${path.split("/").map(encodeURIComponent).join("/")}`,
      "Cache-Control": "no-store"
    } });
  }
  try {
    const snapshot = await getBlog(context);
    const sha = Object.hasOwn(snapshot.media, path) ? snapshot.media[path] : undefined;
    if (!sha) return plain("Not found", 404);
    const image = await getBlogImage(context, path, sha);
    const headers = new Headers({
      "Content-Type": image.headers.get("Content-Type")!,
      // Only the source snapshot is cached for 60s; browser/CDN caches must not
      // add another 60s to updates or keep a withdrawn image visible indefinitely.
      "Cache-Control": "public, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ETag: `"${sha}"`
    });
    if (context.request.headers.get("If-None-Match") === `"${sha}"`) return new Response(null, { status: 304, headers });
    return new Response(image.body, { headers });
  } catch (error) {
    console.error("Blog image is temporarily unavailable:", error instanceof Error ? error.message : "Unknown error");
    return plain("Image temporarily unavailable", 503);
  }
};
