# creatures/ — les bêtes

| fichier | à ouvrir pour… |
|---|---|
| `etats.js` | les six états de la mère (lus par trois modules) |
| `mere.js` | son IA : perception, décision, déplacement |
| `jeunes.js` | les petits, et le correctif de blocage |
| `directeur.js` | la pression et les zones de patrouille |
| `lueurs.js` | **yeux, pattes, interstices** — la grammaire de la terreur |
| `geometrie.js` | le maillage, reconstruit à chaque image |

## La grammaire des yeux

C'est un signal de jeu, donc une règle constante, définie dans
`SETUP.creature.yeux` :

| état | couleur | taille | ce que ça dit |
|---|---|---|---|
| traque / retrait | rouge sombre | ×1.0 | elle ne sait pas où tu es |
| écoute | rouge **fixe**, sans pulsation | ×1.0 | elle s'est arrêtée, elle écoute |
| approche / fouille | rouge vif, pulsation lente | ×1.3 | elle a une piste |
| poursuite | orange-blanc, pulsation rapide | ×2.2 | **elle arrive** |

Les yeux sont injectés dans le tableau de lumières du rendu : ils produisent
donc des godrays rouges dans le fog et se voient bien avant la silhouette.

Les **interstices** de carapace pulsent au repos (leurre à proies) et
**s'éteignent** en poursuite : l'extinction est le signal d'attaque.

## Les jeunes qui se bloquaient

Quatre causes distinctes, toutes corrigées — le détail est en tête de
`jeunes.js`. Le filet final est un détecteur de blocage : aucun jeune ne peut
rester immobile plus de 2,5 s.
