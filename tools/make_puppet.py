"""Turn ONE front-facing cartoon picture (plain background) into an animated "puppet".

    python tools/make_puppet.py --name yuri --src path/to/girl.png

Steps: (1) cut the character out of the plain background, (2) erase the painted mouth,
(3) slice into body / head / left hand / right hand, (4) write static/tutors/<name>/ + rig.json.
The page (chat.js) then makes the head nod, the hands wave, the eyes blink and draws a talking mouth.

All coordinates below are on a 200x200 grid and are scaled automatically, so a bigger picture works too.
"""
import argparse, json
from pathlib import Path
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageChops

# ---- per-tutor geometry on a 200x200 grid -------------------------------------------------
CONFIG = {
    "girl": dict(
        head=[(44,0),(156,0),(158,100),(160,152),(128,152),(128,128),(72,128),(72,152),(40,152),(42,100)],
        head_e=[(44,0),(156,0),(158,100),(160,148),(128,148),(128,124),(72,124),(72,148),(40,148),(42,100)],
        handL=[(0,98),(44,98),(44,153),(0,153)], handL_e=[(0,98),(41,98),(41,149),(0,149)],
        handR=[(156,98),(200,98),(200,153),(156,153)], handR_e=[(159,98),(200,98),(200,149),(159,149)],
        pivots=dict(head=(100,128), handL=(38,153), handR=(162,153)),
        mouth_erase=(86,98,114,111), mouth=dict(x=100, y=105, r=11),
        eyes=[(80,82,14,17),(120,82,14,17)], skin_at=(100,80), teeth=False),
    "boy": dict(
        head=[(44,0),(156,0),(156,132),(44,132)], head_e=[(44,0),(156,0),(156,128),(44,128)],
        handL=[(0,100),(46,100),(46,157),(0,157)], handL_e=[(0,100),(43,100),(43,153),(0,153)],
        handR=[(154,100),(200,100),(200,157),(154,157)], handR_e=[(157,100),(200,100),(200,153),(157,153)],
        pivots=dict(head=(100,132), handL=(33,157), handR=(167,157)),
        mouth_erase=(82,107,118,126), mouth=dict(x=100, y=116, r=13),
        eyes=[(80,95,13,15),(120,95,13,15)], skin_at=(100,90), teeth=True),
}
ALIASES = {"yuri": "girl", "joohyuk": "boy"}

def cutout(bgr):
    """Plain background -> transparent. Flood-fill from the border; the dark outline stops the fill."""
    h, w = bgr.shape[:2]
    corner = np.median(np.concatenate([bgr[:6,:6].reshape(-1,3), bgr[:6,-6:].reshape(-1,3), bgr[-6:,:6].reshape(-1,3), bgr[-6:,-6:].reshape(-1,3)]), axis=0)
    diff = np.abs(bgr.astype(int) - corner.astype(int)).max(axis=2)
    bg_like = (diff < 14).astype(np.uint8)
    n, lab = cv2.connectedComponents(bg_like, connectivity=4)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:,0], lab[:,-1]]))) - {0}
    bg = np.isin(lab, list(border)) | (bg_like > 0)      # border-connected AND enclosed gaps of the same colour
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    # keep only the biggest piece (drops the little motion marks next to the hands)
    n, lab2, st, _ = cv2.connectedComponentsWithStats((alpha > 0).astype(np.uint8))
    alpha = np.where(lab2 == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]), 255, 0).astype(np.uint8)
    k = max(1, w // 400)
    alpha = cv2.erode(alpha, np.ones((2*k+1, 2*k+1), np.uint8))          # trim the light halo
    alpha = cv2.GaussianBlur(alpha, (2*k+1, 2*k+1), 0)
    return alpha

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--name", required=True); ap.add_argument("--src", required=True)
    ap.add_argument("--kind", choices=["girl", "boy"]); ap.add_argument("--out", default="static/tutors")
    a = ap.parse_args(); kind = a.kind or ALIASES[a.name]; C = CONFIG[kind]
    img = cv2.imread(a.src, cv2.IMREAD_COLOR); 
    if img.shape[1] < 600: img = cv2.resize(img, (600, 600), interpolation=cv2.INTER_CUBIC)   # smoother when enlarged
    H, W = img.shape[:2]; s = W / 200.0
    sc = lambda pts: [(x*s, y*s) for x, y in pts]
    alpha = cutout(img)

    # ---- erase the painted mouth (we draw a moving one on top) ----
    x0, y0, x1, y1 = [int(v*s) for v in C["mouth_erase"]]
    m = np.zeros((H, W), np.uint8); m[y0:y1, x0:x1] = 255
    painted = cv2.inpaint(img, m, 6, cv2.INPAINT_TELEA)
    sx, sy = [int(v*s) for v in C["skin_at"]]
    skin = img[sy-3:sy+3, sx-3:sx+3].reshape(-1,3).mean(axis=0)[::-1].astype(int)    # RGB
    rgba = cv2.cvtColor(painted, cv2.COLOR_BGR2RGBA); rgba[..., 3] = alpha
    full = Image.fromarray(rgba)

    def poly_mask(pts):
        mk = Image.new("L", (W, H), 0); ImageDraw.Draw(mk).polygon(sc(pts), fill=255); return mk
    def part(pts):
        o = full.copy(); o.putalpha(ImageChops.multiply(full.getchannel("A"), poly_mask(pts))); return o
    head, handL, handR = part(C["head"]), part(C["handL"]), part(C["handR"])
    erase = ImageChops.lighter(ImageChops.lighter(poly_mask(C["head_e"]), poly_mask(C["handL_e"])), poly_mask(C["handR_e"]))
    body = full.copy(); body.putalpha(ImageChops.multiply(full.getchannel("A"), ImageChops.invert(erase)))

    # crop everything to the same box so layers still line up
    box = full.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    out = Path(a.out) / a.name; out.mkdir(parents=True, exist_ok=True)
    for n, l in (("body", body), ("handL", handL), ("handR", handR), ("head", head), ("full", full)):
        l.crop(box).save(out / f"{n}.png")
    cw, ch = box[2]-box[0], box[3]-box[1]
    P = lambda x, y: [round(x*s-box[0], 1), round(y*s-box[1], 1)]
    mo = C["mouth"]
    rig = {"size": [cw, ch], "thumb": "full.png", "stand": False,
           "layers": [{"name": "body", "src": "body.png"},
                      {"name": "handL", "src": "handL.png", "pivot": P(*C["pivots"]["handL"])},
                      {"name": "handR", "src": "handR.png", "pivot": P(*C["pivots"]["handR"])},
                      {"name": "head", "src": "head.png", "pivot": P(*C["pivots"]["head"])}],
           "face": {"pivot": P(*C["pivots"]["head"]), "skin": "#%02x%02x%02x" % tuple(skin),
                    "mouth": {"x": P(mo["x"], mo["y"])[0], "y": P(mo["x"], mo["y"])[1], "r": round(mo["r"]*s, 1), "teeth": C["teeth"]},
                    "eyes": [{"x": P(x, y)[0], "y": P(x, y)[1], "rx": round(rx*s, 1), "ry": round(ry*s, 1)} for x, y, rx, ry in C["eyes"]]}}
    (out / "rig.json").write_text(json.dumps(rig, indent=1))
    print("wrote", out, "size", cw, ch, "skin", rig["face"]["skin"])

if __name__ == "__main__":
    main()
