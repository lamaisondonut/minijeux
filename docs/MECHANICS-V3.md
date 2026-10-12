# Mécaniques V3 : vitesse et obstacles

La V3 conserve les impulsions du moteur V2 (`-565`, puis `-510` px/s), la gravité de `1520` px/s² et les **deux sauts maximum par atterrissage**. Le score, les combos, les titres et le record local restent gérés par le moteur existant. Aucun backend ni aucune attribution de récompense ne sont ajoutés.

## Réglages

- Vitesse initiale : **315 px/s**, soit +31,25 % par rapport aux 240 px/s de la V2. Plafond : **530 px/s**. Progression inchangée : `min(530, 315 + 2.8 × sqrt(score))`.
- Simulation conservée à **1/120 s**. Le corps de collision mesure maintenant **32 × 72 px**, avec la marge de collision existante de 5 px, pour suivre la silhouette du sprite V3. Cette boîte demeure une approximation rectangulaire du personnage.
- Les variantes arrivent aux scores 900, 1800 et 2700 pour apporter plus tôt de la diversité. Les tout premiers obstacles restent une roche ou une bûche.
- Chaque obstacle reste **isolé** : aucun mur d'obstacles, empilement ni combinaison serrée de branche et de souche.

| Obstacle | Largeur × hauteur | Placement | Franchissement testé |
| --- | --- | --- | --- |
| Roche | 36 × 30 px | Posée au sol | Un saut |
| Bûche | 58 × 38 px | Posée au sol | Un saut |
| Souche | 36 × 58 px | Posée au sol | Un saut |
| Tronc haut (`type: stump`, `variant: high`) | 46 × 126 px | Posé au sol | Double saut nécessaire |
| Branche | 72 × 19 px | Haut à `sol - 125 px` | Passer en courant dessous |

La branche laisse 34 px entre son bord inférieur et le haut du corps debout. Sauter volontairement dans une branche peut toujours provoquer une collision. Le tronc haut est remplacé par une souche normale lorsque la largeur du jeu est inférieure à 320 px, car il apparaîtrait trop tard à l'écran.

## Espacement et collectibles

Le délai après chaque création est :

```text
nextSpawn = (530 / vitesseCourante) × 1.5 + 0.12 + aléatoire × 0.22
```

La vitesse ne diminue pas au cours d'une partie. L'objet précédent parcourt donc au minimum `vitesseCourante × nextSpawn` avant la création du suivant. Même si la vitesse monte ensuite immédiatement au plafond, la séparation correspond à **au moins 1,5 seconde de déplacement au plafond**. Le supplément aléatoire ajoute une marge et évite un rythme totalement mécanique. Le délai est d'environ 2,64–2,86 secondes à la vitesse initiale et 1,62–1,84 seconde au plafond. Les obstacles restent suffisamment espacés pour atterrir et retrouver les deux sauts avant le suivant avec la politique de franchissement testée.

`recommendCollectibleY()` peut remplacer le placement vertical de la V2. Il renvoie `null` près d'une branche ou d'un tronc haut pour ne pas pousser le joueur à sauter dans une branche ou à poursuivre un objet risqué. Sinon, une baie est placée 86–110 px au-dessus du sol et une planche 138–172 px. La planche en hauteur conserve une utilité au deuxième saut. Les collectibles se déplacent à la même vitesse que les obstacles : leur séparation horizontale reste constante.

## Vérification reproductible

Commande indépendante :

```sh
node tests/mechanics-v3.cjs
```

Résultat : **740 assertions réussies**. La simulation reprend l'ordre d'intégration du jeu et sa collision AABB avec marge, avec le corps V3 de 32 × 72 px.

- 90 traversées individuelles : les cinq types aux vitesses 315, 340, 380, 430, 480 et 530 px/s, avec une variation de déclenchement de ±25 ms.
- 25 paires ordonnées : chaque type suivi de chaque autre, au plafond de vitesse, avec seulement la séparation minimale garantie de 795 px.
- 600 obstacles générés : cinq graines reproductibles, 120 objets chacune ; accélération de 80 px/s² jusqu'au plafond, supérieure à la progression liée au temps seul. Tous passent avec la politique testée, sans collision ni saut demandé avant l'atterrissage précédent.
- Le tronc haut échoue avec un seul saut à chacune des six vitesses et passe avec deux. Un troisième saut est refusé ; l'atterrissage remet le compteur à zéro. Le générateur est reproductible, les valeurs restent dans les bornes et les objets incitant à sauter près d'une branche sont supprimés.

La politique de test déclenche le premier saut environ 230 ms avant le début du chevauchement horizontal pour les obstacles bas. Pour le tronc haut, elle commence environ 380 ms avant le chevauchement et effectue le second saut 230 ms après le premier. Une branche est franchie sans sauter. Ces paramètres servent **uniquement aux tests**, sans pilotage automatique intégré au jeu livré.

Ces vérifications prouvent l'existence de trajectoires franchissables pour les cas testés. Elles ne prouvent pas que toute décision du joueur réussit, ni que l'équilibrage est idéal pour chaque niveau d'habileté. Les tests utilisent une largeur logique de 390 px pour les séries générées ; ils vérifient également le retrait du tronc haut à 280 px. La réactivité tactile, la silhouette de collision perçue et la difficulté demandent encore des essais de jeu humains sur téléphone. Les captures et contrôles de navigateur sont effectués séparément par la suite de validation V3.

## Intégration

Charger `mechanics.js` avant le script du jeu, fusionner `BorealMechanics.config` dans les paramètres V2, puis utiliser `config.playerWidth`/`config.playerHeight` pour le corps du joueur. `nextObstacle({width, ground, score, speed})` renvoie `{obstacle, nextSpawn}` ; le moteur ajoute cet obstacle et réinitialise son compteur de création au délai retourné. Le dessin du tronc haut doit utiliser ses dimensions réelles et une silhouette distincte. Si `recommendCollectibleY()` renvoie `null`, reporter seulement la création du collectible en conservant le prochain délai habituel.

Le module n'ajoute aucune API de débogage à la version jouable. Les graines et les outils de simulation sont utilisés dans le fichier de test uniquement.
