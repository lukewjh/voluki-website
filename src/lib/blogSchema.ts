import { z } from "astro/zod";

const optionalText = z.preprocess(
  (value) => value === "" || value === null ? undefined : value,
  z.string().trim().optional()
);

export const blogSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(2000),
  date: z.preprocess((value) => value === null || value === "" ? undefined : value, z.coerce.date()),
  updated: z.preprocess((value) => value === "" || value === null ? undefined : value, z.coerce.date().optional()),
  tags: z.preprocess((value) => value === null ? undefined : value, z.array(z.string()).default([])),
  category: optionalText,
  image: optionalText.refine((value) => !value || /^\/(?!\/)/.test(value) || /^https?:\/\//i.test(value), "Use a site path or HTTP(S) image URL."),
  imageAlt: optionalText,
  draft: z.boolean().default(false)
});

export type BlogMetadata = z.infer<typeof blogSchema>;
