#!/usr/bin/env python3
"""
VERIFIER — contrôle de cohérence à lancer avant chaque commit.

    python outils/verifier.py

Six contrôles, tous nés d'un problème réel rencontré sur ce projet :

  1. IMPORTS CASSÉS
     Un module importe un symbole qu'un autre n'exporte pas. C'est l'erreur la
     plus fréquente quand on renomme un export sans suivre ses consommateurs.

  2. EXPORTS RÉASSIGNÉS  ← le piège le plus sournois
     `export let x` réassigné plus tard marche en modules ES (liaisons
     vivantes) mais PAS après concaténation par le bundler, qui capture la
     valeur à l'initialisation. Le jeu marche alors en dev et casse en
     livraison. Utilise un objet porteur : `export const p = {v:null}`.

  3. CLÉS DE SETUP JAMAIS LUES
     Une valeur qui n'est lue nulle part est soit un oubli, soit un déchet.

  4. CURSEURS ORPHELINS
     Un curseur qui pointe vers une clé absente de SETUP.

  5. TABLE DES BIOMES DÉSYNCHRONISÉE
     outils/biomes.json doit refléter src/monde/biomes.js, sinon l'éditeur
     RELEVÉ code les couleurs autrement que le jeu ne les lit, et l'import
     PNG se met à donner n'importe quel biome.

  6. MODULES ORPHELINS
     Un fichier de src/ que personne n'importe : soit un oubli de branchement,
     soit un reste à supprimer.
"""

import json
import re
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

RACINE = Path(__file__).resolve().parent.parent
SRC = RACINE / "src"

sys.path.insert(0, str(Path(__file__).parent))
import bundler  # noqa: E402  (on réutilise son analyseur, une seule source)

RE_EXPORT_LET = re.compile(r"^export\s+(let|var)\s+([A-Za-z_$][\w$]*)", re.M)

erreurs, avertis = [], []


def err(t):
    erreurs.append(t)


def avert(t):
    avertis.append(t)


# ── 1 & 2 : graphe d'imports et exports réassignés ─────────────────────────
def controler_modules():
    modules, ordre = bundler.charger(SRC / "jeu.js")

    for e in bundler.verifier_liens(modules):
        err("IMPORT CASSÉ\n" + e)

    for mod in modules.values():
        for m in RE_EXPORT_LET.finditer(mod.brut):
            nom = m.group(2)
            # cherche une réassignation `nom = …` hors de la déclaration
            corps = mod.brut[m.end():]
            if re.search(rf"^\s*{re.escape(nom)}\s*=[^=]", corps, re.M):
                err(
                    f"EXPORT RÉASSIGNÉ\n  {mod.rel}\n"
                    f"      « {nom} » est un `export {m.group(1)}` réassigné plus tard.\n"
                    f"      Marche en modules ES, CASSE dans le bundle.\n"
                    f"      Remplace par un objet porteur : export const X = {{v:…}}"
                )
    return modules, ordre


# ── 3 & 4 : clés de setup ───────────────────────────────────────────────────
def chemins_de_setup():
    """
    Liste les chemins de clés de SETUP, façon 'froid.geoPlancher'.

    Scanner à profondeur réelle, et non ligne à ligne : la première version
    perdait l'imbrication dès qu'un tableau d'objets apparaissait
    (`paliers:[{min:70, …}]`) et rapportait alors `SETUP.delaiMort` au lieu de
    `SETUP.froid.delaiMort`. On ne pousse un nom sur la pile que si un `{` suit
    immédiatement `nom:` — les objets anonymes d'un tableau ne créent donc pas
    de niveau nommé.
    """
    txt = (SRC / "setup.js").read_text(encoding="utf-8")
    j = txt.index("{", txt.index("export const SETUP = {"))
    n = len(txt)
    pile = []            # [(nom, profondeur où il a été ouvert)]
    chemins = []
    prof = 0

    while j < n:
        c = txt[j]
        if c in "{[":
            prof += 1
        elif c in "}]":
            prof -= 1
            while pile and pile[-1][1] > prof:
                pile.pop()
            if prof == 0:
                break
        elif c == "/" and j + 1 < n and txt[j + 1] in "/*":
            # on saute les commentaires : ils contiennent des « nom : » trompeurs
            if txt[j + 1] == "/":
                k = txt.find("\n", j)
            else:
                k = txt.find("*/", j)
                k = k + 1 if k >= 0 else -1
            if k < 0:
                break
            j = k
        elif re.match(r"[A-Za-z_$]", c) and (j == 0 or not re.match(r"[\w$.'\"]", txt[j - 1])):
            m = re.match(r"([A-Za-z_$][\w$]*)\s*:\s*", txt[j:])
            if m:
                nom = m.group(1)
                k = j + m.end()
                if k < n and txt[k] == "{":
                    pile.append((nom, prof + 1))
                else:
                    chemins.append(".".join([p[0] for p in pile] + [nom]))
                j = k - 1
        j += 1
    return chemins


def controler_setup():
    chemins = chemins_de_setup()
    sources = "\n".join(
        p.read_text(encoding="utf-8")
        for p in SRC.rglob("*.js")
        if p.name != "setup.js"
    )
    setup_txt = (SRC / "setup.js").read_text(encoding="utf-8")

    for ch in chemins:
        feuille = ch.split(".")[-1]
        # Trois façons légitimes de lire une clé, toutes acceptées :
        #   SETUP.groupe.feuille                 accès direct
        #   const S = SETUP.groupe; S.feuille    raccourci local, très courant ici
        #   const {feuille} = SETUP.groupe       destructuration
        #   ecrire('groupe.feuille', …)          par chemin, depuis les curseurs
        # C'est une HEURISTIQUE : `.feuille` peut matcher une propriété sans
        # rapport. On préfère un avertissement manqué à vingt faux positifs.
        motifs = [
            rf"SETUP\.{re.escape(ch)}\b",
            rf"\.{re.escape(feuille)}\b",
            rf"\b{re.escape(feuille)}\s*[,}}]",
            rf"['\"]{re.escape(ch)}['\"]",
        ]
        if any(re.search(m, sources) for m in motifs):
            continue
        # une clé peut aussi n'être lue que dans setup.js lui-même : c'est le
        # cas des maxima de curseurs (image.fogMax alimente CURSEURS).
        if re.search(rf"['\"]{re.escape(ch)}['\"]", setup_txt):
            continue
        if re.search(rf"SETUP\.{re.escape(ch)}\b", setup_txt):
            continue
        avert(f"CLÉ INUTILISÉE   SETUP.{ch}")

    # curseurs orphelins
    for m in re.finditer(r"chemin:\s*'([^']+)'", setup_txt):
        if m.group(1) not in chemins:
            err(f"CURSEUR ORPHELIN\n  SETUP.CURSEURS pointe vers « {m.group(1)} », "
                f"absent de SETUP.")


# ── 5 : biomes.json ─────────────────────────────────────────────────────────
def controler_biomes():
    js = (SRC / "monde" / "biomes.js").read_text(encoding="utf-8")
    attendus = [
        {"nom": n, "code": c}
        for n, c in zip(re.findall(r"^\s*n:'([^']+)'", js, re.M),
                        re.findall(r"code:'(#[0-9a-fA-F]{6})'", js))
    ]
    fic = RACINE / "outils" / "biomes.json"
    if not fic.exists():
        err("BIOMES DÉSYNCHRONISÉS\n  outils/biomes.json absent.\n"
            "      lance : python outils/exporter_biomes.py")
        return
    reel = json.loads(fic.read_text(encoding="utf-8"))
    if reel.get("biomes") != attendus:
        err("BIOMES DÉSYNCHRONISÉS\n  outils/biomes.json ne correspond plus à "
            "src/monde/biomes.js\n      lance : python outils/exporter_biomes.py")


# ── 6 : modules orphelins ───────────────────────────────────────────────────
def controler_orphelins(modules):
    atteints = {Path(m.chemin).as_posix() for m in modules.values()}
    for p in SRC.rglob("*.js"):
        if p.resolve().as_posix() not in atteints:
            avert(f"MODULE ORPHELIN  {p.relative_to(RACINE).as_posix()}"
                  f"  (personne ne l'importe)")


def main():
    print("\n  VÉRIFICATION\n")
    modules, _ = controler_modules()
    controler_setup()
    controler_biomes()
    controler_orphelins(modules)

    for a in avertis:
        print("  ⚠  " + a)
    if avertis:
        print()
    for e in erreurs:
        print("  ✗  " + e)
        print()

    if erreurs:
        print(f"  {len(erreurs)} erreur(s), {len(avertis)} avertissement(s).\n")
        return 1
    print(f"  tout est cohérent. {len(avertis)} avertissement(s).\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
