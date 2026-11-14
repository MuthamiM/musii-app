/**
 * BitChord Color Palettes & Gradient Presets
 * Optimized for OLED blacks and Frosted Liquid Glassmorphism
 */
const colors = {
  backgrounds: {
    base: '#07070a',
    elevated: '#111118',
    surface: 'rgba(22, 22, 30, 0.65)',
    surfaceElevated: 'rgba(30, 30, 42, 0.75)',
    overlay: 'rgba(0, 0, 0, 0.75)'
  },
  accents: {
    primary: '#ff4767',
    primaryGlow: 'rgba(255, 71, 103, 0.35)',
    secondary: '#ff8533',
    violet: '#8b5cf6',
    cyan: '#06b6d4',
    amber: '#f59e0b',
    emerald: '#10b981'
  },
  text: {
    primary: '#fcfcff',
    secondary: 'rgba(255, 255, 255, 0.75)',
    muted: '#8e8e9f',
    dim: '#5c5c6e'
  },
  glass: {
    border: 'rgba(255, 255, 255, 0.12)',
    borderLight: 'rgba(255, 255, 255, 0.22)',
    specular: 'inset 0 1px 1px 0 rgba(255, 255, 255, 0.28)',
    shadow: '0 20px 48px -10px rgba(0, 0, 0, 0.75)',
    blur: 'blur(28px) saturate(180%)'
  },
  gradients: {
    crimson: 'linear-gradient(135deg, #f43f5e 0%, #be123c 100%)',
    violet: 'linear-gradient(135deg, #8b5cf6 0%, #581c87 100%)',
    amber: 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)',
    cyan: 'linear-gradient(135deg, #06b6d4 0%, #0e7490 100%)',
    magenta: 'linear-gradient(135deg, #ec4899 0%, #9d174d 100%)',
    emerald: 'linear-gradient(135deg, #10b981 0%, #065f46 100%)',
    fireBrand: 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 50%, #ff8533 100%)'
  }
};

module.exports = colors;

