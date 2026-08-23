#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
APERÇU — regarder le jeu. Vraiment.

    python outils/apercu.py                    # une vue par biome
    python outils/apercu.py --biome 4          # seulement la ville
    python outils/apercu.py --graine 7 --large 1280 --haut 800

Les images sortent dans `apercus/`.

── POURQUOI CET OUTIL EXISTE ─────────────────────────────────────────────────
Depuis le début du projet, tous les tests simulent WebGL par un Proxy qui
répond n'importe quoi de plausible. Ça valide le graphe d'imports, la
génération, l'IA, la boucle — et strictement rien de ce qu'on VOIT. Une erreur
de compilation GLSL, un brouillard trop dense, une lampe qui écrase tout :
aucun de ces défauts n'apparaissait, et l'ambiance se réglait à l'aveugle.

Or Chrome headless sait faire du WebGL2 en logiciel (`--use-angle=swiftshader`).
C'est lent — quelques images par seconde — mais on ne cherche pas à jouer : on
cherche à voir. Une image tranche une question d'ambiance que mille lignes de
rapport ne trancheront jamais.

── POURQUOI LA PAGE RENVOIE L'IMAGE AU SERVEUR ───────────────────────────────
Trois approches ont été essayées, dans l'ordre :

  1. `--screenshot` : Chrome capture quand le budget de temps virtuel
     s'épuise, ce qui n'a aucun rapport avec le moment où le monde est prêt.
     Résultat : deux photographies de l'écran de chargement.
  2. `--dump-dom` avec l'image en data-URL : la page maîtrisait l'instant de
     la capture, mais le vidage du DOM arrivait, lui, quand Chrome le
     décidait — dix-sept images après le démarrage.
  3. Celle-ci. La page appelle `toDataURL()` quand ELLE juge la scène prête et
     POSTe le résultat au serveur ; Python attend le fichier, puis referme le
     navigateur. Plus de temps virtuel, plus de course : c'est la page qui dit
     quand.
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
PORT = 8741

NAVIGATEURS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

BIOMES = ["souterrain", "glaciere", "barrage", "surface", "ville"]

# Ce que la page renvoie, rempli par le serveur depuis un autre fil.
recu = {}
arrive = threading.Event()


HARNAIS = """
<script>
/* ── HARNAIS D'APERÇU — injecté par outils/apercu.py ── */
(function(){
  var erreurs = [], notes = [];

  window.addEventListener('error', function(e){
    erreurs.push((e.message||'') + ' @ '
      + (e.filename||'').split('/').pop() + ':' + e.lineno);
  });
  var ce = console.error;
  console.error = function(){
    erreurs.push('console: ' + Array.prototype.map.call(arguments, function(x){
      return String(x); }).join(' ').slice(0, 260));
    ce.apply(console, arguments);
  };

  /* preserveDrawingBuffer : sans lui, toDataURL() sur un canvas WebGL rend une
     image vide — le tampon est recyclé dès la fin de l'image. C'est la seule
     concession que cet outil demande au moteur, et elle ne coûte que pendant
     la capture. */
  var vraiCtx = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(t, o){
    if(t === 'webgl2'){ o = o || {}; o.preserveDrawingBuffer = true; }
    var gl = vraiCtx.call(this, t, o);
    if(gl && t === 'webgl2' && !gl.__espionne){
      gl.__espionne = true;
      var cs = gl.compileShader.bind(gl), ls = gl.linkProgram.bind(gl);
      gl.compileShader = function(sh){
        cs(sh);
        if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
          erreurs.push('GLSL: ' + gl.getShaderInfoLog(sh).slice(0, 400));
      };
      gl.linkProgram = function(p){
        ls(p);
        if(!gl.getProgramParameter(p, gl.LINK_STATUS))
          erreurs.push('LINK: ' + gl.getProgramInfoLog(p).slice(0, 260));
      };
    }
    return gl;
  };

  var lance = false, place = false, images = 0, apresPose = 0, fini_ = false;
  var t0 = Date.now(), tPose = 0;

  function tic(){
    images++;
    if(fini_) return;
    var S = window.SCOLO;

    if(!S){
      if(Date.now() - t0 > 200000) envoyer(null, 'GENERATION JAMAIS FINIE');
      return;
    }

    /* ── entrer en partie ──
       Le jeu ne démarre que sur `pointerlockchange`, et le verrouillage du
       pointeur n'existe pas en headless. On pose donc l'état directement :
       c'est le seul endroit où cet outil s'écarte du chemin d'un vrai joueur,
       et il faut le savoir en lisant les images. */
    if(!lance){
      var v = document.getElementById('veil');
      if(v) v.style.display = 'none';
      if(S.jeu) S.jeu.enCours = true;

      /* Surcharges de réglage. C'est ce qui fait de cet outil un instrument
         plutôt qu'un appareil photo : on compare deux densités de brouillard
         sur LA MÊME vue, au lieu de modifier le code entre deux captures et
         d'espérer que le monde retombe pareil. */
      var REG = REGLAGES;
      for(var cle in REG){
        var bouts = cle.split('.'), o = S.SETUP, k;
        for(k = 0; k < bouts.length - 1; k++) o = o && o[bouts[k]];
        if(o){ o[bouts[k]] = REG[cle]; notes.push('réglage ' + cle + ' = ' + REG[cle]); }
        else erreurs.push('réglage inconnu : ' + cle);
      }
      /* Les biomes ne sont pas dans SETUP : on les atteint par le monde. */
      var BIO = BIOMES_SURCHARGE;
      if(Object.keys(BIO).length && S.BIOMES){
        for(var bk in BIO){
          var p = bk.split('.'), bi = parseInt(p[0], 10);
          var b = S.BIOMES[bi];
          if(b){ b[p[1]] = BIO[bk]; notes.push('biome ' + bk + ' = ' + BIO[bk]); }
        }
      }
      lance = true;
    }

    if(!place){
      place = poser(S);
      if(!place && images > 400) envoyer(S, 'BIOME ABSENT DE CE MONDE');
      return;
    }

    /* Laisser le streaming bâtir les pavés autour du joueur. En rendu
       logiciel c'est long : on exige un nombre d'images ET un temps réel
       minimum, parce que l'un sans l'autre ne garantit rien. */
    apresPose++;
    if(apresPose >= IMAGES_ATTENTE && Date.now() - tPose > 5000) envoyer(S, null);
    if(Date.now() - t0 > 260000) envoyer(S, 'TEMPS ECOULE');
  }

  /* ══════════ CHOISIR UN POINT DE VUE ══════════
     Le premier essai posait le joueur sur la meilleure note d'ouverture et
     de hauteur sous plafond. Il a atterri au bord de la carte, sur la lèvre
     d'un gouffre de 114 m, le nez contre la paroi : une image de cône de
     lampe sur du gris. Techniquement une réussite, visuellement rien.

     Une bonne vue demande trois choses, et les trois comptent :

       · une SALLE, pas un boyau ni un gouffre — plafond entre 3 et 16 m ;
       · de la PROFONDEUR devant soi, sinon on photographie un mur ;
       · quelque chose à ÉCLAIRER : on cherche donc le voisinage des lampes
         du décor, qui sont exactement ce que le brouillard doit faire
         rougeoyer.

     Et on oriente le regard vers la plus longue enfilade libre, plutôt que
     vers un cap arbitraire.                                                */

  function degagement(G, x, z, dx, dz, max_){
    /* Combien de cellules de sol franchissables en ligne droite. C'est la
       mesure de « y a-t-il quelque chose à voir de ce côté ». */
    var k = 0;
    var h0 = G.floorH[G.idx(x, z)];
    for(; k < max_; k++){
      var nx = x + dx*(k+1), nz = z + dz*(k+1);
      if(nx < 1 || nz < 1 || nx >= G.GW-1 || nz >= G.GH-1) break;
      var i = G.idx(nx, nz);
      if(G.grid[i] !== G.FLOOR) break;
      if(G.vide[i]) break;
      if(Math.abs(G.floorH[i] - h0) > 6) break;
    }
    return k;
  }

  function poser(S){
    var G = S.Grille, J = S.joueur;
    var n = G.GW * G.GH;
    var BORD = 40;                         // on s'écarte des bords de carte

    /* Les lampes du décor, en grille grossière : savoir si un endroit a de
       quoi être éclairé sans parcourir des milliers de sources par cellule. */
    var pasL = 24, LW = Math.ceil(G.GW/pasL), densite = new Float32Array(LW*LW);
    var L = S.lights || [];
    for(var q = 0; q < L.length; q++){
      var lx = Math.floor(G.w2c(L[q].x)/pasL), lz = Math.floor(G.w2c(L[q].z)/pasL);
      if(lx >= 0 && lz >= 0 && lx < LW && lz < LW) densite[lz*LW+lx]++;
    }

    var meilleur = -1, mieux = -1, capMieux = 0;
    for(var i = 0; i < n; i += 3){
      if(G.grid[i] !== G.FLOOR || G.vide[i] || G.blocked[i]) continue;
      if(G.biome[i] !== BIOME_VOULU) continue;
      var x = i % G.GW, z = (i / G.GW) | 0;
      if(x < BORD || z < BORD || x >= G.GW-BORD || z >= G.GH-BORD) continue;

      var haut = G.ceilH[i] - G.floorH[i];
      if(haut < 3 || haut > 16) continue;         // ni boyau ni gouffre
      var ouv = G.openN ? G.openN[i] : 1;
      if(ouv < 0.5) continue;

      var lum = densite[Math.floor(z/pasL)*LW + Math.floor(x/pasL)] || 0;
      var note = ouv * 3 + Math.min(lum, 12) * 0.5 + Math.min(haut, 9) * 0.2;
      if(note <= mieux) continue;
      mieux = note; meilleur = i;
    }
    if(meilleur < 0) return false;

    var mx = meilleur % G.GW, mz = (meilleur / G.GW) | 0;

    /* Regarder là où ça s'ouvre le plus. Seize caps, on garde le plus long. */
    var capBest = 0, longBest = -1;
    for(var a = 0; a < 16; a++){
      var ang = a / 16 * 6.28318;
      var dx = Math.round(Math.cos(ang)), dz = Math.round(Math.sin(ang));
      if(!dx && !dz) continue;
      var d = degagement(G, mx, mz, dx, dz, 40);
      if(d > longBest){ longBest = d; capBest = ang; }
    }

    J.x = (mx + 0.5) * G.CELL;
    J.z = (mz + 0.5) * G.CELL;
    J.gy = G.floorH[meilleur];
    J.vy = 0; J.surPont = false; J.abrite = false; J.prone = 0;
    /* Le lacet du jeu : 0 regarde vers -Z, et il tourne dans l'autre sens.
       D'où la conversion depuis l'angle du balayage ci-dessus. */
    J.yaw = -Math.atan2(Math.cos(capBest), -Math.sin(capBest)) + Math.PI/2;
    J.pitch = -0.03;
    tPose = Date.now();
    notes.push('posé en ' + mx + ',' + mz
             + ' · altitude ' + J.gy.toFixed(0) + ' m'
             + ' · plafond ' + (G.ceilH[meilleur]-G.floorH[meilleur]).toFixed(1) + ' m'
             + ' · dégagement ' + (longBest*G.CELL).toFixed(0) + ' m');
    return true;
  }

  function envoyer(S, souci){
    if(fini_) return; fini_ = true;
    var png = '';
    try{
      var cv = document.querySelector('canvas');
      if(cv){
        png = cv.toDataURL('image/png');
        /* Luminance, saturation, point le plus clair. Trois chiffres qui
           disent si l'image est noire, criarde ou correcte — avant même de
           l'ouvrir, et surtout de façon COMPARABLE d'une version à l'autre.
           C'est ce qui permet de régler une ambiance sans tourner en rond. */
        var t = document.createElement('canvas');
        t.width = 80; t.height = 50;
        var c2 = t.getContext('2d');
        c2.drawImage(cv, 0, 0, 80, 50);
        var d = c2.getImageData(0, 0, 80, 50).data, np = d.length / 4;
        var som = 0, somS = 0, mx = 0;
        for(var k = 0; k < d.length; k += 4){
          var a = Math.max(d[k], d[k+1], d[k+2]);
          var b = Math.min(d[k], d[k+1], d[k+2]);
          som += (0.299*d[k] + 0.587*d[k+1] + 0.114*d[k+2]) / 255;
          somS += a ? (a - b) / a : 0;
          mx = Math.max(mx, a / 255);
        }
        notes.push('luminance ' + (som/np).toFixed(3)
                 + ' · saturation ' + (somS/np).toFixed(3)
                 + ' · plus clair ' + mx.toFixed(3));
      }
      notes.push(images + ' images en ' + ((Date.now()-t0)/1000).toFixed(0) + ' s');
    }catch(e){ erreurs.push('capture: ' + e.message); }

    if(souci) erreurs.push(souci);
    fetch('/_capture', {method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({png:png, notes:notes, erreurs:erreurs})});
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
    """Sert le jeu, et reçoit l'image que la page lui renvoie."""

    def log_message(self, *a):
        pass

    def do_POST(self):
        if self.path != "/_capture":
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


def capturer(bac, exe, nom, biome, graine, large, haut, yaw, attente,
             patience, reglages=None, biomes_sur=None):
    recu.clear()
    arrive.clear()

    page = (bac / "index.html").read_text(encoding="utf-8")
    h = (HARNAIS.replace("BIOME_VOULU", str(biome))
                .replace("IMAGES_ATTENTE", str(attente))
                .replace("YAW", str(yaw))
                .replace("REGLAGES", json.dumps(reglages or {}))
                .replace("BIOMES_SURCHARGE", json.dumps(biomes_sur or {})))
    (bac / "_apercu.html").write_text(page.replace("</head>", h + "</head>"),
                                      encoding="utf-8")

    proc = subprocess.Popen(
        [exe, "--headless=new",
         # le rendu logiciel : c'est LUI qui rend cet outil possible
         "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
         "--user-data-dir=" + str(bac / ("p_" + nom)), "--no-first-run",
         "--hide-scrollbars", "--force-device-scale-factor=1", "--mute-audio",
         "--window-size=%d,%d" % (large, haut),
         "http://127.0.0.1:%d/_apercu.html?debug&graine=%d" % (PORT, graine)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    t0 = time.time()
    ok = arrive.wait(timeout=patience)
    duree = time.time() - t0
    proc.kill()
    try:
        proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        pass

    if not ok:
        return None, {"erreurs": ["rien reçu après %.0f s" % duree]}, duree

    png = recu.get("png", "")
    rapport = {"notes": recu.get("notes", []),
               "erreurs": recu.get("erreurs", [])}
    if png.startswith("data:image/png;base64,"):
        cible = SORTIE / (nom + ".png")
        cible.write_bytes(base64.b64decode(png.split(",", 1)[1]))
        return cible, rapport, duree
    return None, rapport, duree


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--biome", type=int, default=None, help="0..4, sinon tous")
    ap.add_argument("--graine", type=int, default=3)
    ap.add_argument("--large", type=int, default=960)
    ap.add_argument("--haut", type=int, default=600)
    ap.add_argument("--yaw", type=float, default=1.1)
    ap.add_argument("--attente", type=int, default=45,
                    help="images à laisser passer après la pose")
    ap.add_argument("--patience", type=int, default=300,
                    help="secondes avant d'abandonner une vue")

    ap.add_argument("--suffixe", default="")
    ap.add_argument("--reglage", action="append", default=[],
                    metavar="image.fog=1.4",
                    help="surcharge une valeur de SETUP, répétable")
    ap.add_argument("--biome-reglage", action="append", default=[],
                    metavar="0.fogD=5.0",
                    help="surcharge un champ de biome, répétable")
    a = ap.parse_args()

    def lire_paires(liste):
        d = {}
        for p in liste:
            if "=" not in p:
                print("  réglage mal formé (attendu cle=valeur) : " + p)
                sys.exit(1)
            k, v = p.split("=", 1)
            try:
                d[k.strip()] = json.loads(v)
            except json.JSONDecodeError:
                d[k.strip()] = v
        return d

    reglages = lire_paires(a.reglage)
    biomes_sur = lire_paires(a.biome_reglage)

    SORTIE.mkdir(exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="apercu_"))
    bac = tmp / "jeu"
    shutil.copytree(RACINE, bac, ignore=shutil.ignore_patterns(
        "application", "build", ".git", "__pycache__", "archives",
        ".sauvegardes", "apercus"))
    srv = servir(bac)
    exe = navigateur()

    cibles = [a.biome] if a.biome is not None else list(range(len(BIOMES)))

    print()
    print("  APERÇU — rendu logiciel, %d × %d, graine %d"
          % (a.large, a.haut, a.graine))
    print()

    try:
        for b in cibles:
            nom = BIOMES[b] + a.suffixe
            print("  %-12s …" % BIOMES[b], end="", flush=True)
            img, rap, dt = capturer(bac, exe, nom, b, a.graine, a.large,
                                    a.haut, a.yaw, a.attente, a.patience,
                                    reglages, biomes_sur)
            if img:
                print("  %s   %.0f Ko   %.0f s"
                      % (img.relative_to(RACINE), img.stat().st_size / 1024, dt))
            else:
                print("  PAS D'IMAGE   (%.0f s)" % dt)
            for n in rap.get("notes", []):
                print("                 " + n)
            for e in rap.get("erreurs", [])[:6]:
                print("       ERREUR    " + e[:170])
    finally:
        srv.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    print("  images dans " + str(SORTIE))


if __name__ == "__main__":
    main()
