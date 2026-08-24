#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMOKE_ARMES — les armes font-elles ce qu'elles promettent ?

    python outils/smoke_armes.py

Une arme touche des créatures : c'est exactement le genre de code où tout
« marche » — pas d'exception, pas d'avertissement — pendant que rien ne se
passe. Le coup part dans le vide, la portée est fausse d'un facteur deux, ou
le jeune encaisse et ne meurt jamais. Rien de tout cela ne se voit sans le
vérifier explicitement.

Ce qu'on éprouve, dans l'ordre :

  · une arme se ramasse en marchant dessus, et devient l'arme courante ;
  · un jeune placé DEVANT et à portée est touché ;
  · un jeune placé DERRIÈRE ne l'est pas — l'arc compte, sinon on frappe à
    360° et l'arme n'a plus de maniement ;
  · un jeune trop LOIN ne l'est pas non plus ;
  · assez de coups tuent ; le compte de jeunes baisse vraiment ;
  · le thunderbolt refuse de tirer sans cellules, et en consomme une par tir ;
  · LA MÈRE NE MEURT PAS. Elle recule, et le répit diminue à chaque coup —
    c'est la règle du jeu, et un test doit la protéger.
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
PORT = 8743

NAVIGATEURS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

HARNAIS = """
<script>
(function(){
  var res = [], erreurs = [], images = 0, fini = false, fait = false;

  window.addEventListener('error', function(e){
    erreurs.push('error: ' + (e.message||'') + ' @ '
      + (e.filename||'').split('/').pop() + ':' + e.lineno);
  });
  var ce = console.error;
  console.error = function(){
    erreurs.push('console: ' + Array.prototype.map.call(arguments,
      function(x){ return String(x); }).join(' ').slice(0,240));
    ce.apply(console, arguments);
  };

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
    if(images++ > 2000){ rapporter(); return 0; }
    return setTimeout(function(){
      horloge += 16;
      try{ cb(horloge); }catch(e){ erreurs.push('rAF: ' + (e.stack||e.message)); }
      try{ etape(); }catch(e){ erreurs.push('essai: ' + (e.stack||e.message)); }
    }, 0);
  };

  function log(x){ res.push(x); }
  function verifier(quoi, ok){ log((ok ? '  ok   ' : '  RATE ') + quoi); if(!ok) erreurs.push(quoi); }

  function etape(){
    var S = window.SCOLO;
    if(!S || fait) return;
    if(images < 30) return;
    fait = true;
    try{ essais(S); }catch(e){ erreurs.push('essais: ' + (e.stack||e.message)); }
    rapporter();
  }

  /* Poser un jeune a une distance et un angle donnes DEVANT le joueur.
     On passe par le tableau exporte : c'est le meme que celui que le jeu
     fait vivre, donc on eprouve le vrai chemin. */
  function poserJeune(S, dist, angle){
    var J = S.joueur;
    var a = J.yaw + angle;
    var fx = -Math.sin(a), fz = -Math.cos(a);
    var j = {
      x: J.x + fx*dist, z: J.z + fz*dist, y: J.gy, h:0,
      hist:[], cum:0, t:0, ph:0, ech:1,
      path:null, pathIdx:1, repathT:0, cible:null,
      chargeT:0, reposT:0, leurre:null, leurreT:0, fuiteT:0,
      refX:0, refZ:0, blocT:0, coinceT:0,
      pv: S.SETUP.jeunes.pv, sonne: 0,
    };
    S.jeunes.push(j);
    return j;
  }

  function essais(S){
    var A = S.armes, J = S.joueur;

    log('--- ramassage ---');
    log('  armes semees dans le monde : ' + S.armesAuSol.length);
    log('  tas de cellules            : ' + S.cellulesAuSol.length);
    verifier('des armes sont semees', S.armesAuSol.length > 0);

    var a0 = S.armesAuSol[0];
    if(a0){
      J.x = a0.x; J.z = a0.z; J.gy = a0.y - 0.24;
      var pr = S.ramasserArmes(J);
      verifier('marcher dessus la ramasse', pr.arme === a0.cle);
      verifier('elle devient l arme courante', A.etat.courante === a0.cle);
      log('  ramassee : ' + a0.cle);
    }

    /* On force le pied-de-biche : c'est l'arme de mêlée, la plus simple a
       eprouver, et on ne veut pas dependre du tirage du monde. */
    A.etat.possedees = ['mains','piedDeBiche','thunderbolt'];
    A.etat.courante = 'piedDeBiche';
    A.etat.cd = 0;
    S.jeunes.length = 0;

    log('');
    log('--- l arc et la portee ---');
    var arme = A.ARMES.piedDeBiche;

    var devant = poserJeune(S, 1.4, 0);
    A.etat.cd = 0;
    var r = A.frapper(J, S.jeunes.map(function(j){
      return {x:j.x, z:j.z, rayon:0.55, ref:j}; }));
    verifier('un jeune DEVANT et pres est touche',
             !!r && r.touches.length === 1);

    S.jeunes.length = 0;
    poserJeune(S, 1.4, Math.PI);            // pile derriere
    A.etat.cd = 0;
    r = A.frapper(J, S.jeunes.map(function(j){
      return {x:j.x, z:j.z, rayon:0.55, ref:j}; }));
    verifier('un jeune DERRIERE n est pas touche',
             !!r && r.touches.length === 0);

    S.jeunes.length = 0;
    poserJeune(S, arme.portee + 3, 0);      // trop loin
    A.etat.cd = 0;
    r = A.frapper(J, S.jeunes.map(function(j){
      return {x:j.x, z:j.z, rayon:0.55, ref:j}; }));
    verifier('un jeune TROP LOIN n est pas touche',
             !!r && r.touches.length === 0);

    log('');
    log('--- on les tue ---');
    S.jeunes.length = 0;
    var cible = poserJeune(S, 1.3, 0);
    var coups = 0, mort = false;
    for(var k=0; k<8 && !mort; k++){
      A.etat.cd = 0;
      r = A.frapper(J, [{x:cible.x, z:cible.z, rayon:0.55, ref:cible}]);
      if(!r || !r.touches.length) break;
      coups++;
      if(S.blesserJeune(cible, r.touches[0].degats, r.touches[0].poussee,
                        r.touches[0].dx, r.touches[0].dz) === 'mort') mort = true;
    }
    log('  coups de pied-de-biche pour en tuer un : ' + coups);
    verifier('un jeune finit par mourir', mort);
    verifier('il disparait de la liste', S.jeunes.length === 0);
    verifier('il en faut plus d un coup', coups >= 2);

    log('');
    log('--- munitions ---');
    A.etat.courante = 'thunderbolt';
    A.etat.reserves.cellule = 0;
    A.etat.cd = 0;
    r = A.frapper(J, []);
    verifier('sans cellule, il refuse de tirer', !!r && r.vide === true);

    A.etat.reserves.cellule = 2;
    A.etat.cd = 0;
    r = A.frapper(J, []);
    verifier('avec une cellule, il tire', !!r && r.tire === true);
    verifier('et il en consomme une', A.etat.reserves.cellule === 1);
    log('  bruit du tir : rayon ' + A.ARMES.thunderbolt.bruit
        + ' m   (un pas = 4, un leurre = 30)');

    log('');
    log('--- LA MERE NE MEURT PAS ---');
    A.memoire.accoutumance = 0;
    var repits = [];
    for(var q=0; q<4; q++) repits.push(+A.reculMere(A.ARMES.piedDeBiche).toFixed(2));
    log('  repit obtenu, coup apres coup : ' + repits.join(' / ') + ' s');
    verifier('le premier coup la fait reculer', repits[0] > 0.5);
    verifier('chaque coup suivant vaut moins', repits[3] < repits[0] * 0.5);
    verifier('la mere n a pas de points de vie',
             S.creature.pv === undefined && S.creature.hp === undefined);
    log('  etat de la mere apres le coup : ' + S.creature.state);
  }

  function rapporter(){
    if(fini) return; fini = true;
    var d = document.createElement('div');
    d.id = 'RES';
    d.textContent = JSON.stringify({lignes:res, erreurs:erreurs});
    document.body.appendChild(d);
  }
  setTimeout(rapporter, 90000);
})();
</script>
"""


def navigateur():
    for c in NAVIGATEURS:
        if Path(c).is_file():
            return c
    print("Ni Chrome ni Edge trouvés.")
    sys.exit(1)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="armes_"))
    bac = tmp / "jeu"
    shutil.copytree(RACINE, bac, ignore=shutil.ignore_patterns(
        "application", "build", ".git", "__pycache__", "archives",
        ".sauvegardes", "apercus", "cartes"))

    page = (bac / "index.html").read_text(encoding="utf-8")
    (bac / "_armes.html").write_text(
        page.replace("</head>", HARNAIS + "</head>"), encoding="utf-8")

    h = functools.partial(http.server.SimpleHTTPRequestHandler,
                          directory=str(bac))
    h.log_message = lambda *a, **k: None

    class S(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    srv = S(("127.0.0.1", PORT), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    try:
        p = subprocess.run(
            [navigateur(), "--headless=new", "--disable-gpu",
             "--user-data-dir=" + str(tmp / "p"), "--no-first-run",
             "--virtual-time-budget=90000", "--dump-dom",
             "--enable-logging=stderr", "--log-level=0",
             "http://127.0.0.1:%d/_armes.html?debug" % PORT],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=300)
    finally:
        srv.shutdown()

    m = re.search(r'<div id="RES">(.*?)</div>', p.stdout, re.S)
    if not m:
        console = [l for l in (p.stderr or "").splitlines()
                   if "CONSOLE" in l or "Uncaught" in l]
        print("\n  Aucun rapport.")
        for l in console[:10]:
            i = l.find("]")
            print("    " + (l[i + 1:] if i > 0 else l).strip()[:200])
        shutil.rmtree(tmp, ignore_errors=True)
        sys.exit(1)

    d = json.loads(m.group(1).replace("&quot;", '"').replace("&amp;", "&")
                   .replace("&lt;", "<").replace("&gt;", ">"))
    shutil.rmtree(tmp, ignore_errors=True)

    print()
    print("  LES ARMES FONT-ELLES CE QU'ELLES PROMETTENT ?")
    print()
    for l in d["lignes"]:
        print("  " + l)

    print()
    if d["erreurs"]:
        print("  ✗  %d problème(s) :" % len(d["erreurs"]))
        for e in d["erreurs"]:
            print("      " + e[:200])
        sys.exit(1)
    print("  ✓  on peut se défendre, et la mère reste inarrêtable.")


if __name__ == "__main__":
    main()
