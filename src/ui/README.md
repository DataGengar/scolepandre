# ui/ — l'interface

| fichier | rôle |
|---|---|
| `menu.js` | le voile, ses onglets, l'écran de chargement |
| `hud.js` | bandeau du bas, objectif, **jauge de chaleur** |
| `reglages.js` | le panneau de réglages, construit tout seul |

## Ajouter un réglage

Une ligne dans `CURSEURS` (`src/setup.js`) et c'est fini : le curseur apparaît,
lit et écrit dans `SETUP`, et les modules abonnés réagissent. En v2 il fallait
modifier trois endroits, qui pouvaient diverger.
