# -*- coding: utf-8 -*-
"""
═══ LANCEUR / THÈME ═══════════════════════════════════════════════════════════

La palette d'Héphaïstos, avec ses noms d'origine — passer d'un projet à l'autre
ne doit demander aucune traduction mentale. C'est le troisième exemplaire de la
même charte : `ui/theme.py` chez Héphaïstos, `src/editeur/theme.css` pour la
forge, celui-ci pour le banc d'essai.

Pourquoi du Tkinter nu et pas customtkinter : il n'est pas installé, et une
dépendance de plus dans un exécutable qu'on veut voir démarrer en une seconde
n'en vaut pas la peine. Tk sait très bien faire du plat sombre, à condition de
le lui demander explicitement — d'où `plat()` et `bouton()` plus bas.
"""

# ── surfaces ──────────────────────────────────────────────────────────────
PANEL_BG   = "#161b22"     # panneaux, barres
ITEM_BG    = "#21262d"     # élément de liste
ITEM_SEL   = "#1f3a5f"     # sélection
CONTENT_BG = "#0d1117"     # fond de contenu
CARD_BG    = "#161b22"
SLATE      = "#21262d"
SLATE2     = "#30363d"
HOVER      = "#30363d"
BORDER     = "#30363d"

# ── texte ─────────────────────────────────────────────────────────────────
TEXT    = "#c9d1d9"
TEXT_ON = "#e6edf3"        # mis en avant
MUTED   = "#8b949e"
SECTION = "#7d8590"        # libellés de section

# ── accent ────────────────────────────────────────────────────────────────
MAGIC      = "#58a6ff"
ACCENT     = "#1f6feb"
ACCENT_HOV = "#388bfd"

# ── console ───────────────────────────────────────────────────────────────
CANVAS_TINT = "#101a33"
CONSOLE_BG  = CANVAS_TINT
CONSOLE_FG  = "#c9d1d9"

LOG_COLORS = {
    "info":    "#58a6ff",
    "success": "#3fb950",
    "warning": "#d29922",
    "error":   "#f85149",
    "accent":  "#bc8cff",
    "muted":   "#8b949e",
    "default": "#c9d1d9",
}

# ── typographie ───────────────────────────────────────────────────────────
# Héphaïstos embarque DejaVu ; ici on prend ce que Windows a, avec la même
# silhouette. Tk retombe silencieusement sur une police système si le nom
# est inconnu, donc pas besoin de garde.
UI_FONT    = "Segoe UI"
MONO_FONT  = "Consolas"
BRAND_FONT = "Bahnschrift"          # condensée, comme Oswald

BRAND_NAME = "⛏ SCOLOPANDRE"
BRAND_SUB  = "BANC D'ESSAI"


def track_to_width(canvas, texte, cible, police):
    """
    Inter-lettre `texte` pour qu'il occupe `cible` pixels.

    Tk ne connaît pas le letter-spacing : on insère des espaces fines entre
    les caractères jusqu'à atteindre la largeur voulue. C'est exactement ce
    que fait Héphaïstos pour aligner « FORGE CRÉATIVE » sous « HÉPHAÏSTOS ».
    Renvoie la chaîne espacée.
    """
    import tkinter.font as tkfont
    f = tkfont.Font(root=canvas, font=police)
    if len(texte) < 2:
        return texte
    base = f.measure(texte)
    if base >= cible:
        return texte
    esp = f.measure(" ") or 1
    # (n-1) intervalles à remplir
    par_intervalle = max(0, int(round((cible - base) / (len(texte) - 1) / esp)))
    if par_intervalle == 0:
        return texte
    return (" " * par_intervalle).join(texte)


def plat(widget, **kw):
    """Aplatit un widget Tk : ni relief, ni surlignage, ni bordure."""
    widget.configure(bd=0, highlightthickness=0, relief="flat", **kw)
    return widget


def filet(parent, tk):
    """Le séparateur de section d'Héphaïstos : 2 px de BORDER."""
    f = tk.Frame(parent, height=2, bg=BORDER, bd=0, highlightthickness=0)
    return f
