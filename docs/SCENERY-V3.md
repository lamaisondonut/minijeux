# Décor jouable de la V3

Le module `v3/scenery.js` compose un panorama pixel art original et neuf plans. Le fond n’est pas une capture de la maquette : ce sont deux nouvelles illustrations, générées pour le projet et inspectées avant intégration, une portrait et une paysage. Elles reprennent la lumière rose du couchant, les aurores vertes, les montagnes enneigées, le lac et la densité de la forêt québécoise. Elles ne contiennent ni personnage, ni texte, ni marque additionnelle. La largeur complète du Canvas est effacée à chaque image et chaque orientation utilise son illustration sans étirer les proportions ni laisser de marges.

Les épinettes sont trois nouveaux sprites originaux générés dans un atlas transparent, inspectés, puis rasterisés une fois en petites images natives. Leurs branches irrégulières, aiguilles en petits groupes, ombres, reflets et écorce remplacent les anciens triangles. Les fougères, arbustes à petits fruits, chevreuil, écureuil, hibou et oiseau sont des sprites raster originaux produits par le module puis mis en cache. Aucun de ces détails n’est recalculé dans la boucle d’affichage. Les sprites sont agrandis sans interpolation.

| Plan | Vitesse relative au monde |
| --- | ---: |
| Ciel et panorama | 0,008 (déplacement limité) |
| Étoiles et aurores | 0,018 |
| Épinettes lointaines | 0,075 |
| Reflets du lac | 0,11 |
| Rive et sous-bois | 0,18 |
| Conifères proches | 0,28 |
| Faune décorative | 0,37 |
| Sentier et aiguilles | 0,72 |
| Fougères et fleurs | 0,91 |

Le panorama contient les montagnes et le lac ; ces éléments ne sont pas des fichiers transparents indépendants. Les plans de parallaxe transparents sont superposés au panorama. Le sentier est aligné sur le sol physique du moteur, et les fougères du premier plan restent sous cette ligne afin de ne pas cacher les obstacles. Les animaux sont décoratifs et ne participent pas aux collisions.

Interface : `BorealScenery.draw(ctx, {width, height, ground, world, time})`. Le moteur appelle ce dessin avant les objets et Jacques. `ready` résout le chargement du panorama et rejette la promesse si le fichier manque ; `loaded` et `error` exposent son état. Le moteur désactive alors le démarrage et affiche une erreur. Un fond coloré permet uniquement de garder l’écran d’accueil lisible pendant le chargement ; il n’est pas présenté comme un décor validé.

Sources éditables : `v3/scenery.js`. Illustrations : `v3/assets/forest-panorama.png` (1024 × 1536 PNG), `v3/assets/forest-landscape.png` (1536 × 1024 PNG) et `v3/assets/forest-trees.png` (1536 × 1024 PNG RGBA transparent). Aucun graphique tiers n’a été importé. `v3/assets/forest-sprites.png` est l’export PNG 512 × 256 des sprites végétaux et animaux ; `BorealScenery.atlas()` régénère cette planche sans modifier le jeu. Les illustrations originales conservent leurs pixels ; le Canvas ne lisse ni les sprites ni les décors.

La couleur et la composition restent à valider avec les prochaines références photographiques et l’usage sur téléphone physique ; les captures du jeu établissent l’intégration, pas une validation artistique définitive par le commanditaire.
