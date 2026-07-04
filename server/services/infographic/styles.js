/**
 * Infographic style presets — short prompt fragments that describe the
 * visual direction. Used as part of the gpt-image-2 prompt.
 *
 * Add new presets here; the client UI auto-picks them up via
 * /api/infographic/styles.
 */
export const STYLES = {
  business: {
    label: 'ビジネス',
    description: 'プロフェッショナル・整然とした構成',
    prompt: [
      'Clean professional business infographic',
      'crisp typography (sans-serif)',
      'structured grid layout with clear section dividers',
      'simple geometric icons and subtle data-style decorations (charts, arrows, badges)',
      'color palette: navy blue, white, and a single gold or teal accent',
      'sophisticated and trustworthy feel suitable for corporate reports',
    ].join(', '),
  },

  pop: {
    label: 'ポップ・SNS映え',
    description: 'カラフルで明るい、SNS向け',
    prompt: [
      'Vibrant social-media friendly infographic',
      'bold and energetic',
      'rounded chunky icons, hand-drawn touches, playful shapes',
      'large bold typography',
      'color palette: bright multi-color (coral, yellow, mint, sky blue) with high contrast',
      'fun and approachable, suitable for Instagram or TikTok thumbnails',
    ].join(', '),
  },

  natural: {
    label: 'ナチュラル・あたたかみ',
    description: '柔らかい・植物モチーフ・キャラクター映え',
    prompt: [
      'Soft natural infographic with botanical and plant motifs',
      'gentle hand-drawn touches',
      'friendly mascot character (cute, charming, well-suited to inspirational content)',
      'rounded organic shapes, leaf and flower decorations',
      'color palette: muted sage green, warm beige, cream, soft brown',
      'warm and inviting feel, suitable for community / wellness / education content',
    ].join(', '),
  },

  minimal: {
    label: 'ミニマル・雑誌風',
    description: '洗練・余白多め・モノトーン',
    prompt: [
      'Editorial minimalist infographic',
      'lots of white space',
      'refined sophisticated typography (mix of serif and sans-serif)',
      'thin elegant lines and small accent shapes',
      'monochrome base (black + dark gray + white) with one bold accent color (red or yellow ochre)',
      'high-end magazine aesthetic, suitable for premium long-form content',
    ].join(', '),
  },
};

export function getStyle(name) {
  return STYLES[name] || null;
}

export function listStyles() {
  return Object.entries(STYLES).map(([key, s]) => ({
    key,
    label: s.label,
    description: s.description,
  }));
}
