"""
scolo_pipeline — topographie Blender → structures de navigation du jeu.

POURQUOI CE PIPELINE EXISTE
    Une heightmap stocke une altitude par colonne (x,z). Dès qu'un pont passe
    au-dessus d'un gouffre, la colonne a DEUX sols et la structure ne peut plus
    les représenter. Toute la navigation doit donc passer en 3D.

POURQUOI UN GRAPHE DE VOXELS DE SURFACE, ET PAS UN NAVMESH POLYGONAL
    Un navmesh à la Recast suppose un agent qui marche : il ne conserve que les
    triangles dont la pente est sous un seuil, et jette les murs. Or le
    scoléopandre grimpe aux parois et court au plafond — ces surfaces sont
    précisément celles qu'un navmesh polygonal supprime.

    On extrait donc les voxels libres au contact d'un solide, sur TOUTE
    orientation, avec leur normale sortante. Ça donne :
      - une couverture native des ponts et superpositions (c'est de la 3D) ;
      - les parois et plafonds pour la créature, gratuitement ;
      - le sous-ensemble marchable pour le joueur, par simple filtre.

    Le prix à payer est le nombre de nœuds. Il se paie avec la résolution du
    voxel et le découpage en chunks (A* hiérarchique côté client).

CONVENTION D'AXES
    Interne : Y vers le haut (comme le client WebGL).
    Blender exporte en Z-up par défaut : passer up='z' à load_obj().
"""

from __future__ import annotations
import json, math
from pathlib import Path
import numpy as np
from scipy import ndimage

# ── types de surface ────────────────────────────────────────────────────────
SOL, PAROI, PLAFOND = 0, 1, 2
NOM_SURFACE = {SOL: "sol", PAROI: "paroi", PLAFOND: "plafond"}

# ── biomes ──────────────────────────────────────────────────────────────────
SOUTERRAIN, GLACIERE, BARRAGE, SURFACE = 0, 1, 2, 3
NOM_BIOME = {SOUTERRAIN: "souterrain", GLACIERE: "glacière",
             BARRAGE: "barrage", SURFACE: "surface"}
# reconnaissance par nom de matériau ou d'objet Blender
# Un objet Blender dont le nom commence par l'un de ces préfixes ne décrit pas
# de la matière : il délimite le volume à naviguer. Il n'est pas voxelisé.
PREFIXES_BORNE = ("borne", "bounds", "navvolume", "volume_nav")

MOTS_BIOME = {
    "glaciere": GLACIERE, "glacier": GLACIERE, "ice": GLACIERE, "glace": GLACIERE,
    "barrage": BARRAGE, "dam": BARRAGE, "beton": BARRAGE, "concrete": BARRAGE,
    "surface": SURFACE, "foret": SURFACE, "forest": SURFACE, "exterieur": SURFACE,
    "souterrain": SOUTERRAIN, "cave": SOUTERRAIN, "donjon": SOUTERRAIN,
}


# ════════════════════════════════════════════════════════════════════════════
# 1. CHARGEMENT OBJ
# ════════════════════════════════════════════════════════════════════════════
def load_obj(path, up="y"):
    """Lit un .obj (v / f / o / g / usemtl). Retourne (sommets, faces, tags,
    noms). `tags[i]` est l'indice dans `noms` du groupe de la face i — c'est
    ce qui portera le biome. Volontairement sans dépendance : un OBJ est
    trivial à lire, et une dépendance de moins est une dépendance de moins."""
    verts, faces, tags, noms = [], [], [], []
    courant, index_nom = None, {}

    def id_nom(n):
        if n not in index_nom:
            index_nom[n] = len(noms)
            noms.append(n)
        return index_nom[n]

    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for ligne in fh:
            if not ligne or ligne[0] == "#":
                continue
            parts = ligne.split()
            if not parts:
                continue
            t = parts[0]
            if t == "v":
                verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif t in ("o", "g", "usemtl"):
                courant = id_nom(parts[1] if len(parts) > 1 else "default")
            elif t == "f":
                # "f v/vt/vn" → on ne garde que l'indice de sommet
                idx = []
                for p in parts[1:]:
                    i = int(p.split("/")[0])
                    idx.append(i - 1 if i > 0 else len(verts) + i)
                if courant is None:
                    courant = id_nom("default")
                # triangulation en éventail : suffisant pour de la topographie
                for k in range(1, len(idx) - 1):
                    faces.append((idx[0], idx[k], idx[k + 1]))
                    tags.append(courant)

    V = np.asarray(verts, np.float64)
    if up.lower() == "z":                       # Blender Z-up → Y-up
        V = V[:, [0, 2, 1]]
        V[:, 2] *= -1.0
    return V, np.asarray(faces, np.int64), np.asarray(tags, np.int32), noms


def biome_du_nom(nom):
    n = nom.lower()
    for mot, b in MOTS_BIOME.items():
        if mot in n:
            return b
    return None


# ════════════════════════════════════════════════════════════════════════════
# 2. VOXELISATION
# ════════════════════════════════════════════════════════════════════════════
class Grille:
    """Occupation solide sur une grille régulière. `solide[i,j,k]` ; j est
    l'axe vertical. `marque[i,j,k]` retient le groupe Blender du triangle qui
    a rempli le voxel, ce qui permet ensuite d'en déduire le biome."""

    def __init__(self, bmin, bmax, voxel, marge=2):
        self.voxel = float(voxel)
        self.origine = np.asarray(bmin, np.float64) - self.voxel * marge
        etendue = np.asarray(bmax, np.float64) - self.origine + self.voxel * marge
        self.dims = tuple(int(math.ceil(e / self.voxel)) + 1 for e in etendue)
        self.solide = np.zeros(self.dims, dtype=bool)
        self.satures = 0   # triangles ayant atteint le plafond de subdivision
        self.marque = np.full(self.dims, -1, dtype=np.int16)

    @property
    def nb_voxels(self):
        return int(np.prod(self.dims))

    def monde(self, ijk):
        """Indices voxel → coordonnées monde (centre du voxel)."""
        return self.origine + (np.asarray(ijk, np.float64) + 0.5) * self.voxel


_CACHE_BARY = {}


def _bary(n):
    """Points barycentriques d'un triangle, n subdivisions par arête."""
    if n not in _CACHE_BARY:
        u, v = [], []
        for i in range(n + 1):
            for j in range(n + 1 - i):
                u.append(i / n)
                v.append(j / n)
        _CACHE_BARY[n] = (np.array(u), np.array(v))
    return _CACHE_BARY[n]


def separer_bornes(V, F, tags, noms):
    """Sépare les objets « borne » du reste : ils délimitent le volume à
    naviguer et ne sont pas de la matière. Sans borne, tout est navigable."""
    est_borne = np.array([nm.lower().startswith(PREFIXES_BORNE) for nm in noms])
    if not est_borne.any():
        return F, tags, []
    m = est_borne[tags]
    boites = []
    for i in np.where(est_borne)[0]:
        pts = V[F[tags == i].ravel()]
        if len(pts):
            boites.append((pts.min(0), pts.max(0)))
    return F[~m], tags[~m], boites


def remplir_cavites(g):
    """Un maillage fermé exporté de Blender devient une COQUE de voxels : son
    intérieur reste « libre », et le pipeline y fabriquerait des nœuds de
    navigation enfermés dans la matière. On étiquette donc l'espace libre et
    on solidifie toute poche qui ne touche pas le bord de la grille.

    C'est l'étape sans laquelle le graphe se retrouve éclaté en autant de
    composantes qu'il y a de murs — constaté, pas supposé."""
    libre = ~g.solide
    etiq, n = ndimage.label(libre)
    if n == 0:
        return 0
    bord = set()
    for ax in range(3):
        for sl in (0, -1):
            idx = [slice(None)] * 3
            idx[ax] = sl
            bord.update(np.unique(etiq[tuple(idx)]).tolist())
    bord.discard(0)
    interieur = libre & ~np.isin(etiq, list(bord))
    n_rempli = int(interieur.sum())
    g.solide |= interieur
    return n_rempli


def voxeliser(V, F, tags, voxel, marge=2, sub_max=2048, budget_pts=4_000_000):
    """Rasterise les triangles par échantillonnage barycentrique dense.

    Le pas d'échantillonnage vaut 0,45 voxel : plus fin que le voxel, donc
    aucune fuite pour de la topographie normale. Ce n'est PAS un rasteriseur
    conservatif exact (un test SAT triangle/AABB le serait) ; pour de la
    navigation la différence est invisible, et ceci se vectorise.

    ATTENTION — le nombre de subdivisions ne doit JAMAIS être plafonné à une
    valeur basse. Un plafond à 48 sur un triangle de 42 m donne un pas de
    0,87 m pour des voxels de 0,4 m : le sol devient une passoire, la surface
    se troue, et le graphe de navigation se fragmente en milliers de morceaux
    sans qu'aucune erreur ne soit levée. On borne donc la MÉMOIRE par lots,
    pas la finesse. `sub_max` n'est plus qu'un garde-fou, et tout triangle qui
    l'atteint est signalé."""
    bmin, bmax = V.min(0), V.max(0)
    g = Grille(bmin, bmax, voxel, marge)

    A, B, C = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    e1, e2 = B - A, C - A
    long_max = np.maximum(np.linalg.norm(e1, axis=1), np.linalg.norm(e2, axis=1))
    n_sub = np.clip(np.ceil(long_max / (voxel * 0.45)).astype(int), 1, sub_max)

    g.satures = int((np.ceil(long_max / (voxel * 0.45)) > sub_max).sum())
    dims = np.array(g.dims)
    plat_solide = g.solide.reshape(-1)
    plat_marque = g.marque.reshape(-1)
    for n in np.unique(n_sub):
        sel = np.where(n_sub == n)[0]
        u, v = _bary(int(n))
        S = len(u)
        # découpage en lots : la finesse reste exacte, seule la mémoire est bornée
        par_lot = max(1, budget_pts // max(1, S))
        for d0 in range(0, len(sel), par_lot):
            lot = sel[d0:d0 + par_lot]
            pts = (A[lot][:, None, :]
                   + u[None, :, None] * e1[lot][:, None, :]
                   + v[None, :, None] * e2[lot][:, None, :])
            ijk = np.floor((pts - g.origine) / voxel).astype(np.int64)
            np.clip(ijk, 0, dims - 1, out=ijk)
            plat = (ijk[..., 0] * dims[1] + ijk[..., 1]) * dims[2] + ijk[..., 2]
            r = plat.ravel()
            plat_solide[r] = True
            plat_marque[r] = np.repeat(tags[lot].astype(np.int16), S)
    return g


# ════════════════════════════════════════════════════════════════════════════
# 3. GRAPHE DE NAVIGATION
# ════════════════════════════════════════════════════════════════════════════
def _decale(a, off, remplissage=False):
    """out[p] = a[p + off], hors bornes = `remplissage`."""
    out = np.full_like(a, remplissage)
    src = [slice(None)] * 3
    dst = [slice(None)] * 3
    for ax, d in enumerate(off):
        if d > 0:
            src[ax], dst[ax] = slice(d, None), slice(None, -d)
        elif d < 0:
            src[ax], dst[ax] = slice(None, d), slice(-d, None)
    out[tuple(dst)] = a[tuple(src)]
    return out


class GrapheNav:
    def __init__(self):
        self.pos = None        # (N,3) float32, monde
        self.ijk = None        # (N,3) int32, voxel
        self.normale = None    # (N,3) float32, sortante
        self.genre = None      # (N,)  uint8 : SOL / PAROI / PLAFOND
        self.marchable = None  # (N,)  bool  — praticable par le joueur
        self.ciel = None       # (N,)  bool  — rien de solide au-dessus
        self.biome = None      # (N,)  uint8
        self.aretes = None     # (E,2) int32
        self.cout = None       # (E,)  float32
        self.chunk = None      # (N,)  int32
        self.dims_chunk = None
        self.voxel = None


# 26-voisinage, sans le centre
_OFFSETS = [(i, j, k)
            for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1)
            if (i, j, k) != (0, 0, 0)]

# la créature préfère les parois : elles coûtent moins cher que le sol dégagé
COUT_GENRE = {SOL: 1.00, PAROI: 0.72, PLAFOND: 0.88}


def extraire_graphe(g, hauteur_agent=1.8, pas_joueur=0.6,
                    seuil_sol=0.55, taille_chunk=16, noms=None, bornes=None):
    """Extrait les voxels libres au contact d'un solide, les classe, les relie,
    et en déduit le sous-ensemble marchable par le joueur."""
    voxel = g.voxel
    solide = g.solide
    libre = ~solide

    # ── normale sortante : somme des directions opposées aux voisins solides
    acc = np.zeros(solide.shape + (3,), np.int8)
    contact = np.zeros(solide.shape, bool)
    for ax, sgn in ((0, 1), (0, -1), (1, 1), (1, -1), (2, 1), (2, -1)):
        off = [0, 0, 0]
        off[ax] = sgn
        voisin = _decale(solide, tuple(off))       # solide dans la direction off
        m = libre & voisin
        contact |= m
        acc[..., ax][m] -= sgn                     # la normale fuit le solide

    # ── restriction aux volumes de navigation, s'il y en a
    if bornes:
        dedans = np.zeros(solide.shape, bool)
        for bmin, bmax in bornes:
            i0 = np.maximum(0, np.floor((bmin - g.origine) / voxel).astype(int))
            i1 = np.minimum(np.array(solide.shape),
                            np.ceil((bmax - g.origine) / voxel).astype(int) + 1)
            dedans[i0[0]:i1[0], i0[1]:i1[1], i0[2]:i1[2]] = True
        contact &= dedans

    idx = np.argwhere(contact)
    if len(idx) == 0:
        raise ValueError("aucune surface trouvée : géométrie vide ou voxel trop grand")

    nrm = acc[contact[...]][:, :] if False else acc[idx[:, 0], idx[:, 1], idx[:, 2]].astype(np.float32)
    norme = np.linalg.norm(nrm, axis=1, keepdims=True)
    norme[norme == 0] = 1.0
    nrm /= norme

    genre = np.full(len(idx), PAROI, np.uint8)
    genre[nrm[:, 1] > seuil_sol] = SOL
    genre[nrm[:, 1] < -seuil_sol] = PLAFOND

    # ── dégagement vertical : combien de voxels libres au-dessus
    hv = max(1, int(round(hauteur_agent / voxel)))
    degage = libre.copy()
    for k in range(1, hv + 1):
        degage &= _decale(libre, (0, k, 0))
    marchable = (genre == SOL) & degage[idx[:, 0], idx[:, 1], idx[:, 2]]

    # ── exposition au ciel : y a-t-il du solide plus haut dans la colonne ?
    #    C'est ce qui distingue l'extérieur du souterrain, sans rien annoter.
    solide_dessus = np.flip(np.maximum.accumulate(
        np.flip(_decale(solide, (0, 1, 0)), axis=1), axis=1), axis=1)
    ciel = ~solide_dessus[idx[:, 0], idx[:, 1], idx[:, 2]]

    G = GrapheNav()
    G.voxel = voxel
    G.ijk = idx.astype(np.int32)
    G.pos = (g.origine + (idx + 0.5) * voxel).astype(np.float32)
    G.normale = nrm
    G.genre = genre
    G.marchable = marchable
    G.ciel = ciel

    # ── table d'indices pour retrouver un nœud depuis un voxel
    nid = np.full(solide.shape, -1, np.int32)
    nid[idx[:, 0], idx[:, 1], idx[:, 2]] = np.arange(len(idx), dtype=np.int32)

    # ── arêtes : on relie deux nœuds voisins si le chemin ne traverse pas de
    #    solide. Pour une diagonale, on exige que les pas orthogonaux
    #    intermédiaires soient libres — sinon l'agent coupe un angle plein.
    a_list, b_list, c_list = [], [], []
    for off in _OFFSETS:
        voisin_id = _decale(nid, off, remplissage=-1)
        ok = (nid >= 0) & (voisin_id >= 0)
        # Anti-traversée de matière — mais pas anti-arête convexe.
        # Exiger que TOUS les pas intermédiaires soient libres interdisait de
        # contourner le bord d'une dalle : le dessus, le dessous et les parois
        # formaient alors des graphes séparés, et la créature ne pouvait plus
        # grimper. On exige donc qu'AU MOINS UN pas soit libre : franchir une
        # arête convexe redevient légal, traverser un coin plein reste exclu.
        inter = None
        for ax, d in enumerate(off):
            if d:
                o = [0, 0, 0]
                o[ax] = d
                f = _decale(libre, tuple(o))
                inter = f if inter is None else (inter | f)
        if inter is not None:
            ok &= inter
        if not ok.any():
            continue
        a = nid[ok]
        b = voisin_id[ok]
        dist = math.sqrt(sum(d * d for d in off)) * voxel
        a_list.append(a)
        b_list.append(b)
        c_list.append(np.full(len(a), dist, np.float32))

    A = np.concatenate(a_list)
    B = np.concatenate(b_list)
    Cst = np.concatenate(c_list)
    # coût modulé par la nature de la surface d'arrivée
    mult = np.array([COUT_GENRE[SOL], COUT_GENRE[PAROI], COUT_GENRE[PLAFOND]], np.float32)
    Cst = Cst * mult[genre[B]]
    G.aretes = np.stack([A, B], 1).astype(np.int32)
    G.cout = Cst

    # ── biome : d'abord le nom du groupe Blender du solide porteur,
    #    sinon déduction automatique (ciel ouvert = surface, altitude = reste)
    G.biome = deduire_biomes(G, g, noms)

    # ── chunks, pour l'A* hiérarchique côté client
    G.dims_chunk = tuple(int(math.ceil(d / taille_chunk)) for d in g.dims)
    ci = G.ijk // taille_chunk
    G.chunk = ((ci[:, 0] * G.dims_chunk[1] + ci[:, 1]) * G.dims_chunk[2]
               + ci[:, 2]).astype(np.int32)
    return G


def deduire_biomes(G, g, noms):
    """Le biome vient du matériau Blender quand il est nommé, et de la
    topographie sinon — ce qui est exactement la demande : les biomes se
    positionnent d'après le terrain importé, pas d'après une carte séparée."""
    n = len(G.ijk)
    biome = np.full(n, SOUTERRAIN, np.uint8)

    # 1. annotation explicite : on lit la marque du voxel solide sous le nœud
    if noms:
        table = {i: biome_du_nom(nm) for i, nm in enumerate(noms)}
        sous = G.ijk.copy()
        sous[:, 1] = np.maximum(0, sous[:, 1] - 1)
        marques = g.marque[sous[:, 0], sous[:, 1], sous[:, 2]]
        for mi, b in table.items():
            if b is not None:
                biome[marques == mi] = b
        annote = np.zeros(n, bool)
        for mi, b in table.items():
            if b is not None:
                annote |= (marques == mi)
    else:
        annote = np.zeros(n, bool)

    # 2. déduction pour tout le reste
    y = G.pos[:, 1]
    if (~annote).any():
        hauts = np.quantile(y, 0.72)
        auto = ~annote
        biome[auto & G.ciel] = SURFACE
        biome[auto & ~G.ciel & (y > hauts)] = GLACIERE
    return biome


# ════════════════════════════════════════════════════════════════════════════
# 4. VALIDATION
# ════════════════════════════════════════════════════════════════════════════
def _composantes(n, aretes):
    """Union-find sur un graphe non orienté."""
    parent = np.arange(n)

    def trouve(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in aretes:
        ra, rb = trouve(a), trouve(b)
        if ra != rb:
            parent[ra] = rb
    racines = np.array([trouve(i) for i in range(n)])
    _, inv, cnt = np.unique(racines, return_inverse=True, return_counts=True)
    return inv, cnt


def valider(G, pas_joueur=0.6):
    """Contrôles qui ont déjà attrapé de vrais défauts sur ce projet :
       - la carte se tient-elle d'un seul tenant ?
       - existe-t-il des culs-de-sac où l'on tombe sans pouvoir remonter ?
       - le pont produit-il bien deux niveaux marchables dans la même colonne ?
    """
    rap = {}
    n = len(G.ijk)
    rap["noeuds"] = n
    rap["aretes"] = len(G.aretes)
    for gr, nom in NOM_SURFACE.items():
        rap[f"noeuds_{nom}"] = int((G.genre == gr).sum())
    rap["noeuds_marchables"] = int(G.marchable.sum())
    rap["noeuds_ciel_ouvert"] = int(G.ciel.sum())
    for b, nom in NOM_BIOME.items():
        c = int((G.biome == b).sum())
        if c:
            rap[f"biome_{nom}"] = c

    # ── graphe de la créature : tout est connecté, elle grimpe partout
    inv, cnt = _composantes(n, G.aretes)
    rap["composantes_creature"] = int(len(cnt))
    rap["creature_3_plus_grandes_%"] = [round(100.0 * c / n, 1)
                                        for c in sorted(cnt)[::-1][:3]]

    # ── graphe du joueur : orienté. Monter est limité, descendre est libre.
    idm = np.where(G.marchable)[0]
    remap = np.full(n, -1, np.int64)
    remap[idm] = np.arange(len(idm))
    a, b = G.aretes[:, 0], G.aretes[:, 1]
    m = (remap[a] >= 0) & (remap[b] >= 0)
    dy = G.pos[b[m], 1] - G.pos[a[m], 1]
    aa, bb = remap[a[m]], remap[b[m]]
    avant = [(int(x), int(y)) for x, y, d in zip(aa, bb, dy) if d <= pas_joueur]
    rap["noeuds_joueur"] = len(idm)

    if len(idm):
        import collections
        succ = collections.defaultdict(list)
        pred = collections.defaultdict(list)
        for x, y in avant:
            succ[x].append(y)
            pred[y].append(x)

        # ── ARÊTES DE CHUTE.
        # L'adjacence de voxels ne dit rien d'un joueur qui saute d'une
        # corniche : les deux nœuds sont trop éloignés pour être voisins.
        # Or c'est exactement ce mouvement qui fabrique les culs-de-sac.
        # On le modélise donc explicitement, et en sens unique.
        ij = G.ijk[idm]
        colonnes = collections.defaultdict(list)
        for n, (i, j, k) in enumerate(ij):
            colonnes[(int(i), int(k))].append((int(j), n))
        for cle in colonnes:
            colonnes[cle].sort()
        pas_vox = max(1, int(round(pas_joueur / G.voxel)))
        for (i, k), liste in colonnes.items():
            for j, n in liste:
                for di, dk in ((1, 0), (-1, 0), (0, 1), (0, -1),
                               (1, 1), (1, -1), (-1, 1), (-1, -1)):
                    voisine = colonnes.get((i + di, k + dk))
                    if not voisine:
                        continue
                    # le plus haut palier accessible sans escalader
                    cible = None
                    for j2, n2 in voisine:
                        if j2 <= j + pas_vox:
                            cible = (j2, n2)
                        else:
                            break
                    if cible is None:
                        continue
                    j2, n2 = cible
                    if n2 not in succ[n]:
                        succ[n].append(n2)
                        pred[n2].append(n)
                    # on ne remonte que si la marche reste franchissable
                    if j - j2 <= pas_vox and n not in succ[n2]:
                        succ[n2].append(n)
                        pred[n].append(n2)

        def parcours(dep, table):
            vus = np.zeros(len(idm), bool)
            vus[dep] = True
            pile = [dep]
            while pile:
                x = pile.pop()
                for y in table[x]:
                    if not vus[y]:
                        vus[y] = True
                        pile.append(y)
            return vus

        # Partir d'un nœud arbitraire donne un chiffre fragile : on cherche
        # d'abord la plus grosse composante faiblement connexe, qui est le
        # niveau jouable, puis on teste les culs-de-sac DEDANS.
        pairs = [(x, y) for x in succ for y in succ[x]]
        inv2, cnt2 = _composantes(len(idm), np.array(pairs, np.int64)) \
            if pairs else (np.zeros(len(idm), int), np.array([len(idm)]))
        principal = int(np.argmax(cnt2))
        membres = np.where(inv2 == principal)[0]
        rap["composantes_joueur"] = int(len(cnt2))
        rap["joueur_composante_principale_%"] = round(100.0 * len(membres) / len(idm), 1)
        dep = int(membres[np.argmin(G.pos[idm[membres], 1])])
        av = parcours(dep, succ)
        ar = parcours(dep, pred)
        rap["joueur_atteignable_depuis_le_point_bas_%"] = round(
            100.0 * av.sum() / max(1, len(membres)), 1)
        rap["cellules_pieges"] = int((av & ~ar).sum())

    # ── preuve de superposition : colonnes (x,z) à plusieurs niveaux marchables
    if len(idm):
        col = G.ijk[idm][:, [0, 2]]
        hy = G.ijk[idm][:, 1]
        ordre = np.lexsort((hy, col[:, 1], col[:, 0]))
        c, h = col[ordre], hy[ordre]
        niveaux, courant, prev = 0, 1, None
        mult = 0
        for i in range(len(h)):
            same = prev is not None and c[i, 0] == c[i - 1, 0] and c[i, 1] == c[i - 1, 1]
            if same:
                if h[i] - h[i - 1] > 2:      # vrai décrochement, pas un voisin
                    courant += 1
            else:
                if courant > 1:
                    mult += 1
                    niveaux = max(niveaux, courant)
                courant = 1
            prev = i
        if courant > 1:
            mult += 1
            niveaux = max(niveaux, courant)
        rap["colonnes_multi_niveaux"] = mult
        rap["niveaux_max_dans_une_colonne"] = max(1, niveaux)
    return rap


# ════════════════════════════════════════════════════════════════════════════
# 5. EXPORT
# ════════════════════════════════════════════════════════════════════════════
def exporter(G, g, dossier, nom="nav"):
    """Écrit un binaire compact + un manifeste JSON.

    Le binaire est pensé pour être avalé tel quel par le client : un seul
    fetch(), des vues typées posées sur l'ArrayBuffer, zéro parsing."""
    dossier = Path(dossier)
    dossier.mkdir(parents=True, exist_ok=True)

    blocs = [
        ("pos",      G.pos.astype(np.float32)),
        ("normale",  (G.normale * 127).astype(np.int8)),
        ("genre",    G.genre.astype(np.uint8)),
        ("drapeaux", (G.marchable.astype(np.uint8) | (G.ciel.astype(np.uint8) << 1))),
        ("biome",    G.biome.astype(np.uint8)),
        ("chunk",    G.chunk.astype(np.int32)),
        ("aretes",   G.aretes.astype(np.int32)),
        ("cout",     G.cout.astype(np.float32)),
    ]
    manifeste = {
        "version": 1,
        "voxel": G.voxel,
        "origine": [float(v) for v in g.origine],
        "dims_voxel": list(g.dims),
        "dims_chunk": list(G.dims_chunk),
        "nb_noeuds": int(len(G.pos)),
        "nb_aretes": int(len(G.aretes)),
        "genres": NOM_SURFACE,
        "biomes": NOM_BIOME,
        "blocs": [],
    }
    decalage = 0
    with open(dossier / f"{nom}.bin", "wb") as fh:
        for cle, arr in blocs:
            octets = arr.tobytes()
            fh.write(octets)
            manifeste["blocs"].append({
                "cle": cle, "type": arr.dtype.name,
                "forme": list(arr.shape),
                "decalage": decalage, "octets": len(octets),
            })
            decalage += len(octets)
    manifeste["octets_total"] = decalage
    with open(dossier / f"{nom}.json", "w", encoding="utf-8") as fh:
        json.dump(manifeste, fh, ensure_ascii=False, indent=2)
    return manifeste


def exporter_collision(g, dossier, nom="collision"):
    """Occupation solide compactée en bits : c'est la collision du client.
    Un niveau de 240×60×240 m à 0,4 m tient dans ~3 Mo une fois compacté."""
    dossier = Path(dossier)
    dossier.mkdir(parents=True, exist_ok=True)
    paquet = np.packbits(g.solide.reshape(-1))
    with open(dossier / f"{nom}.bin", "wb") as fh:
        fh.write(paquet.tobytes())
    meta = {"voxel": g.voxel, "origine": [float(v) for v in g.origine],
            "dims": list(g.dims), "octets": int(paquet.nbytes),
            "encodage": "packbits, ordre C (i,j,k), j vertical"}
    with open(dossier / f"{nom}.json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    return meta
