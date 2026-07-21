/*
 * Settings tab — one clean screen replacing both the Android app's AlertDialog
 * and the extension's popup. Two sections: a global appearance picker (Light /
 * Dark / True Dark, applies to the app's own chrome AND the wrapped chat
 * pages), then per-site booster tuning: on/off, how many recent turns stay
 * rendered, reveal batch size, auto-reveal near top, and the floating pill.
 * Steppers/switches (no number keyboard) keep it thumb-friendly. Live
 * hidden/visible counts come from the engine's postMessage bridge.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getSite, SITES, SiteId } from '../sites/registry';
import {
  AllSettings,
  clamp,
  KEEP_VISIBLE_MAX,
  KEEP_VISIBLE_MIN,
  loadAllSettings,
  REVEAL_BATCH_MAX,
  REVEAL_BATCH_MIN,
  saveAllSettings,
  SiteSettings,
} from '../state/settingsStore';
import { Palette, THEME_MODE_LABELS, THEME_MODES, ThemeMode } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  stats: Partial<Record<SiteId, { hidden: number; visible: number }>>;
};

export default function SettingsScreen({ stats }: Props) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<SiteId>(SITES[0].id);
  const [all, setAll] = useState<AllSettings | null>(null);
  const { mode: themeMode, palette, setMode } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  // Reload whenever the tab regains focus, so external changes stay in sync.
  const reload = useCallback(() => {
    loadAllSettings().then(setAll);
  }, []);
  // useFocusEffect isn't imported to keep this screen decoupled from nav; a
  // mount load plus save-driven local updates is enough since this screen owns
  // the only writer.
  React.useEffect(reload, [reload]);

  const update = useCallback(
    (patch: Partial<SiteSettings>) => {
      setAll((prev) => {
        if (!prev) return prev;
        const next: AllSettings = { ...prev, [selected]: { ...prev[selected], ...patch } };
        saveAllSettings(next).catch(() => {});
        return next;
      });
    },
    [selected]
  );

  if (!all) return <View style={styles.screen} />;

  const s = all[selected];
  const live = stats[selected];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
    >
      <Text style={styles.title}>Lazy Render</Text>
      <Text style={styles.subtitle}>Keeps long chats fast by hiding older messages.</Text>

      {/* Appearance — applies to this screen, the tab bar, AND the wrapped
          ChatGPT/Claude pages themselves (see engine/theme-inject.js). */}
      <Text style={styles.sectionLabel}>Appearance</Text>
      <View style={styles.segment}>
        {THEME_MODES.map((m) => {
          const active = m === themeMode;
          return (
            <TouchableOpacity
              key={m}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              onPress={() => setMode(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {THEME_MODE_LABELS[m]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.themeHint}>{themeHint(themeMode)}</Text>

      <Text style={styles.sectionLabel}>Booster</Text>

      {/* Site picker */}
      <View style={styles.segment}>
        {SITES.map((site) => {
          const active = site.id === selected;
          return (
            <TouchableOpacity
              key={site.id}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              onPress={() => setSelected(site.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{site.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.card}>
        <ToggleRow
          label="Enable booster"
          value={s.enabled}
          onValueChange={(v) => update({ enabled: v })}
          palette={palette}
          styles={styles}
        />
        <Divider styles={styles} />
        <StepperRow
          label="Visible turns"
          hint={`${KEEP_VISIBLE_MIN}–${KEEP_VISIBLE_MAX} most-recent kept rendered`}
          value={s.keepVisible}
          step={10}
          min={KEEP_VISIBLE_MIN}
          max={KEEP_VISIBLE_MAX}
          disabled={!s.enabled}
          onChange={(v) => update({ keepVisible: v })}
          styles={styles}
        />
        <Divider styles={styles} />
        <StepperRow
          label="Reveal batch"
          hint={`${REVEAL_BATCH_MIN}–${REVEAL_BATCH_MAX} revealed at a time`}
          value={s.revealBatch}
          step={5}
          min={REVEAL_BATCH_MIN}
          max={REVEAL_BATCH_MAX}
          disabled={!s.enabled}
          onChange={(v) => update({ revealBatch: v })}
          styles={styles}
        />
        <Divider styles={styles} />
        <ToggleRow
          label="Auto-reveal near top"
          value={s.autoReveal}
          disabled={!s.enabled}
          onValueChange={(v) => update({ autoReveal: v })}
          palette={palette}
          styles={styles}
        />
        <Divider styles={styles} />
        <ToggleRow
          label="Show status pill"
          value={s.showBadge}
          disabled={!s.enabled}
          onValueChange={(v) => update({ showBadge: v })}
          palette={palette}
          styles={styles}
        />
      </View>

      <View style={styles.statsCard}>
        <Text style={styles.statsTitle}>{getSite(selected).label} · live</Text>
        <Text style={styles.statsBody}>
          {live && live.hidden + live.visible > 0
            ? `${live.hidden} older hidden · ${live.visible} visible`
            : 'Open this chat and scroll a long thread to see counts.'}
        </Text>
      </View>

      <Text style={styles.footnote}>
        You log in to each site normally, inside its tab. Settings are saved on this device.
      </Text>
    </ScrollView>
  );
}

function themeHint(mode: ThemeMode): string {
  switch (mode) {
    case 'light':
      return 'Natural page rendering, no override.';
    case 'dark':
      return 'Forces a dark look on every page, even ones without their own dark mode.';
    case 'trueDark':
      return 'Same as Dark, pushed toward true black — best for OLED screens.';
  }
}

type Styles = ReturnType<typeof makeStyles>;

function ToggleRow(props: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (v: boolean) => void;
  palette: Palette;
  styles: Styles;
}) {
  const { styles } = props;
  return (
    <View style={[styles.row, props.disabled && styles.rowDisabled]}>
      <Text style={styles.rowLabel}>{props.label}</Text>
      <Switch
        value={props.value}
        onValueChange={props.onValueChange}
        disabled={props.disabled}
        trackColor={{ true: props.palette.accent, false: props.palette.border }}
        thumbColor="#fff"
      />
    </View>
  );
}

function StepperRow(props: {
  label: string;
  hint: string;
  value: number;
  step: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  styles: Styles;
}) {
  const { styles } = props;
  const dec = () => props.onChange(clamp(props.value - props.step, props.min, props.max));
  const inc = () => props.onChange(clamp(props.value + props.step, props.min, props.max));
  return (
    <View style={[styles.row, props.disabled && styles.rowDisabled]}>
      <View style={styles.rowLabelBox}>
        <Text style={styles.rowLabel}>{props.label}</Text>
        <Text style={styles.rowHint}>{props.hint}</Text>
      </View>
      <View style={styles.stepper}>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={dec}
          disabled={props.disabled || props.value <= props.min}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${props.label}`}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepValue}>{props.value}</Text>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={inc}
          disabled={props.disabled || props.value >= props.max}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${props.label}`}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Divider({ styles }: { styles: Styles }) {
  return <View style={styles.divider} />;
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.background },
    content: { paddingHorizontal: 16 },
    title: { color: palette.text, fontSize: 22, fontWeight: '700' },
    subtitle: { color: palette.textDim, fontSize: 13, marginTop: 4, marginBottom: 18 },
    sectionLabel: {
      color: palette.textDim,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 8,
      marginTop: 4,
    },
    segment: {
      flexDirection: 'row',
      backgroundColor: palette.surface,
      borderRadius: 10,
      padding: 4,
      marginBottom: 8,
    },
    segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 7, alignItems: 'center' },
    segmentBtnActive: { backgroundColor: palette.accent },
    segmentText: { color: palette.textDim, fontSize: 14, fontWeight: '600' },
    segmentTextActive: { color: '#fff' },
    themeHint: { color: palette.textDim, fontSize: 11, marginBottom: 20, lineHeight: 15 },
    card: { backgroundColor: palette.surface, borderRadius: 12, paddingHorizontal: 14 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      gap: 12,
    },
    rowDisabled: { opacity: 0.45 },
    rowLabelBox: { flex: 1 },
    rowLabel: { color: palette.text, fontSize: 15 },
    rowHint: { color: palette.textDim, fontSize: 11, marginTop: 2 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border },
    stepper: { flexDirection: 'row', alignItems: 'center' },
    stepBtn: {
      width: 34,
      height: 34,
      borderRadius: 8,
      backgroundColor: palette.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepBtnText: { color: palette.text, fontSize: 20, lineHeight: 22 },
    stepValue: { color: palette.text, fontSize: 16, fontWeight: '600', width: 46, textAlign: 'center' },
    statsCard: { backgroundColor: palette.surface, borderRadius: 12, padding: 14, marginTop: 16 },
    statsTitle: { color: palette.accent, fontSize: 12, fontWeight: '700', marginBottom: 4 },
    statsBody: { color: palette.text, fontSize: 13 },
    footnote: { color: palette.textDim, fontSize: 11, marginTop: 18, lineHeight: 16 },
  });
}
