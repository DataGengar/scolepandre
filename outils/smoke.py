#!/usr/bin/env python3
"""
SMOKE — exécute vraiment le jeu, sans GPU, et rapporte ce qui casse.

    python outils/smoke.py            # teste les modules (src/, comme en dev)
    python outils/smoke.py --bundle   # teste dist/scolopandre.html

Pourquoi : il n'y a pas de moteur JavaScript en ligne de commande sur cette
machine, mais il y a Chrome. On s'en sert en mode headless.

Comment : on fabrique une page jumelle de index.html dans laquelle un script
CLASSIQUE (donc exécuté avant les modules, qui sont différés) installe :

  · un faux contexte WebGL2 — un Proxy qui répond n'importe quoi de véridique
    à n'importe quel appel, ce qui suffit puisqu'on ne vérifie pas les pixels
    mais l'absence d'exception ;
  · un requestAnimationFrame branché sur setTimeout, borné en nombre d'images
    (sans ça la page tournerait indéfiniment et Chrome ne rendrait jamais la
    main) ;
  · des collecteurs sur window.onerror, unhandledrejection et console.error.

On lit ensuite le DOM avec --dump-dom et on en extrait le rapport.

CE QUE ÇA VALIDE : le graphe d'imports, la génération complète du monde, la
boucle de jeu sur ~100 images, l'IA, l'audio (l'AudioContext n'est créé qu'au
clic, il reste donc muet), le sismographe.
CE QUE ÇA NE VALIDE PAS : le rendu réel, les shaders, ce à quoi ça ressemble.
"""

import re
import shutil
import subprocess
import sys
import tempfile
import threading
import http.server
import socketserver
import functools
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

RACINE = Path(__file__).resolve().parent.parent
PORT = 8731
IMAGES = 600          # images simulées (× 50 ms = 30 s de partie)

NAVIGATEURS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

MOCK = """
<script>
/* ── HARNAIS DE TEST — injecté par outils/smoke.py, absent du jeu ── */
(function(){
  var journal = [], erreurs = [], images = 0, fini = false, depart = null;

  function rapporter(){
    if(fini) return; fini = true;
    /* État final : c'est la PREUVE que la simulation a tourné et pas
       seulement le rendu. Sans ça, un jeu.enCours resté faux passerait le
       test sans qu'on s'en aperçoive. */
    var etat = null;
    try {
      if(window.SCOLO){
        var S = window.SCOLO;
        etat = {
          joueur: {
            x: +S.joueur.x.toFixed(1), z: +S.joueur.z.toFixed(1),
            alt: +S.joueur.gy.toFixed(1), mode: S.joueur.mode,
            abrite: S.joueur.abrite, secousse: +S.joueur.shake.toFixed(2),
            leurres: S.joueur.held
          },
          distanceParcourue: depart ? +Math.hypot(S.joueur.x-depart.x, S.joueur.z-depart.z).toFixed(1) : null,
          chaleur: +S.froid.chaleur.toFixed(1),
          palier: S.froid.nomPalier,
          creature: {etat: S.creature.state, vitesse: +S.creature.vitesse.toFixed(2),
                     certitude: +S.creature.belief.conf.toFixed(2)},
          jeunes: S.jeunes.length,
          jeunesImmobiles: S.jeunes.filter(function(j){ return j.coinceT > 2; }).length,
          pression: +S.directeur.pression.toFixed(2)
        };
        etat.traverse = {
          chaleurMin: +obs.chaleurMin.toFixed(1),
          paliersVus: Object.keys(obs.paliers),
          secousseMax: +obs.secousseMax.toFixed(2),
          etatsCreatureVus: Object.keys(obs.etatsCreature),
          jeunesMax: obs.jeunesMax,
          jeunesCoincesMax: obs.jeunesCoincesMax,
          imagesAuSol: obs.prone,
          imagesEnCachette: obs.abrite,
          imagesSurPasserelle: obs.surPont,
          morts: obs.morts,
          distanceMax: +obs.distanceMax.toFixed(0),
          altitudes: [+obs.altitudeMin.toFixed(0), +obs.altitudeMax.toFixed(0)]
        };
      }
    } catch(e){ erreurs.push('état final: ' + (e.stack||e.message)); }

    var d = document.createElement('div');
    d.id = 'SMOKE_RESULTAT';
    d.textContent = JSON.stringify({
      images: images,
      erreurs: erreurs,
      etat: etat,
      journal: journal.slice(-40)
    });
    document.body.appendChild(d);
    document.title = erreurs.length ? 'SMOKE_KO' : 'SMOKE_OK';
  }

  window.addEventListener('error', function(e){
    erreurs.push('error: ' + (e.message||'') + ' @ ' +
      (e.filename||'').split('/').pop() + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', function(e){
    erreurs.push('promesse rejetée: ' + (e.reason && (e.reason.stack||e.reason.message) || e.reason));
  });
  var ce = console.error;
  console.error = function(){
    var a = Array.prototype.map.call(arguments, function(x){
      return (x && x.stack) ? x.stack : String(x); }).join(' ');
    erreurs.push('console.error: ' + a);
    ce.apply(console, arguments);
  };
  var cl = console.log;
  console.log = function(){
    journal.push(Array.prototype.map.call(arguments, function(x){
      try { return typeof x === 'object' ? JSON.stringify(x) : String(x); }
      catch(e){ return String(x); }
    }).join(' '));
    cl.apply(console, arguments);
  };

  /* ── faux WebGL2 ──
     Un Proxy qui se renvoie lui-même pour tout accès et tout appel. Les
     constantes GL doivent être des nombres (le code s'en sert comme clés de
     texParameteri) ; tout le reste peut être le proxy, qui est truthy — ce qui
     fait passer les tests COMPILE_STATUS et LINK_STATUS. */
  var faux = new Proxy(function(){}, {
    get: function(t, k){
      if(k === Symbol.toPrimitive) return function(){ return 1; };
      if(k === 'then') return undefined;               // pas thenable
      if(typeof k === 'string' && /^[A-Z][A-Z0-9_]*$/.test(k)) return 1;
      return faux;
    },
    apply: function(){ return faux; }
  });
  var vrai = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type){
    if(type === 'webgl2') return faux;
    return vrai.apply(this, arguments);
  };

  /* ── rAF borné ──
     La génération du monde attend une image entre chaque étape ; sans rAF
     réel en headless, la page resterait bloquée sur la barre de chargement. */
  var horloge = 0;
  window.requestAnimationFrame = function(cb){
    if(images++ > __IMAGES__){ rapporter(); return 0; }
    return setTimeout(function(){
      /* Horloge synthétique de 50 ms : c'est le pas maximal que la boucle
         accepte. Avec le temps réel, chaque image durerait 1 ms et 600 images
         ne feraient pas une seconde de jeu — on ne verrait jamais la créature
         bouger. Là, 600 images valent 30 s de partie. */
      horloge += 50;
      try { cb(horloge); agiter(images); observer(); }
      catch(e){ erreurs.push('rAF: ' + (e.stack || e.message)); }
    }, 0);
  };

  /* ── mise en jeu forcée ──
     Sans verrouillage du pointeur, jeu.enCours reste faux et la boucle ne
     SIMULE rien : on ne testerait que le rendu. On truque donc
     document.pointerLockElement, on clique sur « Descendre » (ce qui construit
     tout le graphe audio) et on maintient une touche pour que le joueur marche.

     Le déclenchement attend que window.SCOLO existe : il n'apparaît qu'une fois
     la génération terminée, et entrer en jeu avant ne servirait à rien puisque
     la boucle se garde derrière jeu.pret. */
  var enJeu = false, imageDepart = 0;

  /* ── observateur ──
     Un instantané final ne prouve pas grand-chose : il faut savoir ce qui a
     été TRAVERSÉ. On échantillonne à chaque image et on retient les extrêmes
     et les ensembles d'états vus. C'est ce tableau qui atteste que le froid
     descend vraiment ses paliers, que la caméra tremble, que la bête poursuit
     et qu'aucun jeune ne reste planté. */
  var obs = {
    chaleurMin: 100, secousseMax: 0, profondeurMax: 0, altitudeMin: 0, altitudeMax: 0,
    paliers: {}, etatsCreature: {}, jeunesMax: 0, jeunesCoincesMax: 0,
    prone: 0, abrite: 0, surPont: 0, morts: 0, distanceMax: 0
  };
  var morteAvant = 0;

  function observer(){
    if(!window.SCOLO) return;
    var S = window.SCOLO;
    obs.chaleurMin  = Math.min(obs.chaleurMin, S.froid.chaleur);
    obs.secousseMax = Math.max(obs.secousseMax, S.joueur.shake);
    obs.altitudeMin = Math.min(obs.altitudeMin, S.joueur.gy);
    obs.altitudeMax = Math.max(obs.altitudeMax, S.joueur.gy);
    obs.paliers[S.froid.nomPalier] = 1;
    obs.etatsCreature[S.creature.state] = 1;
    obs.jeunesMax = Math.max(obs.jeunesMax, S.jeunes.length);
    var coinces = 0;
    for(var i=0;i<S.jeunes.length;i++) if(S.jeunes[i].coinceT > 2) coinces++;
    obs.jeunesCoincesMax = Math.max(obs.jeunesCoincesMax, coinces);
    if(S.joueur.prone > 0) obs.prone++;
    if(S.joueur.abrite) obs.abrite++;
    if(S.joueur.surPont) obs.surPont++;
    if(S.jeu.attrapeT > 0 && morteAvant <= 0) obs.morts++;
    morteAvant = S.jeu.attrapeT;
    if(depart) obs.distanceMax = Math.max(obs.distanceMax,
      Math.hypot(S.joueur.x-depart.x, S.joueur.z-depart.z));
  }

  function entrerEnJeu(n){
    var cv = document.getElementById('gl');
    if(!cv) return;
    try {
      Object.defineProperty(document, 'pointerLockElement',
        {get: function(){ return cv; }, configurable: true});
    } catch(e){ erreurs.push('pointerLock: ' + e.message); }
    cv.requestPointerLock = function(){};
    var jouer = document.getElementById('mJouer');
    if(jouer) jouer.click();                       // construit le graphe audio
    document.dispatchEvent(new Event('pointerlockchange'));
    window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyW'}));
    depart = {x: window.SCOLO.joueur.x, z: window.SCOLO.joueur.z};
    enJeu = true; imageDepart = n;
  }

  function touche(code){ window.dispatchEvent(new KeyboardEvent('keydown', {code:code})); }

  /* Un peu d'agitation : leurre, torche, cachette, effondrement, froid extrême.
     Ce sont les chemins de code les plus neufs, donc les plus suspects. */
  function agiter(n){
    if(!enJeu){
      if(window.SCOLO) entrerEnJeu(n);
      return;
    }
    var k = n - imageDepart;
    if(k === 40)  touche('Space');            // lancer un leurre
    if(k === 60)  touche('KeyF');             // torche
    if(k === 80)  touche('KeyE');             // tenter une cachette
    if(k === 100) touche('Tab');              // sismographe
    if(k === 120){
      try { window.SCOLO.effondrement(); }
      catch(e){ erreurs.push('effondrement: ' + (e.stack||e.message)); }
    }
    if(k === 150){
      // coller la créature au joueur : poursuite, dread, contact
      try {
        var S = window.SCOLO;
        S.creature.x = S.joueur.x + 6; S.creature.z = S.joueur.z + 6;
      } catch(e){ erreurs.push('rapprochement: ' + (e.stack||e.message)); }
    }
    /* Secousse forcée : c'est le seul moyen fiable de vérifier la chute
       sismique. En 30 s de partie, une créature qui ne poursuit pas ne fait
       jamais monter le tremblement au-dessus du seuil. */
    if(k >= 170 && k <= 210){
      try { window.SCOLO.jeu.secousseEvt = 1; }
      catch(e){ erreurs.push('secousse: ' + e.message); }
    }
    /* Cachette : il n'y en a que 16 sur 1632 m, on n'en croise pas par
       hasard en 30 s. On s'y téléporte pour valider tout le chemin
       (perception coupée, mur audio, sortie automatique). */
    if(k === 250){
      try {
        var S2 = window.SCOLO;
        if(S2.monde && S2.cachettes && S2.cachettes.length){
          var c = S2.cachettes[0];
          S2.joueur.x = c.entree.x; S2.joueur.z = c.entree.z; S2.joueur.gy = c.y;
        }
      } catch(e){ erreurs.push('téléport cachette: ' + (e.stack||e.message)); }
    }
    /* Passerelle : on se pose sur une échelle de pont et on monte. Sans ça le
       second étage ne serait jamais exercé — il n'y a que 260 tronçons sur
       1632 m et le robot n'en croise pas par hasard. */
    if(k === 340){
      try {
        var S3 = window.SCOLO, G = S3.Grille;
        for(var i=0;i<G.echelle.length;i++){
          if(G.echelle[i] === 1 && G.pont[i] === 1){
            S3.joueur.x = G.c2w(i % G.GW);
            S3.joueur.z = G.c2w((i / G.GW) | 0);
            S3.joueur.gy = G.floorH[i];
            S3.joueur.surPont = false;
            break;
          }
        }
      } catch(e){ erreurs.push('téléport pont: ' + (e.stack||e.message)); }
    }
    if(k === 342){
      // s'orienter DANS L'AXE du pont, sinon on marche droit dans le vide
      try {
        var S4 = window.SCOLO, G4 = S4.Grille;
        var c = G4.idx(G4.w2c(S4.joueur.x), G4.w2c(S4.joueur.z));
        var selonX = G4.pont[c+1] === 1 || G4.pont[c-1] === 1;
        S4.joueur.yaw = selonX
          ? (G4.pont[c+1] ? -Math.PI/2 : Math.PI/2)
          : (G4.pont[c+G4.GW] ? Math.PI : 0);
      } catch(e){ erreurs.push('cap pont: ' + (e.stack||e.message)); }
    }
    if(k === 345) touche('KeyE');           // monter sur le tablier
    if(k === 255) touche('KeyE');
    if(k === 300) touche('KeyE');           // ressortir
    if(k === 220){
      // pousser le froid pour traverser les quatre paliers jusqu'à la mort
      try { window.SCOLO.SETUP.froid.base = [40,40,40,40,40]; }
      catch(e){ erreurs.push('froid: ' + e.message); }
    }
    if(k === 470) touche('KeyR');             // régénérer un monde
  }

  /* Filet : si la page se bloque sans jamais atteindre le quota d'images,
     on rapporte quand même ce qu'on a. */
  setTimeout(rapporter, 90000);
})();
</script>
"""


def servir(racine, port):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(racine))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


def main():
    bundle = "--bundle" in sys.argv
    src = RACINE / ("dist/scolopandre.html" if bundle else "index.html")
    if not src.exists():
        raise SystemExit(f"ERREUR  {src} introuvable")

    html = src.read_text(encoding="utf-8")
    mock = MOCK.replace("__IMAGES__", str(IMAGES))
    html = html.replace("<body>", "<body>\n" + mock, 1)
    if bundle:
        # le bundle vit dans dist/ : rien à réécrire, il est autonome
        cible = RACINE / "dist" / "_smoke.html"
    else:
        cible = RACINE / "_smoke.html"
    cible.write_text(html, encoding="utf-8")

    nav = next((n for n in NAVIGATEURS if Path(n).exists()), None)
    if not nav:
        raise SystemExit("ERREUR  aucun navigateur Chromium trouvé")

    httpd = servir(RACINE, PORT)
    rel = cible.relative_to(RACINE).as_posix()
    url = f"http://127.0.0.1:{PORT}/{rel}?debug"
    print(f"\n  {nav.split(chr(92))[-1]}  →  {rel}\n")

    profil = tempfile.mkdtemp(prefix="smoke_")
    cmd = [
        nav, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--use-gl=swiftshader", "--mute-audio",
        f"--user-data-dir={profil}",
        "--virtual-time-budget=120000",
        "--run-all-compositor-stages-before-draw",
        "--dump-dom", url,
    ]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=240)
        dom = p.stdout or ""
    except subprocess.TimeoutExpired:
        print("  ✗  le navigateur n'a pas rendu la main en 240 s\n")
        return 1
    finally:
        httpd.shutdown()
        shutil.rmtree(profil, ignore_errors=True)
        try: cible.unlink()
        except Exception: pass

    m = re.search(r'id="SMOKE_RESULTAT">(.*?)</div>', dom, re.S)
    if not m:
        print("  ✗  aucun rapport produit — la page n'a jamais démarré.")
        corps = re.search(r"<body[^>]*>(.{0,900})", dom, re.S)
        if corps:
            print("\n  début du DOM :\n")
            print("      " + corps.group(1).strip().replace("\n", "\n      ")[:900])
        print()
        return 1

    import json, html as H
    r = json.loads(H.unescape(m.group(1)))

    print(f"  images simulées : {r['images']}  (≈ {r['images']*0.05:.0f} s de partie)")
    if r.get("etat"):
        e = r["etat"]
        print("\n  état final :")
        for k, v in e.items():
            if isinstance(v, dict) and k == "traverse":
                print("      traversé :")
                for k2, v2 in v.items():
                    print(f"          {k2:<20} {v2}")
            else:
                print(f"      {k:<20} {v}")
    if r["journal"]:
        print("\n  journal :")
        for l in r["journal"][-8:]:
            # Le rapport du monde est long, et c'est justement celui qu'on
            # vient lire : le tronquer a 200 caracteres cachait la moitie des
            # compteurs. On le deplie ligne par ligne.
            if l.startswith("MONDE "):
                try:
                    for k, v in json.loads(l[6:]).items():
                        print("      %-24s %s" % (k, v))
                    continue
                except json.JSONDecodeError:
                    pass
            print("      " + l[:200])

    if r["erreurs"]:
        print(f"\n  ✗  {len(r['erreurs'])} erreur(s) :\n")
        vues = set()
        for e in r["erreurs"]:
            cle = e[:160]
            if cle in vues:
                continue
            vues.add(cle)
            print("      " + e.replace("\n", "\n          ")[:800])
            print()
        return 1

    print("\n  ✓  aucune erreur. Le monde se génère et la boucle tourne.")
    print("     (Le rendu réel n'est pas testé : WebGL est simulé.)\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
