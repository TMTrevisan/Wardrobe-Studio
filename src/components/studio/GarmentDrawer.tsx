'use client';

import { useEffect, useMemo, useState } from 'react';
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

const categories = ['Tops', 'Outerwear', 'Tailoring', 'Bottoms', 'Footwear', 'Accessories', 'Dresses'];
export function GarmentDrawer({ garment, demoMode, onClose, onUpdated, onDeleted }: Props) {
  const [draft, setDraft] = useState(garment);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [catalogImageFailed, setCatalogImageFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [heroUrl, setHeroUrl] = useState<string | null>(null);

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
          brand: draft.brand,
          sub_category: draft.sub_category,
          color_family: draft.color_family,
          hex_code: draft.hex_code,
          tonal_value: draft.tonal_value,
          fabric_type: draft.fabric_type,
          fit_block: draft.fit_block,
          style_detail: draft.style_detail,
          pattern: draft.pattern,
          season: draft.season,
          formality: draft.formality,
          size_label: draft.size_label,
          price: draft.price,
          purchase_year: draft.purchase_year,
          status: draft.status,
          notes: draft.notes,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not save this garment.');
      onUpdated({ ...draft, ...(json.data?.item ?? {}) });
      onClose();
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
  const defaultHero = catalogImageFailed
    ? draft.source_asset_url || draft.primary_image_url
    : draft.catalog_asset_url || draft.source_asset_url || draft.primary_image_url;
  const image = heroUrl ?? defaultHero;

  // One horizontal rail of every evidence image and Studio asset, sorted by
  // purpose: originals, source crop, generated background, catalog cutouts.
  // Each thumb carries a small kind chip so the rail stays compact while
  // every provenance role is still distinguishable.
  const gallery = useMemo(() => {
    const allImages = (draft.images || []) as Array<any>;
    const allAssets = (draft.assets || []) as Array<any>;
    const originals = allImages
      .filter((img) => img?.url)
      .map((img) => ({ id: img.id, url: img.url as string, kind: 'Original', primary: !!img.is_primary_profile }));
    const sourceCrops = allAssets
      .filter((asset) => asset?.kind === 'source_crop' && asset?.url)
      .map((asset) => ({ id: asset.id, url: asset.url as string, kind: 'Source', primary: false }));
    const chroma = allAssets
      .filter((asset) => asset?.kind === 'catalog_chroma' && asset?.url)
      .map((asset) => ({ id: asset.id, url: asset.url as string, kind: 'Chroma', primary: false }));
    const cutouts = allAssets
      .filter((asset) => asset?.kind === 'catalog_cutout' && asset?.url)
      .sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary))
      .map((asset) => ({ id: asset.id, url: asset.url as string, kind: 'Catalog', primary: !!asset.is_primary }));
    return [...originals, ...sourceCrops, ...chroma, ...cutouts];
  }, [draft.images, draft.assets]);

  // Reset the selected hero when the underlying garment changes (drawer reuse).
  useEffect(() => {
    setHeroUrl(null);
  }, [draft.id]);

  const details = Array.from(new Set(draft.style_detail?.split(',').map((tag) => tag.trim()).filter(Boolean) ?? []));
  const [newDetail, setNewDetail] = useState('');
  const addDetail = () => {
    const tag = newDetail.trim();
    if (!tag || details.some((detail) => detail.toLowerCase() === tag.toLowerCase())) return;
    update('style_detail', [...details, tag].join(', '));
    setNewDetail('');
  };
  const removeDetail = (detail: string) => update('style_detail', details.filter((tag) => tag !== detail).join(', ') || null);

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

        {gallery.length > 0 && (
          <section className="drawer-gallery" aria-label="All garment images and generated assets">
            <div className="drawer-gallery-rail" role="listbox" aria-label="Image gallery">
              {gallery.map((item) => {
                const isActive = image === item.url;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`drawer-gallery-thumb${isActive ? ' active' : ''}${item.primary ? ' primary' : ''} kind-${item.kind.toLowerCase()}`}
                    onClick={() => setHeroUrl(item.url)}
                    aria-label={`${item.kind} image`}
                    aria-pressed={isActive}
                  >
                    <Image src={item.url} alt="" width={96} height={96} unoptimized />
                    <span className="drawer-gallery-chip">{item.primary ? `★ ${item.kind}` : item.kind}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="drawer-form">
          <div className="form-grid two">
            <label><span>Name</span><input value={draft.display_name || ''} onChange={(event) => update('display_name', event.target.value)} /></label>
            <label><span>Category</span><select value={draft.category} onChange={(event) => update('category', event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label><span>Brand</span><input value={draft.brand || ''} onChange={(event) => update('brand', event.target.value || null)} /></label>
            <label><span>Sub-category</span><input value={draft.sub_category || ''} onChange={(event) => update('sub_category', event.target.value)} /></label>
            <label><span>Fabric</span><input value={draft.fabric_type || ''} onChange={(event) => update('fabric_type', event.target.value || null)} /></label>
            <label><span>Fit</span><input value={draft.fit_block || ''} onChange={(event) => update('fit_block', event.target.value || null)} /></label>
            <label><span>Size</span><input value={draft.size_label || ''} onChange={(event) => update('size_label', event.target.value || null)} /></label>
            <label><span>Price</span><input type="number" min="0" step="0.01" value={draft.price ?? 0} onChange={(event) => update('price', Number(event.target.value) || 0)} /></label>
          </div>

          <section className="form-section">
            <p className="field-heading">Colors</p>
            <div className="color-editor">
              <input className="color-input" type="color" value={draft.hex_code || '#c8bda9'} onChange={(event) => update('hex_code', event.target.value)} aria-label="Primary garment color" />
              <label className="color-name"><span>Primary color</span><input value={draft.color_family || ''} onChange={(event) => update('color_family', event.target.value)} /></label>
              <code>{(draft.hex_code || '#c8bda9').toUpperCase()}</code>
            </div>
            <p className="drawer-hint">Primary color should describe the garment itself. Accent/print color support is being restored separately; unrelated palette swatches have been removed.</p>
          </section>

          <section className="form-section">
            <p className="field-heading">Details</p>
            <div className="tag-row">{details.map((detail) => <span key={detail}>{detail}<button type="button" onClick={() => removeDetail(detail)} aria-label={`Remove ${detail}`}>×</button></span>)}</div>
            <div className="detail-adder"><input value={newDetail} onChange={(event) => setNewDetail(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addDetail(); } }} placeholder="Add a detail" /><button type="button" onClick={addDetail}>+</button></div>
            <div className="form-grid two compact">
              <label><span>Pattern</span><input value={draft.pattern || ''} onChange={(event) => update('pattern', event.target.value)} placeholder="Solid" /></label>
              <label><span>Dress code</span><input value={draft.formality || ''} onChange={(event) => update('formality', event.target.value)} placeholder="Casual" /></label>
            </div>
            <label className="notes-field"><span>Notes</span><textarea value={draft.notes || ''} onChange={(event) => update('notes', event.target.value || null)} placeholder="Fit, care, purchase, or styling notes" /></label>
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
