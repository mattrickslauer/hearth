/**
 * Watch authoring, editing, tuning and memory-binding — the state and handlers that used to live
 * inline in the dashboard god component. The watch LIST stays in the screen (many things read it);
 * this hook owns only the authoring/edit/tune draft state and mutates the list through the passed
 * setters. The sheet state machine and tab navigation are the screen's, threaded in as callbacks,
 * so behavior is identical — this is a move, not a rewrite.
 */

import { useState, type Dispatch, type SetStateAction } from 'react';

import type { TunePatch } from '@/components/tune-watch';
import type { SheetState, TabKey } from '@/lib/dashboard-types';
import {
  authorWatch,
  configureWatch,
  deleteWatch,
  linkWatchMemory,
  listEvents,
  updateWatch,
  type ContextSuggestion,
  type RunEvent,
  type Watch,
} from '@/lib/home';

export function useWatchAuthoring(opts: {
  token?: string | null;
  reload: () => Promise<void>;
  setSheet: (s: SheetState) => void;
  closeSheet: () => void;
  setTab: (k: TabKey) => void;
  setWatches: Dispatch<SetStateAction<Watch[] | null>>;
  setEvents: Dispatch<SetStateAction<RunEvent[] | null>>;
  setError: (e: string | null) => void;
}) {
  const { token, reload, setSheet, closeSheet, setTab, setWatches, setEvents, setError } = opts;

  const [wish, setWish] = useState('');
  const [authoring, setAuthoring] = useState(false);
  // When Qwen compiles a vision wish it recommends the context that would make it work well
  // (reference photos of household members, aim, cadence…). We surface that in its own sheet.
  const [suggestions, setSuggestions] = useState<{ title: string; items: ContextSuggestion[] } | null>(null);

  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);

  const [savingTune, setSavingTune] = useState(false);
  const [tuneError, setTuneError] = useState<string | null>(null);
  // Authoring can produce two things worth saying, and only one layer to say them on: Qwen's
  // context suggestions, and the budget of a cloud watch. When both apply we queue the tune
  // behind the suggestions rather than dropping either.
  const [pendingTuneId, setPendingTuneId] = useState<string | null>(null);

  const submitWish = async () => {
    if (!wish.trim() || authoring) return;
    setAuthoring(true);
    setError(null);
    try {
      const { question } = await authorWatch(wish.trim(), token);
      const next = question.contextSuggestions?.length
        ? { title: question.title, items: question.contextSuggestions }
        : null;
      setSuggestions(next);
      setWish('');
      // A local watch is free and has no cloud knobs, so there's nothing to tune.
      const tuneable = question.compiledSpec?.kind === 'cloud';
      setTuneError(null);
      // Suggestions first when there are any — they're about making it work at all. The budget
      // follows on their heels (see pendingTuneId), while the wish is still in mind.
      setPendingTuneId(next && tuneable ? question.id : null);
      if (next) setSheet({ kind: 'suggest' });
      else if (tuneable) setSheet({ kind: 'tune', id: question.id });
      else {
        setSheet({ kind: 'none' });
        setTab('watches');
      }
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthoring(false);
    }
  };

  // Persist the real program knobs (mode, rate, model). Expected activity isn't sent — it isn't
  // a property of the program, only of your guess at how busy the scene is.
  const saveTune = async (id: string, patch: TunePatch) => {
    if (savingTune) return;
    setSavingTune(true);
    setTuneError(null);
    try {
      const { question } = await configureWatch(id, patch, token);
      setWatches((prev) => (prev ? prev.map((w) => (w.id === question.id ? question : w)) : prev));
      await reload();
      closeSheet();
    } catch (err) {
      setTuneError((err as Error).message);
    } finally {
      setSavingTune(false);
    }
  };

  // Leaving the suggestions hands the layer to the budget, if this watch has one to spend.
  const closeSuggest = () => {
    const next = pendingTuneId;
    setPendingTuneId(null);
    if (next) setSheet({ kind: 'tune', id: next });
    else closeSheet();
  };

  const saveEdit = async (id: string) => {
    if (!editText.trim() || savingEdit) return;
    setSavingEdit(true);
    setWatchError(null);
    try {
      const { question } = await updateWatch(id, editText.trim(), token);
      // Recompiled in place — swap the updated watch into the list without a full reload.
      setWatches((prev) => (prev ? prev.map((w) => (w.id === question.id ? question : w)) : prev));
      setSheet({ kind: 'watch', id });
      listEvents(20, token).then(setEvents).catch(() => {});
    } catch (err) {
      setWatchError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  };

  const removeWatch = async (w: Watch) => {
    if (deletingId) return;
    setWatchError(null);
    setDeletingId(w.id);
    try {
      await deleteWatch(w.id, token);
      setWatches((prev) => (prev ? prev.filter((x) => x.id !== w.id) : prev));
      closeSheet();
      listEvents(20, token).then(setEvents).catch(() => {});
    } catch (err) {
      setWatchError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  // Attach or detach one reference-memory object from a watch. Optimistic: flip the link in place,
  // persist, and roll back to the server's authoritative list if the call fails.
  const toggleWatchMemory = async (w: Watch, memoryId: string) => {
    const current = w.memoryIds ?? [];
    const next = current.includes(memoryId)
      ? current.filter((id) => id !== memoryId)
      : [...current, memoryId];
    setWatchError(null);
    setWatches((prev) => (prev ? prev.map((x) => (x.id === w.id ? { ...x, memoryIds: next } : x)) : prev));
    try {
      const { question } = await linkWatchMemory(w.id, next, token);
      setWatches((prev) =>
        prev ? prev.map((x) => (x.id === w.id ? { ...x, memoryIds: question.memoryIds ?? [] } : x)) : prev,
      );
    } catch (err) {
      setWatchError((err as Error).message);
      setWatches((prev) => (prev ? prev.map((x) => (x.id === w.id ? { ...x, memoryIds: current } : x)) : prev));
    }
  };

  return {
    wish,
    setWish,
    authoring,
    submitWish,
    suggestions,
    closeSuggest,
    pendingTuneId,
    setPendingTuneId,
    editText,
    setEditText,
    savingEdit,
    saveEdit,
    deletingId,
    removeWatch,
    watchError,
    setWatchError,
    savingTune,
    tuneError,
    setTuneError,
    saveTune,
    toggleWatchMemory,
  };
}
