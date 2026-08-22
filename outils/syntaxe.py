#!/usr/bin/env python3
"""
SYNTAXE — contrôle de délimiteurs sur les sources JS.

    python outils/syntaxe.py

Il n'y a pas de moteur JavaScript sur cette machine (ni node, ni deno, ni bun),
donc pas moyen de faire un vrai `--check`. Ce script fait ce qu'on peut faire
sans : un tokeniseur qui saute correctement les chaînes, les gabarits, les
commentaires et les littéraux d'expression régulière, puis vérifie que les
accolades, parenthèses et crochets s'équilibrent.

Ce que ça attrape : l'accolade ou la parenthèse manquante, la chaîne non
fermée, le commentaire de bloc laissé ouvert. C'est-à-dire la quasi-totalité
des fautes de frappe qui empêchent une page de démarrer.

Ce que ça n'attrape pas : les erreurs sémantiques, les variables non définies,
les erreurs de type. Pour ça, il faut ouvrir la page et lire la console.
"""

import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

RACINE = Path(__file__).resolve().parent.parent
SRC = RACINE / "src"

PAIRES = {")": "(", "]": "[", "}": "{"}
OUVRANTS = set("([{")

# Un `/` démarre une regex plutôt qu'une division si le dernier jeton
# significatif est l'un de ceux-ci.
AVANT_REGEX = set("(,=:[!&|?{};+-*%~^<>") | {"return", "typeof", "case", "in", "of", "new", "delete"}


def controler(chemin: Path):
    """Renvoie une liste de messages d'erreur pour ce fichier."""
    s = chemin.read_text(encoding="utf-8")
    # Le piège de l'accent grave ne concerne QUE les fichiers dont les
    # commentaires vivent à l'intérieur d'une chaîne gabarit : chez nous, les
    # sources GLSL. Partout ailleurs, « `nom` » dans un commentaire est de la
    # prose parfaitement légitime, et la signaler noierait le rapport.
    glsl = "#version 300 es" in s
    n = len(s)
    pb = []
    pile = []          # [(caractère, ligne)]
    i = 0
    ligne = 1
    dernier = ""       # dernier caractère significatif

    while i < n:
        c = s[i]

        if c == "\n":
            ligne += 1
            i += 1
            continue

        # ── commentaires
        if c == "/" and i + 1 < n:
            if s[i + 1] == "/":
                j = s.find("\n", i)
                i = n if j < 0 else j
                continue
            if s[i + 1] == "*":
                j = s.find("*/", i + 2)
                if j < 0:
                    pb.append(f"ligne {ligne} : commentaire de bloc jamais fermé")
                    break
                # PIÈGE VÉCU : un accent grave dans un commentaire de bloc FERME
                # le template literal qui l'englobe. C'est exactement ce qui a
                # cassé le shader — un « `ang` » dans un commentaire GLSL, à
                # l'intérieur d'une chaîne gabarit. Invisible à la lecture, et
                # l'équilibre des délimiteurs restait juste puisqu'il y en avait
                # deux : seul le navigateur s'en plaignait.
                if glsl and "`" in s[i:j]:
                    pb.append(f"ligne {ligne} : accent grave dans un commentaire de "
                              f"bloc — il FERME le template literal GLSL qui l'englobe")
                ligne += s.count("\n", i, j)
                i = j + 2
                continue
            # ── littéral d'expression régulière
            if dernier in AVANT_REGEX or dernier == "":
                j = i + 1
                classe = False
                fini = False
                while j < n:
                    d = s[j]
                    if d == "\\":
                        j += 2
                        continue
                    if d == "[":
                        classe = True
                    elif d == "]":
                        classe = False
                    elif d == "/" and not classe:
                        fini = True
                        break
                    elif d == "\n":
                        break
                    j += 1
                if fini:
                    i = j + 1
                    dernier = "/"
                    continue
            i += 1
            dernier = "/"
            continue

        # ── chaînes simples et doubles
        if c in "'\"":
            j = i + 1
            while j < n:
                if s[j] == "\\":
                    j += 2
                    continue
                if s[j] == c:
                    break
                if s[j] == "\n":
                    pb.append(f"ligne {ligne} : chaîne {c}…{c} non fermée en fin de ligne")
                    break
                j += 1
            if j >= n:
                pb.append(f"ligne {ligne} : chaîne {c}…{c} non fermée")
                break
            i = j + 1
            dernier = c
            continue

        # ── gabarit `…${…}…`
        if c == "`":
            j = i + 1
            prof = 0
            while j < n:
                d = s[j]
                if d == "\\":
                    j += 2
                    continue
                if d == "\n":
                    ligne += 1
                elif d == "$" and j + 1 < n and s[j + 1] == "{":
                    prof += 1
                    j += 2
                    continue
                elif d == "}" and prof > 0:
                    prof -= 1
                elif d == "`" and prof == 0:
                    break
                j += 1
            if j >= n:
                pb.append(f"ligne {ligne} : gabarit `…` non fermé")
                break
            i = j + 1
            dernier = "`"
            continue

        # ── délimiteurs
        if c in OUVRANTS:
            pile.append((c, ligne))
        elif c in PAIRES:
            if not pile:
                pb.append(f"ligne {ligne} : « {c} » sans ouvrant correspondant")
            elif pile[-1][0] != PAIRES[c]:
                o, lo = pile[-1]
                pb.append(f"ligne {ligne} : « {c} » ferme un « {o} » ouvert ligne {lo}")
                pile.pop()
            else:
                pile.pop()

        if not c.isspace():
            dernier = c
        i += 1

    for o, lo in pile:
        pb.append(f"ligne {lo} : « {o} » jamais fermé")

    return pb


def main():
    print("\n  CONTRÔLE DE SYNTAXE (délimiteurs)\n")
    total = 0
    fichiers = sorted(SRC.rglob("*.js"))
    for f in fichiers:
        pb = controler(f)
        if pb:
            total += len(pb)
            print(f"  ✗  {f.relative_to(RACINE).as_posix()}")
            for m in pb[:6]:
                print(f"        {m}")
            print()
    if total:
        print(f"  {total} problème(s) sur {len(fichiers)} fichiers.\n")
        return 1
    print(f"  {len(fichiers)} fichiers, délimiteurs équilibrés.")
    print("  (Ne remplace pas l'ouverture de la page : les erreurs de nom ou")
    print("   de type ne se voient que dans la console du navigateur.)\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
