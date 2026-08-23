# -*- coding: utf-8 -*-
"""
═══ LANCEUR / SERVEUR ═════════════════════════════════════════════════════════

Un serveur HTTP local, sur un port libre, servant le dossier du jeu.

── POURQUOI UN SERVEUR, ET PAS UN SIMPLE DOUBLE-CLIC SUR index.html ──────────
Parce que le jeu est fait de modules ES. Un navigateur refuse `import` depuis
`file://` — c'est la même origine « nulle » pour tous les fichiers du disque, et
la politique de même origine s'y applique en bloc. Ouvrir index.html directement
donne une page noire et une erreur CORS, rien d'autre.

Le fichier unique `dist/scolopandre.html`, lui, s'ouvre bien en `file://` : tout
y est inline. Mais il ne sert qu'à la distribution, pas au travail : il faut le
reconstruire à chaque modification, et l'éditeur n'existe pas sous cette forme.

── CE QU'IL NE FAIT PAS ──────────────────────────────────────────────────────
Il n'écoute que sur 127.0.0.1 : rien du réseau local ne l'atteint. C'est un
détail qui compte — `http.server` n'est pas un serveur durci, et il n'a aucune
raison d'être joignable depuis ailleurs que cette machine.
"""

import functools
import http.server
import json
import socket
import socketserver
import threading
from urllib.parse import urlparse, parse_qs

from . import forge


class _Silencieux(http.server.SimpleHTTPRequestHandler):
    """
    Le même serveur de fichiers, mais muet et sans cache.

    - Muet : `SimpleHTTPRequestHandler` écrit une ligne sur stderr par requête.
      Le chargement du jeu en fait plus de soixante-dix ; ça n'apprend rien et
      ça noie la console. Les erreurs, elles, remontent (voir `log_error`).
    - Sans cache : on modifie un module et on recharge. Si le navigateur sert
      sa copie, on débogue du code qui n'existe plus. C'est le genre de perte
      de temps qu'on ne voit pas venir.
    """

    journal = None          # callback (entete, corps, niveau) posé par le lanceur

    def log_message(self, fmt, *a):
        pass

    def log_error(self, fmt, *a):
        if _Silencieux.journal:
            _Silencieux.journal("HTTP", (fmt % a), "warning")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    # ── le pont de la forge ──────────────────────────────────────────────
    #
    # Tout ce qui commence par /_forge/ est detourne vers lanceur/forge.py.
    # Le reste du serveur reste un simple serveur de fichiers : ces routes
    # n'existent QUE quand l'application tourne, et un `python -m http.server`
    # sur le meme dossier redonne exactement l'ancien comportement.

    racine_projet = None

    def _forge(self, corps=None):
        u = urlparse(self.path)
        code, obj = forge.traiter(_Silencieux.racine_projet, u.path,
                                  parse_qs(u.query), corps,
                                  journal=_Silencieux.journal)
        charge = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(charge)))
        self.end_headers()
        self.wfile.write(charge)

    def do_GET(self):
        if self.path.startswith("/_forge/"):
            return self._forge()
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/_forge/"):
            self.send_error(405, "seules les routes /_forge/ acceptent POST")
            return
        n = int(self.headers.get("Content-Length") or 0)
        if n > forge.TAILLE_MAX:
            self.send_error(413, "corps trop gros")
            return
        return self._forge(self.rfile.read(n).decode("utf-8", "replace"))

    def guess_type(self, path):
        # Certaines installations Windows associent .js à `text/plain` via le
        # registre, et un module servi en text/plain est REFUSÉ par le
        # navigateur. Panne classique, message d'erreur peu parlant.
        p = str(path).lower()
        if p.endswith(".js") or p.endswith(".mjs"):
            return "text/javascript"
        if p.endswith(".json"):
            return "application/json"
        if p.endswith(".css"):
            return "text/css"
        return super().guess_type(path)


class _Serveur(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


def port_libre(depart=8757, essais=40):
    """
    Le premier port libre à partir de `depart`.

    Un port fixe casserait dès qu'une autre instance tourne — ou qu'un autre
    programme a pris le numéro. On demande donc au système, port par port.
    """
    for p in range(depart, depart + essais):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise OSError("aucun port libre entre %d et %d" % (depart, depart + essais))


def demarrer(racine, journal=None):
    """
    Lance le serveur en tâche de fond.

    Renvoie `(url_base, arreter)`. Le fil est démon : si la fenêtre se ferme
    brutalement, il meurt avec le processus au lieu de le maintenir en vie.
    """
    _Silencieux.journal = journal
    _Silencieux.racine_projet = racine
    p = port_libre()
    handler = functools.partial(_Silencieux, directory=str(racine))
    srv = _Serveur(("127.0.0.1", p), handler)

    fil = threading.Thread(target=srv.serve_forever, daemon=True,
                           name="scolopandre-http")
    fil.start()

    def arreter():
        srv.shutdown()
        srv.server_close()

    return "http://127.0.0.1:%d" % p, arreter
