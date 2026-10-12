# Vérification du jeu V3

La suite est exécutée avec le vrai HTML, les scripts et les images de `v3/`, servis localement à Chromium par Playwright. Commande depuis la racine :

```sh
node tests/v3-browser.cjs
```

Le serveur de test écoute uniquement sur `127.0.0.1:8766`. `CHROMIUM_PATH` peut désigner un autre binaire Chromium installé. Les dépendances Playwright sont celles du projet.

## Périmètre

- Chargement asynchrone des images et activation du bouton Jouer seulement après leur disponibilité.
- Découpage par rectangles complets et silhouettes isolées, sans pieds/bras rognés par une grille indicative.
- Affichage du personnage par `drawImage` à partir de son atlas PNG et changement effectif des frames de course.
- Plusieurs frames réellement dessinées pour chacun des états course, saut, double saut, descente et collision.
- États course, saut, double saut, descente et collision réellement transmis au renderer du jeu.
- Neuf plans de décor, défilement observé des fougères plus rapide que celui des arbres lointains et repeinture complète de chaque image en paysage.
- Commandes tactiles et clavier, limitation à deux sauts, refus du troisième saut et recharge après atterrissage.
- Franchissement des obstacles avec les sauts nécessaires, progression du score, bonus de collecte, combos et expiration.
- Pause, reprise, retour au menu, redémarrage, perte de focus, titres et persistance du record local.
- Physique et score à 30, 60 et 120 pas d’affichage par seconde ; redimensionnement pendant un saut.
- Rendu en 390 × 844, 320 × 568 et 844 × 390 pixels CSS.
- Ressource Jacques volontairement indisponible : message explicite, démarrage bloqué et récupération par rechargement après rétablissement de l’image.
- Absence d’erreur JavaScript et d’appel à un backend ou service externe pendant les scénarios normaux.

## Captures

Les images dans `artifacts/v3/` proviennent du véritable Canvas du jeu rendu dans Chromium. Elles ne sont pas des maquettes ni des compositions ajoutées après le test. Les menus, le jeu en course et la pause sont capturés pendant l’exécution normale. Les captures de saut, double saut, descente et collision utilisent le même moteur, avec un temps de simulation contrôlé pour capturer la bonne pose.

`collision-mobile.png` montre l’écran de fin réel. `collision-sprite-mobile.png` masque uniquement le panneau de fin dans la page de test afin d’examiner le sprite de collision derrière celui-ci. Le panneau reste présent dans la version jouable.

Pour ces scénarios déterministes, le test injecte un accès aux variables de la fermeture dans sa seule réponse HTTP et interrompt les rappels automatiques d’affichage. Le HTML livré ne contient aucun accès de test. Les événements tactiles et clavier utilisent les handlers du jeu.

## Résultats

**56 contrôles réussis** sur la V3 intégrée, avec Chromium 154.0.8037.57. Le résultat détaillé de la dernière exécution réussie est enregistré dans `artifacts/v3/results.json`.

Sur 90 intervalles d’affichage mesurés, le débit observé est d’environ 60 images/s, avec un intervalle médian d’environ 16,7 ms. Il s’agit d’une mesure Chromium headless dans cet environnement.

La première inspection visuelle a révélé des traces d’anciennes images dans les côtés de la scène en paysage. Le renderer repeint désormais l’intégralité du Canvas. Le test compare tous les pixels d’un décor initial à ceux du même décor après un déplacement aller-retour : les deux images sont identiques. La nouvelle capture paysage a aussi été inspectée visuellement sans traces.

## Limites

Cette validation utilise Chromium headless sous Linux. Elle ne constitue pas une validation sur iPhone, Safari iOS ou téléphone Android physique. La mesure du débit d’affichage indique seulement le comportement observé dans cet environnement ; elle ne promet pas un débit identique sur les appareils des joueurs. Les tests vérifient le chargement et les états d’animation. L’atlas a été réalisé avec la photo de Jacques fournie pendant cette étape ; sa ressemblance artistique reste à valider par revue visuelle.
