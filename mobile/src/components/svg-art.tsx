// Renders the SVG markup the shared chart module draws (cars, price history), with the
// website's CSS for those classes, so the pictures match the site exactly.
import { useMemo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { SvgCss } from 'react-native-svg/css';

import type { Palette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const CAR_CSS = `
.car-shadow { fill: rgba(0,0,0,.14); }
.car-body { stroke: rgba(0,0,0,.28); stroke-width: .8; }
.car-glass { fill: #1f2937; opacity: .82; }
.car-shine { fill: none; stroke: rgba(255,255,255,.35); stroke-width: .6; }
.car-tire { fill: #1c1f24; }
.car-rim { fill: #c4c9cf; stroke: #6b7280; stroke-width: 1.4; }
.car-lamp { fill: #eef3ff; stroke: rgba(0,0,0,.25); stroke-width: .6; }
.car-grille { fill: #1f2328; }
.car-bumper { fill: rgba(0,0,0,.22); }
.car-mirror { stroke: rgba(0,0,0,.25); stroke-width: .6; }
.car-well { fill: #0b0d11; }
.car-spoke { fill: #e5e7eb; }
.car-hub { fill: #9ca3af; stroke: #4b5563; stroke-width: 1.2; }
`;

const chartCss = (c: Palette) => `
.grid { stroke: ${c.border}; stroke-width: 1; }
.tick { fill: ${c.muted}; font-size: 11px; }
.hist-line { fill: none; stroke: ${c.accent}; stroke-width: 2.5; }
.hist-area { fill: ${c.accent}; fill-opacity: .12; }
.hist-pt { fill: ${c.surface}; stroke: ${c.accent}; stroke-width: 2; }
.last { fill: ${c.accent}; }
`;

// SvgCss can't parse <title> tooltips or ARIA attributes, so drop them.
const clean = (xml: string) => xml.replace(/<title>[\s\S]*?<\/title>/g, '').replace(/\s(role|aria-label)="[^"]*"/g, '');

export function SvgArt({ xml, style, aspect }: { xml: string; style?: StyleProp<ViewStyle>; aspect: number }) {
  const c = useTheme();
  const markup = useMemo(() => {
    const css = `<style>${CAR_CSS}${chartCss(c)}</style>`;
    return clean(xml).replace(/^<svg([^>]*)>/, `<svg$1>${css}`);
  }, [xml, c]);
  return <SvgCss xml={markup} width="100%" height="100%" style={[{ aspectRatio: aspect, width: '100%' }, style]} />;
}
