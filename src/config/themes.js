const colors = require('./colors');

const themes = {
  'dark-obsidian': {
    id: 'dark-obsidian',
    name: 'OLED Obsidian Glass',
    description: 'Deep pitch black with radiant neon specular highlights and rich frosted glass blur',
    isDefault: true,
    tokens: {
      '--bg': colors.backgrounds.base,
      '--bg-surface': colors.backgrounds.surface,
      '--bg-surface-elevated': colors.backgrounds.surfaceElevated,
      '--accent': colors.accents.primary,
      '--accent2': colors.accents.secondary,
      '--accent-glow': colors.accents.primaryGlow,
      '--accent-gradient': colors.gradients.fireBrand,
      '--glass-border': colors.glass.border,
      '--glass-border-light': colors.glass.borderLight,
      '--glass-specular': colors.glass.specular,
      '--text-main': colors.text.primary,
      '--text-muted': colors.text.muted,
      '--text-dim': colors.text.dim
    }
  },
  'violet-nebula': {
    id: 'violet-nebula',
    name: 'Violet Nebula',
    description: 'Cosmic purple glow with electric lilac highlights',
    isDefault: false,
    tokens: {
      '--bg': '#090712',
      '--bg-surface': 'rgba(28, 22, 42, 0.65)',
      '--bg-surface-elevated': 'rgba(38, 30, 58, 0.75)',
      '--accent': '#a855f7',
      '--accent2': '#ec4899',
      '--accent-glow': 'rgba(168, 85, 247, 0.35)',
      '--accent-gradient': 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)',
      '--glass-border': 'rgba(216, 180, 254, 0.15)',
      '--glass-border-light': 'rgba(216, 180, 254, 0.28)',
      '--glass-specular': 'inset 0 1px 1px 0 rgba(255, 255, 255, 0.3)',
      '--text-main': '#fcfaff',
      '--text-muted': '#a79cb8',
      '--text-dim': '#6b5f80'
    }
  },
  'cyber-emerald': {
    id: 'cyber-emerald',
    name: 'Cyber Emerald',
    description: 'Matrix-infused deep jade with pristine glass finish',
    isDefault: false,
    tokens: {
      '--bg': '#050c09',
      '--bg-surface': 'rgba(15, 32, 25, 0.65)',
      '--bg-surface-elevated': 'rgba(20, 44, 34, 0.75)',
      '--accent': '#10b981',
      '--accent2': '#06b6d4',
      '--accent-glow': 'rgba(16, 185, 129, 0.35)',
      '--accent-gradient': 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
      '--glass-border': 'rgba(110, 231, 183, 0.15)',
      '--glass-border-light': 'rgba(110, 231, 183, 0.28)',
      '--glass-specular': 'inset 0 1px 1px 0 rgba(255, 255, 255, 0.3)',
      '--text-main': '#f0fdf4',
      '--text-muted': '#86a896',
      '--text-dim': '#4b6e5b'
    }
  }
};

module.exports = themes;

