import sys
import os
from rembg import remove
from PIL import Image

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 remove_bg.py <input_path> <output_path>")
        sys.exit(1)
        
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    
    if not os.path.exists(input_path):
        print(f"Error: Input file {input_path} does not exist.")
        sys.exit(1)
        
    try:
        print(f"Removing background from {input_path}...")
        input_image = Image.open(input_path)
        output_image = remove(input_image)
        output_image.save(output_path, "PNG")
        print(f"Saved background cutout to {output_path}")
        sys.exit(0)
    except Exception as e:
        print(f"Error during background removal: {str(e)}")
        sys.exit(2)

if __name__ == "__main__":
    main()
