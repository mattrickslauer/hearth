import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CostQuote } from '@/components/cost-quote';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { HomeModel, MemoryObject, Watch } from '@/lib/home';
import { webNoOutline } from '@/lib/web-style';

import { Tag, useHover } from './shared';

/**
 * A watch, compressed to the line that matters: what it's called, where it runs, and what it
 * does. Everything else — cost, memory bindings, edit, delete — is one tap deeper, in the sheet.
 */
export function WatchCard({ watch, onPress }: { watch: Watch; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${watch.title}. Tap to open.`}
      {...hoverProps}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.card,
          borderColor: pressed || hovered ? theme.emberDeep : theme.border,
          transform: [{ scale: pressed ? 0.995 : 1 }],
        },
      ]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {watch.title}
        </Text>
        <View style={styles.tags}>
          <Tag on={watch.runsLocally} text={watch.runsLocally ? 'local' : 'cloud'} />
          {watch.usesVision ? <Tag on text="vision" /> : null}
        </View>
      </View>
      <Text style={[styles.line, { color: theme.textSecondary }]} numberOfLines={2}>
        <Text style={{ color: theme.textMuted }}>when </Text>
        {watch.trigger}
        <Text style={{ color: theme.textMuted }}> → </Text>
        {watch.action}
      </Text>
    </Pressable>
  );
}

/** The body of a watch's sheet — the full picture, and the memory it reasons over. */
export function WatchSheetBody({
  watch,
  home,
  memory,
  onToggleMemory,
  onAddMemory,
}: {
  watch: Watch;
  home: HomeModel | null;
  memory: MemoryObject[];
  onToggleMemory: (memoryId: string) => void;
  onAddMemory: () => void;
}) {
  const theme = useTheme();
  const linkedIds = watch.memoryIds ?? [];

  return (
    <>
      <View style={styles.tags}>
        <Tag on={watch.runsLocally} text={watch.runsLocally ? 'local' : 'cloud'} />
        {watch.usesVision ? <Tag on text="vision" /> : null}
      </View>

      <View style={[styles.rule, { backgroundColor: theme.codeBg, borderColor: theme.border }]}>
        <Text style={[styles.ruleLabel, { color: theme.textMuted }]}>WHEN</Text>
        <Text style={[styles.ruleText, { color: theme.text }]}>{watch.trigger}</Text>
        <Text style={[styles.ruleLabel, { color: theme.textMuted, marginTop: 8 }]}>THEN</Text>
        <Text style={[styles.ruleText, { color: theme.text }]}>{watch.action}</Text>
      </View>

      {/* What it costs, before you ever look at a bill. A local watch says
          "$0 · runs on your hub" — that's the point, not silence. */}
      <CostQuote watch={watch} home={home} />

      {/* Which people/pets/vehicles from memory Qwen-VL should reason over when this fires.
          Attaching narrows a vision watch to just these; attaching none means all of memory. */}
      <View style={{ gap: Spacing.two }}>
        <Text style={[styles.memLabel, { color: theme.textSecondary }]}>
          Memory{linkedIds.length ? ` · ${linkedIds.length} attached` : ' · watches everything'}
        </Text>
        {memory.length ? (
          <>
            <Text style={[styles.memHint, { color: theme.textMuted }]}>
              Tap to choose who or what Qwen-VL should look for. Attach none to reason over all of
              memory.
            </Text>
            <View style={styles.memGrid}>
              {memory.map((m) => {
                const on = linkedIds.includes(m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => onToggleMemory(m.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={[
                      styles.memChip,
                      {
                        borderColor: on ? theme.emberDeep : theme.border,
                        backgroundColor: on ? theme.emberGlow : theme.backgroundElement,
                      },
                    ]}>
                    <Image source={{ uri: m.image }} style={styles.memChipImg} />
                    <Text
                      style={[styles.memChipLabel, { color: on ? theme.ember : theme.textSecondary }]}
                      numberOfLines={1}>
                      {on ? '✓ ' : ''}
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <Pressable
            onPress={onAddMemory}
            style={[styles.memEmpty, { borderColor: theme.emberDeep, backgroundColor: theme.emberGlow }]}>
            <Text style={[styles.memEmptyText, { color: theme.ember }]}>
              ＋ Add reference photos to attach →
            </Text>
          </Pressable>
        )}
      </View>
    </>
  );
}

/** The body of the edit sheet — one field, and a warning about what saving actually does. */
export function WatchEditBody({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (t: string) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <>
      <Text style={[styles.memHint, { color: theme.textMuted }]}>
        Saving re-compiles the watch from your description — the trigger, action and bindings are
        re-derived.
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        multiline
        placeholder="Describe what this watch should do…"
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          { backgroundColor: theme.codeBg, borderColor: theme.borderStrong, color: theme.text },
          webNoOutline,
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.md, borderWidth: 1, padding: Spacing.three, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1, fontFamily: Fonts?.sans, fontSize: 15.5, fontWeight: '700' },
  tags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  line: { fontFamily: Fonts?.sans, fontSize: 13.5, lineHeight: 20 },

  rule: { borderRadius: Radius.md, borderWidth: 1, padding: Spacing.three },
  ruleLabel: { fontFamily: Fonts?.mono, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  ruleText: { fontFamily: Fonts?.sans, fontSize: 14.5, lineHeight: 21, marginTop: 2 },

  memLabel: {
    fontFamily: Fonts?.mono,
    fontSize: 11.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  memHint: { fontFamily: Fonts?.sans, fontSize: 12.5, lineHeight: 18 },
  memGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  memChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 5,
    paddingHorizontal: 11,
    paddingLeft: 5,
    borderRadius: Radius.pill,
    borderWidth: 1,
    maxWidth: 210,
  },
  memChipImg: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#0002' },
  memChipLabel: { fontFamily: Fonts?.sans, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  memEmpty: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  memEmptyText: { fontFamily: Fonts?.sans, fontSize: 13, fontWeight: '700' },

  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontFamily: Fonts?.sans,
    fontSize: 15,
    fontWeight: '500',
    minHeight: 96,
    textAlignVertical: 'top',
  },
});
