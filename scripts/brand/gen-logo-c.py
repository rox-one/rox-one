#!/usr/bin/env python3
"""Rox logo variant C ("rim light"): light face + grey rim on hair edges.

Reads the ink alpha mask from the original ink-brush portrait (git history:
rox-avatar-ink-black.png before feat/logo-c) and writes the variant C
PNG at the same canvas size, usable on both light and dark backgrounds.
Usage: gen-logo-c.py <ink-source.png> <out.png>
Requires: pillow, numpy, scipy.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as nd

src, out = sys.argv[1], sys.argv[2]
img = Image.open(src).convert("RGBA")
a = np.array(img)[:, :, 3].astype(float) / 255
pad = 60
a = np.pad(a, pad)
m = nd.binary_closing(a > 0.15, iterations=6)
sil = nd.binary_opening(nd.binary_fill_holes(m), iterations=2)
silS = np.array(Image.fromarray((sil * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(float) / 255
dist = nd.distance_transform_edt(sil)
rim = np.clip(1 - dist / 14, 0, 1) * sil
inkv = rim * 150  # ink colour: black inside, up to grey 150 at silhouette edge
# composite: white fill (silS) then ink over it
alpha = a + silS * (1 - a)
rgb = (250 * silS * (1 - a) + inkv * a) / np.maximum(alpha, 1e-4)
res = np.dstack([rgb, rgb, rgb, alpha * 255]).clip(0, 255).astype(np.uint8)
res = res[pad:-pad, pad:-pad]
Image.fromarray(res).save(out, optimize=True)
