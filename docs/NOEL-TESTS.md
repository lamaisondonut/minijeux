# Vérification de l’édition Noël

Depuis la racine du dépôt :

```sh
node tests/noel-browser.cjs
```

La suite lance le vrai HTML de `v3/` dans Chromium avec Playwright. Le serveur temporaire écoute uniquement sur `127.0.0.1:8767` et s’arrête à la fin. `CHROMIUM_PATH` permet de choisir un autre binaire Chromium ; la valeur par défaut est `/usr/bin/chromium`.

## Contrôles

- Empreintes SHA-256 des trois modules V3 et des six assets originaux, figées au commit `106dfa8` ; les originaux doivent rester strictement identiques.
- Empreintes de quatorze fonctions originales du moteur : saut, physique, collisions, génération, score, pause, redimensionnement, animation et navigation.
- Atlas Noël distinct de 24 silhouettes, toutes avec la tenue rouge, dont la pose de réserve 23 ; mêmes cadences, boucles et séquences d’animation. Les sept états sont observés dans le vrai moteur et dessinent plusieurs frames PNG.
- Parties réelles en 390 × 844 et 1366 × 768 pixels CSS ; contrôles supplémentaires en 320 × 568 et 844 × 390.
- Commandes clavier et tactiles, deux sauts, refus du troisième, recharge à l’atterrissage, cinq variantes d’obstacles, souche haute nécessitant deux sauts et branche franchissable au sol.
- Score de progression, bonus exacts 50/125, combo +25 plafonné à cinq, expiration du combo, six titres, meilleur score local, pause/reprise, perte de focus, rotation et indépendance de la fréquence d’affichage.
- Décor original conservé avec ses neuf vitesses de parallaxe, trois plans de neige et un budget de 84 flocons. Les dessins d’hiver sont réutilisés en cache, sans création de Canvas à chaque image.
- Deux fonds de Noël distincts remplacent les fonds d’été via la carte de ressources prévue par le loader original. Le test vérifie leurs dimensions identiques aux originaux, les requêtes réelles et leur dessin dans les Canvas portrait et paysage. Les fichiers originaux restent inchangés et leurs PNG de fond ne sont pas demandés pendant la partie.
- Repeinture complète de la scène, vérifiée par comparaison de tous les pixels après un déplacement aller-retour à temps identique.
- Quatre collectibles festifs dessinés réellement à 1,3× autour du même centre, sans changement des objets logiques, des boîtes 18 × 18 / 29 × 16 ou des points.
- Les pixels visibles des quatre glyphes touchent les quatre bords de leurs caches, sans marge transparente. Cent vingt dessins réemploient ces mêmes caches sans créer de Canvas.
- Absence d’erreur JavaScript et de requête vers un backend, un service de récompenses ou tout autre domaine externe pendant les parties normales.
- Dix ressources Noël volontairement bloquées, une par scénario : cinq scripts, atlas PNG, métadonnées JSON, deux fonds d’hiver PNG et image du traîneau. Le démarrage est désactivé, une erreur apparaît et le rechargement fonctionne après rétablissement de chaque ressource.

Les tests déterministes ajoutent leur accès au moteur dans la seule réponse HTTP de test et bloquent les rappels automatiques d’affichage. Le jeu livré ne contient aucun accès de test. Les événements clavier et tactiles passent par les handlers réels.

## Captures et résultats

`artifacts/noel/` contient les captures issues de Chromium et `results.json` contient la liste des contrôles réussis, la version du navigateur, les dimensions testées et la mesure du rythme d’affichage.

Dernière exécution intégrée : **137 contrôles réussis**, Chromium **154.0.8037.57**. Sur 90 intervalles, le rythme observé est d’environ **60 images/s**, avec une médiane et un 95e centile de **16,7 ms** dans cet environnement. Les neuf fichiers originaux et les quatorze fonctions contrôlées conservent leurs empreintes exactes. Les captures du menu, de la course et du paysage ont été revues : les nouveaux fonds montrent une forêt et des rives enneigées.

Les vues du menu, de la course et du bureau viennent de l’exécution normale. Les poses de saut, double saut, descente et collision utilisent le vrai moteur à temps contrôlé. Pour examiner la silhouette de collision, une capture masque seulement le panneau de fin dans la page de test. `jacques-noel-24-poses.png` assemble les 24 silhouettes isolées du vrai atlas PNG saisonnier, avec leur numéro et leur état ; ce montage de revue est distinct des captures de partie.

## Menu agrandi et traîneau

```sh
node tests/noel-home.test.cjs
```

Cette suite complémentaire réussit **66 contrôles**. Elle utilise un serveur local temporaire sur `127.0.0.1:8768` et conserve ses captures et mesures dans `artifacts/noel-home/`.

- Menus en 390 × 844, 320 × 568, 620 × 900 et 844 × 390 pixels CSS ; mesure de la silhouette opaque réellement dessinée après transformation du Canvas.
- Jacques entièrement visible, sans chevauchement du titre ou des boutons. En 390 × 844, sa silhouette mesure environ 152 pixels de haut à 1,9× et ses pieds sont à 426 pixels, contre 1,45× et 287 pixels précédemment.
- Échelle de Jacques en partie inchangée. Neuf fichiers originaux et quatorze fonctions du moteur conservent leurs empreintes.
- Les deux poses de l’ancien oiseau sont entièrement transparentes ; le décor réel dessine le nouveau traîneau mis en cache.
- Le PNG a été inspecté visuellement : exactement six rennes distincts devant le Père Noël, sans découpe visible des bois, du traîneau ou du museau de tête. La déclaration `reindeerCount` ne remplace pas cette revue visuelle.
- La pause conserve la même empreinte SHA-256 de tous les pixels du Canvas pendant 250 ms dans les quatre dimensions. La reprise fonctionne.
- Soixante dessins du décor et du traîneau ne créent ni image, ni Canvas, ni OffscreenCanvas.
- Script et PNG du traîneau bloqués volontairement : erreur explicite, démarrage bloqué et récupération après rétablissement.

Le traîneau est une décoration du décor : il peut passer derrière les éléments du menu sur les petites hauteurs. Les accès au moteur employés par cette suite sont injectés dans la seule réponse HTTP de test.

## Limites

Chromium headless sous Linux est utilisé. Aucun iPhone, Safari iOS ou téléphone Android physique n’a été testé. L’émulation d’une vue mobile ne remplace pas un test sur appareil. Le rythme d’affichage mesuré décrit cet environnement uniquement. La ressemblance artistique et la qualité du costume restent soumises à la revue visuelle.

Le contrôle du nez de Nez rouge compare réellement ses pixels entre la phase
claire et la phase sombre, vérifie sa position sur le renne de tête et contrôle
la désactivation du mouvement et de la pulsation si les animations sont réduites.
