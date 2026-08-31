/**
 * Territory swatches.
 *
 * One palette drives both the map rectangle and the sidebar entry, so a box is
 * recognisable in either place without a second lookup. Hues are spaced far
 * enough apart to stay distinguishable at rectangle size, and each carries its
 * own dark-theme variant because a stroke that reads well on light tiles
 * disappears on inverted ones.
 */
export interface TerritoryColor {
  key: string;
  label: string;
  /** Stroke and accent in light theme. */
  light: string;
  /** Stroke and accent in dark theme. */
  dark: string;
}

export const TERRITORY_COLORS: TerritoryColor[] = [
  { key: 'cobalt', label: 'Cobalt', light: '#1F5FD0', dark: '#6098F7' },
  { key: 'teal', label: 'Teal', light: '#0F7B76', dark: '#3FBDB4' },
  { key: 'green', label: 'Green', light: '#2C7A39', dark: '#5CBF6C' },
  { key: 'amber', label: 'Amber', light: '#A8720C', dark: '#E0A93F' },
  { key: 'orange', label: 'Orange', light: '#B4551F', dark: '#EE8A4E' },
  { key: 'red', label: 'Red', light: '#B23A34', dark: '#EE7A72' },
  { key: 'violet', label: 'Violet', light: '#6B44C4', dark: '#A487F0' },
  { key: 'slate', label: 'Slate', light: '#55636F', dark: '#93A2B0' },
];

export const DEFAULT_TERRITORY_COLOR = 'cobalt';

export function territoryColor(key: string | undefined): TerritoryColor {
  return (
    TERRITORY_COLORS.find((c) => c.key === key) ??
    TERRITORY_COLORS.find((c) => c.key === DEFAULT_TERRITORY_COLOR)!
  );
}

/** The hex to actually paint, for the theme in play. */
export function territoryHex(key: string | undefined, theme: 'light' | 'dark'): string {
  const c = territoryColor(key);
  return theme === 'dark' ? c.dark : c.light;
}
