import type { Garment } from '@/types/db';

function garmentSvg(kind: 'top' | 'bottom' | 'outerwear' | 'shoe' | 'accessory', color: string, accent = '#d9d0c3') {
  const shapes = {
    top: `<path d="M61 38 92 25l24 18-17 29-14-8v89H43V64l-14 8-17-29 24-18 31 13Z" fill="${color}"/><path d="M51 28c4 15 28 15 32 0" fill="none" stroke="${accent}" stroke-width="5"/>`,
    bottom: `<path d="M38 22h52l8 43-11 91H60L54 82l-6 74H21L10 65l8-43Z" fill="${color}"/><path d="M18 43h72" stroke="${accent}" stroke-width="4"/>`,
    outerwear: `<path d="M59 35 91 22l24 24-18 28-13-10v91H43V64L30 74 12 46l24-24 32 13Z" fill="${color}"/><path d="m59 35 9 19 9-19M68 54v101" fill="none" stroke="${accent}" stroke-width="4"/>`,
    shoe: `<path d="M16 105c20 0 30-25 34-56h31c1 34 13 50 47 56 11 2 18 10 18 22H16c-8 0-12-6-12-12s4-10 12-10Z" fill="${color}"/><path d="M17 127h128" stroke="${accent}" stroke-width="5"/>`,
    accessory: `<path d="M28 58h92l-8 85H36Z" fill="${color}"/><path d="M48 58c0-39 52-39 52 0" fill="none" stroke="${color}" stroke-width="8"/>`,
  };
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 175"><g>${shapes[kind]}</g></svg>`)}`;
}

const now = new Date().toISOString();
const entries = [
  ['Vintage Raglan Tee', 'Tops', 'Graphic T-Shirt', '#ded9cf', 'top'],
  ['Olive Henley', 'Tops', 'Short Sleeve Henley', '#656544', 'top'],
  ['Midnight Oxford', 'Tops', 'Oxford Shirt', '#17233b', 'top'],
  ['Sea Glass Tee', 'Tops', 'Crewneck T-Shirt', '#66aab1', 'top'],
  ['Cloud Hoodie', 'Outerwear', 'Pullover Hoodie', '#b8bab8', 'outerwear'],
  ['Blue Linen Shirt', 'Tops', 'Linen Shirt', '#b8d5df', 'top'],
  ['Washed Red Utility', 'Tops', 'Camp Shirt', '#cf493e', 'top'],
  ['Cream Knit Polo', 'Tops', 'Knit Polo', '#e7dfcc', 'top'],
  ['Rust Drawstring Trouser', 'Bottoms', 'Casual Trouser', '#aa4f27', 'bottom'],
  ['Stone Chino', 'Bottoms', 'Chino', '#cfc8ba', 'bottom'],
  ['Black Leather Sneaker', 'Footwear', 'Low-top Sneaker', '#252321', 'shoe'],
  ['Forest Day Bag', 'Accessories', 'Tote Bag', '#264b3c', 'accessory'],
] as const;

export const demoGarments: Garment[] = entries.map(([name, category, subCategory, color, kind], index) => ({
  id: `demo-${index}`,
  display_name: name,
  category,
  sub_category: subCategory,
  brand: index % 3 === 0 ? 'Found' : null,
  color_family: name.split(' ')[0],
  hex_code: color,
  tonal_value: index % 3 === 0 ? 'Light' : index % 3 === 1 ? 'Medium' : 'Dark',
  fabric_type: category === 'Footwear' ? 'Leather' : 'Cotton',
  fit_block: 'Regular',
  style_detail: 'Source-grounded catalog sample with a clean, relaxed silhouette.',
  pattern: index === 0 ? 'Graphic' : 'Solid',
  season: ['Spring', 'Summer'],
  formality: 'Casual',
  catalog_status: 'ready',
  status: 'Active',
  images: [],
  assets: [],
  primary_image_url: garmentSvg(kind, color),
  catalog_asset_url: garmentSvg(kind, color),
  notes: null,
  price: 0,
  purchase_year: null,
  created_at: now,
}));
