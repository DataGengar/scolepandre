#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DIAG_PASSAGE — le monde est-il traversable ?

    python outils/diag_passage.py            # 3 graines
    python outils/diag_passage.py 7          # 7 graines

Orlando rapporte qu'il passe son temps à se dégager. Avant de retirer des
éléments au jugé, il faut savoir CE QUI bloque, et combien. Ce script génère
plusieurs mondes en headless et compte :

  · les cellules praticables, et la part condamnée par le décor ;
  · les COMPOSANTES CONNEXES du sol praticable une fois le décor posé —
    c'est le chiffre qui compte : deux composantes, c'est une moitié de carte
    inatteignable ;
  · les CULS-DE-SAC : cellules praticables n'ayant qu'un seul voisin
    praticable. C'est la mesure de « on se cogne partout » ;
  · les GOULETS : cellules dont le retrait couperait le passage — impossible à
    calculer exactement à cette taille, donc approché par les cellules à deux
    voisins opposés seulement ;
  · les PONTS : combien posés, combien réellement ATTEIGNABLES depuis la
    composante principale. Un pont qu'on ne peut pas rejoindre est du décor.

Rien n'est modifié : c'est une mesure, pas une correction.
"""

import functools
import http.server
import json
import re
import shutil
import socketserver
import statistics
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
PORT = 8739

NAVIGATEURS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

HARNAIS = """
<script>
/* ── HARNAIS — injecté par outils/diag_passage.py ── */
(function(){
  var res = [], erreurs = [], images = 0, fini = false;

  window.addEventListener('error', function(e){
    erreurs.push('error: ' + (e.message||'') + ' @ '
      + (e.filename||'').split('/').pop() + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', function(e){
    erreurs.push('promesse: ' + (e.reason && (e.reason.stack||e.reason.message)));
  });

  var faux = new Proxy(function(){}, {
    get: function(t,k){
      if(k===Symbol.toPrimitive) return function(){return 1;};
      if(k==='then') return undefined;
      if(typeof k==='string' && /^[A-Z][A-Z0-9_]*$/.test(k)) return 1;
      return faux;
    },
    apply: function(){ return faux; }
  });
  var vrai = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(t){
    if(t === 'webgl2') return faux;
    return vrai.apply(this, arguments);
  };

  var horloge = 0;
  window.requestAnimationFrame = function(cb){
    if(images++ > 4000){ rapporter(); return 0; }
    return setTimeout(function(){
      horloge += 16;
      try{ cb(horloge); }catch(e){ erreurs.push('rAF: ' + (e.stack||e.message)); }
      try{ etape(images); }catch(e){ erreurs.push('diag: ' + (e.stack||e.message)); }
    }, 0);
  };

  /* ══════════ LA MESURE ══════════
     Un parcours en largeur maison, sur les mêmes règles que le joueur —
     on ne peut pas réutiliser connexite.js tel quel : il ignore `pont`,
     alors que marcher sur un tablier est précisément ce qui relie deux
     morceaux séparés par un gouffre. */
  function mesurer(G){
    var GW = G.GW, GH = G.GH, n = GW*GH;
    var grid = G.grid, floorH = G.floorH, blocked = G.blocked, vide = G.vide;
    var pont = G.pont, pontH = G.pontH, FLOOR = G.FLOOR, STEPUP = G.STEPUP;

    /* ══ DEUX ÉTAGES ══
       Le monde n'est pas un plan. Une cellule peut porter du SOL, un TABLIER,
       ou les deux — et un tablier au-dessus d'un gouffre est praticable alors
       que le gouffre ne l'est pas. Modéliser cela comme un seul plan donnait
       17 % de tabliers « inatteignables » qui l'étaient tous : c'est le
       graphe qui était faux, pas le monde.

       Noeud i        : le sol de la cellule i
       Noeud n + i    : le tablier de la cellule i                         */
    var sol = new Uint8Array(n), tab = new Uint8Array(n);
    var solTotal = 0, condamne = 0;

    for(var i=0;i<n;i++){
      if(pont[i]) tab[i] = 1;
      if(grid[i] !== FLOOR) continue;
      solTotal++;
      if(vide[i]) continue;
      if(blocked[i]){ condamne++; continue; }
      sol[i] = 1;
    }

    var praticable = function(v){ return v < n ? sol[v] : tab[v-n]; };
    var cote = function(v){ return v < n ? floorH[v] : pontH[v-n]; };

    /* Voisinage. Sur un même étage : la marche doit passer DANS LES DEUX SENS.
       Entre étages : c'est exactement la règle de montée automatique de
       joueur.js — le tablier est à portée de pas. */
    function relie(a, b){
      return Math.abs(cote(a) - cote(b)) <= STEPUP;
    }

    var comp = new Int32Array(2*n).fill(-1);
    var file = new Int32Array(2*n);
    var tailles = [];
    var id = 0;

    for(var d=0; d<2*n; d++){
      if(comp[d] !== -1 || !praticable(d)) continue;
      var tete=0, queue=0, taille=0;
      file[queue++] = d; comp[d] = id;
      while(tete < queue){
        var c = file[tete++]; taille++;
        var base = c < n ? c : c - n;
        var cx = base % GW, cz = (base/GW)|0;
        var etage = c < n ? 0 : n;

        // les quatre voisins, sur le MÊME étage
        if(cx>0)     essai(c, base-1  + etage);
        if(cx<GW-1)  essai(c, base+1  + etage);
        if(cz>0)     essai(c, base-GW + etage);
        if(cz<GH-1)  essai(c, base+GW + etage);
        // et le changement d'étage, sur place
        essai(c, c < n ? base + n : base);
      }
      function essai(a, b){
        if(comp[b] !== -1 || !praticable(b)) return;
        if(!relie(a,b)) return;
        comp[b] = id; file[queue++] = b;
      }
      tailles.push(taille); id++;
    }

    tailles.sort(function(a,b){ return b-a; });
    var total = tailles.reduce(function(s,v){ return s+v; }, 0);

    // la composante la plus grande
    var compte = {};
    for(var i4=0;i4<2*n;i4++) if(comp[i4] >= 0) compte[comp[i4]] = (compte[comp[i4]]||0)+1;
    var meilleure = -1, mieux = -1;
    for(var k in compte) if(compte[k] > mieux){ mieux = compte[k]; meilleure = +k; }

    /* culs-de-sac : au sol uniquement — sur un tablier, être au bout est
       normal, c'est une passerelle. */
    var impasses = 0, goulets = 0;
    for(var i2=0;i2<n;i2++){
      if(!sol[i2]) continue;
      var cx2 = i2 % GW, cz2 = (i2/GW)|0;
      if(cx2<1 || cz2<1 || cx2>=GW-1 || cz2>=GH-1) continue;
      var v = 0, ew = 0, ns = 0;
      if(sol[i2-1]  && relie(i2, i2-1)){  v++; ew++; }
      if(sol[i2+1]  && relie(i2, i2+1)){  v++; ew++; }
      if(sol[i2-GW] && relie(i2, i2-GW)){ v++; ns++; }
      if(sol[i2+GW] && relie(i2, i2+GW)){ v++; ns++; }
      if(tab[i2] && Math.abs(pontH[i2]-floorH[i2]) <= STEPUP) v++;
      if(v <= 1) impasses++;
      else if(v === 2 && (ew === 2 || ns === 2)) goulets++;
    }

    /* Les tabliers : combien de cellules, et combien sont dans la composante
       principale — c'est-à-dire : peut-on y monter en marchant depuis le
       reste du monde ? */
    var cellulesPont = 0, pontsRelies = 0, ponts = 0;
    for(var i5=0;i5<n;i5++){
      if(!tab[i5]) continue;
      cellulesPont++;
      if(comp[n+i5] === meilleure) pontsRelies++;
    }

    /* Un tablier SERT-IL ? Il sert s'il enjambe du vide : sinon c'est une
       estrade. On compte les cellules de tablier au-dessus d'un gouffre. */
    var pontsUtiles = 0;
    for(var i6=0;i6<n;i6++) if(tab[i6] && vide[i6]) pontsUtiles++;

    /* ══ POURQUOI LES MORCEAUX SONT-ILS COUPÉS ? ══
       Sans cette réponse on corrige au hasard. On longe la frontière de tout
       ce qui n'est pas la composante principale et on regarde ce qu'il y a
       de l'autre côté :

         VIDE      un gouffre — il manque un pont, ou il est infranchissable
         FALAISE   un dénivelé trop haut — il manque une rampe
         DÉCOR     un élément condamne la cellule — c'est réparable tout de suite
         ROCHE     ce n'est pas creusé : le morceau est une vraie enclave      */
    var causeVide = 0, causeFalaise = 0, causeDecor = 0, causeRoche = 0;
    var cellulesIsolees = 0;
    for(var i7=0;i7<n;i7++){
      if(!sol[i7] || comp[i7] === meilleure) continue;
      cellulesIsolees++;
      var cx7 = i7 % GW, cz7 = (i7/GW)|0;
      if(cx7<1 || cz7<1 || cx7>=GW-1 || cz7>=GH-1) continue;
      var vois = [i7-1, i7+1, i7-GW, i7+GW];
      for(var v7=0; v7<4; v7++){
        var j = vois[v7];
        if(comp[j] === meilleure) continue;      // pas une frontiere
        if(vide[j]){ causeVide++; continue; }
        if(blocked[j]){ causeDecor++; continue; }
        if(grid[j] !== FLOOR){ causeRoche++; continue; }
        if(Math.abs(floorH[j] - floorH[i7]) > STEPUP){ causeFalaise++; continue; }
      }
    }
    var totCause = causeVide + causeFalaise + causeDecor + causeRoche || 1;

    return {
      solTotal: solTotal,
      praticables: total,
      condamne: condamne,
      pctCondamne: solTotal ? +(condamne/solTotal*100).toFixed(1) : 0,
      composantes: tailles.length,
      significatives: tailles.filter(function(t){ return t > 200; }).length,
      plusGrande: tailles[0] || 0,
      pctPlusGrande: total ? +(tailles[0]/total*100).toFixed(1) : 0,
      impasses: impasses,
      pctImpasses: total ? +(impasses/total*100).toFixed(2) : 0,
      goulets: goulets,
      cellulesPont: cellulesPont,
      pontsRelies: pontsRelies,
      pctPontsRelies: cellulesPont ? +(pontsRelies/cellulesPont*100).toFixed(1) : 0,
      pontsUtiles: pontsUtiles,
      pctPontsUtiles: cellulesPont ? +(pontsUtiles/cellulesPont*100).toFixed(1) : 0,
      cellulesIsolees: cellulesIsolees,
      pctVide:    +(causeVide/totCause*100).toFixed(1),
      pctFalaise: +(causeFalaise/totCause*100).toFixed(1),
      pctDecor:   +(causeDecor/totCause*100).toFixed(1),
      pctRoche:   +(causeRoche/totCause*100).toFixed(1),
    };
  }

  /* ══════════ TRAVERSER POUR DE VRAI ══════════
     Le graphe dit que les tabliers sont atteignables. Ce n'est pas la même
     chose que « on peut marcher dessus » : Orlando s'est plaint des deux, et
     seul le second se vérifie en marchant.

     On pose donc le joueur à la culée d'un pont, face au tablier, et on
     avance pas à pas avec le VRAI code de déplacement. On regarde s'il monte
     sur le tablier, s'il arrive de l'autre côté, ou s'il tombe.             */
  function traverser(S){
    var G = S.Grille, J = S.joueur;
    var GW = G.GW, n = GW*G.GH, CELL = G.CELL;
    var pont = G.pont, pontH = G.pontH, floorH = G.floorH, vide = G.vide;

    /* Trouver des culées : une cellule de tablier posée sur du solide, dont
       le voisin en ligne droite surplombe le vide. C'est le point d'entrée. */
    var culees = [];
    for(var i=0;i<n && culees.length<40;i++){
      if(!pont[i] || vide[i]) continue;
      var x = i % GW, z = (i/GW)|0;
      if(x<2 || z<2 || x>=GW-2 || z>=G.GH-2) continue;
      var dirs = [[1,0,i+1],[-1,0,i-1],[0,1,i+GW],[0,-1,i-GW]];
      for(var d=0; d<4; d++){
        var j = dirs[d][2];
        if(pont[j] && vide[j]){
          culees.push({i:i, x:x, z:z, dx:dirs[d][0], dz:dirs[d][1]});
          break;
        }
      }
    }

    var essais = 0, montes = 0, traverses = 0, tombes = 0, refuses = 0;
    var ecarts = [];

    for(var k=0; k<culees.length && essais<12; k++){
      var c = culees[k];
      essais++;

      // poser le joueur sur la culée, au sol
      J.x = (c.x + 0.5) * CELL;
      J.z = (c.z + 0.5) * CELL;
      J.gy = floorH[c.i];
      J.vy = 0; J.vx = 0; J.vz = 0;
      J.surPont = false; J.chuteDepuis = null; J.prone = 0;
      J.abrite = false;

      /* L'écart entre le sol de la culée et le tablier : c'est LUI qui
         décidait de tout dans l'ancienne version. Il valait 3,6 m et rien
         ne pouvait monter. */
      ecarts.push(+(pontH[c.i] - floorH[c.i]).toFixed(2));

      // avancer droit devant, en petits pas, comme un joueur qui marche
      var depart = {x:J.x, z:J.z};
      var monte = false, tombe = false;
      for(var p=0; p<70; p++){
        var nx = J.x + c.dx * 0.28, nz = J.z + c.dz * 0.28;
        if(!S.bloqueA(nx, nz, J.gy)){ J.x = nx; J.z = nz; }
        S.majEtage();                       // la vraie règle des deux étages
        var gt = S.coteSol(J.x, J.z);
        if(gt < -9000){ tombe = true; break; }   // plus rien sous les pieds
        J.gy = gt;
        if(J.surPont) monte = true;
      }
      var parcouru = Math.hypot(J.x-depart.x, J.z-depart.z);
      if(monte) montes++;
      if(tombe) tombes++;
      else if(parcouru > 6 && !tombe) traverses++;
      if(!monte && !tombe) refuses++;
    }

    return {
      culeesTrouvees: culees.length,
      essais: essais,
      montes: montes,
      traverses: traverses,
      tombes: tombes,
      refuses: refuses,
      ecartMoyen: ecarts.length
        ? +(ecarts.reduce(function(a,b){return a+b;},0)/ecarts.length).toFixed(2) : 0,
      ecartMax: ecarts.length ? Math.max.apply(null, ecarts) : 0,
    };
  }

  var graine = null, fait = false;

  function etape(n){
    if(n < 40 || fait) return;
    var S = window.SCOLO;
    if(!S) return;
    fait = true;
    try{
      var m = mesurer(S.Grille);
      m.graine = GRAINE;
      var r = S.rapport();
      m.props = r['éléments'] || r.props || '?';
      m.ponts = r.ponts || '?';
      m.gouffres = r.gouffres || '?';
      try{ m.marche = traverser(S); }
      catch(e2){ erreurs.push('traversee: ' + (e2.stack||e2.message)); }
      res.push(m);
    }catch(e){ erreurs.push('mesure: ' + (e.stack||e.message)); }
    rapporter();
  }

  function rapporter(){
    if(fini) return; fini = true;
    var d = document.createElement('div');
    d.id = 'RES';
    d.textContent = JSON.stringify({mesures:res, erreurs:erreurs});
    document.body.appendChild(d);
  }
  setTimeout(rapporter, 120000);
})();
</script>
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


def une_graine(bac, exe, graine):
    page = (bac / "index.html").read_text(encoding="utf-8")
    page = page.replace("</head>",
                        HARNAIS.replace("GRAINE", str(graine)) + "</head>")
    (bac / "_diag.html").write_text(page, encoding="utf-8")

    p = subprocess.run(
        [exe, "--headless=new", "--disable-gpu",
         "--user-data-dir=" + str(bac / "profil"), "--no-first-run",
         "--virtual-time-budget=120000", "--dump-dom",
         "--enable-logging=stderr", "--log-level=0",
         "http://127.0.0.1:%d/_diag.html?debug&graine=%d" % (PORT, graine)],
        capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=300)

    m = re.search(r'<div id="RES">(.*?)</div>', p.stdout, re.S)
    if not m:
        console = [l for l in (p.stderr or "").splitlines()
                   if "CONSOLE" in l or "Uncaught" in l]
        print("    aucun rapport pour la graine %d" % graine)
        for l in console[:6]:
            i = l.find("]")
            print("      " + (l[i + 1:] if i > 0 else l).strip()[:200])
        return None
    d = json.loads(m.group(1).replace("&quot;", '"').replace("&amp;", "&")
                   .replace("&lt;", "<").replace("&gt;", ">"))
    for e in d["erreurs"]:
        print("      ! " + e[:180])
    return d["mesures"][0] if d["mesures"] else None


def main():
    combien = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 3

    tmp = Path(tempfile.mkdtemp(prefix="diag_"))
    bac = tmp / "jeu"
    shutil.copytree(RACINE, bac, ignore=shutil.ignore_patterns(
        "application", "build", ".git", "__pycache__", "archives",
        ".sauvegardes", "cartes", "dist"))
    srv = servir(bac)
    exe = navigateur()

    print()
    print("  LE MONDE EST-IL TRAVERSABLE ?   (%d graines)" % combien)
    print()

    mesures = []
    try:
        for g in range(1, combien + 1):
            print("  graine %d…" % g, flush=True)
            m = une_graine(bac, exe, g)
            if m:
                mesures.append(m)
    finally:
        srv.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)

    if not mesures:
        print("\n  aucune mesure obtenue.")
        sys.exit(1)

    def col(cle):
        return [m[cle] for m in mesures if cle in m]

    def moy(cle):
        v = col(cle)
        return statistics.mean(v) if v else 0

    print()
    print("  %-34s %10s %10s %10s" % ("", "min", "moyenne", "max"))
    print("  " + "─" * 68)

    LIGNES = [
        ("cellules de sol",              "solTotal",       "%d"),
        ("praticables après décor",      "praticables",    "%d"),
        ("condamnées par un élément",    "condamne",       "%d"),
        ("  soit, en %",                 "pctCondamne",    "%.1f"),
        ("",                             None,             None),
        ("composantes connexes",         "composantes",    "%d"),
        ("  dont significatives (>200)", "significatives", "%d"),
        ("  part de la plus grande, %",  "pctPlusGrande",  "%.1f"),
        ("",                             None,             None),
        ("culs-de-sac",                  "impasses",       "%d"),
        ("  soit, en %",                 "pctImpasses",    "%.2f"),
        ("goulets d'un pas",             "goulets",        "%d"),
        ("",                             None,             None),
        ("cellules coupées du monde",    "cellulesIsolees", "%d"),
        ("  frontière : gouffre, %",     "pctVide",        "%.0f"),
        ("  frontière : falaise, %",     "pctFalaise",     "%.0f"),
        ("  frontière : décor, %",       "pctDecor",       "%.0f"),
        ("  frontière : roche, %",       "pctRoche",       "%.0f"),
        ("",                             None,             None),
        ("cellules de tablier",          "cellulesPont",   "%d"),
        ("  atteignables en marchant, %", "pctPontsRelies", "%.1f"),
        ("  au-dessus du vide, %",       "pctPontsUtiles", "%.1f"),
    ]
    for libelle, cle, fmt in LIGNES:
        if cle is None:
            print()
            continue
        v = col(cle)
        if not v:
            continue
        print("  %-34s %10s %10s %10s" % (
            libelle, fmt % min(v), fmt % statistics.mean(v), fmt % max(v)))

    marches = [m["marche"] for m in mesures if m.get("marche")]
    if marches:
        print()
        print("  ON Y MARCHE VRAIMENT ?   (le joueur avance, pas le graphe)")
        print()
        som = lambda c: sum(x[c] for x in marches)
        print("    %-34s %d" % ("culées essayées", som("essais")))
        print("    %-34s %d" % ("montées sur le tablier", som("montes")))
        print("    %-34s %d" % ("traversées complètes", som("traverses")))
        print("    %-34s %d" % ("chutes", som("tombes")))
        print("    %-34s %d" % ("refusées (rien ne se passe)", som("refuses")))
        e = [x["ecartMoyen"] for x in marches]
        print("    %-34s %.2f m  (max %.2f)" % (
            "marche sol → tablier à la culée",
            statistics.mean(e), max(x["ecartMax"] for x in marches)))

    print()
    print("  CE QU'IL FAUT LIRE")
    print()
    if moy("significatives") > 1:
        print("    ✗  %.1f morceaux significatifs en moyenne : une partie de la"
              % moy("significatives"))
        print("       carte est inatteignable à pied. Ce qui l'en sépare :")
        for libelle, cle in (("un gouffre", "pctVide"), ("une falaise", "pctFalaise"),
                             ("un élément de décor", "pctDecor"),
                             ("de la roche non creusée", "pctRoche")):
            print("         %-24s %.0f %%" % (libelle, moy(cle)))
    else:
        print("    ✓  un seul morceau significatif : la carte se traverse.")

    if moy("pctPontsRelies") < 90:
        print("    ✗  seulement %.0f %% des tabliers touchent la carte principale."
              % moy("pctPontsRelies"))
        print("       Les autres sont du décor : on ne peut pas y monter.")
    else:
        print("    ✓  %.0f %% des tabliers s'atteignent en marchant."
              % moy("pctPontsRelies"))

    if marches:
        e = sum(x["essais"] for x in marches)
        mo = sum(x["montes"] for x in marches)
        tr = sum(x["traverses"] for x in marches)
        if e and mo / e < 0.9:
            print("    ✗  %d culées sur %d seulement laissent monter sur le pont."
                  % (mo, e))
        elif e:
            print("    ✓  %d culées sur %d laissent monter en marchant." % (mo, e))
        if e and tr / e < 0.7:
            print("    ✗  %d traversées complètes sur %d essais." % (tr, e))
        elif e:
            print("    ✓  %d traversées complètes sur %d essais." % (tr, e))

    if moy("pctPontsUtiles") < 25:
        print("    ✗  seulement %.0f %% du tablier surplombe du vide : le reste"
              % moy("pctPontsUtiles"))
        print("       est une estrade posée sur du sol qu'on pouvait déjà longer.")
    else:
        print("    ✓  %.0f %% du tablier enjambe réellement un gouffre."
              % moy("pctPontsUtiles"))

    if moy("pctImpasses") > 2:
        print("    ✗  %.2f %% de culs-de-sac : c'est ça, « se cogner partout »."
              % moy("pctImpasses"))
    else:
        print("    ✓  peu de culs-de-sac.")

    if moy("pctCondamne") > 8:
        print("    ✗  %.1f %% du sol est condamné par le décor."
              % moy("pctCondamne"))
    else:
        print("    ✓  le décor condamne peu de sol (%.1f %%)."
              % moy("pctCondamne"))
    print()


if __name__ == "__main__":
    main()
