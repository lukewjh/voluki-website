import { defineCollection } from "astro:content";
import { blogSchema } from "../lib/blogSchema";

const blog = defineCollection({
  type: "content",
  schema: blogSchema
});

export const collections = { blog };
