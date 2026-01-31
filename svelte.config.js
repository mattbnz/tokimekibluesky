import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Warnings to suppress in development (these clutter the console but are not critical)
const suppressedWarnings = [
  'a11y_consider_explicit_label',
  'state_referenced_locally',
  'node_invalid_placement_ssr',
];

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [
    vitePreprocess({
      postcss: true,
    }),
  ],

  // Filter out noisy warnings that clutter server logs
  // Set SVELTE_SHOW_ALL_WARNINGS=1 to see all warnings
  onwarn: (warning, handler) => {
    if (process.env.SVELTE_SHOW_ALL_WARNINGS === '1') {
      handler(warning);
      return;
    }
    if (suppressedWarnings.some(code => warning.code === code)) {
      return;
    }
    handler(warning);
  },

  kit: {
    adapter: adapter(),
  },

  plugins: {

  },
};

export default config;
