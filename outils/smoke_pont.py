#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMOKE_PONT — la forge écrit-elle vraiment dans le jeu ?

    python outils/smoke_pont.py

C'est le test de la chaîne complète, et c'est le seul qui prouve que la forge
sert à quelque chose :

    la page compose un élément
      → pont.js appelle /_forge/prop
        → serveur.py route vers forge.py
          → forge.py découpe le switch de props.js et écrit
            → le fichier sur disque contient l'élément
              → et props.js est toujours du JavaScript valide.

Chaque maillon est simple ; c'est leur assemblage qui casse. Un en-tête HTTP
oublié, une route mal préfixée, un JSON refusé, une découpe qui déséquilibre
les accolades — rien de tout cela ne se voit dans les tests unitaires.

TOUT SE PASSE DANS UNE COPIE du projet : ce test écrit dans props.js, et il
n'est pas question qu'il touche au dépôt.
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RACINE))

NAVIGATEURS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

# Le scénario joué dans la page. Il s'installe AVANT les modules (script
# classique), attend que la forge soit prête, compose, puis écrit.
#
# ATTENTION : c'est une chaîne triple NON brute. Python y interprète les
# séquences d'échappement AVANT que la page soit écrite — un `'` destiné
# au JavaScript arrive dans la page en simple apostrophe et casse la
# chaîne. Écrire les textes sans apostrophe, ou entre guillemets doubles.
SCENARIO = """
<script>
(function(){
  var res = [], erreurs = [], images = 0, fini = false;
  function log(x){ res.push(x); }

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
    if(images++ > 400){ rapporter(); return 0; }
    return setTimeout(function(){
      horloge += 16;
      try{ cb(horloge); }catch(e){ erreurs.push('rAF: ' + (e.stack||e.message)); }
      try{ etape(images); }catch(e){ erreurs.push('scenario: ' + (e.stack||e.message)); }
    }, 0);
  };

  function forcerTailles(){
    for(var i=0;i<2;i++){
      var c = document.getElementById(['carte2d','gl'][i]);
      if(!c) continue;
      Object.defineProperty(c, 'clientWidth',  {get:function(){return 900;}, configurable:true});
      Object.defineProperty(c, 'clientHeight', {get:function(){return 700;}, configurable:true});
    }
  }

  var lance = false;

  function etape(n){
    if(n === 20){
      forcerTailles();
      var o = document.getElementById('ong-assets');
      if(o) o.click();
      forcerTailles();
    }

    if(n === 40 && !lance){
      lance = true;
      var A = window.__ASSETS, P = window.__PONT;
      if(!A || !P){ log('MODULES NON EXPOSÉS'); rapporter(); return; }

      log('pont disponible : ' + P.disponible());
      if(!P.disponible()){
        erreurs.push('le pont n\\u2019est pas detecte alors que le lanceur sert la page');
        rapporter(); return;
      }

      /* ── on compose une grille de barreaux : une primitive + un réseau ── */
      A.ajouterElement('barreauxEssai');
      A.vider();
      A.ajouter('bloc');
      A.el().parts[0].sx = 0.06;
      A.el().parts[0].sy = 1.8;
      A.el().parts[0].sz = 0.06;
      A.el().parts[0].y  = 0.9;
      A.ajouterModif('reseau');
      var m = A.el().pile[0];
      m.n = 7; m.dx = 0.22;
      A.salir();

      var st = A.stats();
      log('composé : ' + st.base + ' base → ' + st.parts + ' parts, '
          + st.triangles + ' triangles, ' + st.verdict);

      /* ── on ajoute une roche, pour éprouver la nouvelle primitive ── */
      A.ajouterElement('rocheEssai');
      A.vider();
      A.ajouter('roche');
      A.ajouterModif('dispersion');
      A.el().pile[0].n = 9;
      A.salir();
      log('roche dispersée : ' + A.stats().parts + ' parts, '
          + A.stats().triangles + ' triangles');

      /* ── écriture, deux fois : ajout puis remplacement ── */
      /* Chaque etape rapporte son propre echec. Une seule chaine avec un
         `catch` en bout de course dirait « ca a rate » sans dire lequel — et
         c'est justement ce qui rend un test de bout en bout inexploitable. */
      function choisirParNom(nom){
        for(var i=0;i<A.biblio.elements.length;i++)
          if(A.biblio.elements[i].nom === nom){ A.choisirElement(i); return true; }
        erreurs.push('element introuvable dans la bibliotheque : ' + nom);
        return false;
      }
      function pas(titre, promesse, suite){
        return promesse.then(suite, function(err){
          var m = (err && err.message) || String(err);
          erreurs.push(titre + ' : ' + m);
          log(titre + ' : ECHEC - ' + m);
          rapporter();
        });
      }

      choisirParNom('rocheEssai');

      pas('ecriture 1', P.ecrireProp('rocheEssai', A.versCode()), function(r1){
        log('ecriture 1 : ' + r1.action + ' - ' + r1.lignes + ' lignes'
            + (r1.sauvegarde ? ' - sauvegarde' : ' - PAS DE SAUVEGARDE'));
        if(r1.action !== 'ajout' + '\u00e9')
          erreurs.push('la premiere ecriture aurait du ajouter');
        A.el().pile[0].n = 3; A.salir();

        pas('ecriture 2', P.ecrireProp('rocheEssai', A.versCode()), function(r2){
          log('ecriture 2 : ' + r2.action + '   (doit valoir remplace)');
          if(r2.action.indexOf('remplac') !== 0)
            erreurs.push('la seconde ecriture a ajoute au lieu de remplacer');
          if(!choisirParNom('barreauxEssai')){ rapporter(); return; }

          pas('ecriture 3', P.ecrireProp('barreauxEssai', A.versCode()),
          function(r3){
            log('ecriture 3 : ' + r3.action + ' - barreauxEssai');

            pas('liste', P.listerProps(), function(noms){
              log('props.js contient ' + noms.length + ' case');
              log('rocheEssai present    : ' + (noms.indexOf('rocheEssai') >= 0));
              log('barreauxEssai present : ' + (noms.indexOf('barreauxEssai') >= 0));
              if(noms.indexOf('rocheEssai') < 0) erreurs.push('rocheEssai absent');
              if(noms.indexOf('barreauxEssai') < 0) erreurs.push('barreauxEssai absent');

              /* ── le dernier maillon : semer dans les biomes ── */
              pas('semer', P.semer('rocheEssai', [0, 1], 2), function(rs){
                log('semis : ' + rs.action + ' dans biomes '
                    + JSON.stringify(rs.biomes));

                pas('relire biomes', P.biomes(), function(bs){
                  var compte = bs.map(function(b){
                    return b.props.filter(function(p){
                      return p === 'rocheEssai'; }).length; });
                  log('occurrences par biome : ' + JSON.stringify(compte));
                  if(compte[0] !== 2 || compte[1] !== 2)
                    erreurs.push("le semis n a pas pose 2 occurrences");
                  if(compte[2] !== 0)
                    erreurs.push('le semis a debordé sur un biome non demande');

                  /* le refus attendu : un nom qui sortirait du fichier */
                  var vilain = "case '../mechant': {}";
                  P.ecrireProp('../mechant', vilain).then(
                    function(){ erreurs.push('un nom invalide a ete accepte');
                                rapporter(); },
                    function(err){ log('nom invalide refuse : '
                                       + String(err.message).slice(0, 60));
                                   rapporter(); });
                });
              });
            });
          });
        });
      });
    }
  }

  function rapporter(){
    if(fini) return; fini = true;
    var d = document.createElement('div');
    d.id = 'RES';
    d.textContent = JSON.stringify({lignes:res, erreurs:erreurs, images:images});
    document.body.appendChild(d);
  }
  setTimeout(rapporter, 60000);
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
    from lanceur import serveur

    tmp = Path(tempfile.mkdtemp(prefix="pont_"))
    bac = tmp / "projet"
    shutil.copytree(RACINE, bac, ignore=shutil.ignore_patterns(
        "application", "build", ".git", "__pycache__", "archives",
        ".sauvegardes", "cartes"))
    print("  bac à sable :", bac)

    # une page jumelle de editeur.html avec le harnais devant les modules
    page = (bac / "editeur.html").read_text(encoding="utf-8")
    page = page.replace("</head>", SCENARIO + "</head>")
    page = page.replace('src="src/editeur/editeur.js"',
                        'src="src/editeur/editeur.js?debug"')
    (bac / "_smoke_pont.html").write_text(page, encoding="utf-8")

    # `?debug` sur l'URL déclenche exposer() dans editeur.js
    url, arreter = serveur.demarrer(bac)
    print("  serveur :", url)

    props0 = (bac / "src/monde/props.js").read_text(encoding="utf-8")

    profil = tmp / "profil"
    try:
        p = subprocess.run(
            [navigateur(), "--headless=new", "--disable-gpu",
             "--user-data-dir=" + str(profil), "--no-first-run",
             "--virtual-time-budget=45000", "--dump-dom",
             "--enable-logging=stderr", "--log-level=0",
             url + "/_smoke_pont.html?debug"],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=180)
        dom = p.stdout
    finally:
        arreter()

    m = re.search(r'<div id="RES">(.*?)</div>', dom, re.S)
    if not m:
        # Une faute de syntaxe dans le scénario ne produit RIEN : ni rapport,
        # ni message, juste un DOM muet. La console du navigateur, elle, le
        # dit en une ligne — encore faut-il la demander.
        console = [l for l in (p.stderr or "").splitlines()
                   if "CONSOLE" in l or "Uncaught" in l]
        if console:
            print("\n  La page n'a rien rapporté. La console du navigateur dit :\n")
            for l in console[:12]:
                i = l.find("]")
                print("    " + (l[i + 1:] if i > 0 else l).strip()[:220])
        else:
            print("\n  Aucun rapport, et la console est muette. Extrait du DOM :\n")
            print(dom[:1800])
        shutil.rmtree(tmp, ignore_errors=True)
        sys.exit(1)

    R = json.loads(m.group(1).replace("&quot;", '"').replace("&amp;", "&")
                   .replace("&lt;", "<").replace("&gt;", ">"))

    print()
    print("  LA FORGE ÉCRIT-ELLE DANS LE JEU ?")
    print()
    for l in R["lignes"]:
        print("    " + l)

    # ── ce que le disque dit, indépendamment de ce que la page raconte ──
    props1 = (bac / "src/monde/props.js").read_text(encoding="utf-8")
    print()
    print("    props.js : %d → %d octets" % (len(props0), len(props1)))

    soucis = list(R["erreurs"])
    for attendu in ("case 'rocheEssai'", "case 'barreauxEssai'",
                    "roche:[", "composé dans la forge"):
        if attendu not in props1:
            soucis.append("props.js ne contient pas : " + attendu)
    if props1.count("{") != props1.count("}"):
        soucis.append("accolades déséquilibrées dans props.js")

    sauv = sorted((bac / ".sauvegardes").glob("*.bak")) \
        if (bac / ".sauvegardes").is_dir() else []
    print("    sauvegardes créées : %d" % len(sauv))
    if not sauv:
        soucis.append("aucune sauvegarde avant écriture")

    biomes1 = (bac / "src/monde/biomes.js").read_text(encoding="utf-8")
    print("    biomes.js  : %d occurrences de rocheEssai"
          % biomes1.count("'rocheEssai'"))
    if biomes1.count("'rocheEssai'") != 4:
        soucis.append("biomes.js ne porte pas les 4 occurrences attendues")

    # ── et le fichier est-il toujours chargeable ? ──
    v = subprocess.run([sys.executable, "outils/syntaxe.py"], cwd=str(bac),
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace")
    ok_syntaxe = "équilibrés" in (v.stdout or "")
    print("    syntaxe après écriture : " + ("ok" if ok_syntaxe else "CASSÉE"))
    if not ok_syntaxe:
        soucis.append("props.js n'est plus équilibré")
        print(v.stdout[-800:])

    shutil.rmtree(tmp, ignore_errors=True)

    print()
    if soucis:
        print("  ✗  %d problème(s) :" % len(soucis))
        for x in soucis:
            print("      " + x)
        sys.exit(1)
    print("  ✓  la forge écrit dans le jeu, et le jeu reste valide.")


if __name__ == "__main__":
    main()
