import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    category: z.string().optional(),
    image: z.string().url().optional(),
    imageAlt: z.string().optional(),
    draft: z.boolean().default(false)
  })
});

export const collections = { blog };
