/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F8FAF7",
        surface: "#FFFFFF",
        ink: { DEFAULT: "#142B31", soft: "#3E5559", muted: "#5E6F73" },
        line: "#DFE8E4",
        accent: { DEFAULT: "#176E62", hover: "#10584F", soft: "#E8F5F0", ink: "#0F4F46" },
        deep: { DEFAULT: "#163E37", hover: "#0E5549" },
        mint: { DEFAULT: "#E8F5F0", strong: "#DFF3E9", border: "#CEE5D9" },
        success: { DEFAULT: "#15803D", soft: "#ECFDF3" },
        warning: { DEFAULT: "#B45309", soft: "#FFF7E6" },
        danger: { DEFAULT: "#B42318", soft: "#FEF3F2" },
      },
      fontFamily: {
        sans: ["Inter Variable", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,43,49,0.04), 0 1px 3px rgba(20,43,49,0.05)",
        float: "0 24px 72px rgba(23,50,45,0.09)",
        soft: "0 14px 45px rgba(28,71,58,0.08)",
        cta: "0 8px 20px rgba(10,83,70,0.12)",
      },
      maxWidth: { content: "72rem" },
    },
  },
  plugins: [],
};
