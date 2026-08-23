# -*- coding: utf-8 -*-
"""
═══ LANCEUR — LE BANC D'ESSAI ═════════════════════════════════════════════════

La fenêtre qu'on ouvre pour jouer, ouvrir la forge, et vérifier que rien n'est
cassé. C'est ce que devient `Scolopandre.exe`.

── POURQUOI UNE FENÊTRE ET PAS UN RACCOURCI ──────────────────────────────────
Un simple raccourci qui ouvre le navigateur suffirait à jouer. Il ne suffit pas
à *rapporter*. Quand quelque chose ne va pas — le monde ne se génère pas, une
zone du plan reste vide, le rendu se fige — il faut pouvoir dire quoi, et il
faut une trace à recopier. D'où la console, qui est le vrai contenu de cette
fenêtre : les boutons ne font que la remplir.

C'est aussi pour ça que les outils de vérification sont là plutôt que dans un
terminal. `Vérifier` et `Test de fumée` répondent à la question « est-ce que ça
vient de mon installation ou du jeu ? » avant même d'avoir lancé une partie.

── STRUCTURE ─────────────────────────────────────────────────────────────────
  theme.py       la palette, pendant Python de src/editeur/theme.css
  serveur.py     le serveur HTTP local — les modules ES l'exigent
  navigateur.py  Chrome ou Edge en mode fenêtre d'application
  lanceur.py     ce fichier : la fenêtre, et rien d'autre
"""

import io
import os
import pathlib
import queue
import runpy
import subprocess
import sys
import threading
import traceback

import tkinter as tk
from tkinter import font as tkfont

from . import navigateur, serveur
from . import theme as T

VERSION = "3.4"


# ══════════════════════════════════════════════════════════════════════════
#  OÙ SONT LES FICHIERS
# ══════════════════════════════════════════════════════════════════════════

def racine():
    """
    Le dossier contenant index.html.

    En développement c'est le parent de `lanceur/`. Une fois empaqueté,
    PyInstaller dépose les données à côté de l'exécutable (mode onedir) ou les
    extrait dans un dossier temporaire qu'il annonce par `sys._MEIPASS`
    (onefile). On teste les trois, dans cet ordre.
    """
    ici = pathlib.Path(__file__).resolve().parent

    candidats = []
    if getattr(sys, "frozen", False):
        exe = pathlib.Path(sys.executable).resolve().parent
        candidats += [exe, exe / "_internal"]
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            candidats.append(pathlib.Path(meipass))
    candidats.append(ici.parent)

    for c in candidats:
        if (c / "index.html").is_file():
            return c
    # Rien trouvé : on renvoie le plus probable et l'appelant le signalera.
    return candidats[0]


# ══════════════════════════════════════════════════════════════════════════
#  LA FENÊTRE
# ══════════════════════════════════════════════════════════════════════════

class Banc:

    def __init__(self):
        self.racine = racine()
        self.url = None
        self.arreter_serveur = None
        self.processus = []             # fenêtres de navigateur ouvertes
        self.file = queue.Queue()       # lignes venues des fils de travail
        self.occupe = False
        self.boutons_outils = []

        self._fenetre()
        self._entete()
        self._corps()
        self._barre_etat()

        self.root.after(60, self._vider_file)
        self.root.after(120, self._demarrer_serveur)
        self.root.protocol("WM_DELETE_WINDOW", self.fermer)

    # ── ossature ──────────────────────────────────────────────────────────

    def _fenetre(self):
        self.root = tk.Tk()
        self.root.title("Scolopandre — banc d'essai")
        self.root.configure(bg=T.CONTENT_BG)
        self.root.geometry("1080x660")
        self.root.minsize(920, 560)

        ico = self.racine / "icon.ico"
        if ico.is_file():
            try:
                self.root.iconbitmap(str(ico))
            except tk.TclError:
                pass

        self.f_ui = tkfont.Font(family=T.UI_FONT, size=9)
        self.f_gras = tkfont.Font(family=T.UI_FONT, size=9, weight="bold")
        self.f_sect = tkfont.Font(family=T.UI_FONT, size=8, weight="bold")
        self.f_mono = tkfont.Font(family=T.MONO_FONT, size=9)
        self.f_mono_g = tkfont.Font(family=T.MONO_FONT, size=9, weight="bold")
        self.f_nom = tkfont.Font(family=T.BRAND_FONT, size=15, weight="bold")
        self.f_sous = tkfont.Font(family=T.BRAND_FONT, size=8)

    def _entete(self):
        """La barre de 58 px, avec le logotype à deux lignes d'Héphaïstos."""
        b = tk.Frame(self.root, bg=T.PANEL_BG, height=58)
        b.pack(fill="x")
        b.pack_propagate(False)

        c = tk.Canvas(b, bg=T.PANEL_BG, width=280, height=58,
                      bd=0, highlightthickness=0)
        c.pack(side="left", padx=(14, 0))
        c.create_text(0, 17, text=T.BRAND_NAME, anchor="w",
                      fill=T.ACCENT, font=self.f_nom)

        # Le sous-titre est inter-lettré jusqu'à la largeur du nom : c'est ce
        # qui fait tenir le bloc ensemble plutôt que d'avoir deux lignes qui
        # flottent l'une sous l'autre.
        largeur = self.f_nom.measure(T.BRAND_NAME)
        c.create_text(1, 38,
                      text=T.track_to_width(c, T.BRAND_SUB, largeur, self.f_sous),
                      anchor="w", fill=T.MUTED, font=self.f_sous)

        droite = tk.Frame(b, bg=T.PANEL_BG)
        droite.pack(side="right", padx=14)
        tk.Label(droite, text="v" + VERSION, bg=T.PANEL_BG, fg=T.SECTION,
                 font=self.f_mono).pack(side="right")

        tk.Frame(self.root, bg=T.BORDER, height=1).pack(fill="x")

    def _corps(self):
        corps = tk.Frame(self.root, bg=T.CONTENT_BG)
        corps.pack(fill="both", expand=True)

        gauche = tk.Frame(corps, bg=T.PANEL_BG, width=310)
        gauche.pack(side="left", fill="y")
        gauche.pack_propagate(False)
        tk.Frame(corps, bg=T.BORDER, width=1).pack(side="left", fill="y")

        self._panneau(gauche)
        self._console(corps)

    # ── le panneau de gauche ──────────────────────────────────────────────

    def _section(self, parent, titre):
        tk.Label(parent, text=titre, bg=T.PANEL_BG, fg=T.SECTION,
                 font=self.f_sect, anchor="w").pack(fill="x", padx=16, pady=(16, 4))
        tk.Frame(parent, bg=T.BORDER, height=2).pack(fill="x", padx=16)

    def _bouton(self, parent, texte, action, accent=False, hauteur=1):
        """
        Un bouton plat. Tk n'a pas d'état « survol » : on le câble à la main,
        sinon les boutons paraissent morts sur un fond sombre.
        """
        fond = T.ACCENT if accent else T.SLATE
        survol = T.ACCENT_HOV if accent else T.HOVER
        texte_c = "#ffffff" if accent else T.TEXT

        bt = tk.Button(parent, text=texte, command=action,
                       bg=fond, fg=texte_c,
                       activebackground=survol, activeforeground=texte_c,
                       font=self.f_gras if accent else self.f_ui,
                       bd=0, highlightthickness=0, relief="flat",
                       cursor="hand2", pady=7 * hauteur)
        bt.pack(fill="x", padx=16, pady=3)
        bt.bind("<Enter>", lambda e: bt.configure(bg=survol))
        bt.bind("<Leave>", lambda e: bt.configure(
            bg=fond if bt["state"] == "normal" else T.SLATE))
        return bt

    def _panneau(self, p):
        self._section(p, "LANCER")
        self._bouton(p, "▶   JOUER", self.jouer, accent=True, hauteur=2)
        self._bouton(p, "⛏   Ouvrir la forge", self.forge)

        opts = tk.Frame(p, bg=T.PANEL_BG)
        opts.pack(fill="x", padx=16, pady=(6, 0))
        self.v_plein = tk.BooleanVar(value=False)
        self._case(opts, "plein écran", self.v_plein)

        gr = tk.Frame(p, bg=T.PANEL_BG)
        gr.pack(fill="x", padx=16, pady=(8, 0))
        tk.Label(gr, text="graine", bg=T.PANEL_BG, fg=T.MUTED,
                 font=self.f_ui).pack(side="left")
        self.e_graine = tk.Entry(gr, bg=T.SLATE, fg=T.TEXT_ON,
                                 insertbackground=T.MAGIC, font=self.f_mono,
                                 bd=0, highlightthickness=1,
                                 highlightbackground=T.BORDER,
                                 highlightcolor=T.ACCENT, width=12)
        self.e_graine.pack(side="right", ipady=3, ipadx=4)
        tk.Label(p, text="vide = un monde différent à chaque partie",
                 bg=T.PANEL_BG, fg=T.SECTION, font=("", 7),
                 anchor="w").pack(fill="x", padx=16, pady=(3, 0))

        self._section(p, "VÉRIFIER")
        self.boutons_outils += [
            self._bouton(p, "Cohérence du code", lambda: self.outil(
                "verifier.py", [], "VERIFIER")),
            self._bouton(p, "Syntaxe", lambda: self.outil(
                "syntaxe.py", [], "SYNTAXE")),
            self._bouton(p, "Test de fumée — jeu", lambda: self.outil(
                "smoke.py", [], "FUMEE")),
            self._bouton(p, "Test de fumée — forge", lambda: self.outil(
                "smoke_editeur.py", [], "FUMEE")),
            self._bouton(p, "Reconstruire le fichier unique", lambda: self.outil(
                "bundler.py", [], "BUNDLE")),
        ]

        self._section(p, "DOSSIERS")
        self._bouton(p, "Dossier du jeu", lambda: self.ouvrir_dossier(self.racine))
        self._bouton(p, "Dossier des cartes",
                     lambda: self.ouvrir_dossier(self.racine / "cartes"))
        self._bouton(p, "Effacer les données du navigateur", self.effacer_profil)

    def _case(self, parent, texte, var):
        c = tk.Checkbutton(parent, text=texte, variable=var,
                           bg=T.PANEL_BG, fg=T.MUTED, selectcolor=T.SLATE,
                           activebackground=T.PANEL_BG, activeforeground=T.TEXT_ON,
                           font=self.f_ui, bd=0, highlightthickness=0,
                           anchor="w", cursor="hand2")
        c.pack(fill="x")
        return c

    # ── la console ────────────────────────────────────────────────────────

    def _console(self, parent):
        cadre = tk.Frame(parent, bg=T.CONSOLE_BG)
        cadre.pack(side="left", fill="both", expand=True)

        asc = tk.Scrollbar(cadre, bg=T.SLATE2, troughcolor=T.CONSOLE_BG,
                           activebackground=T.ACCENT, bd=0,
                           highlightthickness=0, relief="flat", width=11)
        asc.pack(side="right", fill="y")

        self.txt = tk.Text(cadre, bg=T.CONSOLE_BG, fg=T.CONSOLE_FG,
                           font=self.f_mono, bd=0, highlightthickness=0,
                           wrap="word", padx=13, pady=9, spacing1=1,
                           insertbackground=T.MAGIC, yscrollcommand=asc.set)
        self.txt.pack(fill="both", expand=True)
        asc.configure(command=self.txt.yview)

        for nom, couleur in T.LOG_COLORS.items():
            self.txt.tag_configure(nom, foreground=couleur)
        self.txt.tag_configure("entete", font=self.f_mono_g)
        self.txt.tag_configure("heure", foreground=T.SECTION)
        self.txt.configure(state="disabled")

    def _barre_etat(self):
        tk.Frame(self.root, bg=T.BORDER, height=1).pack(fill="x")
        b = tk.Frame(self.root, bg=T.PANEL_BG, height=24)
        b.pack(fill="x")
        b.pack_propagate(False)
        self.l_etat = tk.Label(b, text="démarrage…", bg=T.PANEL_BG, fg=T.MUTED,
                               font=("", 8), anchor="w")
        self.l_etat.pack(side="left", padx=12)
        self.l_url = tk.Label(b, text="", bg=T.PANEL_BG, fg=T.MAGIC,
                              font=self.f_mono, anchor="e")
        self.l_url.pack(side="right", padx=12)

    # ══════════════════════════════════════════════════════════════════════
    #  JOURNAL
    # ══════════════════════════════════════════════════════════════════════

    def log(self, entete, corps="", niveau="info"):
        """Depuis le fil principal. Les fils de travail passent par la file."""
        import datetime
        self.txt.configure(state="normal")
        self.txt.insert("end", datetime.datetime.now().strftime("%H:%M:%S "), "heure")
        if entete:
            self.txt.insert("end", entete + " ", ("entete", niveau))
        self.txt.insert("end", str(corps) + "\n", niveau if not entete else "default")
        self.txt.see("end")
        self.txt.configure(state="disabled")

    def _depuis_fil(self, entete, corps="", niveau="info"):
        self.file.put((entete, corps, niveau))

    def _vider_file(self):
        """
        Tkinter n'est pas réentrant depuis un autre fil : tout ce qui vient
        d'un fil de travail transite par une file, que le fil principal vide
        à intervalle régulier. C'est la seule façon sûre de faire.
        """
        try:
            while True:
                self.log(*self.file.get_nowait())
        except queue.Empty:
            pass
        self.root.after(60, self._vider_file)

    def etat(self, texte):
        self.l_etat.configure(text=texte)

    # ══════════════════════════════════════════════════════════════════════
    #  SERVEUR
    # ══════════════════════════════════════════════════════════════════════

    def _demarrer_serveur(self):
        self.log("BANC", "Scolopandre v%s" % VERSION, "accent")

        if not (self.racine / "index.html").is_file():
            self.log("ERREUR", "index.html introuvable dans " + str(self.racine),
                     "error")
            self.etat("installation incomplète")
            return

        try:
            self.url, self.arreter_serveur = serveur.demarrer(
                self.racine, journal=self._depuis_fil)
        except OSError as e:
            self.log("ERREUR", "serveur : " + str(e), "error")
            self.etat("serveur indisponible")
            return

        self.l_url.configure(text=self.url)
        self.log("SERVEUR", self.url + "  ·  " + str(self.racine), "muted")

        nav = navigateur.nom_navigateur()
        if navigateur.trouver():
            self.log("NAVIGATEUR", nav + " — fenêtre d'application", "muted")
        else:
            self.log("NAVIGATEUR",
                     "ni Chrome ni Edge trouvés : le jeu s'ouvrira dans un "
                     "onglet du navigateur par défaut", "warning")

        # Où la forge écrira-t-elle ?
        self._avertir_racine()

        self.etat("prêt")
        self.log("PRÊT", "« JOUER » lance une partie · « forge » ouvre l'éditeur",
                 "success")

    def _avertir_racine(self):
        """
        Dire clairement où atterrissent les assets forgés.

        L'application empaquetée porte SA PROPRE copie de `src/`. Un élément
        composé dans la forge y est écrit — pas dans le dépôt, et il
        disparaîtra à la prochaine reconstruction. Ça ne se devine pas, et on
        s'en aperçoit après avoir perdu une heure de travail.
        """
        if "application" not in self.racine.parts:
            return
        self.log("ATTENTION",
                 "cette application a sa propre copie de src/. Ce que la forge "
                 "y écrit N'EST PAS dans le dépôt et sera perdu à la prochaine "
                 "reconstruction — recopie src/monde/props.js, ou lance "
                 "« python -m lanceur » depuis le dépôt pour travailler dessus "
                 "directement.", "warning")

    # ══════════════════════════════════════════════════════════════════════
    #  ACTIONS
    # ══════════════════════════════════════════════════════════════════════

    def _ouvrir(self, page, titre):
        if not self.url:
            self.log("ERREUR", "le serveur n'est pas démarré", "error")
            return
        u = self.url + "/" + page
        g = self.e_graine.get().strip()
        if g:
            u += ("&" if "?" in u else "?") + "graine=" + g
        p, mode = navigateur.ouvrir(u, titre, plein_ecran=self.v_plein.get())
        if p:
            self.processus.append(p)
        self.log("OUVERT", titre + "  ·  " + mode + ("  ·  graine " + g if g else ""),
                 "success")

    def jouer(self):
        self._ouvrir("index.html", "Scolopandre")

    def forge(self):
        self._ouvrir("editeur.html", "Forge")

    def ouvrir_dossier(self, chemin):
        chemin = pathlib.Path(chemin)
        if not chemin.is_dir():
            self.log("ERREUR", str(chemin) + " n'existe pas", "error")
            return
        os.startfile(str(chemin))          # noqa: S606  (Windows uniquement)
        self.log("DOSSIER", str(chemin), "muted")

    def effacer_profil(self):
        """
        Remise à zéro du `localStorage` : réglages, collection, plan de la forge.
        Utile quand un état enregistré empêche le jeu de démarrer — et c'est le
        premier réflexe à avoir avant de conclure à un bug du moteur.
        """
        import shutil
        from tkinter import messagebox
        d = navigateur.dossier_profil()
        if not messagebox.askyesno(
                "Effacer les données",
                "Cela supprime les réglages, la collection de cartes et le plan "
                "enregistré dans le navigateur.\n\nContinuer ?"):
            return
        if self.processus and any(p.poll() is None for p in self.processus):
            self.log("REFUS", "ferme d'abord les fenêtres de jeu ouvertes",
                     "warning")
            return
        try:
            shutil.rmtree(d, ignore_errors=True)
            self.log("EFFACÉ", str(d), "success")
        except OSError as e:
            self.log("ERREUR", str(e), "error")

    # ══════════════════════════════════════════════════════════════════════
    #  OUTILS
    # ══════════════════════════════════════════════════════════════════════

    def outil(self, script, args, entete):
        """
        Lance un script d'`outils/` dans un fil, et déverse sa sortie ici.

        On l'exécute DANS CE PROCESSUS (`runpy`) plutôt qu'en appelant
        `python outils/…`. Raison : une fois empaqueté, il n'y a plus de
        `python.exe` — `sys.executable` désigne l'exécutable lui-même. Passer
        par runpy fait marcher les outils à l'identique en développement et
        dans l'application, ce qui est exactement la propriété qu'on veut d'un
        banc d'essai.
        """
        if self.occupe:
            self.log("OCCUPÉ", "un outil tourne déjà", "warning")
            return
        chemin = self.racine / "outils" / script
        if not chemin.is_file():
            self.log("ERREUR", "outil absent : " + str(chemin), "error")
            return

        self.occupe = True
        for b in self.boutons_outils:
            b.configure(state="disabled", bg=T.SLATE, fg=T.SECTION)
        self.etat("« %s » en cours…" % script)
        self.log(entete, script + " …", "info")

        threading.Thread(target=self._executer, daemon=True,
                         args=(chemin, args, entete)).start()

    def _executer(self, chemin, args, entete):
        flux = _FluxVersFile(self.file, entete)
        vieux_out, vieux_err = sys.stdout, sys.stderr
        vieux_argv, vieux_path = sys.argv, list(sys.path)
        code = 0
        try:
            sys.stdout = sys.stderr = flux
            sys.argv = [str(chemin)] + list(args)
            # verifier.py importe bundler : son dossier doit être atteignable.
            sys.path.insert(0, str(chemin.parent))
            os.chdir(str(self.racine))
            runpy.run_path(str(chemin), run_name="__main__")
        except SystemExit as e:
            code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
        except Exception:
            for ligne in traceback.format_exc().splitlines():
                self.file.put(("", ligne, "error"))
            code = -1
        finally:
            flux.finir()
            sys.stdout, sys.stderr = vieux_out, vieux_err
            sys.argv, sys.path = vieux_argv, vieux_path

        if code == 0:
            self.file.put((entete, "terminé sans erreur", "success"))
        else:
            self.file.put((entete, "code de sortie %s — voir ci-dessus" % code,
                           "error"))
        self.file.put(("__fini__", "", ""))

    # ══════════════════════════════════════════════════════════════════════

    def fermer(self):
        for p in self.processus:
            if p.poll() is None:
                p.terminate()
        if self.arreter_serveur:
            self.arreter_serveur()
        self.root.destroy()

    def tourner(self):
        self.root.mainloop()


class _FluxVersFile(io.TextIOBase):
    """
    Un `sys.stdout` qui pousse chaque ligne complète dans la file de la console.

    Les outils écrivent en `print`, souvent par morceaux ; on n'émet qu'aux
    fins de ligne, sinon la console reçoit des fragments.
    """

    def __init__(self, file, entete):
        self.file = file
        self.entete = entete
        self.tampon = ""

    def write(self, s):
        self.tampon += s
        while "\n" in self.tampon:
            ligne, self.tampon = self.tampon.split("\n", 1)
            self.file.put(("", ligne.rstrip(), _niveau(ligne)))
        return len(s)

    def finir(self):
        if self.tampon.strip():
            self.file.put(("", self.tampon.rstrip(), _niveau(self.tampon)))
        self.tampon = ""

    def flush(self):
        pass


def _niveau(ligne):
    """
    Colorer la sortie d'un outil d'après ce qu'elle dit.

    Grossier — c'est de la coloration syntaxique de prose — mais suffisant :
    ce qu'on veut voir au premier coup d'œil, c'est s'il y a du rouge.
    """
    b = ligne.lower()
    if any(m in b for m in ("erreur", "error", "échec", "echec", "traceback",
                            "✗", "introuvable")):
        return "error"
    if any(m in b for m in ("avertissement", "warning", "attention", "⚠")):
        return "warning"
    if any(m in b for m in ("✓", "ok ", "cohérent", "terminé", "réussi")):
        return "success"
    return "muted"


def main():
    banc = Banc()

    # Le sentinelle « __fini__ » remet les boutons d'outils en service. Il
    # transite par la même file que les lignes de journal, ce qui garantit
    # qu'il arrive APRÈS toute la sortie de l'outil, et pas au milieu.
    log_direct = banc.log

    def log_filtre(entete, corps="", niveau="info"):
        if entete == "__fini__":
            banc.occupe = False
            for b in banc.boutons_outils:
                b.configure(state="normal", bg=T.SLATE, fg=T.TEXT)
            banc.etat("prêt")
            return
        log_direct(entete, corps, niveau)

    banc.log = log_filtre
    banc.tourner()


if __name__ == "__main__":
    main()
