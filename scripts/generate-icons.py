import os
from PIL import Image, ImageDraw

src_path = "/Users/joaogustavo/.gemini/antigravity/brain/7f3be408-2036-42a7-9ee5-a68882fe3a77/.user_uploaded/media_1795543006726_093e05eb.jpg"
src = Image.open(src_path)

# Exact squircle bounds in user image
# x: 116 to 898 (width = 782)
# y: 74 to 856 (height = 782)
crop = src.crop((116, 74, 898, 856)).convert("RGBA")
w, h = crop.size
print(f"Original crop size: {w}x{h}")

# 1. Create squircle mask with smooth alpha anti-aliasing
mask = Image.new("L", (w, h), 0)
draw = ImageDraw.Draw(mask)
# corner radius is ~172px for 782px
draw.rounded_rectangle([(0, 0), (w - 1, h - 1)], radius=172, fill=255)

# 2. Transparent squircle version (for browser tabs favicon)
squircle_transparent = crop.copy()
squircle_transparent.putalpha(mask)

# 3. Full bleed square version (for iOS apple-touch-icon and Android maskable)
# We fill outside the mask with horizontal gradient extension from edges so no black or white occurs
full_bleed = Image.new("RGBA", (w, h))
for y in range(h):
    left_x = 0
    while left_x < w and mask.getpixel((left_x, y)) < 240:
        left_x += 1
    right_x = w - 1
    while right_x >= 0 and mask.getpixel((right_x, y)) < 240:
        right_x -= 1
        
    if left_x >= right_x:
        c_left = crop.getpixel((w // 2, y))
        c_right = c_left
    else:
        c_left = crop.getpixel((left_x, y))
        c_right = crop.getpixel((right_x, y))
        
    for x in range(w):
        if x < left_x:
            full_bleed.putpixel((x, y), (c_left[0], c_left[1], c_left[2], 255))
        elif x > right_x:
            full_bleed.putpixel((x, y), (c_right[0], c_right[1], c_right[2], 255))
        else:
            orig = crop.getpixel((x, y))
            full_bleed.putpixel((x, y), (orig[0], orig[1], orig[2], 255))

full_bleed_rgb = full_bleed.convert("RGB")

# Generate all destination files:
os.makedirs("public/icons", exist_ok=True)

# Apple Touch Icons (iOS Home Screen) - 180x180 RGB full bleed (Apple masks it)
apple_180 = full_bleed_rgb.resize((180, 180), Image.Resampling.LANCZOS)
apple_180.save("public/apple-touch-icon.png", format="PNG")
apple_180.save("public/apple-touch-icon-precomposed.png", format="PNG")
apple_180.save("public/icons/apple-touch-icon.png", format="PNG")

# Favicon PNG (Browser tab) - 64x64 transparent squircle
fav_64 = squircle_transparent.resize((64, 64), Image.Resampling.LANCZOS)
fav_64.save("public/favicon.png", format="PNG")

# Favicon 32x32 transparent squircle
fav_32 = squircle_transparent.resize((32, 32), Image.Resampling.LANCZOS)
fav_32.save("public/favicon-32x32.png", format="PNG")

# Favicon.ico multi-resolution
fav_16 = squircle_transparent.resize((16, 16), Image.Resampling.LANCZOS)
fav_48 = squircle_transparent.resize((48, 48), Image.Resampling.LANCZOS)
fav_48.save("public/favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

# PWA icons
pwa_192 = full_bleed_rgb.resize((192, 192), Image.Resampling.LANCZOS)
pwa_192.save("public/icons/icon-192.png", format="PNG")

pwa_512 = full_bleed_rgb.resize((512, 512), Image.Resampling.LANCZOS)
pwa_512.save("public/icons/icon-512.png", format="PNG")

print("All icons successfully generated!")
