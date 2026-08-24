#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CARTE_MONDE — voir le terrain d'en haut, en une image.

    python outils/carte_monde.py                 # graine 3
    python outils/carte_monde.py --graine 7 --suffixe _essai
    python outils/carte_monde.py --reglage terrain.seuilGalerie=0.55

Les images sortent dans `apercus/`.

── POURQUOI CET OUTIL EXISTE ─────────────────────────────────────────────────
`apercu.py` montre ce que le joueur VOIT : c'est ce qui tranche une question
d'ambiance. Mais pour régler un terrain — la taille des cavernes, la sinuosité
des galeries, la lisibilité des strates — une vue subjective à quinze mètres
de portée dans le brouillard ne dit rien. Il faut voir la PLANCHE.

Deux panneaux, côte à côte :

  MATIÈRE   ce qui est creusé et ce qui est plein. Chaque cellule de sol prend
            la couleur de son biome ; la roche reste noire. C'est là qu'on lit
            si le réseau de galeries est un réseau ou un gruyère.

  RELIEF    le champ d'altitude, ombré comme une carte d'état-major, y compris
            sous la roche. C'est là qu'on lit la descente d'ensemble, les
            plis, et si les failles produisent des escarpements ou des vagues.

Le rapport de génération est imprimé avec — durée, part creusée, poches
rebouchées, morceaux — parce qu'une image sans chiffres se surinterprète.
"""

import argparse
import base64
import functools
import http.server
import json
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

RACINE = Path(__file__).resolve().parent.parent
SORTIE = RACINE / "apercus"
PORT = 8743

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
/* ── HARNAIS DE CARTE — injecté par outils/carte_monde.py ── */
(function(){
  var erreurs = [], fini = false, t0 = Date.now();
  var GRAINE = GRAINE_VOULUE, REG = REGLAGES;
  var etape = 'attente';        // attente → régénère → dessine

  window.addEventListener('error', function(e){
    erreurs.push((e.message||'') + ' @ '
      + (e.filename||'').split('/').pop() + ':' + e.lineno);
  });

  function envoyer(png, rapport){
    if(fini) return; fini = true;
    fetch('/_carte', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({png:png, rapport:rapport, resume:resume,
                            erreurs:erreurs})});
  }

  function dessiner(S){
    var G = S.Grille, GW = G.GW, GH = G.GH;
    var PAS = Math.max(1, Math.ceil(GW / 544));
    var W = Math.floor(GW / PAS), H = Math.floor(GH / PAS);

    var cv = document.createElement('canvas');
    cv.width = W*3 + 16; cv.height = H;
    var ct = cv.getContext('2d');
    ct.fillStyle = '#101418'; ct.fillRect(0, 0, cv.width, cv.height);

    /* couleurs de biome, lues dans la table du jeu : une seule vérité */
    var COUL = [];
    for(var b = 0; b < S.BIOMES.length; b++){
      var c = S.BIOMES[b].code;
      COUL.push([parseInt(c.slice(1,3),16), parseInt(c.slice(3,5),16),
                 parseInt(c.slice(5,7),16)]);
    }

    var mn = 1e9, mx = -1e9;
    for(var i = 0; i < GW*GH; i++){
      var h = G.floorH[i];
      if(h < mn) mn = h;
      if(h > mx) mx = h;
    }
    var etendue = Math.max(1, mx - mn);

    /* ── panneau 1 : la matière ── */
    var img = ct.createImageData(W, H), d = img.data;
    for(var y = 0; y < H; y++) for(var x = 0; x < W; x++){
      var gi = G.idx(x*PAS, y*PAS);
      var o = (y*W + x) * 4, r, v, bl;
      if(G.vide[gi]){ r = v = bl = 0; }
      else if(G.grid[gi] !== G.FLOOR){
        var cr = COUL[G.biome[gi]] || [40,40,40];
        r = cr[0]*0.16; v = cr[1]*0.16; bl = cr[2]*0.16;
      } else {
        var cf = COUL[G.biome[gi]] || [128,128,128];
        var t = 0.55 + 0.45 * ((G.floorH[gi] - mn) / etendue);
        r = cf[0]*t; v = cf[1]*t; bl = cf[2]*t;
      }
      d[o] = r; d[o+1] = v; d[o+2] = bl; d[o+3] = 255;
    }
    ct.putImageData(img, 0, 0);

    /* ── panneau 2 : le relief ombré ──
       Ombrage de Lambert sur le gradient du champ de hauteur. C'est ce qui
       rend un pli visible : une rampe de gris seule ne montre que des bandes. */
    var img2 = ct.createImageData(W, H), d2 = img2.data;
    for(var y2 = 0; y2 < H; y2++) for(var x2 = 0; x2 < W; x2++){
      var xx = Math.min(GW-2, Math.max(1, x2*PAS));
      var zz = Math.min(GH-2, Math.max(1, y2*PAS));
      var hc = G.floorH[G.idx(xx, zz)];
      var dx = G.floorH[G.idx(xx+1, zz)] - G.floorH[G.idx(xx-1, zz)];
      var dz = G.floorH[G.idx(xx, zz+1)] - G.floorH[G.idx(xx, zz-1)];
      var e = 2 * PAS * G.CELL;
      var nl = Math.sqrt(dx*dx + dz*dz + e*e) || 1;
      var lum = Math.max(0.12, Math.min(1, (dx*0.4 + e*0.82 + dz*0.4) / nl));
      var t2 = (hc - mn) / etendue;
      var rr = (40 + 190*t2) * lum;
      var vv = (52 + 150*t2*t2) * lum;
      var bb = (86 + 60*(1-t2)) * lum;
      if(G.grid[G.idx(xx, zz)] !== G.FLOOR){ rr *= 0.45; vv *= 0.45; bb *= 0.45; }
      var o2 = (y2*W + x2) * 4;
      d2[o2] = rr; d2[o2+1] = vv; d2[o2+2] = bb; d2[o2+3] = 255;
    }
    ct.putImageData(img2, W + 8, 0);

    /* ── panneau 3 : ce qu'on ATTEINT À PIED ──
       Les deux premiers panneaux montrent un monde ; celui-ci montre ce qu'on
       peut en parcourir. Sans lui, « 86 % du sol dans un seul morceau » ne dit
       pas OÙ sont les 14 % restants — et on corrige à l'aveugle. Vert : la
       composante principale. Rouge : coupé du monde. */
    var n = GW*GH;
    var comp = new Int32Array(n).fill(-1);
    var file = new Int32Array(n);
    var STEP = S.SETUP.monde.marcheJoueur;
    var praticable = function(i){
      return G.pont[i] || (G.grid[i] === G.FLOOR && !G.blocked[i] && !G.vide[i]);
    };
    var id = 0, meilleure = -1, mieux = -1;
    for(var d0 = 0; d0 < n; d0++){
      if(comp[d0] !== -1 || !praticable(d0)) continue;
      var tete = 0, queue = 0, taille = 0;
      file[queue++] = d0; comp[d0] = id;
      while(tete < queue){
        var c0 = file[tete++]; taille++;
        var cx0 = c0 % GW;
        if(cx0 > 0)      voisin(c0, c0-1);
        if(cx0 < GW-1)   voisin(c0, c0+1);
        if(c0 >= GW)     voisin(c0, c0-GW);
        if(c0 < n - GW)  voisin(c0, c0+GW);
      }
      if(taille > mieux){ mieux = taille; meilleure = id; }
      id++;
    }
    function voisin(a2, b2){
      if(comp[b2] !== -1 || !praticable(b2)) return;
      if(Math.abs(G.floorH[a2] - G.floorH[b2]) > STEP) return;
      comp[b2] = comp[a2]; file[queue++] = b2;
    }

    var img3 = ct.createImageData(W, H), d3 = img3.data;
    for(var y3 = 0; y3 < H; y3++) for(var x3 = 0; x3 < W; x3++){
      var gi3 = G.idx(x3*PAS, y3*PAS), o3 = (y3*W + x3)*4;
      var r3, v3, b3;
      if(G.vide[gi3]){ r3 = 6; v3 = 6; b3 = 10; }
      else if(G.grid[gi3] !== G.FLOOR){ r3 = 22; v3 = 24; b3 = 26; }
      else if(comp[gi3] === meilleure){ r3 = 60; v3 = 170; b3 = 90; }
      else { r3 = 210; v3 = 60; b3 = 55; }
      d3[o3] = r3; d3[o3+1] = v3; d3[o3+2] = b3; d3[o3+3] = 255;
    }
    ct.putImageData(img3, W*2 + 16, 0);

    /* Le chiffre qui va avec l'image : sans lui on surinterprète une tache. */
    var praticables = 0, dansLaGrande = 0;
    for(var i9 = 0; i9 < n; i9++){
      if(comp[i9] < 0) continue;
      praticables++;
      if(comp[i9] === meilleure) dansLaGrande++;
    }
    /* ── POURQUOI SONT-ILS COUPÉS ? ──
       On longe la frontière de tout ce qui n'est pas la composante principale
       et on regarde ce qu'il y a en face. La nuance qui manquait à
       diag_passage.py : un voisin QUI EST dans la composante principale est
       justement le cas intéressant — s'il est là et qu'on n'y va pas, c'est
       une MARCHE. L'ancien code sautait ce cas au motif que « ce n'est pas une
       frontière », et concluait donc invariablement « de la roche ». */
    var causes = {marche:0, decor:0, vide:0, roche:0};
    var marches = [];
    for(var i8 = 0; i8 < n; i8++){
      if(comp[i8] < 0 || comp[i8] === meilleure) continue;
      var x8 = i8 % GW;
      var vois = [];
      if(x8 > 0) vois.push(i8-1);
      if(x8 < GW-1) vois.push(i8+1);
      if(i8 >= GW) vois.push(i8-GW);
      if(i8 < n-GW) vois.push(i8+GW);
      for(var q = 0; q < vois.length; q++){
        var j8 = vois[q];
        if(praticable(j8)){
          if(comp[j8] === meilleure){
            causes.marche++;
            marches.push(+Math.abs(G.floorH[i8] - G.floorH[j8]).toFixed(2));
          }
        }
        else if(G.vide[j8]) causes.vide++;
        else if(G.blocked[j8]) causes.decor++;
        else causes.roche++;
      }
    }
    marches.sort(function(a,b){ return a-b; });

    /* Les marches infranchissables telles qu'elles sont À LA FIN de la
       génération — la relaxation, elle, mesure les siennes juste après son
       passage. L'écart entre les deux dit si une étape ultérieure (gouffres,
       rampes, cachettes, décor) a recassé le sol. */
    var marchesFin = 0;
    for(var i7 = 0; i7 < n; i7++){
      if(G.grid[i7] !== G.FLOOR || G.vide[i7]) continue;
      var x7 = i7 % GW;
      if(x7 < GW-1 && G.grid[i7+1] === G.FLOOR && !G.vide[i7+1]
         && Math.abs(G.floorH[i7] - G.floorH[i7+1]) > STEP) marchesFin++;
      if(i7 < n-GW && G.grid[i7+GW] === G.FLOOR && !G.vide[i7+GW]
         && Math.abs(G.floorH[i7] - G.floorH[i7+GW]) > STEP) marchesFin++;
    }

    /* La RUGOSITÉ du sol : l'écart de hauteur moyen entre deux cellules
       voisines. C'est la mesure de « le sol est-il vallonné ou est-ce un
       gymnase ? » — l'œil, dans quinze mètres de brouillard, ne sait pas
       trancher. */
    var somme = 0, paires = 0;
    for(var i6 = 0; i6 < n; i6++){
      if(G.grid[i6] !== G.FLOOR || G.vide[i6]) continue;
      if((i6 % GW) < GW-1 && G.grid[i6+1] === G.FLOOR && !G.vide[i6+1]){
        somme += Math.abs(G.floorH[i6] - G.floorH[i6+1]); paires++;
      }
      if(i6 < n-GW && G.grid[i6+GW] === G.FLOOR && !G.vide[i6+GW]){
        somme += Math.abs(G.floorH[i6] - G.floorH[i6+GW]); paires++;
      }
    }

    resume = {
      rugosite: +(somme/Math.max(1,paires)).toFixed(3),
      marchesFin: marchesFin,
      composantes: id,
      partPlusGrande: +(dansLaGrande/Math.max(1,praticables)*100).toFixed(1),
      cellulesCoupees: praticables - dansLaGrande,
      causes: causes,
      marcheMediane: marches.length ? marches[marches.length>>1] : null,
      marcheMin: marches.length ? marches[0] : null,
    };

    return cv.toDataURL('image/png');
  }

  function tic(){
    if(fini) return;
    var S = window.SCOLO;
    if(Date.now() - t0 > 260000){ erreurs.push('TEMPS ECOULE'); envoyer(null, null); return; }
    if(!S || !S.jeu) return;

    /* ── 1. poser les réglages, puis REGÉNÉRER ──
       Les surcharges n'ont de sens qu'appliquées avant la génération. Le
       monde du démarrage a déjà été bâti : on en fait un second, avec la
       graine demandée. C'est aussi ce qui rend la carte REJOUABLE — le jeu ne
       lit pas la graine dans l'URL. */
    if(etape === 'attente'){
      if(!S.jeu.pret) return;
      for(var cle in REG){
        var bouts = cle.split('.'), o = S.SETUP, k;
        for(k = 0; k < bouts.length - 1; k++) o = o && o[bouts[k]];
        if(o && bouts[k] in o) o[bouts[k]] = REG[cle];
        else erreurs.push('réglage inconnu : ' + cle);
      }
      etape = 'regenere';
      S.regenerer(GRAINE);
      return;
    }
    // 2. la régénération met jeu.pret à faux, puis à vrai quand c'est fini
    if(etape === 'regenere'){
      if(S.jeu.pret === false){ etape = 'encours'; }
      return;
    }
    if(etape === 'encours'){
      if(!S.jeu.pret) return;
      var rapport = null, png = null;
      try{ rapport = S.rapport(); }catch(e){ erreurs.push('rapport: ' + e.message); }
      try{ png = dessiner(S); }catch(e){ erreurs.push('dessin: ' + (e.stack||e.message)); }
      envoyer(png, rapport);
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
        if self.path != "/_carte":
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


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--graine", type=int, default=3)
    ap.add_argument("--suffixe", default="")
    ap.add_argument("--patience", type=int, default=300)
    ap.add_argument("--reglage", action="append", default=[],
                    metavar="terrain.seuilGalerie=0.55",
                    help="surcharge une valeur de SETUP avant génération, répétable")
    a = ap.parse_args()

    reglages = {}
    for p in a.reglage:
        if "=" not in p:
            print("  réglage mal formé (attendu cle=valeur) : " + p)
            sys.exit(1)
        k, v = p.split("=", 1)
        try:
            reglages[k.strip()] = json.loads(v)
        except json.JSONDecodeError:
            reglages[k.strip()] = v

    SORTIE.mkdir(exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="carte_"))
    bac = tmp / "jeu"
    shutil.copytree(RACINE, bac, ignore=shutil.ignore_patterns(
        "application", "build", ".git", "__pycache__", "archives",
        ".sauvegardes", "apercus"))

    srv = servir(bac)
    exe = navigateur()

    page = (bac / "index.html").read_text(encoding="utf-8")
    h = (HARNAIS.replace("GRAINE_VOULUE", str(a.graine))
                .replace("REGLAGES", json.dumps(reglages)))
    (bac / "_carte.html").write_text(page.replace("</head>", h + "</head>"),
                                     encoding="utf-8")

    print()
    print("  CARTE DU MONDE — graine %d%s" % (a.graine, "".join(
        "\n    réglage %s = %s" % (k, v) for k, v in reglages.items())))
    print()

    recu.clear()
    arrive.clear()
    t0 = time.time()
    proc = subprocess.Popen(
        [exe, "--headless=new", "--use-angle=swiftshader",
         "--enable-unsafe-swiftshader",
         "--user-data-dir=" + str(bac / "profil"), "--no-first-run",
         "--hide-scrollbars", "--mute-audio", "--window-size=400,300",
         "http://127.0.0.1:%d/_carte.html?debug" % PORT],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    ok = arrive.wait(timeout=a.patience)
    duree = time.time() - t0
    proc.kill()
    try:
        proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        pass
    srv.shutdown()

    if not ok:
        print("  rien reçu après %.0f s" % duree)
        sys.exit(1)

    for e in recu.get("erreurs", []):
        print("  ⚠ " + str(e))

    rap = recu.get("rapport")
    if rap:
        print("  RAPPORT DE GÉNÉRATION")
        for k, v in rap.items():
            print("      %-24s %s" % (k, v))
        print()
    res = recu.get("resume")
    if res:
        print("  TRAVERSÉE (mêmes règles que diag_passage.py)")
        print("      %-24s %s m par cellule" % ("rugosité du sol", res["rugosite"]))
        print("      %-24s %s" % ("marches infranch. à la fin", res["marchesFin"]))
        print("      %-24s %s" % ("composantes", res["composantes"]))
        print("      %-24s %s %%" % ("part de la plus grande", res["partPlusGrande"]))
        print("      %-24s %s" % ("cellules coupées", res["cellulesCoupees"]))
        c = res.get("causes") or {}
        tot = max(1, sum(c.values()))
        print("      ce qui les sépare du monde :")
        for k, v in sorted(c.items(), key=lambda kv: -kv[1]):
            print("          %-20s %5.1f %%" % (k, v/tot*100))
        if res.get("marcheMediane") is not None:
            print("      marche médiane à franchir  %.2f m (min %.2f)"
                  % (res["marcheMediane"], res["marcheMin"]))
        print()

    png = recu.get("png") or ""
    if png.startswith("data:image/png;base64,"):
        cible = SORTIE / ("carte%s.png" % a.suffixe)
        cible.write_bytes(base64.b64decode(png.split(",", 1)[1]))
        print("  %s   %.0f Ko   %.0f s"
              % (cible.relative_to(RACINE), cible.stat().st_size / 1024, duree))
    else:
        print("  aucune image reçue")
        sys.exit(1)
    print()
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
