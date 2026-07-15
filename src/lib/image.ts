import { INGEST_LIMITS } from './constants';

/**
 * Resize + re-encode an uploaded image before it leaves the browser.
 * Caps the longer side to `INGEST_LIMITS.maxImageSidePx` and re-encodes
 * as JPEG to keep upload size predictable.
 *
 * Caveats:
 *  - Always produces JPEG, so transparent PNGs (e.g. cutouts) lose their
 *    alpha. Callers that need transparency should skip this step.
 *  - Uses `canvas.toBlob` which is async; awaits internally.
 */
export function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new window.Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const cap = INGEST_LIMITS.maxImageSidePx;
        if (width > height) {
          if (width > cap) {
            height *= cap / width;
            width = cap;
          }
        } else if (height > cap) {
          width *= cap / height;
          height = cap;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressed = new File(
                [blob],
                file.name.replace(/\.[^/.]+$/, '') + '.jpg',
                { type: 'image/jpeg', lastModified: Date.now() }
              );
              resolve(compressed);
            } else {
              reject(new Error('Failed to create canvas blob'));
            }
          },
          'image/jpeg',
          INGEST_LIMITS.jpegQuality
        );
      };
    };
    reader.onerror = (err) => reject(err);
  });
}

/**
 * Render an "outfit collage" onto a canvas: stacks garments vertically
 * by category (top / bottom / footwear) and stamps a watermark.
 *
 * Loads each image asynchronously; the caller should observe canvas
 * changes (the function mutates the canvas in-place via `ctx.drawImage`).
 *
 * NOTE: each `<img>` is created with `crossOrigin="anonymous"` so the
 * canvas doesn't get tainted when sources are cross-origin. If the
 * source image fails CORS, that garment is silently dropped from the
 * collage.
 */
export function drawOutfitCollage(
  canvas: HTMLCanvasElement,
  outfitItems: Array<{ category: string; primary_image_url: string | null }>
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#0b0c10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(102, 252, 241, 0.04)';
  ctx.lineWidth = 1.5;
  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  const itemsToDraw = outfitItems.filter((i) => i.primary_image_url);
  if (itemsToDraw.length === 0) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px monospace';
    ctx.fillText('No images available for collage.', 50, canvas.height / 2);
    return;
  }

  let loadedCount = 0;
  itemsToDraw.forEach((item) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = item.primary_image_url as string;
    img.onload = () => {
      const w = 240;
      const h = 240;
      let x: number;
      let y: number;
      const cat = item.category.toLowerCase();
      if (cat.includes('top') || cat.includes('outerwear') || cat.includes('tailoring')) {
        x = (canvas.width - w) / 2;
        y = 50;
      } else if (cat.includes('bottom')) {
        x = (canvas.width - w) / 2;
        y = 250;
      } else if (cat.includes('footwear')) {
        x = (canvas.width - w) / 2;
        y = 470;
      } else {
        x = 100;
        y = 100 + loadedCount * 150;
      }
      ctx.drawImage(img, x, y, w, h);
      loadedCount++;
      if (loadedCount === itemsToDraw.length) {
        ctx.fillStyle = 'rgba(102, 252, 241, 0.6)';
        ctx.font = 'bold 10px monospace';
        ctx.fillText('ANTIGRAVITY THREADS • OUTFIT COLLAGE', 20, canvas.height - 20);
      }
    };
    img.onerror = () => {
      loadedCount++;
    };
  });
}