// Small building blocks shared by every screen, styled after the website's cards and pills.
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';

import { Radius, Spacing, type Palette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Tone } from '@/lib/gridline';

type Variant = 'title' | 'h2' | 'h3' | 'body' | 'small' | 'muted' | 'price' | 'eyebrow';

export function T({ v = 'body', style, ...rest }: TextProps & { v?: Variant }) {
  const c = useTheme();
  return <Text {...rest} style={[text(c)[v], style]} />;
}

const text = (c: Palette) =>
  StyleSheet.create({
    title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6, color: c.text },
    h2: { fontSize: 19, fontWeight: '700', letterSpacing: -0.3, color: c.text },
    h3: { fontSize: 16, fontWeight: '700', color: c.text },
    body: { fontSize: 15, color: c.text, lineHeight: 21 },
    small: { fontSize: 13, color: c.text2, lineHeight: 18 },
    muted: { fontSize: 13, color: c.muted, lineHeight: 18 },
    price: { fontSize: 20, fontWeight: '800', color: c.text, fontVariant: ['tabular-nums'] },
    eyebrow: { fontSize: 12, fontWeight: '700', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  });

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return <View style={[{ backgroundColor: c.surface, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius, padding: Spacing.lg, gap: Spacing.sm }, style]}>{children}</View>;
}

export function Section({ title, sub, children, right }: { title: string; sub?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ gap: Spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="h2">{title}</T>
          {sub ? <T v="muted">{sub}</T> : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

export const toneColor = (c: Palette, tone: Tone) => ({ great: c.dGreat, good: c.good, fair: c.muted, high: c.warn, over: c.dOver })[tone];

export function Badge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

export function Button({ label, onPress, kind = 'primary', disabled, style }: { label: string; onPress: () => void; kind?: 'primary' | 'ghost'; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : pressed ? 0.75 : 1 },
        primary ? { backgroundColor: c.ink } : { borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
        style,
      ]}>
      <Text style={{ color: primary ? c.onInk : c.text, fontWeight: '700', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

// A row of mutually exclusive choices, like the site's segmented controls.
export function Seg<V extends string | number>({ options, value, onChange, format }: { options: readonly V[]; value: V; onChange: (v: V) => void; format?: (v: V) => string }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.surface2, borderRadius: 999, padding: 3, alignSelf: 'flex-start' }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={String(o)} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(o)}
            style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: on ? c.surface : 'transparent' }}>
            <Text style={{ fontSize: 13, fontWeight: on ? '700' : '500', color: on ? c.text : c.text2 }}>{format ? format(o) : String(o)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, onPress, on }: { label: string; onPress: () => void; on?: boolean }) {
  const c = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ borderRadius: 999, borderWidth: 1, borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accentSoft : c.surface, paddingHorizontal: 12, paddingVertical: 7, opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ fontSize: 13, color: c.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Loading({ label }: { label: string }) {
  const c = useTheme();
  return (
    <View style={{ padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm }}>
      <ActivityIndicator color={c.accent} />
      <T v="muted">{label}</T>
    </View>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <Card>
      <T v="h3">Couldn’t load live data</T>
      <T v="small">{msg}</T>
    </Card>
  );
}

// A label/value row for spec lists and price breakdowns.
export function Row({ label, value, strong, valueStyle }: { label: string; value: string; strong?: boolean; valueStyle?: StyleProp<TextStyle> }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: 6, borderTopWidth: strong ? 1 : 0, borderTopColor: c.border }}>
      <T v={strong ? 'h3' : 'small'} style={{ flexShrink: 1 }}>{label}</T>
      <T v={strong ? 'h3' : 'body'} style={[{ fontVariant: ['tabular-nums'], fontWeight: strong ? '800' : '600' }, valueStyle]}>{value}</T>
    </View>
  );
}
