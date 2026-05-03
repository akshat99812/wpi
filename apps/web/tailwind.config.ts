import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0b0f19",
        panel: "#131826",
        border: "#27324a",
        text: "#e8ecf4",
        muted: "#9aa4ba",
        orange: "#ff8a1f",
        success: "#4cc87a",
        link: "#58a6ff",
      },
    },
  },
  plugins: [],
};
export default config;
