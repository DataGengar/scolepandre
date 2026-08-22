"""
Pipeline topographie → navigation.

    python build.py niveau.obj --sortie ../public/nav --voxel 0.4 --up z

Options utiles :
    --voxel      taille du voxel en mètres (0,35–0,5 est le bon domaine)
    --up z       si l'OBJ vient de Blender sans conversion d'axes
    --hauteur    hauteur du joueur, pour le dégagement vertical (défaut 1,8)
    --pas        marche franchissable par le joueur (défaut 0,6)
    --chunk      côté du chunk en voxels, pour l'A* hiérarchique (défaut 16)
"""
import argparse, time, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import scolo_pipeline as sp


def main():
    ap = argparse.ArgumentParser(description="topographie → navigation")
    ap.add_argument("obj")
    ap.add_argument("--sortie", default="nav_out")
    ap.add_argument("--voxel", type=float, default=0.4)
    ap.add_argument("--up", default="y", choices=["y", "z"])
    ap.add_argument("--hauteur", type=float, default=1.8)
    ap.add_argument("--pas", type=float, default=0.6)
    ap.add_argument("--chunk", type=int, default=16)
    ap.add_argument("--collision", action="store_true",
                    help="exporter aussi la grille de collision compactée")
    a = ap.parse_args()

    def etape(nom):
        print(f"  {nom:.<44}", end="", flush=True)
        return time.time()

    def fini(t0, info=""):
        print(f" {time.time()-t0:6.2f}s  {info}")

    print(f"\n{a.obj}  →  {a.sortie}   (voxel {a.voxel} m)\n")

    t = etape("lecture OBJ")
    V, F, tags, noms = sp.load_obj(a.obj, up=a.up)
    fini(t, f"{len(V)} sommets, {len(F)} triangles, {len(noms)} groupes")

    F, tags, bornes = sp.separer_bornes(V, F, tags, noms)
    if bornes:
        print(f"  {len(bornes)} volume(s) de navigation détecté(s)\n")

    t = etape("voxelisation")
    g = sp.voxeliser(V, F, tags, a.voxel)
    plein = int(g.solide.sum())
    fini(t, f"grille {g.dims}, {plein} voxels pleins "
            f"({100*plein/g.nb_voxels:.1f}%)")
    if g.satures:
        print(f"    ATTENTION : {g.satures} triangle(s) au plafond de subdivision "
              f"— risque de trous dans la surface")

    t = etape("remplissage des cavités fermées")
    n_cav = sp.remplir_cavites(g)
    fini(t, f"{n_cav} voxels intérieurs solidifiés")

    t = etape("extraction du graphe de navigation")
    G = sp.extraire_graphe(g, hauteur_agent=a.hauteur, pas_joueur=a.pas,
                           taille_chunk=a.chunk, noms=noms, bornes=bornes)
    fini(t, f"{len(G.pos)} nœuds, {len(G.aretes)} arêtes")

    t = etape("validation")
    rap = sp.valider(G, pas_joueur=a.pas)
    fini(t)

    t = etape("export")
    man = sp.exporter(G, g, a.sortie)
    info = f"{man['octets_total']/1e6:.2f} Mo"
    if a.collision:
        meta = sp.exporter_collision(g, a.sortie)
        info += f" + collision {meta['octets']/1e6:.2f} Mo"
    fini(t, info)

    print("\n  RAPPORT")
    largeur = max(len(k) for k in rap)
    for k, v in rap.items():
        marque = ""
        if k == "cellules_pieges":
            marque = "  ← doit valoir 0" if v == 0 else "  ← ATTENTION : culs-de-sac"
        if k == "colonnes_multi_niveaux" and v > 0:
            marque = "  ← superposition confirmée, la heightmap ne suffirait pas"
        print(f"    {k:<{largeur}} : {v}{marque}")
    print()


if __name__ == "__main__":
    main()
