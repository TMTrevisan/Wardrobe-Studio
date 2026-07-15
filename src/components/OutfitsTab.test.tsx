// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OutfitsTab from './OutfitsTab';
import type { Garment, SavedOutfit } from '@/types/db';

const baseGarment: Garment = {
  id: 'g1',
  category: 'Tops',
  sub_category: 'T-Shirt',
  brand: 'Acme',
  color_family: 'Olive',
  hex_code: '#556b2f',
  tonal_value: 'Medium',
  fabric_type: 'Cotton',
  fit_block: 'Regular',
  style_detail: null,
  status: 'Active',
  images: [],
  primary_image_url: 'https://example.com/g1.jpg',
  notes: null,
  price: 60,
  purchase_year: 2023,
  created_at: '',
};

const sampleOutfit: SavedOutfit = {
  id: 'o1',
  name: 'Weekend Brunch',
  item_ids: ['g1', 'g2'],
  styling_reasoning: 'Olive tee with navy chinos for a relaxed Sunday.',
  created_at: '',
};

describe('<OutfitsTab>', () => {
  it('shows the empty state when there are no outfits', () => {
    render(<OutfitsTab outfits={[]} items={[]} loading={false} onDelete={() => {}} onEditItem={() => {}} onVisualize={() => {}} />);
    expect(screen.getByText(/no saved outfits/i)).toBeInTheDocument();
  });

  it('shows a loading state when loading', () => {
    render(<OutfitsTab outfits={[]} items={[]} loading={true} onDelete={() => {}} onEditItem={() => {}} onVisualize={() => {}} />);
    expect(screen.getByText(/loading outfits/i)).toBeInTheDocument();
  });

  it('renders outfit cards with item details when garments exist', () => {
    render(
      <OutfitsTab
        outfits={[sampleOutfit]}
        items={[baseGarment]}
        loading={false}
        onDelete={() => {}}
        onEditItem={() => {}}
        onVisualize={() => {}}
      />
    );
    expect(screen.getByText('Weekend Brunch')).toBeInTheDocument();
    expect(screen.getByText(/Olive tee with navy chinos/)).toBeInTheDocument();
    // "Acme T-Shirt" appears twice for one garment: once in the 3-up
    // image grid and once in the constituents list. Both should render.
    expect(screen.getAllByText('Acme T-Shirt')).toHaveLength(2);
  });

  it('calls onDelete when Delete is clicked', async () => {
    const onDelete = vi.fn();
    render(
      <OutfitsTab
        outfits={[sampleOutfit]}
        items={[baseGarment]}
        loading={false}
        onDelete={onDelete}
        onEditItem={() => {}}
        onVisualize={() => {}}
      />
    );
    await userEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith('o1');
  });

  it('calls onVisualize with the resolved items when View Visuals is clicked', async () => {
    const onVisualize = vi.fn();
    render(
      <OutfitsTab
        outfits={[sampleOutfit]}
        items={[baseGarment]}
        loading={false}
        onDelete={() => {}}
        onEditItem={() => {}}
        onVisualize={onVisualize}
      />
    );
    await userEvent.click(screen.getByText(/view outfit visuals/i));
    expect(onVisualize).toHaveBeenCalledWith(sampleOutfit, [baseGarment]);
  });

  it('skips item_ids that point to garments the user no longer has', () => {
    // outfit references g1 (exists) and g2 (doesn't) — only g1 should render.
    render(
      <OutfitsTab
        outfits={[sampleOutfit]}
        items={[baseGarment]}
        loading={false}
        onDelete={() => {}}
        onEditItem={() => {}}
        onVisualize={() => {}}
      />
    );
    // g1 appears in 2 places (image grid + constituents list) × 1 garment
    // = 2 occurrences. g2 (missing) should NOT appear at all.
    expect(screen.getAllByText('Acme T-Shirt')).toHaveLength(2);
    // The total number of garment cards shown in the 3-up grid
    // should be 1 (just g1).
    const imageCards = document.querySelectorAll('.grid-cols-3 > div');
    expect(imageCards).toHaveLength(1);
  });
});