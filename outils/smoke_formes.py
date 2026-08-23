#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMOKE_FORMES — contrôle les cinq primitives du moteur, sommet par sommet.

    python outils/smoke_formes.py

Pourquoi un test dédié : une primitive fausse ne lève aucune exception. Elle
produit des triangles retournés, une normale à zéro, un sommet à l'infini — et
tout ce qu'on voit en jeu, c'est une forme qui « rend bizarre » dans le noir,
à travers le brouillard, une fois sur cinquante. C'est exactement le genre de
défaut qu'on ne trouve jamais en jouant.

Ce qu'on vérifie, pour chaque forme :

  · le compte de triangles annoncé par `trianglesPart()` est le vrai compte ;
  · aucun sommet NaN ni infini ;
  · aucune normale de longueur nulle, toutes normalisées ;
  · la boîte englobante correspond aux dimensions demandées ;
  · `etenduePart()` couvre réellement l'étendue horizontale ;
  · le lacet `ry` fait pivoter la forme (et pas seulement les normales) ;
  · une roche de même graine est reproductible au sommet près.

Aucun WebGL n'est nécessaire : on appelle les primitives avec notre propre
`quad` et on regarde ce qu'elles écrivent.
"""

import functools
import http.server
import json
import re
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

RACINE = Path(__file__).resolve().parent.parent
PORT = 8736

NAVIGATEURS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

PAGE = """<!doctype html><meta charset="utf-8"><body><pre id="out">…</pre>
<script type="module">
import * as F from '/src/monde/formes.js';

const R = [];
const dire = (o) => R.push(o);

/* Un collecteur de triangles : la primitive croit écrire dans un pavé. */
function recolter(q){
  const T = [];
  /* Exactement la règle des vrais émetteurs de maillage.js : deux triangles,
     sauf si le 4e point EST le premier — auquel cas la primitive dessinait un
     triangle et le second serait d'aire nulle. Le test doit compter comme le
     moteur compte, sinon il mesure autre chose que ce qui part au GPU. */
  const quad = (p, n, c) => {
    T.push({p:[p[0],p[1],p[2]], n:n.slice(), c:c[0]});
    if(p[3] === p[0]) return;
    T.push({p:[p[0],p[2],p[3]], n:n.slice(), c:c[0]});
  };
  F.cuirePart(quad, q);
  return T;
}

function aire(t){
  const [a,b,c] = t.p;
  const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  const x = u[1]*v[2]-u[2]*v[1], y = u[2]*v[0]-u[0]*v[2], z = u[0]*v[1]-u[1]*v[0];
  return Math.hypot(x,y,z) / 2;
}

function examiner(nom, q){
  const T = recolter(q);
  const r = {nom, triangles:T.length, annonce:F.trianglesPart(q),
             rayon:F.etenduePart(q)};

  let nan = 0, degeneres = 0, normalesNulles = 0, normalesFausses = 0;
  const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];

  for(const t of T){
    for(const p of t.p){
      for(let k=0;k<3;k++){
        if(!Number.isFinite(p[k])) nan++;
        else { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
      }
    }
    if(aire(t) < 1e-9) degeneres++;
    const L = Math.hypot(t.n[0], t.n[1], t.n[2]);
    if(L < 1e-6) normalesNulles++;
    else if(Math.abs(L - 1) > 0.02) normalesFausses++;
  }

  r.nan = nan;
  r.degeneres = degeneres;          // attendus pour les triangles des coins
  r.normalesNulles = normalesNulles;
  r.normalesFausses = normalesFausses;
  r.boite = [ +(mx[0]-mn[0]).toFixed(4), +(mx[1]-mn[1]).toFixed(4),
              +(mx[2]-mn[2]).toFixed(4) ];
  r.centre = [ +((mx[0]+mn[0])/2).toFixed(4), +((mx[1]+mn[1])/2).toFixed(4),
               +((mx[2]+mn[2])/2).toFixed(4) ];
  // le rayon annoncé couvre-t-il l'étendue horizontale réelle ?
  const etendue = Math.max(mx[0]-mn[0], mx[2]-mn[2]) / 2;
  r.rayonCouvre = F.etenduePart(q) >= etendue - 1e-6;
  return r;
}

const C = [0.5, 0.4, 0.3];

dire(examiner('bloc',        {x:0,y:1,z:0, sx:2,sy:4,sz:1, c:C}));
dire(examiner('bloc+lacet',  {x:0,y:1,z:0, sx:2,sy:4,sz:1, c:C, ry:Math.PI/2}));
dire(examiner('bloc+incl',   {x:0,y:1,z:0, sx:2,sy:4,sz:1, c:C, r:0.4}));
dire(examiner('coin',        {coin:1, x:0,y:0.5,z:0, sx:2,sy:1,sz:3, c:C}));
dire(examiner('coin-',       {coin:-1, x:0,y:0.5,z:0, sx:2,sy:1,sz:3, c:C}));
dire(examiner('plaque',      {plaque:1, x:0,y:1,z:0, sx:1.2,sy:0.8, c:C}));
dire(examiner('plaque+lacet',{plaque:1, x:0,y:1,z:0, sx:1.2,sy:0.8, c:C, ry:Math.PI/2}));
dire(examiner('tube',        {tube:[[0,0,0],0.3,[0,2,0],0.1,8], c:C}));
dire(examiner('tube12',      {tube:[[0,0,0],0.3,[1,2,0.5],0.1,12], c:C}));
dire(examiner('roche',       {roche:[0.5, 7, 0], x:0,y:0.5,z:0, c:C}));
dire(examiner('roche+sub',   {roche:[0.5, 7, 1], x:0,y:0.5,z:0, c:C}));

/* ── reproductibilité : même graine, mêmes sommets ── */
const a = recolter({roche:[0.5, 42, 0], x:0,y:0,z:0, c:C});
const b = recolter({roche:[0.5, 42, 0], x:0,y:0,z:0, c:C});
const d = recolter({roche:[0.5, 43, 0], x:0,y:0,z:0, c:C});
const memes = (u,v) => u.length === v.length &&
  u.every((t,i) => t.p.every((p,j) => p.every((x,k) =>
    Math.abs(x - v[i].p[j][k]) < 1e-12)));
dire({nom:'roche reproductible', identique:memes(a,b), differenteSiAutreGraine:!memes(a,d)});

/* ── le lacet fait-il vraiment tourner la GÉOMÉTRIE ? ── */
const plat  = recolter({x:0,y:0,z:0, sx:4,sy:1,sz:0.5, c:C});
const tourne= recolter({x:0,y:0,z:0, sx:4,sy:1,sz:0.5, c:C, ry:Math.PI/2});
const et = (T,k) => { let m=1e9,M=-1e9; for(const t of T) for(const p of t.p){
  m=Math.min(m,p[k]); M=Math.max(M,p[k]); } return +(M-m).toFixed(4); };
dire({nom:'lacet 90°', avant:[et(plat,0), et(plat,2)],
      apres:[et(tourne,0), et(tourne,2)],
      echange: Math.abs(et(plat,0)-et(tourne,2)) < 1e-3 &&
               Math.abs(et(plat,2)-et(tourne,0)) < 1e-3});

document.getElementById('out').textContent = 'RESULTAT:' + JSON.stringify(R);
</script></body>
"""


def navigateur():
    for c in NAVIGATEURS:
        if Path(c).is_file():
            return c
    print("Ni Chrome ni Edge trouvés.")
    sys.exit(1)


def servir(dossier):
    h = functools.partial(http.server.SimpleHTTPRequestHandler,
                          directory=str(dossier))
    h.log_message = lambda *a, **k: None

    class S(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    srv = S(("127.0.0.1", PORT), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    tmp = Path(tempfile.mkdtemp(prefix="formes_"))
    shutil.copytree(RACINE / "src", tmp / "src")
    (tmp / "essai.html").write_text(PAGE, encoding="utf-8")

    srv = servir(tmp)
    profil = tmp / "profil"
    try:
        p = subprocess.run(
            [navigateur(), "--headless=new", "--disable-gpu",
             "--user-data-dir=" + str(profil), "--no-first-run",
             "--virtual-time-budget=8000", "--dump-dom",
             "http://127.0.0.1:%d/essai.html" % PORT],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=120)
        dom = p.stdout
    finally:
        srv.shutdown()

    m = re.search(r"RESULTAT:(\[.*?\])</pre>", dom, re.S)
    if not m:
        print("Le test n'a produit aucun résultat. Extrait du DOM :\n")
        print(dom[:2500])
        shutil.rmtree(tmp, ignore_errors=True)
        sys.exit(1)

    R = json.loads(m.group(1))
    shutil.rmtree(tmp, ignore_errors=True)

    print()
    print("  CONTRÔLE DES PRIMITIVES")
    print()
    print("  %-14s %5s %5s  %-22s %-20s %6s" %
          ("forme", "tri", "dit", "boîte englobante", "centre", "rayon"))
    print("  " + "─" * 78)

    soucis = []
    for r in R:
        if "triangles" not in r:
            continue
        ok = (r["nan"] == 0 and r["normalesNulles"] == 0
              and r["normalesFausses"] == 0 and r["rayonCouvre"]
              and r["triangles"] == r["annonce"])
        print("  %-14s %5d %5d  %-22s %-20s %6.3f %s" % (
            r["nom"], r["triangles"], r["annonce"],
            "×".join("%.2f" % v for v in r["boite"]),
            ",".join("%.2f" % v for v in r["centre"]),
            r["rayon"], "" if ok else "  ← À VOIR"))
        if r["nan"]:
            soucis.append("%s : %d coordonnées non finies" % (r["nom"], r["nan"]))
        if r["normalesNulles"]:
            soucis.append("%s : %d normales nulles" % (r["nom"], r["normalesNulles"]))
        if r["normalesFausses"]:
            soucis.append("%s : %d normales non normalisées"
                          % (r["nom"], r["normalesFausses"]))
        if not r["rayonCouvre"]:
            soucis.append("%s : etenduePart() plus petit que la forme" % r["nom"])
        if r["triangles"] != r["annonce"]:
            soucis.append("%s : trianglesPart() annonce %d, en produit %d"
                          % (r["nom"], r["annonce"], r["triangles"]))

    print()
    for r in R:
        if "triangles" in r:
            continue
        print("  " + r["nom"] + " : " + ", ".join(
            "%s=%s" % (k, v) for k, v in r.items() if k != "nom"))
        for k, v in r.items():
            if isinstance(v, bool) and not v:
                soucis.append("%s : %s est faux" % (r["nom"], k))

    print()
    if soucis:
        print("  %d PROBLÈME(S)" % len(soucis))
        for s in soucis:
            print("    · " + s)
        sys.exit(1)
    print("  ✓  les cinq primitives sont saines.")


if __name__ == "__main__":
    main()
