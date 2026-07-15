import { NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/supabase';
import { ok } from '@/lib/api';

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const formData = await request.formData();
    
    // Find all files in form data (e.g. image_0, image_1, etc.)
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('image') && value instanceof File) {
        files.push(value);
      }
    }

    const notes = formData.get('notes') as string | null;

    if (files.length === 0) {
      return NextResponse.json({ error: 'No image files provided.' }, { status: 400 });
    }

    // 1. Insert a single garment entry in 'Processing' status
    const { data: garment, error: dbError } = await user.client
      .from('garments')
      .insert([
        {
          user_id: user.id,
          category: 'Tops', // Temporary fallback
          sub_category: 'Processing...',
          color_family: 'Extracting...',
          tonal_value: 'Light', // Temporary fallback
          fabric_type: 'Extracting...',
          fit_block: 'Extracting...',
          status: 'Processing',
          notes: notes || null,
        },
      ])
      .select()
      .single();

    if (dbError || !garment) {
      console.error('Garment insertion error:', dbError);
      return NextResponse.json(
        { error: `Failed to create garment: ${dbError?.message}` },
        { status: 500 }
      );
    }

    // 2. Upload each file to Supabase Storage and register in garment_images
    const imageUploadPromises = files.map(async (file, index) => {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      
      // Security validation: Only allow safe image file types
      if (!file.type.startsWith('image/')) {
        throw new Error(`Security Violation: File ${file.name} is not a valid image.`);
      }

      const fileExtension = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
      if (!allowedExtensions.includes(fileExtension)) {
        throw new Error(`Security Violation: File extension .${fileExtension} is not allowed.`);
      }

      const fileName = `${garment.id}-${index}-${Date.now()}.${fileExtension}`;
      const filePath = `raw/${fileName}`;

      const { error: uploadError } = await user.client.storage
        .from('wardrobe-images')
        .upload(filePath, buffer, {
          contentType: file.type,
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
      }

      const { data: { publicUrl } } = user.client.storage
        .from('wardrobe-images')
        .getPublicUrl(filePath);

      // Save record in garment_images
      const { data: imgRecord, error: imgError } = await user.client
        .from('garment_images')
        .insert([
          {
            garment_id: garment.id,
            storage_path: publicUrl,
            is_primary_profile: index === 0, // Mark the first image as primary
            asset_type: index === 0 ? 'profile' : 'detail',
          },
        ])
        .select()
        .single();

      if (imgError) {
        throw new Error(`Failed to register image record: ${imgError.message}`);
      }

      return imgRecord;
    });

    const registeredImages = await Promise.all(imageUploadPromises);

    // Find the primary profile image url for UI fallback
    const primaryImg = registeredImages.find(img => img.is_primary_profile) || registeredImages[0];

    return ok({
      item: {
        ...garment,
        images: registeredImages,
        primary_image_url: primaryImg ? primaryImg.storage_path : null,
      },
    });
  } catch (error: any) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Upload handler error:', error);
    return NextResponse.json(
      { error: error.message || 'An error occurred during multi-image upload.' },
      { status: 500 }
    );
  }
}
