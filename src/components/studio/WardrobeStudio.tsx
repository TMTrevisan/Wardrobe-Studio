'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import type { Garment } from '@/types/db';
import { demoGarments } from '@/lib/demo-garments';
import { GarmentDrawer } from './GarmentDrawer';
import { ImportPanel } from './ImportPanel';
import { MoreIcon, PlusIcon, SparkleIcon } from './StudioIcons';
import { runCatalogBatch } from '@/lib/ai/catalog-batch';
import { supabase } from '@/lib/supabase';

type Props = { demoMode?: boolean };
type View = 'All' | 'Tops' | 'Jackets' | 'Bottoms' | 'Accessories' | 'Shoes' | 'Outfits';

const views: View[] = ['All', 'Tops', 'Jackets', 'Bottoms', 'Accessories', 'Shoes', 'Outfits'];

function matchesView(garment: Garment, view: View) {
  if (view === 'All') return true;
  if (view === 'Tops') return garment.category === 'Tops';
  if (view === 'Jackets') return garment.category === 'Outerwear';
  if (view === 'Bottoms') return garment.category === 'Bottoms';
  if (view === 'Accessories') return garment.category === 'Accessories';
  if (view === 'Shoes') return garment.category === 'Footwear';
  return false;
}

export function WardrobeStudio({ demoMode = false }: Props) {
  const [garments, setGarments] = useState<Garment[]>(demoMode ? demoGarments : []);
  const [view, setView] = useState<View>('All');
  const [selected, setSelected] = useState<Garment | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [batchStatus, setBatchStatus] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const recoverFromUnauthorized = useCallback(async () => {
    // A persisted browser session can outlive its refresh token. Do not leave
    // the user on an unrecoverable "Try again" panel in that state.
    await supabase.auth.signOut({ scope: 'local' });
    setGarments([]);
    setSelected(null);
    setError('Your session expired. Please sign in again.');
  }, []);

  const loadGarments = useCallback(async () => {
    if (demoMode) return;
    setLoading(true);
    try {
      const response = await fetch('/api/items');
      const json = await response.json();
      if (response.status === 401) {
        const { data, error: refreshError } = await supabase.auth.refreshSession();
        if (!refreshError && data.session) {
          const retry = await fetch('/api/items');
          const retryJson = await retry.json();
          if (retry.ok) {
            setGarments(retryJson.data?.items ?? retryJson.items ?? []);
            setError('');
            return;
          }
        }
        await recoverFromUnauthorized();
        return;
      }
      if (!response.ok) throw new Error(json.error || 'Could not load your wardrobe.');
      setGarments(json.data?.items ?? json.items ?? []);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your wardrobe.');
    } finally {
      setLoading(false);
    }
  }, [demoMode, recoverFromUnauthorized]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadGarments(), 0);
    return () => window.clearTimeout(task);
  }, [loadGarments]);

  const visible = useMemo(() => garments.filter((garment) => matchesView(garment, view)), [garments, view]);
  const updateGarment = (updated: Garment) => {
    setGarments((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelected(updated);
  };
  const deleteGarment = (garmentId: string) => {
    setGarments((current) => current.filter((item) => item.id !== garmentId));
    setSelected(null);
  };

  const openGarment = (garment: Garment) => {
    setSelected(garment);
    window.history.pushState({ wardrobeStudioGarment: garment.id }, '', `#garment=${encodeURIComponent(garment.id)}`);
  };

  const closeGarment = () => {
    if (window.location.hash.startsWith('#garment=')) {
      window.history.back();
      return;
    }
    setSelected(null);
  };

  useEffect(() => {
    const closeDrawerOnBack = () => setSelected(null);
    window.addEventListener('popstate', closeDrawerOnBack);
    return () => window.removeEventListener('popstate', closeDrawerOnBack);
  }, []);

  const createCatalogBatch = async (requestedIds: string[]) => {
    const eligible = garments.filter((garment) => requestedIds.includes(garment.id) && garment.catalog_status !== 'ready' && garment.catalog_source_ready);
    setMenuOpen(false);
    if (!eligible.length) {
      setBatchStatus('Select pieces with a retained source image that still need a catalog image.');
      return;
    }
    if (!window.confirm(`Create ${eligible.length} polished catalog images? This runs one paid GPT Image request per piece at low quality.`)) return;
    setBatchStatus(`Creating 0 of ${eligible.length} images…`);
    const results = await runCatalogBatch(eligible.map((garment) => garment.id), async (garmentId) => {
      const response = await fetch('/api/catalog/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garmentId }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Catalog generation failed.');
    }, {
      concurrency: 2,
      onProgress: (completed, total) => setBatchStatus(`Creating ${completed} of ${total} images…`),
    });
    await loadGarments();
    const ready = results.filter((result) => result.ok).length;
    setBatchStatus(`${ready} of ${results.length} polished images created${ready < results.length ? '; failed pieces can be retried from this menu.' : '.'}`);
    setSelectedIds(new Set(results.filter((result) => !result.ok).map((result) => result.garmentId)));
  };

  const toggleSelection = (garmentId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(garmentId)) next.delete(garmentId);
      else next.add(garmentId);
      return next;
    });
  };

  const closeSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const deleteSelected = async () => {
    const selected = Array.from(selectedIds);
    if (!selected.length) return;
    if (!window.confirm(`Delete ${selected.length} selected garment${selected.length === 1 ? '' : 's'}? This permanently removes their images and cannot be undone.`)) return;
    const results = await Promise.all(selected.map(async (id) => {
      const response = await fetch(`/api/items?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      return response.ok;
    }));
    const deleted = results.filter(Boolean).length;
    setGarments((current) => current.filter((garment) => !selectedIds.has(garment.id) || !results[selected.indexOf(garment.id)]));
    setBatchStatus(`${deleted} of ${selected.length} selected garments deleted.`);
    closeSelection();
  };

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="brand-lockup"><span className="brand-mark">W</span><div><strong>WARDROBE</strong><small>Studio</small></div></div>
        <div className="header-meta"><span>{garments.length} pieces</span><button className="selection-toggle" onClick={() => selectionMode ? closeSelection() : setSelectionMode(true)}>{selectionMode ? 'Done selecting' : 'Select'}</button><div className="header-menu-wrap"><button className="icon-button" aria-label="More options" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreIcon /></button>{menuOpen && <div className="header-menu"><button onClick={() => { setMenuOpen(false); setImportOpen(true); }}>Import photos</button><button onClick={() => { setMenuOpen(false); void loadGarments(); }}>Refresh wardrobe</button><button onClick={() => { setMenuOpen(false); setSelectionMode(true); }}>Select garments for catalog images</button></div>}</div></div>
      </header>

      {batchStatus && <div className="bulk-status" role="status">{batchStatus}<button onClick={() => setBatchStatus('')} aria-label="Dismiss">×</button></div>}
      {selectionMode && <div className="selection-toolbar"><span><strong>{selectedIds.size}</strong> selected</span><div><button onClick={() => void createCatalogBatch(Array.from(selectedIds))} disabled={!selectedIds.size}>Generate / retry images</button><button className="selection-danger" onClick={() => void deleteSelected()} disabled={!selectedIds.size}>Delete selected</button><button onClick={closeSelection}>Done</button></div></div>}

      <nav className="category-nav" aria-label="Wardrobe categories">
        {views.map((item) => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item}</button>)}
      </nav>

      {demoMode && <div className="preview-banner"><span>Preview wardrobe</span><p>Add Supabase keys to use your existing closet and imports.</p></div>}
      {error && <div className="studio-error" role="alert">{error}<button onClick={() => void loadGarments()}>Try again</button><button onClick={() => void recoverFromUnauthorized()}>Sign out &amp; sign in again</button></div>}

      {view === 'Outfits' ? (
        <section className="outfit-stage">
          <div className="outfit-editorial">
            <div className="outfit-copy"><span className="eyebrow">Personal styling</span><h1>Make more of what you already own.</h1><p>Choose a piece and Wardrobe will build combinations from your closet, then render the strongest looks on you.</p><button className="button-dark" onClick={() => setView('All')}>Choose a starting piece</button></div>
            <div className="outfit-collage">{garments.slice(0, 4).map((garment) => garment.primary_image_url && <Image key={garment.id} src={garment.primary_image_url} alt="" width={500} height={600} unoptimized />)}<span><SparkleIcon /></span></div>
          </div>
        </section>
      ) : (
        <section className="wardrobe-stage" aria-busy={loading}>
          <div className="section-heading"><div><span className="eyebrow">Collection</span><h1>{view === 'All' ? 'Everything you own' : view}</h1></div><span>{visible.length.toString().padStart(2, '0')}</span></div>
          {loading ? <div className="wardrobe-grid loading-grid">{Array.from({ length: 12 }, (_, index) => <div key={index} className="garment-skeleton" />)}</div> : visible.length ? (
            <div className="wardrobe-grid">{visible.map((garment) => {
              const image = garment.catalog_asset_url || garment.primary_image_url;
              const isSelected = selectedIds.has(garment.id);
              return <button className={`garment-tile ${selectionMode ? 'selection-mode' : ''} ${isSelected ? 'selected' : ''}`} key={garment.id} aria-pressed={selectionMode ? isSelected : undefined} onClick={() => selectionMode ? toggleSelection(garment.id) : openGarment(garment)}>
                <span className="garment-image">{image ? <Image src={image} alt={garment.display_name || garment.sub_category} width={600} height={730} unoptimized /> : <span className="empty-garment"><PlusIcon /></span>}{garment.catalog_status === 'ready' && <span className="catalog-dot" title="Catalog image ready" />}</span>
                {selectionMode && <span className="tile-selection" aria-hidden="true">{isSelected ? '✓' : ''}</span>}
                <span className="garment-label"><strong>{garment.display_name || garment.sub_category}</strong><small>{garment.color_family || garment.category}</small></span>
              </button>;
            })}</div>
          ) : <div className="empty-wardrobe"><SparkleIcon /><h2>No pieces here yet</h2><p>Import outfit photos and we’ll find the clothes for you.</p><button className="button-primary" onClick={() => setImportOpen(true)}>Import photos</button></div>}
        </section>
      )}

      <button className="floating-import" onClick={() => setImportOpen(true)}><PlusIcon /><span>Add photos</span></button>

      {selected && <GarmentDrawer key={selected.id} garment={selected} demoMode={demoMode} onClose={closeGarment} onUpdated={updateGarment} onDeleted={deleteGarment} />}
      {importOpen && <ImportPanel demoMode={demoMode} onClose={() => setImportOpen(false)} onApproved={loadGarments} />}
    </main>
  );
}
