# -*- coding: utf-8 -*-
"""
POINT D'ENTRÉE — c'est ce script que PyInstaller transforme en Scolopandre.exe.

    python lancer.py          en développement
    Scolopandre.exe           une fois empaqueté

── POURQUOI CE FICHIER EXISTE, ALORS QUE `python -m lanceur` SUFFIT ──────────
Deux raisons, apprises l'une après l'autre :

1. IMPORT ABSOLU. `lanceur/__main__.py` fait `from .lanceur import main`. Lancé
   par `python -m lanceur`, c'est correct. Pris comme script d'entrée par
   PyInstaller, il tourne sous le nom `__main__` sans paquet parent, et
   l'import relatif échoue. Ici on importe en absolu, ce qui marche des deux
   côtés.

2. UNE PANNE DOIT SE VOIR. L'exécutable est construit en mode fenêtré : il n'y
   a pas de console, donc pas de trace. Une exception au démarrage fait
   disparaître l'application sans un mot — c'est exactement ce qui est arrivé
   au premier essai. Tout est donc emballé : la trace part dans un fichier à
   côté de l'exécutable ET dans une boîte de dialogue.
"""

import sys
import traceback
from pathlib import Path


def _rapporter(exc):
    """Écrit la panne là où on la retrouvera, et la montre."""
    trace = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))

    if getattr(sys, "frozen", False):
        base = Path(sys.executable).resolve().parent
    else:
        base = Path(__file__).resolve().parent
    fichier = base / "panne.log"

    try:
        import datetime
        with open(fichier, "a", encoding="utf-8") as f:
            f.write("\n" + "=" * 72 + "\n")
            f.write(datetime.datetime.now().isoformat(" ", "seconds") + "\n")
            f.write("python %s · gelé=%s\n" % (sys.version.split()[0],
                                               getattr(sys, "frozen", False)))
            f.write(trace)
    except OSError:
        fichier = None

    try:
        import tkinter
        from tkinter import messagebox
        r = tkinter.Tk()
        r.withdraw()
        messagebox.showerror(
            "Scolopandre — panne au démarrage",
            trace[-1500:]
            + ("\n\nTrace complète : %s" % fichier if fichier else ""))
        r.destroy()
    except Exception:
        print(trace, file=sys.stderr)


def main():
    try:
        from lanceur.lanceur import main as lancer
        lancer()
    except Exception as e:          # noqa: BLE001 — c'est le filet de dernier recours
        _rapporter(e)
        sys.exit(1)


if __name__ == "__main__":
    main()
