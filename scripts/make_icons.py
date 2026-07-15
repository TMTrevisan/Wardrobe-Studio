import sys
from PIL import Image, ImageDraw

def generate_icons():
    # Make a clean warm terracotta/sage theme hanger logo
    # Background: pure white or soft linen. Let's make it a nice warm light linen (#FAF8F5)
    # Hanger color: deep terracotta (#C86B55)
    
    # 512x512
    img = Image.new("RGBA", (512, 512), "#FAF8F5")
    draw = ImageDraw.Draw(img)
    
    # Draw a beautiful minimalist hanger
    # A hanger consists of a hook at the top and a triangle base
    # Hook center: (256, 160)
    # Triangle top: (256, 220)
    # Triangle left: (120, 360)
    # Triangle right: (392, 360)
    
    # Draw hook
    # Top hook circle arc
    # bounding box for arc: [216, 100, 296, 180]
    draw.arc([216, 100, 296, 180], start=180, end=380, fill="#C86B55", width=14)
    # Hook neck down to triangle top
    draw.line([(256, 180), (256, 220)], fill="#C86B55", width=14)
    
    # Triangle base
    draw.line([(256, 220), (120, 360)], fill="#C86B55", width=14, joint="round")
    draw.line([(120, 360), (392, 360)], fill="#C86B55", width=14, joint="round")
    draw.line([(392, 360), (256, 220)], fill="#C86B55", width=14, joint="round")
    
    # Horizontal bar inside hanger (pant bar)
    draw.line([(140, 340), (372, 340)], fill="#8FA89B", width=10) # sage accent
    
    img.save("public/icon-512.png")
    
    # Resize for 192x192
    img_192 = img.resize((192, 192), Image.Resampling.LANCZOS)
    img_192.save("public/icon-192.png")
    
    # Save as favicon
    img_ico = img.resize((32, 32), Image.Resampling.LANCZOS)
    img_ico.save("public/favicon.ico")
    
    print("Icons generated successfully!")

if __name__ == "__main__":
    generate_icons()
