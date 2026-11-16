/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "#E4DED6",
        input: "#E4DED6",
        ring: "#C87137",
        background: "#F5F3EF",
        foreground: "#1A1A1A",
        primary: {
          DEFAULT: "#C87137",
          foreground: "#FFFFFF",
        },
        secondary: {
          DEFAULT: "#EFEAE3",
          foreground: "#1A1A1A",
        },
        destructive: {
          DEFAULT: "#A94438",
          foreground: "#FFFFFF",
        },
        muted: {
          DEFAULT: "#EFEAE3",
          foreground: "#6B6560",
        },
        accent: {
          DEFAULT: "#C87137",
          foreground: "#FFFFFF",
        },
        popover: {
          DEFAULT: "#FFFFFF",
          foreground: "#1A1A1A",
        },
        card: {
          DEFAULT: "#FFFFFF",
          foreground: "#1A1A1A",
        },
        surface: "#FBF9F6",
        success: "#4F7A5A",
        warning: "#B8862F",
      },
      borderRadius: {
        lg: "0.5rem",
        md: "0.375rem",
        sm: "0.25rem",
      },
      fontFamily: {
        sans: ["Noto Sans SC", "PingFang SC", "system-ui", "sans-serif"],
        serif: ["Noto Serif SC", "Songti SC", "serif"],
        mono: ["SFMono-Regular", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 2px 12px rgba(0,0,0,0.06)",
        "card-hover": "0 6px 20px rgba(0,0,0,0.08)",
      },
    },
  },
  plugins: [],
}
