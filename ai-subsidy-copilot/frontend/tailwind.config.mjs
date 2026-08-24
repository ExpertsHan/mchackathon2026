/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#102A43",
        navy: {
          50: "#EEF4F8",
          100: "#D9E6F0",
          600: "#1D527D",
          700: "#173F61",
          800: "#12344F",
          900: "#0B2942",
        },
        teal: {
          50: "#E7F7F6",
          100: "#C8EEEB",
          600: "#087F7A",
          700: "#056B67",
          800: "#075955",
        },
        cloud: "#F5F8FA",
        line: "#D9E2EC",
        gold: "#C88A16",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,42,67,.04), 0 10px 28px rgba(16,42,67,.07)",
        float: "0 18px 60px rgba(16,42,67,.16)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseDot: {
          "0%, 100%": { opacity: ".35" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "fade-up": "fadeUp .35s ease-out both",
        "pulse-dot": "pulseDot 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
