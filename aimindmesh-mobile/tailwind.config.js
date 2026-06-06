/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        background: 'var(--color-background)',
        surface: 'var(--color-surface)',
        primary: 'var(--color-primary)',
        secondary: 'var(--color-secondary)',
        'bubble-user': 'var(--color-bubble-user)',
        'bubble-model': 'var(--color-bubble-model)',
        'input': 'var(--color-input)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        textPrimary: 'var(--color-text-primary)',
        textSecondary: 'var(--color-text-secondary)',
        'online': 'var(--color-online)',
      },
      backgroundImage: {
        // Atmospheric top-down glow
        'app-gradient': 'radial-gradient(circle at 50% -20%, var(--gradient-glow-color) 0%, var(--color-background) 60%)',
        'user-bubble-gradient': 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        }
      }
    },
  },
  plugins: [],
}