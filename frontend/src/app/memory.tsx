import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthMenu } from '@/components/auth-menu';
import { Card, GlowOrb, Pill, Wordmark, useResponsive } from '@/components/landing/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/context';
import { useTheme } from '@/hooks/use-theme';
import { addMemoryObject, listMemory, removeMemoryObject, type MemoryObject } from '@/lib/home';

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
const webFullHeight = Platform.OS === 'web' ? ({ height: '100vh' } as object) : null;

// Quick-pick tags — the categories Qwen-VL reasons over. Custom tags can be typed too.
const SUGGESTED_TAGS = ['family', 'pet', 'vehicle', 'package', 'allowed', 'watch'];

/** Pick an image file on web and read it as a data: URI. Native returns null (web-first). */
function pickImageWeb(): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

/** Downscale a data URL so uploads stay small and Qwen-VL-friendly (web canvas; no-op elsewhere). */
async function downscale(dataUrl: string, maxDim = 1024, quality = 0.85): Promise<string> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return dataUrl;
  return new Promise((resolve) => {
    const img = new (window as unknown as { Image: new () => HTMLImageElement }).Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export default function MemoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isNarrow, gutter } = useResponsive();
  const insets = useSafeAreaInsets();
  const { status, token } = useAuth();

  const [objects, setObjects] = useState<MemoryObject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // draft for a new object
  const [image, setImage] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [tags, setTags] = useState<string[]>(['family']);
  const [customTag, setCustomTag] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setObjects(await listMemory(token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (status === 'signedIn') void load();
  }, [status, load]);

  const pick = async () => {
    const picked = await pickImageWeb();
    if (picked) setImage(await downscale(picked));
  };

  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const addCustomTag = () => {
    const t = customTag.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags((cur) => [...cur, t]);
    setCustomTag('');
  };

  const resetDraft = () => {
    setImage(null);
    setLabel('');
    setTags(['family']);
    setCustomTag('');
  };

  const save = async () => {
    if (!image || !label.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addMemoryObject(label.trim(), image, tags, token);
      resetDraft();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (obj: MemoryObject) => {
    if (deletingId) return;
    setDeletingId(obj.id);
    try {
      await removeMemoryObject(obj.id, token);
      setObjects((prev) => (prev ? prev.filter((o) => o.id !== obj.id) : prev));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  if (status === 'loading') {
    return (
      <View style={[styles.fill, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.ember} />
      </View>
    );
  }
  if (status === 'signedOut') return <Redirect href="/signin" />;

  const pad = { paddingHorizontal: gutter };
  const canSave = !!image && !!label.trim() && !saving;

  return (
    <SafeAreaView style={[styles.screen, webFullHeight, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Spacing.six + insets.bottom }}>
        <GlowOrb size={560} color={theme.emberGlow} intensity={0.7} style={styles.glow} />

        <View style={[pad, styles.nav]}>
          <Pressable onPress={() => router.push('/')}>
            <Wordmark size={24} />
          </Pressable>
          <AuthMenu align="right" width={210} />
        </View>

        <View style={[pad, styles.body]}>
          <View style={{ gap: Spacing.two }}>
            <Pill dotColor={theme.ember}>Reference memory</Pill>
            <Text style={[styles.h1, isNarrow && styles.h1Narrow, { color: theme.text }]}>Who and what your home knows</Text>
            <Text style={[styles.sub, { color: theme.textSecondary }]}>
              Upload a photo, name it, and tag it. Qwen-VL reasons over these at the door — to tell
              family from strangers, recognise a known car, or watch for a specific thing.
            </Text>
            <Pressable onPress={() => router.push('/dashboard')} hitSlop={8}>
              <Text style={[styles.back, { color: theme.ember }]}>← Back to dashboard</Text>
            </Pressable>
          </View>

          {error ? (
            <Card style={{ borderColor: theme.info }}>
              <Text style={[styles.errBody, { color: theme.textSecondary }]}>{error}</Text>
            </Card>
          ) : null}

          {/* add a new object */}
          <Card glow style={{ gap: Spacing.three }}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Add to memory</Text>

            <View style={[styles.addRow, { flexDirection: isNarrow ? 'column' : 'row' }]}>
              <Pressable
                onPress={pick}
                style={[styles.dropZone, { borderColor: theme.borderStrong, backgroundColor: theme.codeBg }]}>
                {image ? (
                  <Image source={{ uri: image }} style={styles.dropImg} resizeMode="cover" />
                ) : (
                  <Text style={[styles.dropText, { color: theme.textMuted }]}>
                    {Platform.OS === 'web' ? '＋ Choose a photo' : 'Photo upload is web-only for now'}
                  </Text>
                )}
              </Pressable>

              <View style={{ flex: 1, gap: Spacing.two }}>
                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  placeholder="Name — e.g. Alex, the grey Honda, Rex"
                  placeholderTextColor={theme.textMuted}
                  style={[
                    styles.input,
                    { backgroundColor: theme.codeBg, borderColor: theme.borderStrong, color: theme.text },
                    webNoOutline,
                  ]}
                />

                {/* tags */}
                <View style={styles.tagWrap}>
                  {SUGGESTED_TAGS.map((t) => {
                    const on = tags.includes(t);
                    return (
                      <Pressable
                        key={t}
                        onPress={() => toggleTag(t)}
                        style={[
                          styles.tagChip,
                          {
                            borderColor: on ? theme.emberDeep : theme.border,
                            backgroundColor: on ? theme.emberGlow : theme.backgroundElement,
                          },
                        ]}>
                        <Text style={[styles.tagChipText, { color: on ? theme.ember : theme.textMuted }]}>
                          {on ? '✓ ' : ''}
                          {t}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* custom tags */}
                {tags.filter((t) => !SUGGESTED_TAGS.includes(t)).length ? (
                  <View style={styles.tagWrap}>
                    {tags
                      .filter((t) => !SUGGESTED_TAGS.includes(t))
                      .map((t) => (
                        <Pressable
                          key={t}
                          onPress={() => toggleTag(t)}
                          style={[styles.tagChip, { borderColor: theme.emberDeep, backgroundColor: theme.emberGlow }]}>
                          <Text style={[styles.tagChipText, { color: theme.ember }]}>✕ {t}</Text>
                        </Pressable>
                      ))}
                  </View>
                ) : null}

                <View style={styles.addActions}>
                  <TextInput
                    value={customTag}
                    onChangeText={setCustomTag}
                    onSubmitEditing={addCustomTag}
                    placeholder="+ custom tag"
                    placeholderTextColor={theme.textMuted}
                    style={[
                      styles.input,
                      styles.tagInput,
                      { backgroundColor: theme.codeBg, borderColor: theme.borderStrong, color: theme.text },
                      webNoOutline,
                    ]}
                  />
                  <Pressable
                    onPress={save}
                    disabled={!canSave}
                    style={[styles.saveBtn, { backgroundColor: canSave ? theme.ember : theme.backgroundSelected }]}>
                    {saving ? (
                      <ActivityIndicator color={theme.onEmber} />
                    ) : (
                      <Text style={[styles.saveText, { color: canSave ? theme.onEmber : theme.textMuted }]}>
                        Add to memory →
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          </Card>

          {/* the memory */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              In memory{objects ? ` (${objects.length})` : ''}
            </Text>
            {objects && objects.length ? (
              <View style={styles.grid}>
                {objects.map((o) => (
                  <View key={o.id} style={[styles.objCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                    <Image source={{ uri: o.image }} style={styles.objImg} resizeMode="cover" />
                    <View style={{ padding: Spacing.two, gap: 6 }}>
                      <Text style={[styles.objName, { color: theme.text }]} numberOfLines={1}>
                        {o.label}
                      </Text>
                      <View style={styles.tagWrap}>
                        {(o.tags ?? []).map((t) => (
                          <View
                            key={t}
                            style={[styles.miniTag, { borderColor: theme.emberDeep, backgroundColor: theme.emberGlow }]}>
                            <Text style={[styles.miniTagText, { color: theme.ember }]}>{t}</Text>
                          </View>
                        ))}
                        {!(o.tags ?? []).length ? (
                          <Text style={[styles.miniTagText, { color: theme.textMuted }]}>untagged</Text>
                        ) : null}
                      </View>
                      <Pressable onPress={() => remove(o)} disabled={deletingId === o.id} hitSlop={6}>
                        <Text style={[styles.objDelete, { color: theme.warn }]}>
                          {deletingId === o.id ? 'Removing…' : 'Remove'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Card>
                <Text style={[styles.empty, { color: theme.textMuted }]}>
                  {loading ? 'Loading…' : 'Nothing in memory yet — add a person, pet, or vehicle above.'}
                </Text>
              </Card>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1 },
  scroll: { flex: 1, width: '100%' },
  glow: { position: 'absolute', top: -200, alignSelf: 'center' },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.select({ web: Spacing.four, default: Spacing.three }),
    paddingBottom: Spacing.three,
    zIndex: 30,
  },
  body: { width: '100%', maxWidth: 960, alignSelf: 'center', gap: Spacing.four },
  h1: { fontFamily: Fonts?.sans, fontSize: 32, fontWeight: '800', letterSpacing: -1 },
  h1Narrow: { fontSize: 25, letterSpacing: -0.6 },
  sub: { fontFamily: Fonts?.sans, fontSize: 14.5, lineHeight: 21, maxWidth: 620 },
  back: { fontFamily: Fonts?.mono, fontSize: 12.5, fontWeight: '700', marginTop: 2 },

  cardTitle: { fontFamily: Fonts?.sans, fontSize: 17, fontWeight: '700' },
  addRow: { gap: Spacing.three, alignItems: 'flex-start' },
  dropZone: {
    width: 148,
    height: 148,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dropImg: { width: '100%', height: '100%' },
  dropText: { fontFamily: Fonts?.mono, fontSize: 12.5, textAlign: 'center', paddingHorizontal: 10 },

  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontFamily: Fonts?.sans,
    fontSize: 15,
    fontWeight: '500',
    minHeight: 46,
  },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: Radius.pill, borderWidth: 1 },
  tagChipText: { fontFamily: Fonts?.mono, fontSize: 12.5, fontWeight: '700' },
  addActions: { flexDirection: 'row', gap: Spacing.two, alignItems: 'stretch', marginTop: 2 },
  tagInput: { flex: 1, minHeight: 44 },
  saveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: Radius.pill,
    minHeight: 44,
    minWidth: 150,
  },
  saveText: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700' },

  section: { gap: Spacing.three },
  sectionTitle: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  objCard: {
    width: 168,
    flexGrow: 1,
    flexBasis: 168,
    maxWidth: 220,
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  objImg: { width: '100%', height: 132, backgroundColor: '#0002' },
  objName: { fontFamily: Fonts?.sans, fontSize: 15, fontWeight: '700' },
  miniTag: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: Radius.pill, borderWidth: 1 },
  miniTagText: { fontFamily: Fonts?.mono, fontSize: 10.5, fontWeight: '700' },
  objDelete: { fontFamily: Fonts?.mono, fontSize: 12, fontWeight: '700', marginTop: 2 },

  empty: { fontFamily: Fonts?.sans, fontSize: 13.5, lineHeight: 20 },
  errBody: { fontFamily: Fonts?.mono, fontSize: 12.5 },
});
