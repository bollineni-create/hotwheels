import { router } from 'expo-router';
import { useState } from 'react';
import { TextInput } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

// Type a whole search in plain words; the Search tab turns it into filters.
export function SearchBox({ initial = '' }: { initial?: string }) {
  const c = useTheme();
  const [q, setQ] = useState(initial);
  return (
    <TextInput
      value={q}
      onChangeText={setQ}
      placeholder="Try “white 4runner with tow package”"
      placeholderTextColor={c.muted}
      returnKeyType="search"
      autoCorrect={false}
      onSubmitEditing={() => router.push({ pathname: '/search', params: { q: q.trim() } })}
      style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 13, fontSize: 16, color: c.text }}
    />
  );
}
