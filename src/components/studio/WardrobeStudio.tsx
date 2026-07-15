'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import type { Garment } from '@/types/db';
import { demoGarments } from '@/lib/demo-garments';
import { GarmentDrawer } from './GarmentDrawer';
import { ImportPanel } from './ImportPanel';
import { MoreIcon, PlusIcon, SparkleIcon } from './StudioIcons';

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

  const loadGarments = useCallback(async () => {
    if (demoMode) return;
    setLoading(true);
    try {
      const response = await fetch('/api/items');
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not load your wardrobe.');
      setGarments(json.data?.items ?? json.items ?? []);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your wardrobe.');
    } finally {
      setLoading(false);
    }
  }, [demoMode]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadGarments(), 0);
    return () => window.clearTimeout(task);
  }, [loadGarments]);

  const visible = useMemo(() => garments.filter((garment) => matchesView(garment, view)), [garments, view]);
  const updateGarment = (updated: Garment) => {
    setGarments((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelected(updated);
  };

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="brand-lockup"><span className="brand-mark">W</span><div><strong>WARDROBE</strong><small>Studio</small></div></div>
        <div className="header-meta"><span>{garments.length} pieces</span><button className="icon-button" aria-label="More options"><MoreIcon /></button></div>
      </header>

      <nav className="category-nav" aria-label="Wardrobe categories">
        {views.map((item) => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item}</button>)}
      </nav>

      {demoMode && <div className="preview-banner"><span>Preview wardrobe</span><p>Add Supabase keys to use your existing closet and imports.</p></div>}
      {error && <div className="studio-error" role="alert">{error}<button onClick={loadGarments}>Try again</button></div>}

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
              return <button className="garment-tile" key={garment.id} onClick={() => setSelected(garment)}>
                <span className="garment-image">{image ? <Image src={image} alt={garment.display_name || garment.sub_category} width={600} height={730} unoptimized /> : <span className="empty-garment"><PlusIcon /></span>}{garment.catalog_status === 'ready' && <span className="catalog-dot" title="Catalog image ready" />}</span>
                <span className="garment-label"><strong>{garment.display_name || garment.sub_category}</strong><small>{garment.color_family || garment.category}</small></span>
              </button>;
            })}</div>
          ) : <div className="empty-wardrobe"><SparkleIcon /><h2>No pieces here yet</h2><p>Import outfit photos and we’ll find the clothes for you.</p><button className="button-primary" onClick={() => setImportOpen(true)}>Import photos</button></div>}
        </section>
      )}

      <button className="floating-import" onClick={() => setImportOpen(true)}><PlusIcon /><span>Add photos</span></button>

      {selected && <GarmentDrawer key={selected.id} garment={selected} demoMode={demoMode} onClose={() => setSelected(null)} onUpdated={updateGarment} />}
      {importOpen && <ImportPanel demoMode={demoMode} onClose={() => setImportOpen(false)} onApproved={loadGarments} />}
    </main>
  );
}
