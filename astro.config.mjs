import { defineConfig } from "astro/config";
import svelte from "@astrojs/svelte";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import astroIcon from "astro-icon";
import rehypeExternalLinks from "rehype-external-links";

export default defineConfig({
  site: "https://foxlesbiao.github.io",
  base: "/blog",
  trailingSlash: "always",
  integrations: [svelte(), sitemap(), astroIcon()],
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
    plugins: [tailwindcss()],
    css: {
      preprocessorOptions: {
        scss: {
          api: "modern-compiler",
        },
      },
    },
  },
});