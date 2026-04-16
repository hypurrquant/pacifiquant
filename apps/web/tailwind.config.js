/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/shared/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/domains/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/core/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    screens: {
      sm: "390px",
      md: "768px",
      lg: "1024px",
      xl: "1920px",
    },
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      fontFamily: {
        sans: ["Inter", "Noto Sans", "sans-serif"],
      },
      colors: {
        white: "#F5FEFC",
        fcfcfc: "#fcfcfc",
        // Pacifiquant palette — cyan #5fd8ee 기준
        primary: "#5fd8ee",
        secondary: "#3FBED6",
        background: "#0b1114",
        accent: "#5fd8ee",
        "dark-navy": "#070c0f",
        "dark-800": "#101a1f",
        "dark-700": "#142126",
        "dark-600": "#1a2a30",
        surface: "#101a1f",
        elevated: "#142126",
        brand: {
          300: "#93E3F3",
          400: "#5fd8ee",
          DEFAULT: "#5fd8ee",
          500: "#3FBED6",
          600: "#2F9FB4",
          700: "#257E8E",
          900: "#144857",
        },
        yellow: {
          400: "#FDA839",
          500: "#E89420",
          600: "#C47D1A",
          700: "#9D6315",
          900: "#5E3B0D",
        },
        gray: {
          400: "#828D8A",
          500: "#A2A6B0",
        },
        lime: "#C9D26A",
        red: {
          400: "#E75775",
          500: "#D64466",
          600: "#B93558",
          700: "#962A48",
          900: "#5C1A2E",
        },
        "success-surface": "#102422",
        "danger-surface": "#241D24",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "float": "float 6s ease-in-out infinite",
        "glow": "glow 2s ease-in-out infinite alternate",
        "heat-shimmer": "heat-shimmer 3s linear infinite",
        "range-pulse": "range-pulse 2s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-20px)" },
        },
        glow: {
          "0%": { boxShadow: "0 0 20px rgba(95, 216, 238, 0.5)" },
          "100%": { boxShadow: "0 0 40px rgba(95, 216, 238, 0.8)" },
        },
        "heat-shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "range-pulse": {
          "0%, 100%": { boxShadow: "none" },
          "50%": { boxShadow: "var(--pulse-shadow)" },
        },
      },
    },
  },
  plugins: [require("tailwind-scrollbar-hide")],
};
