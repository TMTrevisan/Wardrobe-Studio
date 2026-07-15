'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import type { Garment } from '@/types/db';
import { CloseIcon, SparkleIcon } from './StudioIcons';

type Props = {
  garment: Garment;
  demoMode: boolean;
  onClose: () => void;
  onUpdated: (garment: Garment) => void;
  onDeleted: (garmentId: string) => void;
};

const categories = ['Tops', 'Outerwear', 'Bottoms', 'Footwear', 'Accessories', 'Dresses'];
const suggestedDetails = ['casual', 'minimal', 'everyday', 'layering'];

export function GarmentDrawer({ garment, demoMode, onClose, onUpdated, onDeleted }: Props) {
  const [draft, setDraft] = useState(garment);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [catalogImageFailed, setCatalogImageFailed] = useState(false);
  const [message, setMessage] = useState('');

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

  const save = async () => {
    if (demoMode) {
      onUpdated(draft);
      setMessage('Saved in preview mode');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draft.id,
          display_name: draft.display_name,
          category: draft.category,
          color_family: draft.color_family,
          hex_code: draft.hex_code,
          style_detail: draft.style_detail,
          pattern: draft.pattern,
          formality: draft.formality,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not save this garment.');
      onUpdated({ ...draft, ...(json.data?.item ?? {}) });
      setMessage('Changes saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save this garment.');
    } finally {
      setSaving(false);
    }
  };

  const generateCatalog = async () => {
    if (demoMode) {
      setMessage('Connect Supabase and OpenAI to generate a catalog cutout.');
      return;
    }
    if (!draft.catalog_source_ready) {
      setMessage('This garment has no retained source crop. Re-import a photo of it before creating a Studio catalog image.');
      return;
    }
    setGenerating(true);
    setMessage('Building a source-grounded catalog image…');
    try {
      const response = await fetch('/api/catalog/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garmentId: draft.id }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Catalog generation failed.');
      const updated = {
        ...draft,
        catalog_status: 'ready' as const,
        primary_image_url: json.data?.url ?? draft.primary_image_url,
        catalog_asset_url: json.data?.url ?? draft.catalog_asset_url,
      };
      setDraft(updated);
      onUpdated(updated);
      setMessage('Catalog image ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Catalog generation failed.';
      const failed = { ...draft, catalog_status: 'failed' as const };
      setDraft(failed);
      onUpdated(failed);
      setMessage(`${message} You can retry now.`);
    } finally {
      setGenerating(false);
    }
  };

  const deleteGarment = async () => {
    const label = draft.display_name || draft.sub_category || 'this garment';
    if (!window.confirm(`Delete ${label}? This permanently removes its saved source and catalog images.`)) return;
    if (demoMode) {
      onDeleted(draft.id);
      onClose();
      return;
    }
    setDeleting(true);
    setMessage('');
    try {
      const response = await fetch(`/api/items?id=${encodeURIComponent(draft.id)}`, { method: 'DELETE' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not delete this garment.');
      onDeleted(draft.id);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete this garment.');
    } finally {
      setDeleting(false);
    }
  };

  const update = <K extends keyof Garment>(key: K, value: Garment[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const image = catalogImageFailed
    ? draft.source_asset_url || draft.primary_image_url
    : draft.catalog_asset_url || draft.source_asset_url || draft.primary_image_url;
  const details = Array.from(new Set([...(draft.style_detail?.split(',').map((tag) => tag.trim()).filter(Boolean) ?? []), ...suggestedDetails])).slice(0, 4);

  return (
    <div className="drawer-layer" role="dialog" aria-modal="true" aria-label={`Edit ${draft.display_name || draft.sub_category}`}>
      <button className="drawer-scrim" onClick={onClose} aria-label="Close garment details" />
      <aside className="garment-drawer">
        <header className="drawer-hero">
          <span className="drawer-kicker">{draft.category}</span>
          <button className="icon-button drawer-close" onClick={onClose} aria-label="Close"><CloseIcon /></button>
          {image ? <Image src={image} alt={draft.display_name || draft.sub_category} width={900} height={900} unoptimized onError={() => setCatalogImageFailed(true)} /> : <div className="image-placeholder" />}
          <span className={`asset-badge ${draft.catalog_status === 'ready' ? 'ready' : ''}`}>
            {draft.catalog_status === 'ready' ? 'AI catalog cutout' : 'Source crop'}
          </span>
        </header>

        <div className="drawer-form">
          <div className="form-grid two">
            <label><span>Name</span><input value={draft.display_name || ''} onChange={(event) => update('display_name', event.target.value)} /></label>
            <label><span>Category</span><select value={draft.category} onChange={(event) => update('category', event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
          </div>

          <section className="form-section">
            <p className="field-heading">Colors</p>
            <div className="color-editor">
              <input className="color-input" type="color" value={draft.hex_code || '#c8bda9'} onChange={(event) => update('hex_code', event.target.value)} aria-label="Primary garment color" />
              <label className="color-name"><span>Primary color</span><input value={draft.color_family || ''} onChange={(event) => update('color_family', event.target.value)} /></label>
              <code>{(draft.hex_code || '#c8bda9').toUpperCase()}</code>
            </div>
            <div className="swatch-row" aria-label="Suggested colors">
              {[draft.hex_code || '#c8bda9', '#ece6d8', '#9fa7b4', '#607a9f', '#8d6b4c'].map((color) => <button key={color} style={{ backgroundColor: color }} onClick={() => update('hex_code', color)} aria-label={`Use ${color}`} />)}
            </div>
          </section>

          <section className="form-section">
            <p className="field-heading">Details</p>
            <div className="tag-row">{details.map((detail) => <span key={detail}>{detail}</span>)}</div>
            <div className="form-grid two compact">
              <label><span>Pattern</span><input value={draft.pattern || ''} onChange={(event) => update('pattern', event.target.value)} placeholder="Solid" /></label>
              <label><span>Dress code</span><input value={draft.formality || ''} onChange={(event) => update('formality', event.target.value)} placeholder="Casual" /></label>
            </div>
          </section>

          <div className="catalog-callout">
            <div><SparkleIcon /><span><strong>Studio catalog image</strong><small>{draft.catalog_source_ready ? 'Reconstruct this exact item as a clean ecommerce cutout.' : 'Re-import a source photo to enable reconstruction.'}</small></span></div>
            <button onClick={generateCatalog} disabled={generating || !draft.catalog_source_ready}>{generating ? 'Generating…' : draft.catalog_status === 'ready' ? 'Regenerate' : 'Generate'}</button>
          </div>

          {message && <p className="drawer-message" role="status">{message}</p>}
          <footer className="drawer-actions">
            <button className="button-danger" onClick={deleteGarment} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
            <button className="button-secondary" onClick={onClose}>Cancel</button>
            <button className="button-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save garment'}</button>
          </footer>
        </div>
      </aside>
    </div>
  );
}
