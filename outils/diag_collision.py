#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DIAG_COLLISION — se cogne-t-on, et peut-on s'en sortir ?

    python outils/diag_collision.py            # 2 graines
    python outils/diag_collision.py 5          # 5 graines

Orlando : « je suis souvent bloqué entre 2 objets et le R de déblocage ne
change rien », et « les hitbox sont trop grosses et ne correspondent pas à
l'objet qu'elles contiennent ». Avant de retoucher les hitbox au jugé, il faut
un chiffre. Ce script en produit quatre, sur des mondes réels, avec le VRAI
code de collision du jeu :

  PIÈGES        on tire des milliers de points au hasard sur le sol praticable
                et on demande, en chacun, combien des huit directions laissent
                partir d'un pas de marche. Zéro issue = piège. C'est
                littéralement « bloqué entre deux objets ».

  FROTTEMENT    combien de points n'ont qu'une à trois issues sur huit. On n'y
                est pas coincé, mais on s'y cogne — c'est ce qui donne
                l'impression que le monde est encombré.

  DÉBLOCAGE     sur chaque piège trouvé, on appelle la vraie fonction de la
                touche R et on regarde si le joueur se retrouve QUELQUE PART
                D'OÙ IL PEUT REPARTIR. Un déblocage qui pose le joueur dans un
                second piège compte comme un échec — c'était le défaut de la
                v4.

  HITBOX        le nombre de capsules de collision, leur rayon, et la part du
                sol qu'elles couvrent réellement.

Rien n'est modifié : c'est une mesure, pas une correction.
"""

import functools
import http.server
import json
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
PORT = 8745

NAVIGATEURS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

recu = {}
arrive = threading.Event()

HARNAIS = """
<script>
/* ── HARNAIS — injecté par outils/diag_collision.py ── */
(function(){
  var erreurs = [], fini = false, t0 = Date.now(), etape = 'attente';
  var GRAINE = GRAINE_VOULUE, ECHANT = ECHANTILLONS;

  window.addEventListener('error', function(e){
    erreurs.push((e.message||'') + ' @ '
      + (e.filename||'').split('/').pop() + ':' + e.lineno);
  });

  function envoyer(res){
    if(fini) return; fini = true;
    fetch('/_diag', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({res:res, erreurs:erreurs})});
  }

  /* Un générateur pseudo-aléatoire à nous : on tire les mêmes points d'un
     monde à l'autre, sinon deux mesures ne se comparent pas. */
  var etat = 12345;
  function alea(){ etat = (etat*1664525 + 1013904223) & 0xffffffff;
                   return ((etat>>>8) & 0xffffff) / 0xffffff; }

  /** Combien des huit directions laissent partir, à un pas de marche ? */
  function issues(S, x, z, gy){
    var n = 0, P = S.SETUP.joueur.pasIssue || 0.9;
    for(var k = 0; k < 8; k++){
      var a = k * 0.7854;
      if(!S.bloqueA(x + Math.cos(a)*P, z + Math.sin(a)*P, gy)) n++;
    }
    return n;
  }

  /** Le point est-il À L'INTÉRIEUR d'un élément ? On le calcule sur la liste
      brute, ce qui marche pour les cercles {x,z,r} de la v4 comme pour les
      capsules {x0,z0,x1,z1,r,y0,y1} de la v5. Un point situé dans un pilier
      n'est pas un piège : personne ne peut s'y tenir. L'y compter gonflait la
      mesure des deux côtés. */
  function dedans(C, x, z, gy, R, stepup, corps){
    for(var c = 0; c < C.length; c++){
      var co = C[c], d2;
      if(co.x0 === undefined){
        var ex = x - co.x, ez = z - co.z;
        d2 = ex*ex + ez*ez;
      } else {
        if(co.y1 < gy + stepup || co.y0 > gy + corps) continue;
        var dx = co.x1 - co.x0, dz = co.z1 - co.z0;
        var l2 = dx*dx + dz*dz;
        var t = l2 > 1e-9 ? ((x - co.x0)*dx + (z - co.z0)*dz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        var px = co.x0 + dx*t, pz = co.z0 + dz*t;
        d2 = (x-px)*(x-px) + (z-pz)*(z-pz);
      }
      var rr = co.r + R;
      if(d2 < rr*rr) return true;
    }
    return false;
  }

  function mesurer(S){
    var G = S.Grille, J = S.joueur, GW = G.GW, GH = G.GH, CELL = G.CELL;
    var C0 = S.colliders || (S.monde && S.monde.colliders) || [];
    var RJ = S.SETUP.joueur.rayon;
    var STEP = S.SETUP.monde.marcheJoueur;
    var CORPS = S.SETUP.joueur.hauteurOeil + (S.SETUP.joueur.margeTete || 0);

    /* Sans index, `dedans` parcourrait cinquante mille capsules par point :
       une heure de mesure. On range donc les collisionneurs dans une grille
       grossière, une fois pour toutes. */
    var MAILLE = 4 * G.CELL, IW = Math.ceil(GW*G.CELL/MAILLE) + 1;
    var index = new Map();
    for(var ci = 0; ci < C0.length; ci++){
      var cc = C0[ci];
      var ax0 = (cc.x0 === undefined) ? cc.x : Math.min(cc.x0, cc.x1);
      var ax1 = (cc.x0 === undefined) ? cc.x : Math.max(cc.x0, cc.x1);
      var az0 = (cc.z0 === undefined) ? cc.z : Math.min(cc.z0, cc.z1);
      var az1 = (cc.z0 === undefined) ? cc.z : Math.max(cc.z0, cc.z1);
      var m = cc.r + RJ + 0.1;
      for(var mz = Math.floor((az0-m)/MAILLE); mz <= Math.floor((az1+m)/MAILLE); mz++)
        for(var mx = Math.floor((ax0-m)/MAILLE); mx <= Math.floor((ax1+m)/MAILLE); mx++){
          var kk = mz*IW + mx;
          var lot0 = index.get(kk);
          if(!lot0) index.set(kk, lot0 = []);
          lot0.push(cc);
        }
    }
    var VIDE = [];
    function voisinage(C, x, z){
      return index.get(Math.floor(z/MAILLE)*IW + Math.floor(x/MAILLE)) || VIDE;
    }
    var libres = [];
    /* On échantillonne la grille au pas fixe plutôt qu'au hasard : la mesure
       couvre alors tout le monde, y compris ce qui est loin du joueur. */
    var pas = Math.max(1, Math.round(Math.sqrt(GW*GH/ECHANT)));
    for(var z = 2; z < GH-2; z += pas) for(var x = 2; x < GW-2; x += pas){
      var i = G.idx(x, z);
      if(G.grid[i] !== G.FLOOR || G.blocked[i] || G.vide[i]) continue;
      libres.push(i);
    }

    var pieges = 0, frottement = 0, dansUnObjet = 0, testes = 0;
    var deblocages = 0, deblocagesReussis = 0, distances = [];
    var repartition = [0,0,0,0,0,0,0,0,0];

    /* Sauvegarde de l'état du joueur : on le déplace pour mesurer, il doit
       retrouver sa place — le reste du jeu continue de tourner. */
    var sx = J.x, sz = J.z, sgy = J.gy, spont = J.surPont, sabri = J.abrite;
    J.surPont = false; J.abrite = false;

    for(var k = 0; k < libres.length; k++){
      var i2 = libres[k];
      var cx = i2 % GW, cz = (i2/GW)|0;
      var wx = (cx + 0.5) * CELL, wz = (cz + 0.5) * CELL;
      var gy = G.floorH[i2];
      testes++;

      /* Un point pris DANS un objet n'est pas un piège : on ne peut pas s'y
         tenir. On le compte à part, et on l'exclut du reste. */
      if(dedans(voisinage(C0, wx, wz), wx, wz, gy, RJ, STEP, CORPS)){
        dansUnObjet++;
        continue;
      }

      var n = issues(S, wx, wz, gy);
      repartition[n]++;
      if(n === 0) pieges++;
      else if(n <= 3) frottement++;

      if(n === 0 && deblocages < 400 && S.debloquer){
        deblocages++;
        J.x = wx; J.z = wz; J.gy = gy; J.vx = J.vz = 0; J.vy = 0;
        var d = S.debloquer();
        var apres = issues(S, J.x, J.z, J.gy);
        if(d > 0 && apres >= (S.SETUP.joueur.issuesMin || 5)) deblocagesReussis++;
        if(d > 0) distances.push(+d.toFixed(1));
      }
    }
    /* ── LA MÊME MESURE, DÉCOR RETIRÉ ──
       Un point sans issue peut l'être à cause d'un objet, ou parce qu'il est
       au fond d'un boyau d'une cellule de large. Sans cette seconde passe on
       attribue au décor ce qui revient au terrain — et on retire des objets
       qui n'y sont pour rien. On vide donc l'index de collision et on
       recommence : ce qui reste est du relief pur. */
    var piegesTerrain = 0, frottementTerrain = 0;
    if(S.indexerColliders && C0.length){
      var sauve = C0.slice();
      C0.length = 0; S.indexerColliders();
      for(var k2 = 0; k2 < libres.length; k2++){
        var i5 = libres[k2];
        var wx2 = ((i5 % GW) + 0.5) * CELL, wz2 = (((i5/GW)|0) + 0.5) * CELL;
        var n2 = issues(S, wx2, wz2, G.floorH[i5]);
        if(n2 === 0) piegesTerrain++;
        else if(n2 <= 3) frottementTerrain++;
      }
      for(var k3 = 0; k3 < sauve.length; k3++) C0.push(sauve[k3]);
      S.indexerColliders();
    }

    J.x = sx; J.z = sz; J.gy = sgy; J.surPont = spont; J.abrite = sabri;
    J.vx = J.vz = J.vy = 0;

    /* Les hitbox elles-mêmes. Une capsule ancienne façon n'a pas de x0/x1 :
       on sait donc lire les deux formes, ce qui permet de mesurer une version
       d'avant avec le même outil. */
    /* Tolérant à la version d'AVANT, dont les collisionneurs sont des cercles
       {x,z,r} sans segment : c'est ce qui permet de mesurer les deux et de
       comparer. */
    var C = C0;
    var rayons = [], surface = 0, longueurs = [];
    for(var c = 0; c < C.length; c++){
      var co = C[c];
      rayons.push(co.r);
      var L = (co.x0 === undefined) ? 0
            : Math.hypot(co.x1 - co.x0, co.z1 - co.z0);
      longueurs.push(L);
      surface += Math.PI*co.r*co.r + 2*co.r*L;     // disque + rectangle
    }
    rayons.sort(function(a,b){ return a-b; });

    var solM2 = 0;
    for(var i3 = 0; i3 < GW*GH; i3++)
      if(G.grid[i3] === G.FLOOR && !G.vide[i3]) solM2++;
    solM2 *= CELL*CELL;

    return {
      testes: testes,
      pieges: pieges,
      pctPieges: +(pieges/Math.max(1,testes)*100).toFixed(2),
      frottement: frottement,
      pctFrottement: +(frottement/Math.max(1,testes)*100).toFixed(2),
      pctPiegesTerrain: +(piegesTerrain/Math.max(1,testes)*100).toFixed(2),
      pctFrottementTerrain: +(frottementTerrain/Math.max(1,testes)*100).toFixed(2),
      dansUnObjet: dansUnObjet,
      pctDansUnObjet: +(dansUnObjet/Math.max(1,testes)*100).toFixed(2),
      repartition: repartition,
      deblocages: deblocages,
      deblocagesReussis: deblocagesReussis,
      pctDeblocages: deblocages ? +(deblocagesReussis/deblocages*100).toFixed(1) : null,
      distanceMediane: distances.length
        ? distances.sort(function(a,b){return a-b;})[distances.length>>1] : null,
      hitbox: C.length,
      rayonMedian: rayons.length ? +rayons[rayons.length>>1].toFixed(2) : 0,
      rayonMax: rayons.length ? +rayons[rayons.length-1].toFixed(2) : 0,
      longueurMediane: longueurs.length
        ? +longueurs.sort(function(a,b){return a-b;})[longueurs.length>>1].toFixed(2) : 0,
      pctSolCouvert: +(surface/Math.max(1,solM2)*100).toFixed(2),
    };
  }

  function tic(){
    if(fini) return;
    var S = window.SCOLO;
    if(Date.now() - t0 > 260000){ erreurs.push('TEMPS ECOULE'); envoyer(null); return; }
    if(!S || !S.jeu) return;
    if(etape === 'attente'){
      if(!S.jeu.pret) return;
      etape = 'regenere'; S.regenerer(GRAINE); return;
    }
    if(etape === 'regenere'){ if(!S.jeu.pret) etape = 'encours'; return; }
    if(etape === 'encours'){
      if(!S.jeu.pret) return;
      var r = null;
      try{ r = mesurer(S); }catch(e){ erreurs.push('mesure: ' + (e.stack||e.message)); }
      envoyer(r);
    }
  }

  var boucle = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function(cb){
    return boucle(function(t){
      try{ cb(t); }catch(e){ erreurs.push('rAF: ' + (e.stack||e.message)); }
      try{ tic(); }catch(e){ erreurs.push('tic: ' + (e.stack||e.message)); }
    });
  };
})();
</script>
"""


def navigateur():
    for c in NAVIGATEURS:
        if Path(c).is_file():
            return c
    print("Ni Chrome ni Edge trouvés.")
    sys.exit(1)


class Serveur(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        if self.path != "/_diag":
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length") or 0)
        corps = self.rfile.read(n).decode("utf-8", "replace")
        self.send_response(204)
        self.end_headers()
        try:
            recu.update(json.loads(corps))
        except json.JSONDecodeError as e:
            recu.update({"erreurs": ["JSON illisible : %s" % e]})
        arrive.set()


def servir(dossier):
    h = functools.partial(Serveur, directory=str(dossier))

    class S(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    srv = S(("127.0.0.1", PORT), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def une_graine(bac, exe, graine, echantillons):
    recu.clear()
    arrive.clear()
    page = (bac / "index.html").read_text(encoding="utf-8")
    h = (HARNAIS.replace("GRAINE_VOULUE", str(graine))
                .replace("ECHANTILLONS", str(echantillons)))
    (bac / "_diagcol.html").write_text(page.replace("</head>", h + "</head>"),
                                       encoding="utf-8")
    proc = subprocess.Popen(
        [exe, "--headless=new", "--use-angle=swiftshader",
         "--enable-unsafe-swiftshader",
         "--user-data-dir=" + str(bac / ("p%d" % graine)), "--no-first-run",
         "--mute-audio", "--window-size=400,300",
         "http://127.0.0.1:%d/_diagcol.html?debug" % PORT],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ok = arrive.wait(timeout=300)
    proc.kill()
    try:
        proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        pass
    if not ok:
        return None, ["rien reçu"]
    return recu.get("res"), recu.get("erreurs", [])


def main():
    graines = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    echantillons = 60000

    tmp = Path(tempfile.mkdtemp(prefix="diagcol_"))
    bac = tmp / "jeu"
    shutil.copytree(RACINE, bac, ignore=shutil.ignore_patterns(
        "application", "build", ".git", "__pycache__", "archives",
        ".sauvegardes", "apercus"))
    srv = servir(bac)
    exe = navigateur()

    print()
    print("  DIAG COLLISION — %d monde(s), ~%d points par monde"
          % (graines, echantillons))
    print()

    lots = []
    try:
        for g in range(graines):
            print("  graine %d …" % (g + 1), end="", flush=True)
            r, errs = une_graine(bac, exe, g + 1, echantillons)
            for e in errs:
                print("\n    ⚠ " + str(e))
            if r:
                lots.append(r)
                print("  %d points · %d pièges · %d hitbox"
                      % (r["testes"], r["pieges"], r["hitbox"]))
            else:
                print("  échec")
    finally:
        srv.shutdown()

    if not lots:
        sys.exit(1)

    def moy(cle):
        v = [l[cle] for l in lots if l.get(cle) is not None]
        return statistics.mean(v) if v else 0

    print()
    print("  CE QUE ÇA DONNE")
    print()
    print("    points de sol sondés            %8.0f" % moy("testes"))
    print("    PIÈGES (0 issue sur 8)          %8.2f %%" % moy("pctPieges"))
    print("    frottement (1 à 3 issues)       %8.2f %%" % moy("pctFrottement"))
    print("      dont dû au RELIEF seul        %8.2f %%" % moy("pctFrottementTerrain"))
    print("    PIÈGES dus au relief seul       %8.2f %%" % moy("pctPiegesTerrain"))
    print("    debout DANS un objet            %8.2f %%" % moy("pctDansUnObjet"))
    print()
    print("    déblocages tentés               %8.0f" % moy("deblocages"))
    print("    …qui laissent VRAIMENT repartir %8.1f %%" % moy("pctDeblocages"))
    print("    distance médiane du dégagement  %8.1f m" % moy("distanceMediane"))
    print()
    print("    capsules de collision           %8.0f" % moy("hitbox"))
    print("    rayon médian                    %8.2f m" % moy("rayonMedian"))
    print("    rayon max                       %8.2f m" % moy("rayonMax"))
    print("    longueur médiane                %8.2f m" % moy("longueurMediane"))
    print("    part du sol couverte            %8.2f %%" % moy("pctSolCouvert"))
    print()
    rep = [0]*9
    for l in lots:
        for k, v in enumerate(l["repartition"]):
            rep[k] += v
    total = max(1, sum(rep))
    print("    issues disponibles, en %% des points sondés")
    for k in range(9):
        barre = "█" * int(round(rep[k]/total*40))
        print("      %d sur 8 : %6.2f %%  %s" % (k, rep[k]/total*100, barre))
    print()
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
