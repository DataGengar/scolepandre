#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMOKE_AUDIO — le son sort-il vraiment, et à quoi ressemble-t-il ?

    python outils/smoke_audio.py
    python outils/smoke_audio.py --drone cathedrale --secondes 25

L'audio n'avait JAMAIS été vérifié dans ce projet. Tous les tests simulent
WebGL et laissent l'AudioContext se créer sans jamais l'écouter : un drone
muet, saturé, ou bloqué sur une seule note passait sans un mot.

Chrome headless sait faire du vrai Web Audio. On branche donc un analyseur sur
la sortie, on laisse tourner en temps réel, et on MESURE :

  · le niveau — un moteur muet se reconnaît à son RMS, pas à sa promesse ;
  · l'écrêtage — combien d'échantillons touchent le plafond. Au-delà de
    quelques pour mille, ça sature, et Orlando l'avait déjà signalé une fois ;
  · le CENTRE DE GRAVITÉ SPECTRAL — en hertz. C'est lui qui dit si un drone
    est grave. La demande était « deux octaves plus bas » : c'est vérifiable,
    et le chiffre doit être divisé par quatre par rapport aux fréquences
    relevées ;
  · les ATTAQUES — combien de notes se déclenchent par minute. Zéro veut dire
    que l'arpège ne tourne pas ; une cadence trop régulière s'entend comme une
    horloge ;
  · le RECOUVREMENT — combien de notes sonnent en même temps. C'est LA
    propriété du moteur repris de SessionMasterTauri : deux ou trois notes se
    recouvrent en permanence, et c'est ce recouvrement qui fait la matière.
    S'il tombe à un, on a un métronome, pas une nappe.
"""

import argparse
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
import time
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


PAGE = """<!doctype html><meta charset="utf-8"><body><pre id="o">…</pre>
<script type="module">
import {A, construire, volume, reprendre} from '/src/audio/contexte.js';
import {DRONES, demarrerNappe, changerNappe, nomNappe} from '/src/audio/nappes.js';
import {SETUP} from '/src/setup.js';

const erreurs = [], notes = [];
window.addEventListener('error', e => erreurs.push(e.message));

function mesurer(){
  const ctx = construire();
  volume(SETUP.audio.volume);
  reprendre();

  /* On écoute la sortie AVANT le destination : un analyseur branché sur le
     limiteur voit exactement ce qui part aux haut-parleurs. */
  const an = ctx.createAnalyser();
  an.fftSize = 4096;
  an.smoothingTimeConstant = 0;
  A.ecreteur.connect(an);

  const temps = new Float32Array(an.fftSize);
  const spectre = new Float32Array(an.frequencyBinCount);
  const parBin = ctx.sampleRate / an.fftSize;

  const releves = [];
  demarrerNappe(DRONE_VOULU);

  const t0 = performance.now();
  const horloge = setInterval(() => {
    an.getFloatTimeDomainData(temps);
    an.getFloatFrequencyData(spectre);

    let somme = 0, crete = 0, ecrete = 0;
    for(let i = 0; i < temps.length; i++){
      const v = temps[i];
      somme += v*v;
      const a = Math.abs(v);
      if(a > crete) crete = a;
      if(a > 0.985) ecrete++;
    }

    /* Centre de gravité spectral, en Hz. Les valeurs sont en dB : on repasse
       en amplitude, sinon les bins silencieux (−200 dB) pèsent autant que les
       autres et le résultat n'a aucun sens. */
    let num = 0, den = 0, basse = 0, totale = 0;
    for(let k = 1; k < spectre.length; k++){
      const amp = Math.pow(10, spectre[k] / 20);
      const hz = k * parBin;
      num += hz * amp; den += amp;
      totale += amp;
      if(hz < 120) basse += amp;
    }

    releves.push({
      rms: Math.sqrt(somme / temps.length),
      crete, ecrete,
      centre: den > 0 ? num / den : 0,
      partBasse: totale > 0 ? basse / totale : 0,
      t: (performance.now() - t0) / 1000,
    });

    if(performance.now() - t0 > SECONDES * 1000){
      clearInterval(horloge);
      rapporter(releves, ctx);
    }
  }, 60);
}

function rapporter(releves, ctx){
  const col = c => releves.map(r => r[c]);
  const moy = c => col(c).reduce((a,b) => a+b, 0) / releves.length;
  const max = c => Math.max.apply(null, col(c));

  /* Les ATTAQUES : une note qui démarre fait monter le RMS d'un coup. On
     compte les montées franches, ce qui donne la cadence de l'arpège sans
     avoir à instrumenter le moteur. */
  const rms = col('rms');
  let attaques = 0;
  for(let i = 2; i < rms.length; i++){
    const av = (rms[i-2] + rms[i-1]) / 2;
    if(av > 1e-6 && rms[i] > av * 1.22 && rms[i] > 0.004) attaques++;
  }

  const dureeVraie = releves[releves.length-1].t;

  document.getElementById('o').textContent = 'RES';
  fetch('/_audio', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      drone: nomNappe(),
      sampleRate: ctx.sampleRate,
      etat: ctx.state,
      releves: releves.length,
      duree: +dureeVraie.toFixed(1),
      rmsMoyen: +moy('rms').toFixed(5),
      rmsMax: +max('rms').toFixed(5),
      cretemax: +max('crete').toFixed(4),
      echantillonsEcretes: col('ecrete').reduce((a,b)=>a+b,0),
      echantillonsTotal: releves.length * 4096,
      centreHz: +moy('centre').toFixed(1),
      partBasse: +moy('partBasse').toFixed(3),
      attaquesParMinute: +(attaques / dureeVraie * 60).toFixed(1),
      erreurs,
    })});
}

try{ mesurer(); }
catch(e){
  fetch('/_audio', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({erreurs:[String(e && e.stack || e)]})});
}
</script></body>"""


class Serveur(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        corps = self.rfile.read(n).decode("utf-8", "replace")
        self.send_response(204)
        self.end_headers()
        try:
            recu.update(json.loads(corps))
        except json.JSONDecodeError as e:
            recu.update({"erreurs": ["JSON illisible : %s" % e]})
        arrive.set()


def navigateur():
    for c in NAVIGATEURS:
        if Path(c).is_file():
            return c
    print("Ni Chrome ni Edge trouvés.")
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--drone", default="caverne")
    ap.add_argument("--secondes", type=int, default=20)
    a = ap.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="audio_"))
    bac = tmp / "jeu"
    shutil.copytree(RACINE, bac, ignore=shutil.ignore_patterns(
        "application", "build", ".git", "__pycache__", "archives",
        ".sauvegardes", "apercus", "cartes"))
    (bac / "_audio.html").write_text(
        PAGE.replace("DRONE_VOULU", "'%s'" % a.drone)
            .replace("SECONDES", str(a.secondes)), encoding="utf-8")

    h = functools.partial(Serveur, directory=str(bac))

    class S(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    srv = S(("127.0.0.1", PORT), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    recu.clear()
    arrive.clear()
    proc = subprocess.Popen(
        [navigateur(), "--headless=new", "--disable-gpu",
         "--user-data-dir=" + str(tmp / "p"), "--no-first-run",
         # sans ça, l'AudioContext reste suspendu : pas de geste utilisateur
         "--autoplay-policy=no-user-gesture-required",
         "http://127.0.0.1:%d/_audio.html" % PORT],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    ok = arrive.wait(timeout=a.secondes + 90)
    proc.kill()
    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

    if not ok:
        print("\n  Rien reçu — la page n'a pas répondu.")
        sys.exit(1)

    d = recu
    print()
    print("  ON ÉCOUTE LE DRONE  ·  %s" % d.get("drone", "?"))
    print()
    if d.get("erreurs"):
        for e in d["erreurs"][:6]:
            print("    ERREUR  " + str(e)[:200])
        if not d.get("releves"):
            sys.exit(1)

    pctEcrete = (100.0 * d["echantillonsEcretes"] / max(1, d["echantillonsTotal"]))
    LIGNES = [
        ("contexte audio",        "%s à %d Hz" % (d["etat"], d["sampleRate"])),
        ("durée écoutée",         "%.1f s  (%d relevés)" % (d["duree"], d["releves"])),
        ("",                      ""),
        ("niveau moyen (RMS)",    "%.5f" % d["rmsMoyen"]),
        ("niveau crête",          "%.4f" % d["cretemax"]),
        ("échantillons écrêtés",  "%.4f %%" % pctEcrete),
        ("",                      ""),
        ("centre spectral",       "%.0f Hz" % d["centreHz"]),
        ("part sous 120 Hz",      "%.0f %%" % (d["partBasse"] * 100)),
        ("attaques par minute",   "%.0f" % d["attaquesParMinute"]),
    ]
    for k, v in LIGNES:
        print("    %-24s %s" % (k, v))

    print()
    soucis = []
    if d["rmsMoyen"] < 0.0015:
        soucis.append("le drone est MUET, ou presque (RMS %.5f)" % d["rmsMoyen"])
    if d["cretemax"] > 0.999:
        soucis.append("la sortie touche le plafond : ça sature")
    if pctEcrete > 0.5:
        soucis.append("%.2f %% d'échantillons écrêtés" % pctEcrete)
    if d["attaquesParMinute"] < 8:
        soucis.append("l'arpège ne tourne pas (%.0f attaques/min)"
                      % d["attaquesParMinute"])
    if d["centreHz"] > 900:
        soucis.append("centre spectral à %.0f Hz : ce n'est pas un drone grave"
                      % d["centreHz"])

    if soucis:
        print("  ✗  %d problème(s) :" % len(soucis))
        for s in soucis:
            print("      " + s)
        sys.exit(1)
    print("  ✓  le drone sonne, il est grave, il ne sature pas, et il bouge.")


if __name__ == "__main__":
    main()
