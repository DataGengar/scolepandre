#!/usr/bin/env python3
"""
EXPORTER_BIOMES — src/monde/biomes.js  →  outils/biomes.json

    python outils/exporter_biomes.py

Pourquoi : l'éditeur de cartes (outils/releve.html) doit peindre EXACTEMENT les
couleurs que le jeu sait relire. En v2 les deux avaient chacun leur table
codée en dur, et rien n'empêchait qu'elles divergent — auquel cas une carte
dessinée donnait des biomes faux, sans le moindre message d'erreur.

Désormais src/monde/biomes.js fait foi, ce script en dérive le JSON, et
outils/verifier.py refuse un commit où le JSON a pris du retard.

L'ORDRE FAIT FOI : les cartes PNG encodent l'index du biome. Réordonner la
table casse les cartes déjà dessinées.
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
SOURCE = RACINE / "src" / "monde" / "biomes.js"
SORTIE = RACINE / "outils" / "biomes.json"

# touches de l'éditeur, dans l'ordre de la table
TOUCHES = ["1", "2", "3", "4", "5", "6", "7", "8"]


def main():
    js = SOURCE.read_text(encoding="utf-8")
    noms = re.findall(r"^\s*n:'([^']+)'", js, re.M)
    codes = re.findall(r"code:'(#[0-9a-fA-F]{6})'", js)
    if len(noms) != len(codes):
        raise SystemExit(
            f"ERREUR  {len(noms)} noms mais {len(codes)} codes couleur dans "
            f"{SOURCE.relative_to(RACINE)}"
        )

    data = {
        "_avertissement": "GÉNÉRÉ par outils/exporter_biomes.py — ne pas éditer. "
                          "La source est src/monde/biomes.js.",
        "roche": "#000000",
        "biomes": [{"nom": n, "code": c} for n, c in zip(noms, codes)],
        "touches": TOUCHES[: len(noms)],
    }
    SORTIE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8")

    print(f"\n  {SOURCE.relative_to(RACINE)}  ->  {SORTIE.relative_to(RACINE)}")
    for i, (n, c) in enumerate(zip(noms, codes)):
        print(f"    {i+1}  {c}  {n}")
    print()


if __name__ == "__main__":
    main()
