# joueur/ — toi

| fichier | à ouvrir pour… |
|---|---|
| `joueur.js` | déplacement, collision, traces d'odeur et vibrations |
| `froid.js` | **la règle du froid**, écrite en toutes lettres en tête |
| `chute.js` | chute sismique, chute de falaise, chute dans le vide |
| `torche.js` | autonomie, combustible, braseros |
| `leurres.js` | lancer, vol, impact |

## La règle du froid, en une ligne

    perte/s = base(biome) × exposition × mouvement × torche × géothermie

Quatre paliers : **—**, **ENGOURDI** (70), **GELÉ** (40), **HYPOTHERMIE** (15).
Chacun a sa vitesse, son champ de vision, son souffle audible (qui te rend
REPÉRABLE) et son tremblement de main.

**Descendre réchauffe** (géothermie). C'est le pivot de l'équilibrage : les
cartes rares sont au fond, et il y fait plus chaud. Le froid ne combat donc pas
la collection — il combat l'hésitation.

Tout est réglable dans `SETUP.froid`.
