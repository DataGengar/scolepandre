"""
Fabrique un .obj de test contenant précisément le cas qui tue la heightmap :
un PONT qui franchit un GOUFFRE. Sous le pont, la colonne (x,z) possède deux
sols marchables à des altitudes différentes.

On y ajoute une falaise verticale (que la créature grimpe, que le joueur ne
grimpe pas), une rampe (le seul accès du joueur au fond) et un surplomb
extérieur, pour vérifier la détection automatique de ciel ouvert.

    python make_test_level.py sortie.obj
"""
import sys

SOMMETS = []
FACES = []          # (a, b, c, groupe)


def boite(x0, y0, z0, x1, y1, z1, groupe="souterrain"):
    """Pavé aligné sur les axes, 12 triangles."""
    base = len(SOMMETS) + 1                      # OBJ indexe à partir de 1
    for x in (x0, x1):
        for y in (y0, y1):
            for z in (z0, z1):
                SOMMETS.append((x, y, z))
    # ordre des 8 sommets : (x,y,z) avec x lent, z rapide
    c = [base + i for i in range(8)]
    quads = [
        (0, 1, 3, 2), (4, 6, 7, 5),      # x-  x+
        (0, 4, 5, 1), (2, 3, 7, 6),      # y-  y+
        (0, 2, 6, 4), (1, 5, 7, 3),      # z-  z+
    ]
    for q in quads:
        a, b, d, e = (c[i] for i in q)
        FACES.append((a, b, d, groupe))
        FACES.append((a, d, e, groupe))


def construire():
    # ── plateau principal, coupé en deux par un gouffre ────────────────
    boite(0, -1, 0, 14, 0, 40, "souterrain")        # rive ouest
    boite(26, -1, 0, 40, 0, 40, "souterrain")       # rive est

    # ── fond du gouffre, 9 m plus bas ──────────────────────────────────
    boite(14, -10, 0, 26, -9, 40, "barrage")

    # ── parois verticales du gouffre : la voie de la créature ──────────
    boite(13.4, -9, 0, 14, 0, 40, "barrage")
    boite(26, -9, 0, 26.6, 0, 40, "barrage")

    # ── LE PONT : tablier à +5, il enjambe tout le gouffre ─────────────
    #    Sous lui, la colonne a un sol au fond (-9) ET un sol sur le
    #    tablier (+5). Aucune heightmap ne peut représenter ça.
    boite(12, 4.4, 16, 28, 5, 24, "souterrain")
    boite(12, 5, 16, 28, 6, 16.6, "souterrain")     # garde-corps
    boite(12, 5, 23.4, 28, 6, 24, "souterrain")
    # culées : le pont rejoint les deux rives par des rampes courtes
    for x0, x1 in ((8, 12), (28, 32)):
        for i in range(8):
            t = i / 8
            y = 0 + t * 4.4
            xa = x0 + (x1 - x0) * i / 8
            xb = x0 + (x1 - x0) * (i + 1) / 8
            boite(min(xa, xb), y - 0.5, 16, max(xa, xb), y + 0.1, 24, "souterrain")

    # ── rampe vers le fond : le seul accès du joueur, le long du mur nord
    for i in range(24):
        t = i / 24
        z0 = 1 + i * 1.5
        boite(14.2, -9 + (1 - t) * 9 - 0.5, z0, 18, -9 + (1 - t) * 9, z0 + 1.6, "barrage")

    # ── plateau extérieur surélevé, sans plafond : test du ciel ouvert ──
    boite(0, 7, 42, 40, 8, 56, "surface_gelee")
    for i in range(14):                              # escalier d'accès
        boite(0 + i * 0.9, 0 + i * 0.55, 40, 0 + i * 0.9 + 1.2, 0.6 + i * 0.55, 42,
              "surface_gelee")
    # quelques troncs, pour que la surface ait du volume
    for x in (6, 15, 24, 33):
        boite(x, 8, 46, x + 0.8, 16, 46.8, "surface_gelee")

    # ── plafond au-dessus du souterrain seulement : le reste voit le ciel
    boite(0, 12, 0, 40, 13, 40, "souterrain")

    # ── volume de navigation : hors de cette boîte, rien n'est calculé.
    #    Sans elle le pipeline naviguerait aussi le dessous du monde.
    boite(-1, -11, -1, 41, 18, 57, "BORNE_jouable")


def ecrire(chemin):
    groupes = {}
    for *_, g in FACES:
        groupes.setdefault(g, []).append(None)
    with open(chemin, "w", encoding="utf-8") as fh:
        fh.write("# niveau de test — gouffre franchi par un pont\n")
        for x, y, z in SOMMETS:
            fh.write(f"v {x:.4f} {y:.4f} {z:.4f}\n")
        courant = None
        for a, b, c, g in FACES:
            if g != courant:
                fh.write(f"o {g}\nusemtl {g}\n")
                courant = g
            fh.write(f"f {a} {b} {c}\n")
    print(f"{chemin} : {len(SOMMETS)} sommets, {len(FACES)} triangles, "
          f"{len(groupes)} groupes")


if __name__ == "__main__":
    construire()
    ecrire(sys.argv[1] if len(sys.argv) > 1 else "test_level.obj")
