import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Dark premium design system
        background: '#0D1117',
        primary: '#0172ED',
        accent: '#51E8A6',
        card: 'rgba(255,255,255,0.12)',
        'card-border': 'rgba(1,114,237,0.45)',
        'card-glow': 'rgba(81,232,166,0.2)',
        // Text hierarchy
        'text-primary': '#ffffff',
        'text-secondary': 'rgba(255,255,255,0.7)',
        'text-tertiary': 'rgba(255,255,255,0.5)',
      },
      fontFamily: {
        sans: ['SF Pro', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #0172ED 0%, #51E8A6 100%)',
        'gradient-card': 'linear-gradient(180deg, rgba(1,114,237,0.1) 0%, rgba(81,232,166,0.1) 2px, transparent 2px)',
      },
      boxShadow: {
        'card': '0 0 0 1px rgba(1,114,237,0.2), 0 4px 16px rgba(0,0,0,0.4)',
        'card-hover': '0 0 0 1px rgba(81,232,166,0.4), 0 8px 32px rgba(0,0,0,0.5)',
        'glow': '0 0 20px rgba(1,114,237,0.3)',
        'glow-accent': '0 0 20px rgba(81,232,166,0.3)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.6s ease-out',
        'slide-out': 'slideOut 0.3s ease-in forwards',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite alternate',
        shine: 'shine 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideOut: {
          '0%': { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(100%)' },
        },
        glowPulse: {
          '0%': { boxShadow: '0 0 5px rgba(1,114,237,0.5)' },
          '100%': { boxShadow: '0 0 20px rgba(81,232,166,0.8)' },
        },
        shine: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
    },
  },
  plugins: [],
}

export default config