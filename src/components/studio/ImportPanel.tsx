'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { GooglePhotosButton } from './GooglePhotosButton';
import { CheckIcon, CloseIcon, FolderIcon, ImageIcon, SparkleIcon, UploadIcon } from './StudioIcons';
import { getDetectionPreviewLayout, type NormalizedBoundingBox } from '@/lib/image/detection-preview';
import { runCatalogBatch, type CatalogBatchResult } from '@/lib/ai/catalog-batch';

type Detection = {
  id: string;
  category: string;
  sub_category?: string | null;
  description?: string | null;
  confidence: number;
  colors?: Array<{ name?: string; hex?: string }>;
  bbox?: NormalizedBoundingBox;
  source_preview_url?: string | null;
  source_width?: number;
  source_height?: number;
  source_filename?: string | null;
};

type Props = { demoMode: boolean; onClose: () => void; onApproved: () => void };
type CreatedGarment = { id: string; display_name?: string | null; sub_category?: string | null };
type Stage = 'choose' | 'preview' | 'scanning' | 'review' | 'approving' | 'cataloging' | 'done';

export function ImportPanel({ demoMode, onClose, onApproved }: Props) {
  const [stage, setStage] = useState<Stage>('choose');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generateAfterApproval, setGenerateAfterApproval] = useState(true);
  const [createdGarments, setCreatedGarments] = useState<CreatedGarment[]>([]);
  const [batchResults, setBatchResults] = useState<CatalogBatchResult[]>([]);
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const chooseFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const chosen = Array.from(list).filter((file) => file.type.startsWith('image/')).slice(0, 60);
    previews.forEach(URL.revokeObjectURL);
    setFiles(chosen);
    setPreviews(chosen.slice(0, 12).map(URL.createObjectURL));
    setStage('preview');
    setError('');
  };

  const analyzeImport = useCallback(async (importId: string) => {
    setStage('scanning');
    const response = await fetch(`/api/imports/${importId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: importId }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'The photo scan failed.');
    const found: Detection[] = json.data?.detections ?? [];
    setDetections(found);
    setSelected(new Set(found.filter((item) => item.confidence >= 0.55).map((item) => item.id)));
    setStage('review');
  }, []);

  const uploadAndAnalyze = async () => {
    if (!files.length) return;
    if (demoMode) {
      setError('Photo analysis requires a signed-in Wardrobe Studio account. No garments were created.');
      setStage('preview');
      return;
    }
    setStage('scanning');
    setError('');
    try {
      const form = new FormData();
      form.set('source', 'device_picker');
      form.set('name', `Photo import ${new Date().toLocaleDateString()}`);
      files.forEach((file) => form.append('photos', file));
      const response = await fetch('/api/imports', { method: 'POST', body: form });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Photos could not be uploaded.');
      await analyzeImport(json.data?.importId);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Photos could not be processed.');
      setStage('preview');
    }
  };

  const googleError = useCallback((message: string) => setError(message), []);
  const googleImported = useCallback(async ({ importId }: { importId: string; uploaded: number }) => {
    try { await analyzeImport(importId); } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Google Photos could not be analyzed.');
      setStage('choose');
    }
  }, [analyzeImport]);

  const generateCatalogBatch = async (garments: CreatedGarment[]) => {
    if (!garments.length) return;
    setStage('cataloging');
    setBatchResults([]);
    setBatchProgress({ completed: 0, total: garments.length });
    const results = await runCatalogBatch(garments.map((garment) => garment.id), async (garmentId) => {
      const response = await fetch('/api/catalog/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garmentId }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Catalog generation failed.');
    }, {
      concurrency: 2,
      onProgress: (completed, total) => setBatchProgress({ completed, total }),
    });
    setBatchResults(results);
    setStage('done');
    onApproved();
  };

  const approve = async () => {
    if (!selected.size) return;
    if (demoMode) {
      setStage('done');
      onApproved();
      return;
    }
    setStage('approving');
    try {
      const response = await fetch('/api/detections/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detectionIds: Array.from(selected) }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Garments could not be created.');
      const created: CreatedGarment[] = json.data?.items ?? [];
      if (!created.length) throw new Error('No garment crops could be created from the selected detections.');
      setCreatedGarments(created);
      onApproved();
      if (generateAfterApproval) await generateCatalogBatch(created);
      else setStage('done');
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : 'Garments could not be created.');
      setStage('review');
    }
  };

  return (
    <div className="import-layer" role="dialog" aria-modal="true" aria-label="Import wardrobe photos">
      <button className="drawer-scrim" onClick={onClose} aria-label="Close import" />
      <section className="import-panel">
        <header className="import-header">
          <div><span className="eyebrow">Wardrobe intake</span><h2>{stage === 'review' ? 'We found these pieces' : stage === 'approving' ? 'Preparing your pieces' : stage === 'cataloging' ? 'Creating your catalog' : stage === 'done' ? 'Your wardrobe is growing' : 'Turn photos into a closet'}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </header>

        {stage === 'choose' && <div className="import-body choose-stage">
          <div className="import-intro"><span className="intro-mark"><SparkleIcon /></span><p>Choose photos where you’re wearing outfits. Gemini finds every visible layer, then you approve what becomes a garment.</p></div>
          <div className="source-list">
            <button className="source-option" onClick={() => fileRef.current?.click()}><span className="source-icon"><ImageIcon /></span><span><strong>Phone or computer</strong><small>Select outfit photos or individual items</small></span><span className="source-arrow">→</span></button>
            <button className="source-option" onClick={() => folderRef.current?.click()}><span className="source-icon"><FolderIcon /></span><span><strong>Photo folder</strong><small>Scan a larger local camera-roll export</small></span><span className="source-arrow">→</span></button>
            <GooglePhotosButton onImported={googleImported} onError={googleError} />
          </div>
          <input ref={fileRef} className="sr-only" type="file" accept="image/*" multiple onChange={(event) => chooseFiles(event.target.files)} />
          <input ref={folderRef} className="sr-only" type="file" accept="image/*" multiple {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={(event) => chooseFiles(event.target.files)} />
          <p className="privacy-note">Original photos stay private. Only approved garment crops enter your wardrobe.</p>
          {error && <p className="panel-error" role="alert">{error}</p>}
        </div>}

        {stage === 'preview' && <div className="import-body preview-stage">
          <div className="photo-preview-grid">{previews.map((src, index) => <Image key={src} src={src} alt={`Selected photo ${index + 1}`} width={180} height={225} unoptimized />)}{files.length > previews.length && <div className="more-photos">+{files.length - previews.length}</div>}</div>
          <div className="selection-summary"><div><strong>{files.length} photo{files.length === 1 ? '' : 's'} selected</strong><small>People, backgrounds, and duplicate clothes will be filtered.</small></div><button className="text-button" onClick={() => setStage('choose')}>Choose again</button></div>
          {error && <p className="panel-error" role="alert">{error}</p>}
          <button className="button-primary wide" onClick={uploadAndAnalyze}><UploadIcon /> Find my clothes</button>
        </div>}

        {stage === 'scanning' && <div className="import-body scanning-stage"><div className="scanner-orbit"><SparkleIcon /></div><h3>Looking through your outfits</h3><p>Finding shirts, layers, pants, shoes, and accessories. This can take a minute for a large selection.</p><div className="scan-line"><span /></div></div>}

        {stage === 'approving' && <div className="import-body approving-stage"><div className="scanner-orbit"><SparkleIcon /></div><h3>Preparing your pieces</h3><p>Cropping the garments you approved and adding them to your wardrobe. Polished image generation starts after this step.</p><div className="scan-line"><span /></div></div>}

        {stage === 'review' && <div className="import-body review-stage">
          <p className="review-copy">Select the pieces you actually own. We’ll crop each one and prepare it for a polished catalog image.</p>
          <div className="detection-list">{detections.map((detection) => {
            const checked = selected.has(detection.id);
            const color = detection.colors?.[0]?.hex || '#d8d1c5';
            const preview = detection.bbox && detection.source_preview_url
              ? getDetectionPreviewLayout(
                detection.bbox,
                detection.source_width || 1,
                detection.source_height || 1,
              )
              : null;
            return <button className={`detection-row ${checked ? 'selected' : ''}`} key={detection.id} onClick={() => setSelected((current) => { const next = new Set(current); if (checked) next.delete(detection.id); else next.add(detection.id); return next; })}>
              <span className="detection-check">{checked && <CheckIcon />}</span>
              <span className="detection-visual">
                {preview ? <span className="detection-preview" style={preview.frame}>
                  {/* A signed URL keeps the private source photo visible only during review. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={detection.source_preview_url!} alt="" style={preview.image} />
                </span> : <span className="detection-swatch" style={{ backgroundColor: color }} />}
              </span>
              <span className="detection-copy"><strong>{detection.description || detection.sub_category || detection.category}</strong><small>{detection.category} · {Math.round(detection.confidence * 100)}% confidence{detection.source_filename ? ` · ${detection.source_filename}` : ''}</small></span>
            </button>;
          })}</div>
          {error && <p className="panel-error" role="alert">{error}</p>}
          <label className="batch-choice">
            <input type="checkbox" checked={generateAfterApproval} onChange={(event) => setGenerateAfterApproval(event.target.checked)} />
            <span><strong>Create polished images now</strong><small>Runs one GPT Image generation for each approved garment.</small></span>
          </label>
          <div className="review-actions"><span>{selected.size} selected</span><button className="button-primary" onClick={approve} disabled={!selected.size}>{generateAfterApproval ? 'Add & create images' : 'Add to wardrobe'}</button></div>
        </div>}

        {stage === 'cataloging' && <div className="import-body cataloging-stage">
          <div className="scanner-orbit"><SparkleIcon /></div>
          <h3>Reconstructing your clothes</h3>
          <p>Creating clean, source-grounded catalog images. Keep this window open while the batch finishes.</p>
          <strong>{batchProgress.completed} of {batchProgress.total}</strong>
          <div className="batch-progress" aria-label={`${batchProgress.completed} of ${batchProgress.total} catalog images complete`}><span style={{ width: `${batchProgress.total ? (batchProgress.completed / batchProgress.total) * 100 : 0}%` }} /></div>
        </div>}

        {stage === 'done' && <div className="import-body done-stage"><span className="done-mark"><CheckIcon /></span><h3>Pieces added</h3><p>{batchResults.length ? `${batchResults.filter((result) => result.ok).length} of ${batchResults.length} polished catalog images are ready.` : `${createdGarments.length} source crop${createdGarments.length === 1 ? ' is' : 's are'} ready.`}</p>{batchResults.some((result) => !result.ok) && <button className="button-secondary" onClick={() => void generateCatalogBatch(createdGarments.filter((garment) => batchResults.some((result) => result.garmentId === garment.id && !result.ok)))}>Retry {batchResults.filter((result) => !result.ok).length} failed</button>}<button className="button-primary" onClick={onClose}>See my wardrobe</button></div>}
      </section>
    </div>
  );
}
