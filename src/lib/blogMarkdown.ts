import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import { parse } from "yaml";
import GithubSlugger, { slug as githubSlug } from "github-slugger";
import hljs from "highlight.js/lib/common";
import { blogSchema, type BlogMetadata } from "./blogSchema";

export type BlogPost = {
  path: string;
  sha: string;
  slug: string;
  data: BlogMetadata;
  html: string;
};

export function blogImageUrl(src: string) {
  return src.startsWith("/content_imgs/") ? src.replace("/content_imgs/", "/blog-media/") : src;
}

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  langPrefix: "hljs language-",
  highlight(code, language) {
    return language && hljs.getLanguage(language)
      ? hljs.highlight(code, { language, ignoreIllegals: true }).value
      : "";
  }
});

markdown.renderer.rules.heading_open = (tokens, index, options, env, renderer) => {
  const text = tokens[index + 1]?.children
    ?.filter((token) => token.type === "text" || token.type === "code_inline")
    .map((token) => token.content).join("") ?? "";
  tokens[index].attrSet("id", env.headingSlugger.slug(text));
  return renderer.renderToken(tokens, index, options);
};

export function renderBlogMarkdown(body: string) {
  return sanitizeHtml(markdown.render(body, { headingSlugger: new GithubSlugger() }), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "del"],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading", "decoding", "style"],
      p: ["align"],
      h1: ["id"], h2: ["id"], h3: ["id"], h4: ["id"], h5: ["id"], h6: ["id"],
      code: ["class"], span: ["class"], th: ["align"], td: ["align"]
    },
    allowedClasses: { code: ["hljs", /^language-/], span: [/^hljs-/] },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    allowedStyles: {
      img: {
        width: [/^\d+(?:\.\d+)?(?:px|%|em|rem)$/],
        "max-width": [/^\d+(?:\.\d+)?(?:px|%|em|rem)$/],
        height: [/^\d+(?:\.\d+)?(?:px|%|em|rem)$/, /^auto$/],
        "border-radius": [/^\d+(?:\.\d+)?px$/]
      }
    },
    transformTags: {
      img: (_tag, attributes) => ({
        tagName: "img",
        attribs: { ...attributes, src: blogImageUrl(attributes.src ?? ""), loading: "lazy", decoding: "async" }
      }),
      a: (_tag, attributes) => ({
        tagName: "a",
        attribs: { ...attributes, ...(attributes.target === "_blank" ? { rel: "noopener noreferrer" } : {}) }
      })
    }
  });
}

export function parseBlogPost(path: string, source: string, sha = "local"): BlogPost {
  if (new TextEncoder().encode(source).byteLength > 256 * 1024) throw new Error("Blog post is too large.");
  const match = source.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error("Missing YAML frontmatter.");
  const data = blogSchema.parse(parse(match[1], { maxAliasCount: 20 }));
  const filename = path.split("/").pop()!.replace(/\.md$/i, "");
  const slug = githubSlug(filename);
  if (!slug || slug === "." || slug === "..") throw new Error("Invalid blog filename.");
  return { path, sha, slug, data, html: data.draft ? "" : renderBlogMarkdown(match[2]) };
}

export function publicBlogPosts(posts: BlogPost[]) {
  const visible = posts.filter((post) => !post.data.draft);
  if (new Set(visible.map((post) => post.slug)).size !== visible.length) throw new Error("Duplicate blog URLs.");
  return visible.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf() || a.slug.localeCompare(b.slug));
}
