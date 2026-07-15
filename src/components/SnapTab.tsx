'use client';

import { useState, useRef, useEffect } from 'react';
import type { Garment, IngestGroup, WearLog } from '@/types/db';
import { compressImage } from '@/lib/image';
import EmptyState from './EmptyState';

interface SnapTabProps {
  /** Existing items so we can find the freshly-uploaded one for validation. */
  items: Garment[];
  wearLogs: WearLog[];
  /** Called when a newly-uploaded item should be opened in the validation modal. */
  onSelectForValidation: (item: Garment) => void;
  /** Toast helpers. */
  notify: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    info: (msg: string) => void;
  };
  /** Refetch the items list after a successful upload. */
  onItemsChanged: () => Promise<void> | void;
}

/**
 * Multi-image ingest workspace ("Snap tab"). Users queue groups of
 * photos (one primary + many detail shots) and submit them in a batch
 * to the AI ingestion pipeline.
 *
 * Owns its own state (groups, selection, speech, continuous-snap toggle)
 * so the parent doesn't carry 5 useState hooks + 4 refs + 8 handlers
 * just for this tab.
 */
export default function SnapTab({ items, onSelectForValidation, notify, onItemsChanged }: SnapTabProps) {
  const [ingestGroups, setIngestGroups] = useState<IngestGroup[]>([]);
  const [selectedIngestGroupIds, setSelectedIngestGroupIds] = useState<string[]>([]);
  const [speechActive, setSpeechActive] = useState(false);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [continuousSnap, setContinuousSnap] = useState(false);
  const [activeDetailGroupId, setActiveDetailGroupId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    completed: number;
    failed: number;
  } | null>(null);

  const detailFilePickerRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const detailCameraInputRef = useRef<HTMLInputElement>(null);

  // Global drag-and-drop visual feedback. Fires when the user drags
  // any file over the window, even if they don't drop on the dropzone.
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) setIsDraggingOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      // Only hide when the user leaves the window entirely.
      if (e.relatedTarget === null) setIsDraggingOver(false);
    };
    const onDrop = () => setIsDraggingOver(false);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  const handleFilesSelected = (files: FileList | null, isCameraInput: boolean = false) => {
    if (!files || files.length === 0) return;
    const newGroups = Array.from(files).map((f) => ({
      id: Math.random().toString(36).substring(2, 9),
      files: [f],
      notes: '',
      status: 'pending' as const,
    }));
    setIngestGroups((prev) => [...prev, ...newGroups]);

    if (continuousSnap && isCameraInput) {
      setTimeout(() => {
        cameraInputRef.current?.click();
      }, 700);
    }
  };

  const triggerAddDetail = (groupId: string) => {
    setActiveDetailGroupId(groupId);
    detailFilePickerRef.current?.click();
  };

  const triggerAddDetailCamera = (groupId: string) => {
    setActiveDetailGroupId(groupId);
    detailCameraInputRef.current?.click();
  };

  const handleDetailFilesSelected = (files: FileList | null) => {
    if (!files || !activeDetailGroupId) return;
    const addedFiles = Array.from(files);

    setIngestGroups((prev) =>
      prev.map((g) => (g.id === activeDetailGroupId ? { ...g, files: [...g.files, ...addedFiles] } : g))
    );
    setActiveDetailGroupId(null);
  };

  const handleDeleteGroup = (groupId: string) => {
    setIngestGroups((prev) => prev.filter((g) => g.id !== groupId));
    setSelectedIngestGroupIds((prev) => prev.filter((id) => id !== groupId));
  };

  const handleDeleteFileFromGroup = (groupId: string, fileIdx: number) => {
    setIngestGroups((prev) =>
      prev
        .map((g) => {
          if (g.id !== groupId) return g;
          return { ...g, files: g.files.filter((_, idx) => idx !== fileIdx) };
        })
        .filter((g) => g.files.length > 0)
    );
  };

  const handleMergeSelectedGroups = () => {
    if (selectedIngestGroupIds.length < 2) return;
    const targetGroupId = selectedIngestGroupIds[0];
    const targetGroup = ingestGroups.find((g) => g.id === targetGroupId);
    if (!targetGroup) return;

    const mergedFiles = [...targetGroup.files];
    let mergedNotes = targetGroup.notes;

    ingestGroups.forEach((g) => {
      if (g.id !== targetGroupId && selectedIngestGroupIds.includes(g.id)) {
        mergedFiles.push(...g.files);
        if (g.notes) {
          mergedNotes = mergedNotes ? `${mergedNotes}; ${g.notes}` : g.notes;
        }
      }
    });

    setIngestGroups((prev) => {
      const updated = prev.map((g) => {
        if (g.id === targetGroupId) {
          return { ...g, files: mergedFiles, notes: mergedNotes };
        }
        return g;
      });
      return updated.filter((g) => g.id === targetGroupId || !selectedIngestGroupIds.includes(g.id));
    });

    setSelectedIngestGroupIds([]);
  };

  const clearIngestGroups = () => {
    setIngestGroups([]);
    setSelectedIngestGroupIds([]);
  };

  const handleUpdateNotes = (groupId: string, notes: string) => {
    setIngestGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, notes } : g)));
  };

  const triggerBatchUpload = async () => {
    const pendingGroups = ingestGroups.filter((g) => g.status === 'pending');
    if (pendingGroups.length === 0) return;

    // Atelier Safety Cap: 20 items per batch.
    if (pendingGroups.length > 20) {
      notify.error('Atelier Safety Cap: You can upload a maximum of 20 garments at once. Please remove some items or process in smaller batches.');
      return;
    }

    setIsProcessingBatch(true);
    setBatchProgress({ total: pendingGroups.length, completed: 0, failed: 0 });
    const successfullyUploadedIds: string[] = [];

    // Snapshot for loop so React state changes don't desync the iteration.
    const snapshot = ingestGroups;

    for (let index = 0; index < snapshot.length; index++) {
      const group = snapshot[index];
      if (group.status !== 'pending') continue;

      setIngestGroups((prev) => prev.map((g, idx) => (idx === index ? { ...g, status: 'uploading' } : g)));

      try {
        const formData = new FormData();
        for (let i = 0; i < group.files.length; i++) {
          const compressed = await compressImage(group.files[i]);
          formData.append(`image_${i}`, compressed);
        }
        if (group.notes) formData.append('notes', group.notes);

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        const payload = data.data ?? data;
        if (!res.ok) throw new Error(data.error || 'Upload failed');

        successfullyUploadedIds.push(payload.item.id);
        setIngestGroups((prev) => prev.map((g, idx) => (idx === index ? { ...g, status: 'processing' } : g)));
        setBatchProgress((p) => (p ? { ...p, completed: p.completed + 1 } : p));
      } catch (err: any) {
        notify.error(err.message || 'Upload failed');
        setIngestGroups((prev) =>
          prev.map((g, idx) => (idx === index ? { ...g, status: 'failed', error: err.message } : g))
        );
        setBatchProgress((p) => (p ? { ...p, failed: p.failed + 1 } : p));
      }
    }

    if (successfullyUploadedIds.length > 0) {
      try {
        const processRes = await fetch('/api/ingest/batch-process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: successfullyUploadedIds }),
        });
        const processData = await processRes.json();
        if (processData.results?.length > 0) {
          const firstId = successfullyUploadedIds[0];
          // Look up the freshly-uploaded item for the validation modal.
          await onItemsChanged();
          // We have to re-find the item after refresh; use a small grace
          // period so the items array is populated.
          setTimeout(() => {
            const fresh = items.find((i) => i.id === firstId);
            if (fresh) onSelectForValidation(fresh);
          }, 600);
        }
      } catch (err) {
        console.error('Batch processing error:', err);
      }
    }

    setIngestGroups((prev) => prev.map((g) => (g.status === 'processing' ? { ...g, status: 'done' } : g)));
    setIsProcessingBatch(false);
    // Keep the progress chip visible for a moment so the user sees the
    // "done" state, then clear it.
    setTimeout(() => setBatchProgress(null), 3000);
  };

  const retryGroupUpload = async (groupId: string) => {
    setIngestGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, status: 'uploading', error: undefined } : g))
    );

    try {
      const groupIdx = ingestGroups.findIndex((g) => g.id === groupId);
      if (groupIdx === -1) return;
      const group = ingestGroups[groupIdx];

      const formData = new FormData();
      for (let i = 0; i < group.files.length; i++) {
        const compressed = await compressImage(group.files[i]);
        formData.append(`image_${i}`, compressed);
      }
      if (group.notes) formData.append('notes', group.notes);

      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      const payload = data.data ?? data;
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      setIngestGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, status: 'processing' } : g)));

      const processRes = await fetch('/api/ingest/batch-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [payload.item.id] }),
      });
      const processData = await processRes.json();
      if (!processRes.ok) throw new Error(processData.error || 'Processing failed');

      setIngestGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, status: 'done' } : g)));

      const fresh = items.find((i) => i.id === payload.item.id);
      if (fresh) onSelectForValidation(fresh);

      await onItemsChanged();
    } catch (err: any) {
      notify.error(err.message || 'Retry failed');
      setIngestGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, status: 'failed', error: err.message } : g))
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Full-page drag overlay — when files are being dragged over the
          window, fade in a terracotta tint so the user knows where to drop. */}
      {isDraggingOver && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[80] bg-[var(--accent-terracotta)]/10 backdrop-blur-[1px] flex items-center justify-center"
        >
          <div className="bg-white border-2 border-dashed border-[var(--accent-terracotta)] rounded-3xl px-12 py-8 shadow-2xl text-center">
            <p className="text-2xl mb-1">📥</p>
            <p className="text-sm font-extrabold text-[var(--accent-terracotta)]">Drop photos to ingest</p>
            <p className="text-[10px] text-[var(--text-secondary)] mt-1">First photo = primary; rest = detail shots</p>
          </div>
        </div>
      )}

      {/* Progress chip — visible only during/right-after a batch run. */}
      {batchProgress && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--accent-terracotta)]/5 border border-[var(--accent-terracotta)]/20 rounded-2xl">
          <div className="flex-1">
            <div className="flex items-center justify-between text-[10px] uppercase font-bold text-[var(--accent-terracotta)] mb-1.5">
              <span>
                {batchProgress.completed === batchProgress.total && !isProcessingBatch
                  ? '✓ Done'
                  : `Processing ${batchProgress.completed + 1} of ${batchProgress.total}`}
              </span>
              <span className="font-mono normal-case opacity-70">
                {batchProgress.completed}/{batchProgress.total}
                {batchProgress.failed > 0 && (
                  <span className="ml-2 text-rose-600">· {batchProgress.failed} failed</span>
                )}
              </span>
            </div>
            <div className="h-1.5 bg-[var(--accent-terracotta)]/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--accent-terracotta)] transition-all duration-300"
                style={{
                  width: `${Math.round(
                    ((batchProgress.completed + batchProgress.failed) / Math.max(1, batchProgress.total)) * 100
                  )}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}
      <input
        ref={detailCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handleDetailFilesSelected(e.target.files)}
        className="hidden"
      />
      <input
        ref={detailFilePickerRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => handleDetailFilesSelected(e.target.files)}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handleFilesSelected(e.target.files, true)}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={(e) => handleFilesSelected(e.target.files, false)}
        className="hidden"
      />

      <div className="border border-[#EAE5D9] bg-[var(--bg-card-secondary)] rounded-3xl p-6 tactile-shadow-md">
        <h2 className="text-base font-extrabold text-[var(--text-primary)] mb-1">Tactile Atelier Ingest Queue</h2>
        <p className="text-[var(--text-secondary)] text-xs mb-4">
          Select primary garment layout photos. Then, add detail shots (laundry tags, textures, sizing labels) under each card container. Gemini will synthesize the data concurrently to extract perfect tags.
        </p>

        {/* Tip cards — quick visual guide for what to photograph. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          {[
            { icon: '📐', title: 'Wide shot', body: 'Full garment flat or on hanger, neutral background.' },
            { icon: '🏷️', title: 'Tag close-up', body: 'Brand, size, fabric content. One per garment.' },
            { icon: '✨', title: 'Texture / detail', body: 'Optional. Highlights stitching, weave, or pattern.' },
          ].map((t) => (
            <div key={t.title} className="bg-white/70 border border-[#EAE5D9] rounded-2xl px-3 py-2.5">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--accent-terracotta)] flex items-center gap-1">
                <span aria-hidden="true">{t.icon}</span>
                {t.title}
              </p>
              <p className="text-[10px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">{t.body}</p>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          <div className="border-2 border-dashed border-[#DCD1C0] bg-white/50 rounded-3xl p-6 flex flex-col items-center justify-center gap-4 text-center">
            <div className="flex flex-col items-center gap-1.5 pointer-events-none">
              <svg className="w-8 h-8 text-[var(--accent-terracotta)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              <span className="text-xs font-bold text-[var(--text-primary)]">Add Primary Garment Photos</span>
            </div>

            <div className="flex w-full max-w-sm gap-3 mt-1">
              <button type="button" onClick={() => cameraInputRef.current?.click()} className="flex-1 py-3 text-xs font-black bg-[var(--accent-terracotta)] text-white rounded-full active:scale-[0.98] transition shadow-md flex items-center justify-center gap-1.5 hover:bg-[var(--accent-terracotta)]/90" style={{ minHeight: '44px' }}>
                📸 Take Photo
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex-1 py-3 text-xs font-bold bg-[var(--accent-sage)] text-white rounded-full active:scale-[0.98] transition shadow-md flex items-center justify-center gap-1.5 hover:bg-[var(--accent-sage)]/90" style={{ minHeight: '44px' }}>
                📁 Choose Files
              </button>
            </div>

            <div className="flex items-center justify-between w-full max-w-sm border-t border-[#EAE5D9] pt-3.5 mt-1 select-none">
              <span className="text-[10px] font-black uppercase text-[var(--text-secondary)] flex items-center gap-1.5">
                🔄 Continuous Snap Mode
              </span>
              <button
                type="button"
                onClick={() => setContinuousSnap(!continuousSnap)}
                className={`text-[9px] font-bold px-3 py-1.5 rounded-full border transition-all ${
                  continuousSnap
                    ? 'bg-[var(--accent-terracotta)]/15 text-[var(--accent-terracotta)] border-[var(--accent-terracotta)]/30 font-black'
                    : 'bg-white/60 text-[var(--text-secondary)] border-[#DCD1C0]'
                }`}
              >
                {continuousSnap ? 'ON (Auto-Open)' : 'OFF (Single-Snap)'}
              </button>
            </div>
          </div>

          {ingestGroups.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-[#EAE5D9]">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] font-bold">
                <span>Items Queue ({ingestGroups.length} items configured)</span>
                <div className="flex items-center gap-3">
                  {selectedIngestGroupIds.length >= 2 && (
                    <button onClick={handleMergeSelectedGroups} className="px-3 py-1 bg-[var(--accent-apricot)] text-[var(--text-primary)] font-black rounded-full text-[9px] hover:bg-[var(--accent-apricot)]/90 transition shadow-sm">
                      🔗 Merge Selected ({selectedIngestGroupIds.length})
                    </button>
                  )}
                  <button onClick={clearIngestGroups} className="text-[var(--accent-terracotta)] font-bold hover:underline">Clear All</button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {ingestGroups.map((group) => (
                  <div key={group.id} className="p-5 bg-white border border-[#EAE5D9] rounded-2xl flex flex-col justify-between space-y-4 relative tactile-shadow-sm">
                    <div className="flex items-center justify-between border-b border-[#F5F2EA] pb-2">
                      <label className="flex items-center gap-1.5 cursor-pointer text-[9px] text-[var(--text-secondary)] font-bold select-none">
                        <input
                          type="checkbox"
                          checked={selectedIngestGroupIds.includes(group.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIngestGroupIds((prev) => [...prev, group.id]);
                            } else {
                              setSelectedIngestGroupIds((prev) => prev.filter((id) => id !== group.id));
                            }
                          }}
                          className="w-3.5 h-3.5 rounded border-[#DCD1C0] text-[var(--accent-terracotta)] focus:ring-0 focus:ring-offset-0 bg-white"
                        />
                        Select to Merge
                      </label>
                      <button type="button" onClick={() => handleDeleteGroup(group.id)} className="text-[9px] font-bold text-[var(--accent-terracotta)] hover:underline">
                        ✕ Delete Card
                      </button>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center flex-wrap gap-3.5">
                        {group.files.map((file, fIdx) => (
                          <div key={fIdx} className="polaroid-frame w-14 h-14 shrink-0 relative">
                            <img src={URL.createObjectURL(file)} alt="" className="object-cover w-full h-full rounded-sm" />
                            {fIdx === 0 && (
                              <span className="absolute bottom-0 inset-x-0 bg-[var(--accent-sage)]/90 text-white text-[6px] font-black uppercase text-center py-0.5 rounded-b-sm">Primary</span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteFileFromGroup(group.id, fIdx)}
                              className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 bg-[var(--accent-terracotta)] text-white hover:bg-[var(--accent-terracotta)]/95 text-[8px] flex items-center justify-center rounded-full shadow-sm transition"
                              title="Remove image"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button onClick={() => triggerAddDetailCamera(group.id)} className="w-14 h-14 rounded-xl border-2 border-dashed border-[#DCD1C0] bg-[var(--bg-card-secondary)]/50 flex flex-col items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-card-secondary)] transition" title="Snap Tag Close-up or detail shot">
                          <span className="text-[10px]">📸</span>
                          <span className="text-[6px] font-bold uppercase tracking-wider mt-0.5">Snap</span>
                        </button>
                        <button onClick={() => triggerAddDetail(group.id)} className="w-14 h-14 rounded-xl border-2 border-dashed border-[#DCD1C0] bg-[var(--bg-card-secondary)]/50 flex flex-col items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-card-secondary)] transition" title="Add Tag Close-up or detail shot">
                          <span className="text-[10px]">+</span>
                          <span className="text-[6px] font-bold uppercase tracking-wider mt-0.5">Detail</span>
                        </button>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[8px] uppercase font-bold text-[var(--text-secondary)]">Staging notes (e.g. fit, location)</span>
                        <input
                          type="text"
                          value={group.notes}
                          onChange={(e) => handleUpdateNotes(group.id, e.target.value)}
                          className="w-full text-[10px] bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-terracotta)]/40"
                          placeholder="Brand details, sizing labels details..."
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] pt-2.5 border-t border-[#F5F2EA]">
                      <span className="text-[var(--text-secondary)] font-bold">Images: {group.files.length}</span>
                      <div className="flex items-center gap-2">
                        {group.status === 'failed' && (
                          <button type="button" onClick={() => retryGroupUpload(group.id)} className="px-2.5 py-1 rounded-full bg-[var(--accent-terracotta)]/10 text-[var(--accent-terracotta)] border border-[var(--accent-terracotta)]/20 hover:bg-[var(--accent-terracotta)]/20 transition text-[9px] font-bold">
                            🔄 Retry
                          </button>
                        )}
                        <span className={`font-bold text-[9px] px-2 py-0.5 rounded-full ${
                          group.status === 'done' ? 'bg-[var(--accent-sage)]/10 text-[var(--accent-sage)]' :
                          group.status === 'uploading' ? 'text-[var(--text-secondary)] animate-pulse' :
                          group.status === 'processing' ? 'text-[var(--accent-apricot)] animate-pulse' :
                          group.status === 'failed' ? 'bg-[var(--accent-terracotta)]/10 text-[var(--accent-terracotta)]' : 'text-zinc-550'
                        }`}>{group.status.toUpperCase()}</span>
                      </div>
                    </div>
                    {group.status === 'failed' && group.error && (
                      <div className="text-[9px] text-[var(--accent-terracotta)] bg-[var(--accent-terracotta)]/5 border border-[var(--accent-terracotta)]/10 rounded-xl p-2.5 mt-1.5 leading-relaxed font-mono">
                        ❌ Error: {group.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-3 py-3 border-t border-b border-[#EAE5D9] bg-stone-50/50 p-4 rounded-2xl select-none">
                <button type="button" onClick={() => cameraInputRef.current?.click()} className="flex-1 py-3 text-xs font-black bg-[var(--accent-terracotta)] text-white rounded-full active:scale-[0.98] transition shadow-md flex items-center justify-center gap-1.5 hover:bg-[var(--accent-terracotta)]/90" style={{ minHeight: '44px' }}>
                  📸 Take Photo
                </button>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="flex-1 py-3 text-xs font-bold bg-[var(--accent-sage)] text-white rounded-full active:scale-[0.98] transition shadow-md flex items-center justify-center gap-1.5 hover:bg-[var(--accent-sage)]/90" style={{ minHeight: '44px' }}>
                  📁 Add More
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={triggerBatchUpload}
        disabled={isProcessingBatch || ingestGroups.filter((g) => g.status === 'pending').length === 0}
        className="w-full py-4 text-sm font-black bg-[var(--accent-terracotta)] text-white rounded-full active:scale-[0.98] transition shadow-xl uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--accent-terracotta)]/90"
      >
        {isProcessingBatch
          ? '🔄 Uploading & Analyzing...'
          : `✨ Send ${ingestGroups.filter((g) => g.status === 'pending').length} Garment${
              ingestGroups.filter((g) => g.status === 'pending').length === 1 ? '' : 's'
            } to AI Stylist`}
      </button>
    </div>
  );
}