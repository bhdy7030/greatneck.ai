import type { Config } from "tailwindcss";

function cssVar(name: string) {
  return `rgb(var(${name}) / <alpha-value>)`;
}

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          50:  cssVar("--color-surface-50"),
          100: cssVar("--color-surface-100"),
          200: cssVar("--color-surface-200"),
          300: cssVar("--color-surface-300"),
          400: cssVar("--color-surface-400"),
        },
        text: {
          900: cssVar("--color-text-900"),
          800: cssVar("--color-text-800"),
          700: cssVar("--color-text-700"),
          600: cssVar("--color-text-600"),
          500: cssVar("--color-text-500"),
        },
        sage: {
          DEFAULT: cssVar("--color-sage"),
          light:   cssVar("--color-sage-light"),
          dark:    cssVar("--color-sage-dark"),
          muted:   "rgb(var(--color-sage) / 0.125)",
        },
        gold: {
          DEFAULT: cssVar("--color-gold"),
          light:   cssVar("--color-gold-light"),
          dark:    cssVar("--color-gold-dark"),
        },
      },
    },
  },
  plugins: [],
};

export default config;
