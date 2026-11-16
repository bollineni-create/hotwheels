import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Pressable, Switch, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Button, Card, Row, Seg, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { emptyFilters, isLive, plural, runSearch, syncProvider } from '@/lib/gridline';
import { Geo, Live } from '@/lib/modules';
import { setPrefs, update, useAppState, type Source } from '@/lib/store';

const SOURCES = ['demo', 'autodev', 'visor'] as const;
const SOURCE_LABEL: Record<Source, string> = { demo: 'Demo', autodev: 'auto.dev', visor: 'Visor' };
const THEMES = ['system', 'light', 'dark'] as const;

export default function Settings() {
  const c = useTheme();
  const s = useAppState();
  const src = s.prefs.dataSource;
  const [key, setKey] = useState(src === 'demo' ? '' : Live.getKey(src) || '');
  const [zip, setZip] = useState(s.prefs.homeZip || '');
  const [testing, setTesting] = useState(false);

  const pickSource = (p: Source) => {
    setPrefs({ dataSource: p, sourceChosen: true });
    syncProvider();
    setKey(p === 'demo' ? '' : Live.getKey(p) || '');
  };
  const saveKey = () => {
    Live.setKey(key, src);
    update(() => {}); // re-render screens that depend on isLive()
    Alert.alert(key ? 'Key saved on this phone' : 'Key removed');
  };
  const test = async () => {
    setTesting(true);
    try {
      const r = await runSearch(emptyFilters());
      Alert.alert('Connected', `${Live.info().name} answered with ${plural(r.total, 'car')}.`);
    } catch (e) {
      Alert.alert('Couldn’t connect', e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };
  const info = src === 'demo' ? null : Live.info(src);
  const usage = src === 'demo' ? null : Live.usage(src);

  const input = { borderColor: c.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: c.text, backgroundColor: c.surface2 } as const;

  return (
    <Screen title="Settings">
      <Card>
        <T v="h2">Data source</T>
        <T v="small">The demo market works offline. For real listings, add a free auto.dev key or a Visor key; it stays on this phone.</T>
        <Seg options={SOURCES} value={src} onChange={pickSource} format={(p) => SOURCE_LABEL[p]} />
        {info ? (
          <View style={{ gap: Spacing.sm }}>
            <TextInput value={key} onChangeText={setKey} placeholder={`${info.name} API key`} placeholderTextColor={c.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry style={input} />
            <View style={{ flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' }}>
              <Button label="Save key" onPress={saveKey} />
              <Button kind="ghost" label={testing ? 'Testing…' : 'Test connection'} disabled={testing || !isLive()} onPress={test} />
              <Button kind="ghost" label="Get a key" onPress={() => WebBrowser.openBrowserAsync(info.keyUrl)} />
            </View>
            {usage ? <T v="muted">{`${plural(usage.calls, 'request')} this month${info.monthlyCalls ? ` of ${info.monthlyCalls} free` : ''}${usage.total ? ` · $${usage.total.toFixed(2)} spent` : ''}`}</T> : null}
            {!isLive() ? <T v="small" style={{ color: c.warn }}>No key yet, so the app still shows the demo market.</T> : null}
          </View>
        ) : null}
      </Card>

      <Card>
        <T v="h2">Your area</T>
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <TextInput value={zip} onChangeText={(t) => setZip(t.replace(/\D/g, '').slice(0, 5))} keyboardType="number-pad" placeholder="Home ZIP" placeholderTextColor={c.muted} style={[input, { flex: 1 }]} />
          <Button label="Save" onPress={() => {
            if (!zip) return setPrefs({ homeZip: null });
            if (!Geo.isZip(zip) || !Geo.lookup(zip)) return Alert.alert('Enter a 5-digit US ZIP code.');
            setPrefs({ homeZip: zip });
          }} />
        </View>
        {s.prefs.homeZip ? <T v="muted">{`Home: ${Geo.label(Geo.lookup(s.prefs.homeZip))} · ${s.prefs.homeRadius} mi radius`}</T> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <T v="body">Show dealer names on cards</T>
          <Switch value={!!s.prefs.showDealer} onValueChange={(v) => setPrefs({ showDealer: v })} trackColor={{ true: c.accent, false: c.border }} />
        </View>
      </Card>

      <Card>
        <T v="h2">Appearance</T>
        <Seg options={THEMES} value={s.theme || 'system'} onChange={(t) => update((x) => { x.theme = t === 'system' ? null : t; })} format={(t) => t[0].toUpperCase() + t.slice(1)} />
      </Card>

      <Card style={{ gap: 0 }}>
        <T v="h2" style={{ marginBottom: Spacing.sm }}>Saved data</T>
        <Row label="Favorites" value={String(Object.keys(s.favs).length)} />
        <Row label="In compare" value={String(s.compare.length)} />
        <Pressable onPress={() => Alert.alert('Clear saved cars?', 'Removes your favorites, compare list and history from this phone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Clear', style: 'destructive', onPress: () => update((x) => { x.favs = {}; x.compare = []; x.recent = []; x.liveCars = {}; }) },
        ])} style={{ paddingTop: Spacing.md }}>
          <T v="body" style={{ color: c.bad, fontWeight: '600' }}>Clear saved cars</T>
        </Pressable>
      </Card>

      <T v="muted">Market signals are informational only and are not financial advice. Vehicle makes and model names belong to their respective owners.</T>
    </Screen>
  );
}
