/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: {
          950: '#0A0D12',
          900: '#0F131A',
          850: '#131826',
          800: '#171D2C',
          700: '#232A3D',
          600: '#323B52',
        },
        ink: {
          100: '#EDEFF5',
          300: '#B9C0D4',
          500: '#7B84A0',
          700: '#525A72',
        },
        signal: {
          queued: '#E8A83C',
          scheduled: '#4E8FF0',
          running: '#33C27F',
          failed: '#E5546A',
          dead: '#8B4B9C',
          idle: '#3A4258',
        },
      },
      fontFamily: {
        display: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        panel: '0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
};
