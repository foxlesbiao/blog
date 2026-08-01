import { defineConfig } from "astro/config";
import svelte from "@astrojs/svelte";
import sitemap from "@astrojs/sitemap";
import pagefind from "astro-pagefind";
import rehypeExternalLinks from "rehype-external-links";

export default defineConfig({
  site: "https://foxlesbiao.github.io",
  base: "/blog",
  trailingSlash: "always",
  integrations: [svelte(), sitemap(), pagefind()],
  markdown: {
    rehypePlugins: [
      [rehypeExternalLinks, { target: "_blank", rel: ["noopener", "noreferrer"] }],
    ],
    shikiConfig: {
      theme: "vitesse-dark",
      wrap: false,
    },
  },
  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          api: "modern-compiler",
        },
      },
    },
  },
});