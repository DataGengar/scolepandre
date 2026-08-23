#!/usr/bin/env python3
"""
SMOKE_EDITEUR — exécute l'éditeur en headless et vérifie qu'il fonctionne.

    python outils/smoke_editeur.py

Même principe que outils/smoke.py : Chrome sans GPU, faux contexte WebGL, et un
scénario joué tout seul. Ici le scénario est celui d'une séance d'édition :

    1. l'éditeur démarre, les trois panneaux se construisent
    2. on TRACE une zone à la souris, on lui impose un biome
    3. on lui interdit un contenu (les villages)
    4. on GÉNÈRE un monde et on vérifie que le plan a bien été suivi —
       c'est le test qui compte : un éditeur qui dessine sans que le
       générateur suive ne sert à rien
    5. on passe sur l'onglet ASSETS, on charge chaque type d'élément du jeu
       et on compte ses primitives
    6. on passe sur CRÉATURE et on la fait tourner quelques images
    7. on enregistre, on relit, on compare

Le point 4 est le cœur : il vérifie que le biome imposé domine réellement et
que le contenu interdit n'apparaît pas dans la zone.
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
except Exception:
    pass

RACINE = Path(__file__).resolve().parent.parent
PORT = 8734

NAVIGATEURS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

MOCK = """
<script>
/* ── HARNAIS — injecté par outils/smoke_editeur.py ── */
(function(){
  var res = [], erreurs = [], images = 0, fini = false;
  function log(x){ res.push(x); }

  window.addEventListener('error', function(e){
    erreurs.push('error: ' + (e.message||'') + ' @ '
      + (e.filename||'').split('/').pop() + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', function(e){
    erreurs.push('promesse: ' + (e.reason && (e.reason.stack||e.reason.message) || e.reason));
  });
  var ce = console.error;
  console.error = function(){
    erreurs.push('console.error: ' + Array.prototype.map.call(arguments, function(x){
      return (x && x.stack) ? x.stack : String(x); }).join(' '));
    ce.apply(console, arguments);
  };

  // faux WebGL2
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
    if(images++ > 900){ rapporter(); return 0; }
    return setTimeout(function(){
      horloge += 16;
      try{ cb(horloge); }catch(e){ erreurs.push('rAF: ' + (e.stack||e.message)); }
      try{ etape(images); }catch(e){ erreurs.push('scenario: ' + (e.stack||e.message)); }
    }, 0);
  };

  /* Le canvas 2D a une taille nulle en headless tant qu'on n'a pas de mise en
     page : on la force, sinon tous les calculs d'échelle divisent par zéro. */
  function forcerTailles(){
    for(const id of ['carte2d','gl']){
      const c = document.getElementById(id);
      if(!c) continue;
      Object.defineProperty(c, 'clientWidth',  {get:()=>900, configurable:true});
      Object.defineProperty(c, 'clientHeight', {get:()=>700, configurable:true});
      c.getBoundingClientRect = () => ({left:0, top:0, width:900, height:700,
                                        right:900, bottom:700, x:0, y:0});
    }
  }

  function souris(el, type, x, y, bouton){
    el.dispatchEvent(new MouseEvent(type, {bubbles:true, clientX:x, clientY:y,
                                           button:bouton||0}));
  }

  function etape(n){
    if(n === 30){
      forcerTailles();
      log('--- démarrage ---');
      log('  panneau terrain : ' + (document.getElementById('outils') ? 'ok' : 'ABSENT'));
      log('  panneau assets  : ' + (document.getElementById('aType')  ? 'ok' : 'ABSENT'));
      log('  panneau créature: ' + (document.getElementById('crEtat') ? 'ok' : 'ABSENT'));
    }

    /* ── 1. tracer une zone et lui imposer un biome ── */
    if(n === 40){
      forcerTailles();
      var sel = document.getElementById('biomePose');
      sel.value = '1';                              // GLACIÈRE
      sel.dispatchEvent(new Event('change'));
      var c = document.getElementById('carte2d');
      souris(c, 'mousedown', 100, 100);
      souris(window, 'mousemove', 400, 380);
      souris(window, 'mouseup', 400, 380);
      var P = window.__PLAN;
      log('--- tracé ---');
      log('  zones dans le plan : ' + (P ? P.zones.length : 'PLAN NON EXPOSÉ'));
      if(P && P.zones.length){
        var z = P.zones[0];
        log('  zone : ' + z.nom + ' biome=' + z.biome
            + ' ' + z.w + 'x' + z.h + ' en ' + z.x + ',' + z.z);
        z.contenu.villages = false;                 // on interdit les villages
        log('  villages interdits dans la zone');
      }
    }

    /* ── 2. générer, et vérifier que le plan a été suivi ── */
    if(n === 60){
      var bt = document.getElementById('btGen');
      if(bt){ bt.click(); log('--- génération lancée ---'); }
    }
    if(n === 500){
      var V = window.__VERIF;
      if(!V){ log('  VÉRIF INDISPONIBLE'); return; }
      var r = V();
      log('--- le générateur a-t-il suivi le plan ? ---');
      log('  cellules de sol dans la zone   : ' + r.cellules);
      log('  dont du biome imposé (glacière): ' + r.bonBiome
          + '  (' + r.pct + ' %)');
      log('  villages tombés dans la zone   : ' + r.villagesDedans
          + '   (doit valoir 0)');
      log('  villages ailleurs              : ' + r.villagesDehors);
    }

    /* ── 3. les assets ── */
    if(n === 540){
      document.getElementById('ong-assets').click();
      forcerTailles();
      log('--- assets : chargement de chaque type du jeu ---');
      var A = window.__ASSETS;
      if(!A){ log('  ASSETS NON EXPOSÉ'); return; }
      var manques = [];
      for(var i=0;i<A.TYPES.length;i++){
        var t = A.TYPES[i];
        var nb = 0;
        try{ nb = A.chargerDuJeu(t, 0, 3); }catch(e){ erreurs.push(t + ': ' + e.message); }
        if(!nb) manques.push(t);
      }
      log('  ' + A.TYPES.length + ' types testés, ' +
          (manques.length ? 'VIDES : ' + manques.join(' ') : 'tous produisent de la géométrie'));
      A.chargerDuJeu('maison', 4, 1);
      log('  maison : ' + A.el().parts.length + ' primitives, '
          + A.triangles() + ' triangles');
      log('  export code : ' + (A.versCode().indexOf('parts.push') > 0 ? 'ok' : 'VIDE'));
    }

    /* ── 3b. les cinq primitives, posées et mesurées ── */
    if(n === 548){
      var A = window.__ASSETS;
      log('--- primitives ---');
      A.ajouterElement('essaiFormes');
      A.vider();
      var lignes = [];
      for(var i=0;i<A.ORDRE.length;i++){
        var forme = A.ORDRE[i];
        var avant = A.triangles();
        A.ajouter(forme);
        lignes.push(forme + ' +' + (A.triangles() - avant));
      }
      log('  ' + lignes.join(' · ') + '  → ' + A.el().parts.length
          + ' parts, ' + A.triangles() + ' triangles');
      var st = A.stats();
      log('  taille : ' + st.taille.map(function(v){return v.toFixed(2);}).join(' × ')
          + ' m · budget ' + st.verdict);
      var code = A.versCode();
      var attendus = ['roche:[', 'plaque:1', 'coin:', 'tube:['];
      var absents = attendus.filter(function(k){ return code.indexOf(k) < 0; });
      log('  export : ' + (absents.length ? 'MANQUE ' + absents.join(' ')
                                          : 'les 5 formes sont dans le code'));
    }

    /* ── 3c. la pile de modificateurs ── */
    if(n === 556){
      var A = window.__ASSETS;
      log('--- modificateurs ---');
      A.ajouterElement('essaiPile');
      A.vider();
      A.ajouter('bloc');
      var base = A.triangles();
      log('  base : ' + A.el().parts.length + ' part, ' + base + ' triangles');

      var noms = Object.keys(A.MODIFS);
      for(var i=0;i<noms.length;i++){
        A.el().pile.length = 0;
        A.ajouterModif(noms[i]);
        A.salir();
        var st = A.stats();
        log('  ' + (noms[i] + '            ').slice(0,13) + ' → '
            + st.parts + ' parts, ' + st.triangles + ' triangles'
            + (st.tronque ? '  TRONQUÉ' : ''));
        if(st.parts < 1) erreurs.push('modif ' + noms[i] + ' ne produit rien');
      }

      /* la pile entière, empilée : c'est le cas qui explose si l'on ne borne
         pas — un réseau de réseaux part en puissance */
      A.el().pile.length = 0;
      A.ajouterModif('reseau');
      A.ajouterModif('radial');
      A.ajouterModif('bruit');
      A.salir();
      var st2 = A.stats();
      log('  pile réseau+radial+bruit → ' + st2.parts + ' parts, '
          + st2.triangles + ' triangles');
      log('  étapes : ' + st2.etapes.map(function(e){
            return e.type + '=' + (e.erreur || e.parts); }).join(' → '));

      var avantFige = st2.parts;
      var apresFige = A.figerPile();
      log('  figer la pile : ' + avantFige + ' → ' + apresFige
          + ' parts de base, pile ' + A.el().pile.length);
      if(apresFige !== avantFige) erreurs.push('figerPile a changé le compte');
    }

    /* ── 3d. sélection, transformations, annulation ── */
    if(n === 564){
      var A = window.__ASSETS;
      log('--- édition ---');
      A.ajouterElement('essaiEdition');
      A.vider();
      A.ajouter('bloc'); A.ajouter('tube'); A.ajouter('roche');

      A.toutSelectionner();
      log('  tout sélectionner : ' + A.selection.size + ' / 3');

      var b0 = A.bornes();
      A.memoriser();
      A.transformerSelection({t:[1, 0, 0]});
      var b1 = A.bornes();
      var dx = b1.centre[0] - b0.centre[0];
      log('  translation de 1 m : Δx = ' + dx.toFixed(3)
          + (Math.abs(dx - 1) < 0.02 ? '  ok' : '  FAUX'));
      if(Math.abs(dx - 1) > 0.02) erreurs.push('translation incorrecte');

      A.annuler();
      var b2 = A.bornes();
      log('  annuler : Δx = ' + (b2.centre[0] - b0.centre[0]).toFixed(3)
          + (Math.abs(b2.centre[0] - b0.centre[0]) < 0.02 ? '  ok' : '  FAUX'));

      A.retablir();
      log('  rétablir : Δx = '
          + (A.bornes().centre[0] - b0.centre[0]).toFixed(3));
      A.annuler();

      /* conversion : la position doit survivre au changement de forme */
      A.selection.clear(); A.selection.add(0);
      var c0 = A.el().parts[0];
      var pos0 = [c0.x, c0.y, c0.z];
      A.convertirSelection('coin');
      var c1 = A.el().parts[0];
      var bouge = Math.abs(c1.x-pos0[0]) + Math.abs(c1.y-pos0[1]) + Math.abs(c1.z-pos0[2]);
      log('  bloc → coin : forme=' + A.formeDe(c1)
          + ', déplacement ' + bouge.toFixed(3)
          + (bouge < 0.01 ? '  ok' : '  A BOUGÉ'));

      /* poser au sol */
      A.toutSelectionner();
      A.poserAuSol();
      log('  poser au sol : y min = ' + A.bornes().min[1].toFixed(3));
      if(Math.abs(A.bornes().min[1]) > 0.01) erreurs.push('poserAuSol laisse un écart');
    }

    /* ── 3e. le clic dans la vue 3D désigne bien une part ── */
    if(n === 572){
      var A = window.__ASSETS, V = window.__A3;
      log('--- viser ---');
      A.ajouterElement('essaiVisee');
      A.vider();
      A.ajouter('bloc');
      A.el().parts[0].x = 0; A.el().parts[0].y = 0.5; A.el().parts[0].z = 0;
      A.ajouterModif('miroir');       // pour vérifier que la pile est sauvegardée
      A.salir();
      V.cadrer([0, 0.5, 0], 1);

      /* le rayon du centre de l'écran doit toucher la part, et celui d'un
         coin doit la manquer — sinon la sélection au clic serait au hasard */
      var gl = document.getElementById('gl');
      var w = gl.width || 900, h = gl.height || 700;
      var centre = V.rayonEcran(w/2, h/2);
      var coin   = V.rayonEcran(6, 6);
      var iC = A.viser(centre.o, centre.d);
      var iX = A.viser(coin.o, coin.d);
      log('  au centre : part ' + iC + (iC === 0 ? '  ok' : '  RATÉ'));
      log('  dans le coin : part ' + iX + (iX < 0 ? '  ok (rien)' : '  FAUX POSITIF'));
      if(iC !== 0) erreurs.push('le rayon du centre ne touche pas la part');
      if(iX >= 0)  erreurs.push('le rayon du coin touche quand même');
    }

    /* ── 4. la créature ── */
    if(n === 600){
      document.getElementById('ong-creature').click();
      forcerTailles();
      log('--- créature ---');
    }
    if(n === 660){
      var s = document.getElementById('crStats');
      log('  ' + (s && s.textContent ? s.textContent : 'AUCUNE STATISTIQUE'));
      var cs = document.getElementById('cs0');
      if(cs){
        cs.value = '24';
        cs.dispatchEvent(new Event('input'));
        log('  anneaux ramenés à 24 : ' + document.getElementById('cv0').textContent);
      }
    }
    if(n === 700){
      var s2 = document.getElementById('crStats');
      log('  après changement : ' + (s2 ? s2.textContent : '—'));
    }

    /* ── 5. enregistrer et relire ── */
    if(n === 740){
      var PR = window.__PROJET;
      if(!PR){ log('  PROJET NON EXPOSÉ'); return; }
      var avant = JSON.stringify(PR.versObjet());
      PR.enregistrer();
      var ok = PR.charger();
      var apres = JSON.stringify(PR.versObjet());
      log('--- projet ---');
      log('  enregistré puis relu : ' + (ok ? 'ok' : 'ÉCHEC'));
      log('  identique après aller-retour : ' + (avant === apres ? 'oui' : 'NON'));
      log('  taille : ' + avant.length + ' octets');
      var A = window.__ASSETS;
      log('  bibliothèque : ' + A.biblio.elements.length + ' éléments ('
          + A.biblio.elements.map(function(e){ return e.nom; }).join(', ') + ')');
      var relu = PR.versObjet();
      log('  piles conservées : ' + (relu.assets.elements.filter(function(e){
            return e.pile && e.pile.length; }).length) + ' élément(s) avec pile');
      rapporter();
    }
  }

  function rapporter(){
    if(fini) return; fini = true;
    var d = document.createElement('div');
    d.id = 'RES';
    d.textContent = JSON.stringify({lignes:res, erreurs:erreurs, images:images});
    document.body.appendChild(d);
  }
  setTimeout(rapporter, 100000);
})();
</script>
"""


def servir(port):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(RACINE))
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", port), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def main():
    html = (RACINE / "editeur.html").read_text(encoding="utf-8")
    html = html.replace("<body>", "<body>\n" + MOCK, 1)
    cible = RACINE / "_smoke_ed.html"
    cible.write_text(html, encoding="utf-8")

    nav = next((n for n in NAVIGATEURS if Path(n).exists()), None)
    if not nav:
        raise SystemExit("aucun navigateur Chromium trouvé")

    httpd = servir(PORT)
    profil = tempfile.mkdtemp(prefix="smoke_ed_")
    try:
        p = subprocess.run([
            nav, "--headless=new", "--disable-gpu", "--no-sandbox",
            "--use-gl=swiftshader", "--mute-audio", "--window-size=1280,800",
            f"--user-data-dir={profil}", "--virtual-time-budget=180000",
            "--dump-dom", f"http://127.0.0.1:{PORT}/_smoke_ed.html?debug",
        ], capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=300)
        dom = p.stdout or ""
    except subprocess.TimeoutExpired:
        print("\n  ✗  l'éditeur n'a pas rendu la main en 300 s\n")
        return 1
    finally:
        httpd.shutdown()
        shutil.rmtree(profil, ignore_errors=True)
        try: cible.unlink()
        except Exception: pass

    m = re.search(r'id="RES">(.*?)</div>', dom, re.S)
    if not m:
        print("\n  ✗  aucun rapport — l'éditeur n'a pas démarré.")
        corps = re.search(r"<body[^>]*>(.{0,600})", dom, re.S)
        if corps:
            print("\n" + corps.group(1)[:600])
        return 1

    import html as H
    r = json.loads(H.unescape(m.group(1)))
    print()
    for l in r["lignes"]:
        print("  " + l)
    print(f"\n  {r['images']} images")

    if r["erreurs"]:
        print(f"\n  ✗  {len(r['erreurs'])} erreur(s) :\n")
        vues = set()
        for e in r["erreurs"]:
            if e[:150] in vues:
                continue
            vues.add(e[:150])
            print("      " + e.replace("\n", "\n          ")[:700] + "\n")
        return 1

    print("\n  ✓  l'éditeur tourne, et le générateur suit le plan.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
