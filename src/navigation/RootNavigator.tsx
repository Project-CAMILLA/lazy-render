/*
 * Bottom-tab shell: one tab per wrapped site, plus Settings. Intentionally
 * minimal chrome — no top toolbar — so the WebView gets the whole screen; the
 * site's own UI plus the injected pill provide context. Live booster stats
 * reported by each site tab are held here and handed to the Settings tab.
 */
import React, { useCallback, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import SiteWebViewScreen from '../screens/SiteWebViewScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { SITES, SiteId } from '../sites/registry';
import { useTheme } from '../theme/ThemeContext';

const Tab = createBottomTabNavigator();

type Stats = Partial<Record<SiteId, { hidden: number; visible: number }>>;

function TabGlyph({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.glyph, { borderColor: color }]}>
      <Text style={[styles.glyphText, { color }]}>{label}</Text>
    </View>
  );
}

export default function RootNavigator() {
  const [stats, setStats] = useState<Stats>({});
  const { palette } = useTheme();

  const onStats = useCallback((siteId: SiteId, hidden: number, visible: number) => {
    setStats((prev) => {
      const cur = prev[siteId];
      if (cur && cur.hidden === hidden && cur.visible === visible) return prev;
      return { ...prev, [siteId]: { hidden, visible } };
    });
  }, []);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: [styles.tabBar, { backgroundColor: palette.surface, borderTopColor: palette.border }],
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textDim,
        tabBarLabelStyle: styles.tabLabel,
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      {SITES.map((site) => (
        <Tab.Screen
          key={site.id}
          name={site.label}
          options={{
            tabBarIcon: ({ color }) => <TabGlyph label={site.glyph} color={color} />,
          }}
        >
          {({ navigation }) => (
            <SiteWebViewScreen siteId={site.id} navigation={navigation} onStats={onStats} />
          )}
        </Tab.Screen>
      ))}
      <Tab.Screen
        name="Settings"
        options={{
          tabBarIcon: ({ color }) => <TabGlyph label="⚙" color={color} />,
        }}
      >
        {() => <SettingsScreen stats={stats} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {},
  tabLabel: { fontSize: 11 },
  glyph: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphText: { fontSize: 13, fontWeight: '700' },
});
