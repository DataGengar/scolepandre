# -*- coding: utf-8 -*-
"""
═══ LANCEUR / NAVIGATEUR ══════════════════════════════════════════════════════

Ouvrir le jeu dans une vraie fenêtre d'application, pas dans un onglet.

── LE MOTEUR DE RENDU EST CELUI DU NAVIGATEUR, ET C'EST VOULU ────────────────
Le jeu est du WebGL2. Le faire tourner suppose un moteur web ; la seule question
est lequel, et dans quelle fenêtre. Trois voies possibles :

  pywebview / Qt WebEngine   une vraie fenêtre native — mais 150 Mo de
                             dépendances à installer, et le WebGL y est souvent
                             en retard d'une version.
  Electron / Tauri           il faudrait réécrire l'empaquetage en JS.
  Chrome en mode --app       une fenêtre sans barre d'adresse, sans onglets,
                             avec son icône : visuellement une application.
                             Zéro dépendance, et le WebGL du navigateur du jour.

C'est la troisième. Le compromis : Chrome ou Edge doit être présent — sur
Windows, Edge l'est toujours. En dernier recours on retombe sur le navigateur
par défaut, avec un onglet ordinaire : moins joli, mais ça marche.

── LE PROFIL DÉDIÉ ───────────────────────────────────────────────────────────
On lance avec un `--user-data-dir` à nous, sous %LOCALAPPDATA%. Trois raisons :

  1. sans lui, si Chrome tourne déjà, il ouvre la fenêtre dans le processus
     existant et rend la main aussitôt — on ne peut plus savoir si le jeu est
     encore ouvert ;
  2. aucune extension ne s'injecte dans la page ;
  3. le `localStorage` du jeu — réglages, collection de cartes, plan de la
     forge — vit dans un dossier à nous, qui survit aux nettoyages du
     navigateur et se supprime d'un coup si l'on veut repartir de zéro.
"""

import os
import pathlib
import subprocess
import sys
import webbrowser

# Emplacements d'installation habituels, par ordre de préférence.
CANDIDATS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def trouver():
    """Le premier Chrome ou Edge installé, ou None."""
    local = os.environ.get("LOCALAPPDATA", "")
    chemins = list(CANDIDATS)
    if local:
        chemins.insert(0, os.path.join(
            local, r"Google\Chrome\Application\chrome.exe"))
    for c in chemins:
        if os.path.isfile(c):
            return c
    return None


def dossier_profil():
    """Le profil du navigateur, à côté des autres données de l'application."""
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = pathlib.Path(base) / "Scolopandre" / "navigateur"
    d.mkdir(parents=True, exist_ok=True)
    return d


def ouvrir(url, titre="Scolopandre", taille=(1600, 900), plein_ecran=False):
    """
    Ouvre `url` en fenêtre d'application.

    Renvoie `(processus, mode)`. `processus` vaut None si l'on a dû se rabattre
    sur le navigateur par défaut — auquel cas on ne peut plus rien savoir de la
    fenêtre, d'où le `mode` que l'appelant affiche à l'écran.
    """
    exe = trouver()
    if not exe:
        webbrowser.open(url)
        return None, "navigateur par défaut"

    args = [
        exe,
        "--app=" + url,
        "--user-data-dir=" + str(dossier_profil()),
        "--window-size=%d,%d" % taille,
        # Le jeu démarre sa chaîne audio sur le clic du menu, donc le geste
        # existe. Mais le drone d'ambiance se met en place avant, et sans ça
        # Chrome le suspend jusqu'au clic — l'ambiance arrive en retard.
        "--autoplay-policy=no-user-gesture-required",
        # Fenêtre d'application : ni première exécution, ni bandeau de
        # restauration après une fermeture brutale, ni proposition de profil.
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-session-crashed-bubble",
        "--disable-features=Translate,MediaRouter",
    ]
    if plein_ecran:
        args.append("--start-fullscreen")

    creation = 0
    if sys.platform == "win32":
        # Sans ça, l'exécutable construit en mode fenêtré ouvre une console
        # noire derrière la fenêtre du navigateur.
        creation = subprocess.CREATE_NO_WINDOW

    p = subprocess.Popen(args, creationflags=creation,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return p, ("Chrome" if "chrome.exe" in exe.lower() else "Edge") + " — mode application"


def nom_navigateur():
    """De quoi le dire à l'écran avant même d'avoir lancé quoi que ce soit."""
    exe = trouver()
    if not exe:
        return "navigateur par défaut"
    return "Chrome" if "chrome.exe" in exe.lower() else "Edge"
