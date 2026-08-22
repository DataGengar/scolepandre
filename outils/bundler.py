#!/usr/bin/env python3
"""
BUNDLER — src/*.js + index.html  →  dist/scoleopandre.html (fichier unique)

    python outils/bundler.py

Pourquoi : les modules ES exigent un serveur (file:// les bloque pour cause de
CORS). On veut pouvoir livrer UN fichier double-cliquable, sans dépendance,
sans node. Ce script résout lui-même le graphe d'imports et concatène tout
dans un seul <script>.

Ce qu'il sait faire, et rien de plus — c'est volontaire, il doit rester lisible :

    import {a, b as c} from './x.js';
    import * as NS from './x.js';
    import Def from './x.js';        (non utilisé dans ce projet, mais géré)
    export const / function / class / let / var
    export {a, b as c};
    export {x} from './y.js';        (ré-export, utilisé par audio/index.js)
    export default ...               (non utilisé)

Le principe : chaque module devient une IIFE qui renvoie son objet d'exports,
et les imports deviennent des destructurations. Pas de renommage global, donc
deux modules peuvent avoir des variables locales homonymes sans se marcher
dessus — ce qui arrive beaucoup ici (`props`, `lights`, `S`…).

Vérification finale : le script refuse de produire un bundle si un import
pointe vers un symbole que le module cible n'exporte pas. C'est le garde-fou
qui garde les liens synchronisés.
"""

import re
import sys
from pathlib import Path

# La console Windows est en cp1252 : sans ça, la moindre flèche fait planter
# le script avant même d'avoir lu un fichier.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

RACINE = Path(__file__).resolve().parent.parent
SRC = RACINE / "src"
ENTREE = SRC / "jeu.js"
GABARIT = RACINE / "index.html"
SORTIE = RACINE / "dist" / "scoleopandre.html"

# ── expressions ────────────────────────────────────────────────────────────
# re.S est indispensable : la moitié des imports du projet tiennent sur
# plusieurs lignes. Sans lui ils n'étaient pas reconnus et se retrouvaient
# tels quels dans le bundle, qui ne démarrait donc pas du tout.
RE_IMPORT = re.compile(
    r"^import\s+(?:(?P<clause>[^;]*?)\s+from\s+)?['\"](?P<src>[^'\"]+)['\"]\s*;?[ 	]*$",
    re.M | re.S,
)
RE_EXPORT_FROM = re.compile(
    r"^export\s*\{(?P<noms>[^}]*)\}\s*from\s*['\"](?P<src>[^'\"]+)['\"]\s*;?[ 	]*$",
    re.M | re.S,
)
RE_EXPORT_LISTE = re.compile(r"^export\s*\{(?P<noms>[^}]*)\}\s*;?[ 	]*$", re.M | re.S)
# function* et async function sont gérés ; const/let/var peuvent déclarer
# plusieurs noms d'un coup (`export const a = [], b = [];`), c'est extrait
# par noms_declares() plus bas.
RE_EXPORT_DECL = re.compile(
    r"^export\s+(?P<mot>const|let|var|async\s+function\s*\*?|function\s*\*?|class)\s+"
    r"(?P<reste>[A-Za-z_$][\w$]*)",
    re.M,
)


def noms_declares(src: str, depart: int):
    """
    À partir de l'index du premier identifiant d'un `const/let/var`, renvoie
    tous les noms déclarés par l'instruction. Un scanner minimal suffit : on
    suit la profondeur des parenthèses / crochets / accolades et on retient
    l'identifiant qui suit chaque virgule de profondeur zéro.
    """
    noms = []
    i, n = depart, len(src)
    prof = 0
    attend_nom = True
    while i < n:
        c = src[i]
        if attend_nom and prof == 0:
            m = re.match(r"[A-Za-z_$][\w$]*", src[i:])
            if m:
                noms.append(m.group(0))
                i += m.end()
                attend_nom = False
                continue
        if c in "([{":
            prof += 1
        elif c in ")]}":
            prof -= 1
        elif c == "," and prof == 0:
            attend_nom = True
            i += 1
            while i < n and src[i] in " \t\n":
                i += 1
            continue
        elif c == ";" and prof == 0:
            break
        elif c == "\n" and prof == 0:
            # fin d'instruction si la ligne suivante ne continue pas la liste
            j = i + 1
            while j < n and src[j] in " \t\n":
                j += 1
            if j >= n or not re.match(r"[A-Za-z_$]", src[j:j + 1]) or src[i - 1] != ",":
                break
        i += 1
    return noms


def resoudre(base: Path, spec: str) -> Path:
    """Chemin absolu d'un import relatif."""
    p = (base.parent / spec).resolve()
    if not p.exists():
        raise SystemExit(f"ERREUR  import introuvable : {spec}\n        depuis {base}")
    return p


def parse_specifieurs(clause: str):
    """
    'a, {b, c as d}, * as NS'  →  (defaut, [(exporte, local)…], namespace)
    """
    defaut = None
    nommes = []
    ns = None
    clause = clause.strip()
    # namespace
    m = re.match(r"^\*\s+as\s+([A-Za-z_$][\w$]*)$", clause)
    if m:
        return None, [], m.group(1)
    # partie nommée entre accolades
    m = re.search(r"\{([^}]*)\}", clause)
    if m:
        for morceau in m.group(1).split(","):
            morceau = morceau.strip()
            if not morceau:
                continue
            if " as " in morceau:
                a, b = morceau.split(" as ")
                nommes.append((a.strip(), b.strip()))
            else:
                nommes.append((morceau, morceau))
        clause = (clause[: m.start()] + clause[m.end():]).strip().strip(",").strip()
    if clause:
        defaut = clause
    return defaut, nommes, ns


class Module:
    def __init__(self, chemin: Path):
        self.chemin = chemin
        self.rel = chemin.relative_to(RACINE).as_posix()
        self.brut = chemin.read_text(encoding="utf-8")
        self.deps = []          # [(Path, clause)]
        self.reexports = []     # [(Path, [(exporte, local)…])]
        self.exports = set()
        self.corps = ""
        self.id = "M_" + re.sub(r"[^\w]", "_", chemin.relative_to(SRC).as_posix())[:-3]

    def analyser(self):
        src = self.brut

        # export {x} from './y.js'  → ré-export
        def _reexp(m):
            cible = resoudre(self.chemin, m.group("src"))
            paires = []
            for morceau in m.group("noms").split(","):
                morceau = morceau.strip()
                if not morceau:
                    continue
                if " as " in morceau:
                    a, b = morceau.split(" as ")
                    paires.append((a.strip(), b.strip()))
                else:
                    paires.append((morceau, morceau))
            self.reexports.append((cible, paires))
            for _, local in paires:
                self.exports.add(local)
            return ""

        src = RE_EXPORT_FROM.sub(_reexp, src)

        # imports
        def _imp(m):
            clause = m.group("clause")
            spec = m.group("src")
            cible = resoudre(self.chemin, spec)
            self.deps.append((cible, clause or ""))
            return ""

        src = RE_IMPORT.sub(_imp, src)

        # export const/let/var/function/function*/async function/class
        for m in RE_EXPORT_DECL.finditer(src):
            mot = m.group("mot")
            if mot in ("const", "let", "var"):
                for nom in noms_declares(src, m.start("reste")):
                    self.exports.add(nom)
            else:
                self.exports.add(m.group("reste"))
        src = RE_EXPORT_DECL.sub(
            lambda m: f"{m.group('mot')} {m.group('reste')}", src)

        # export {a, b as c}
        def _liste(m):
            for morceau in m.group("noms").split(","):
                morceau = morceau.strip()
                if not morceau:
                    continue
                nom = morceau.split(" as ")[-1].strip() if " as " in morceau else morceau
                self.exports.add(nom)
            return "/* export groupé retiré par le bundler */"

        src = RE_EXPORT_LISTE.sub(_liste, src)
        self.exports_liste_brute = [
            m.group("noms") for m in RE_EXPORT_LISTE.finditer(self.brut)
        ]
        self.corps = src


def charger(entree: Path):
    modules, ordre, visite, pile = {}, [], set(), set()

    def visiter(p: Path):
        cle = p.as_posix()
        if cle in visite:
            return
        if cle in pile:
            # cycle : on laisse passer, l'ordre d'IIFE le résoudra si les
            # usages sont différés. On le signale quand même.
            print(f"  cycle d'import détecté sur {p.relative_to(RACINE)}")
            return
        pile.add(cle)
        mod = Module(p)
        mod.analyser()
        modules[cle] = mod
        for dep, _ in mod.deps:
            visiter(dep)
        for dep, _ in mod.reexports:
            visiter(dep)
        pile.discard(cle)
        visite.add(cle)
        ordre.append(mod)

    visiter(entree)
    return modules, ordre


def verifier_liens(modules):
    """Le garde-fou : un import vers un symbole non exporté fait échouer."""
    erreurs = []
    for mod in modules.values():
        for dep, clause in mod.deps:
            cible = modules[dep.as_posix()]
            _, nommes, ns = parse_specifieurs(clause)
            if ns:
                continue
            for exporte, _local in nommes:
                if exporte not in cible.exports:
                    erreurs.append(
                        f"  {mod.rel}\n      importe « {exporte} » "
                        f"que {cible.rel} n'exporte pas"
                    )
    return erreurs


def emettre(modules, ordre):
    out = []
    out.append('"use strict";')
    out.append("/* ══════════════════════════════════════════════════════════")
    out.append("   SCOLÉOPANDRE — bundle généré par outils/bundler.py")
    out.append("   NE PAS ÉDITER. Modifie src/ puis relance le bundler.")
    out.append("   ══════════════════════════════════════════════════════════ */")
    out.append("const __M = {};")

    for mod in ordre:
        out.append(f"\n/* ─── {mod.rel} ─── */")
        out.append(f"__M['{mod.id}'] = (function(){{")

        # Un module peut IMPORTER un nom et le RÉ-EXPORTER (monde/index.js le
        # fait pour props, lights, colliders, cachettes, gouffres). En modules
        # ES c'est légal ; ici les deux produiraient deux `const` du même nom
        # dans la même IIFE, donc une SyntaxError et une page qui ne démarre
        # pas du tout. On tient donc la liste des noms déjà liés.
        lies = set()

        # destructurer les imports
        for dep, clause in mod.deps:
            cible = modules[dep.as_posix()]
            defaut, nommes, ns = parse_specifieurs(clause)
            if ns and ns not in lies:
                out.append(f"  const {ns} = __M['{cible.id}'];")
                lies.add(ns)
            neufs = [(a, b) for a, b in nommes if b not in lies]
            if neufs:
                paires = ", ".join(f"{a}: {b}" if a != b else a for a, b in neufs)
                out.append(f"  const {{ {paires} }} = __M['{cible.id}'];")
                lies.update(b for _, b in neufs)
            if defaut and defaut not in lies:
                out.append(f"  const {defaut} = __M['{cible.id}'].default;")
                lies.add(defaut)

        # ré-exports : on ne redéclare pas ce qui est déjà lié par un import
        for dep, paires in mod.reexports:
            cible = modules[dep.as_posix()]
            for exporte, local in paires:
                if local in lies:
                    continue
                out.append(f"  const {local} = __M['{cible.id}']['{exporte}'];")
                lies.add(local)

        out.append(mod.corps)
        if mod.exports:
            champs = ", ".join(sorted(mod.exports))
            out.append(f"  return {{ {champs} }};")
        else:
            out.append("  return {};")
        out.append("})();")

    return "\n".join(out)


def main():
    print(f"\n  {ENTREE.relative_to(RACINE)}  →  {SORTIE.relative_to(RACINE)}\n")
    modules, ordre = charger(ENTREE)
    print(f"  {len(ordre)} modules")

    erreurs = verifier_liens(modules)
    if erreurs:
        print("\n  LIENS CASSÉS :\n")
        print("\n".join(erreurs))
        print("\n  bundle non produit.\n")
        return 1

    script = emettre(modules, ordre)
    html = GABARIT.read_text(encoding="utf-8")
    html = html.replace(
        '<script type="module" src="src/jeu.js"></script>',
        "<script>\n" + script + "\n</script>",
    )
    html = html.replace("<title>SCOLÉOPANDRE — v3</title>",
                        "<title>SCOLÉOPANDRE — v3 (fichier unique)</title>")

    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(html, encoding="utf-8")
    ko = len(html.encode("utf-8")) / 1024
    print(f"  écrit : {SORTIE.relative_to(RACINE)}  ({ko:.0f} Ko)")
    print("\n  Rappel : les GIF de cartes exigent toujours un serveur.")
    print("  Le monde, lui, se joue en double-cliquant le fichier.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
