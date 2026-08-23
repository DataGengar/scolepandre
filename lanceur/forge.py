# -*- coding: utf-8 -*-
"""
═══ LANCEUR / PONT DE LA FORGE ════════════════════════════════════════════════

Ce qui permet à l'éditeur, qui tourne dans un navigateur, d'écrire dans le jeu.

── LE PROBLÈME ───────────────────────────────────────────────────────────────
Une page web ne touche pas au disque. Jusqu'ici la forge produisait donc un
extrait de code à recopier soi-même dans `src/monde/props.js`. Ça marche une
fois ; à la dixième, on ne le fait plus, et l'outil ne sert plus à rien. Un
éditeur d'assets dont le résultat n'atteint pas le jeu n'est pas un éditeur,
c'est une visionneuse.

── LA SOLUTION ───────────────────────────────────────────────────────────────
Le serveur local du lanceur expose quelques routes `/_forge/…`. La page les
appelle, le serveur écrit. Comme le serveur n'écoute que sur 127.0.0.1, seul
ce poste peut les atteindre — et elles n'existent que si l'application tourne :
ouvrir `editeur.html` par un `python -m http.server` donne exactement l'ancien
comportement, avec le bouton « écrire » en moins.

── LA DÉCOUPE CHIRURGICALE ───────────────────────────────────────────────────
`enregistrer_prop()` ne réécrit pas `props.js` : il remplace UN `case` dans le
`switch`, en comptant les accolades pour trouver sa fin. Réécrire tout le
fichier depuis le navigateur signifierait que la page détient la vérité sur un
fichier de 470 lignes qu'elle n'a jamais lu en entier — le premier écart
effacerait du travail.

── GARDE-FOUS ────────────────────────────────────────────────────────────────
  · tout chemin est résolu et doit rester sous la racine du projet ;
  · seules quelques extensions sont acceptées en écriture ;
  · une sauvegarde horodatée part dans `.sauvegardes/` avant toute écriture ;
  · le contenu est plafonné en taille.
Ce n'est pas de la sécurité contre un attaquant — il faudrait déjà être sur ce
poste. C'est de la sécurité contre une erreur de frappe.
"""

import datetime
import json
import re
import shutil
from pathlib import Path

# Écriture autorisée pour ces extensions seulement.
EXT_ECRITURE = {".js", ".json", ".css", ".html", ".md", ".txt"}

# Et jamais dans ces dossiers.
INTERDITS = {".git", "_internal", "build", "application", "archives"}

TAILLE_MAX = 4 * 1024 * 1024          # 4 Mo : large pour du code, borné quand même

PROPS = "src/monde/props.js"


class ErreurForge(Exception):
    """Refus explicite, renvoyé tel quel à la page."""


# ══════════════════════════════════════════════════════════════════════════
#  CHEMINS
# ══════════════════════════════════════════════════════════════════════════

def resoudre(racine, relatif, pour_ecriture=False):
    """
    Transforme un chemin venu de la page en chemin absolu sûr.

    `Path.resolve()` puis comparaison à la racine : c'est ce qui neutralise
    `../../`, les liens symboliques et les chemins absolus déguisés.
    """
    racine = Path(racine).resolve()
    p = (racine / str(relatif).replace("\\", "/").lstrip("/")).resolve()

    try:
        rel = p.relative_to(racine)
    except ValueError:
        raise ErreurForge("hors du projet : %s" % relatif)

    if any(part in INTERDITS for part in rel.parts):
        raise ErreurForge("dossier protégé : %s" % rel)

    if pour_ecriture and p.suffix.lower() not in EXT_ECRITURE:
        raise ErreurForge("extension refusée en écriture : %s" % p.suffix)

    return p


def sauvegarder(racine, fichier):
    """
    Copie horodatée avant écrasement.

    On garde les vingt dernières et on oublie le reste : assez pour récupérer
    une bêtise, pas assez pour que le dossier devienne un problème.
    """
    fichier = Path(fichier)
    if not fichier.is_file():
        return None
    d = Path(racine) / ".sauvegardes"
    d.mkdir(exist_ok=True)
    horo = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
    cible = d / ("%s.%s.bak" % (fichier.name, horo))
    shutil.copy2(fichier, cible)

    anciennes = sorted(d.glob(fichier.name + ".*.bak"))
    for vieille in anciennes[:-20]:
        try:
            vieille.unlink()
        except OSError:
            pass
    return cible


def ecrire(racine, relatif, contenu):
    """Écrit un fichier, après sauvegarde. Renvoie un rapport."""
    if len(contenu) > TAILLE_MAX:
        raise ErreurForge("contenu trop gros (%d octets)" % len(contenu))
    p = resoudre(racine, relatif, pour_ecriture=True)
    p.parent.mkdir(parents=True, exist_ok=True)
    sauve = sauvegarder(racine, p)
    p.write_text(contenu, encoding="utf-8")
    return {"ok": True, "chemin": str(p.relative_to(Path(racine).resolve())),
            "octets": len(contenu.encode("utf-8")),
            "sauvegarde": sauve.name if sauve else None}


def lire(racine, relatif):
    p = resoudre(racine, relatif)
    if not p.is_file():
        raise ErreurForge("introuvable : %s" % relatif)
    if p.stat().st_size > TAILLE_MAX:
        raise ErreurForge("fichier trop gros")
    return p.read_text(encoding="utf-8")


# ══════════════════════════════════════════════════════════════════════════
#  DÉCOUPE DU SWITCH DE props.js
# ══════════════════════════════════════════════════════════════════════════

def _fin_de_bloc(texte, i_accolade):
    """
    L'indice juste après l'accolade fermante correspondant à `texte[i_accolade]`.

    Compte les accolades en sautant ce qui n'en est pas : chaînes simples,
    doubles, gabarits, commentaires de ligne et de bloc. Un compteur naïf
    trébucherait sur la première accolade dans un commentaire — et `props.js`
    en contient.
    """
    n = len(texte)
    i = i_accolade
    prof = 0
    while i < n:
        c = texte[i]
        d = texte[i + 1] if i + 1 < n else ""

        if c == "/" and d == "/":
            i = texte.find("\n", i)
            if i < 0:
                break
            continue
        if c == "/" and d == "*":
            i = texte.find("*/", i + 2)
            if i < 0:
                break
            i += 2
            continue
        if c in "'\"`":
            fin = c
            i += 1
            while i < n:
                if texte[i] == "\\":
                    i += 2
                    continue
                if texte[i] == fin:
                    i += 1
                    break
                i += 1
            continue

        if c == "{":
            prof += 1
        elif c == "}":
            prof -= 1
            if prof == 0:
                return i + 1
        i += 1
    raise ErreurForge("accolade non refermée — props.js est-il valide ?")


def _trouver_case(source, nom):
    """(début, fin) du `case 'nom': { … }`, ou None."""
    m = re.search(r"^[ \t]*case\s+'%s'\s*:\s*\{" % re.escape(nom),
                  source, re.M)
    if not m:
        return None
    debut = m.start()
    ouvrante = source.index("{", m.start())
    return debut, _fin_de_bloc(source, ouvrante)


def lister_props(racine):
    """Les noms de tous les `case` du switch, dans l'ordre du fichier."""
    src = lire(racine, PROPS)
    corps = _corps_du_switch(src)
    return re.findall(r"^[ \t]*case\s+'([A-Za-z0-9_]+)'\s*:", corps, re.M)


def _corps_du_switch(source):
    m = re.search(r"switch\s*\(\s*kind\s*\)\s*\{", source)
    if not m:
        raise ErreurForge("switch(kind) introuvable dans props.js")
    ouvrante = source.index("{", m.start())
    return source[ouvrante:_fin_de_bloc(source, ouvrante)]


def enregistrer_prop(racine, nom, code):
    """
    Remplace — ou ajoute — un `case` dans le switch de `props.js`.

    `code` est le bloc complet, `case 'nom': { … }` compris : c'est l'éditeur
    qui le fabrique, avec le même formateur que le bouton « copier ». Le
    serveur ne compose pas de JavaScript, il le pose au bon endroit.
    """
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,40}", nom or ""):
        raise ErreurForge("nom d'élément invalide : %r" % nom)
    if ("case '%s'" % nom) not in code:
        raise ErreurForge("le code fourni ne déclare pas case '%s'" % nom)

    chemin = resoudre(racine, PROPS, pour_ecriture=True)
    src = chemin.read_text(encoding="utf-8")

    code = code.rstrip() + "\n"
    trouve = _trouver_case(src, nom)

    if trouve:
        debut, fin = trouve
        neuf = src[:debut] + code + src[fin:].lstrip("\n")
        action = "remplacé"
    else:
        # On insère juste avant la fermeture du switch, pour que l'ordre du
        # fichier reflète l'ordre d'ajout.
        m = re.search(r"switch\s*\(\s*kind\s*\)\s*\{", src)
        ouvrante = src.index("{", m.start())
        fin_switch = _fin_de_bloc(src, ouvrante)
        # reculer jusqu'au début de la ligne portant l'accolade fermante
        ligne = src.rfind("\n", 0, fin_switch - 1) + 1
        neuf = src[:ligne] + code + src[ligne:]
        action = "ajouté"

    # Contrôle avant d'écrire : si le fichier n'est plus équilibré, on a raté
    # la découpe, et il vaut mille fois mieux refuser que livrer un props.js
    # que le jeu n'arrivera plus à charger.
    if neuf.count("{") != neuf.count("}"):
        raise ErreurForge("découpe refusée : accolades déséquilibrées après "
                          "modification (%d/%d)" % (neuf.count("{"), neuf.count("}")))

    sauve = sauvegarder(racine, chemin)
    chemin.write_text(neuf, encoding="utf-8")
    return {"ok": True, "action": action, "nom": nom,
            "sauvegarde": sauve.name if sauve else None,
            "lignes": len(code.splitlines())}


# ══════════════════════════════════════════════════════════════════════════
#  ROUTAGE
# ══════════════════════════════════════════════════════════════════════════

def traiter(racine, chemin_url, params, corps, journal=None):
    """
    Répond à une route `/_forge/…`.

    Renvoie `(code_http, objet_json)`. Toute `ErreurForge` devient un 400 avec
    son message : la page l'affiche telle quelle dans sa console, ce qui évite
    d'avoir à deviner ce qui a été refusé.
    """
    route = chemin_url[len("/_forge/"):].strip("/")

    def dire(entete, txt, niveau="info"):
        if journal:
            journal(entete, txt, niveau)

    try:
        if route == "ping":
            return 200, {"forge": True, "racine": str(racine),
                         "props": PROPS}

        if route == "lire":
            return 200, {"ok": True, "contenu": lire(racine, params.get("chemin", [""])[0])}

        if route == "props":
            return 200, {"ok": True, "noms": lister_props(racine)}

        if route == "ecrire":
            d = json.loads(corps or "{}")
            r = ecrire(racine, d.get("chemin", ""), d.get("contenu", ""))
            dire("FORGE", "écrit %s (%d o)" % (r["chemin"], r["octets"]), "success")
            return 200, r

        if route == "prop":
            d = json.loads(corps or "{}")
            r = enregistrer_prop(racine, d.get("nom", ""), d.get("code", ""))
            dire("FORGE", "%s : « %s » dans props.js" % (r["action"], r["nom"]),
                 "success")
            return 200, r

        return 404, {"ok": False, "erreur": "route inconnue : " + route}

    except ErreurForge as e:
        dire("FORGE", "refusé — " + str(e), "warning")
        return 400, {"ok": False, "erreur": str(e)}
    except json.JSONDecodeError as e:
        return 400, {"ok": False, "erreur": "JSON illisible : %s" % e}
    except Exception as e:                       # noqa: BLE001
        dire("FORGE", "%s : %s" % (type(e).__name__, e), "error")
        return 500, {"ok": False, "erreur": "%s : %s" % (type(e).__name__, e)}
