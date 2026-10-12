# Audit initial — Le Défi Boréal

## Référence et sauvegarde

Archive reçue : `defi-boreal-projet-maitre.zip`, SHA-256 `7fc896bedab526d912af90cc50c5a785e2c381049518778e13a67cb3dd8f78d2`.
Le README désigne `current/index.html` comme V2. Son contenu est identique à `versions/v2-reference.html`. La V1 est antérieure ; la V2 enrichit le décor, le menu et l'indicateur de double saut. Copie préalable supplémentaire : `versions/v2-before-stabilisation-2026-10-12.html`. Les deux références originales sont conservées sans changement. Le dépôt Git était initialement sans commit ; aucun historique antérieur n'a été inventé.

## Moteur et dépendances

Application HTML autonome : CSS et JavaScript dans `current/index.html`, Canvas 2D, boucle requestAnimationFrame, collisions AABB, génération aléatoire d'obstacles et collectibles, progression du score, combos, six titres, record localStorage. Aucun asset externe, backend, bibliothèque de jeu, authentification ou service distant. Police Cocogoose nommée dans CSS, mais aucun fichier de police fourni ; repli système effectif. Aucun fichier photo ou maquette fourni. Aucune référence Firebarns relevée dans la V2.

Le score augmente de 22 points par seconde simulée. Une baie vaut 50, une planche 125, plus 25 × min(combo, 5), y compris la première récolte. Le combo expire après 2,7 secondes sans récolte. Le premier et second sauts utilisent -565 et -510 pixels/seconde, avec gravité 1520 pixels/seconde². La vitesse est min(520, 240 + 2,8 × racine(score)). Le niveau d'obstacles monte tous les 1800 points, plafonné à 3. Ces règles existantes sont maintenant centralisées sans rééquilibrage commercial arbitraire.

## Constats et corrections de stabilisation

| Constat | Risque | Traitement |
|---|---|---|
| Euler avec dt variable | trajectoires différentes à 30/60/120 Hz | simulation à pas fixe 1/120 s |
| Plafond de dt à 34 ms | ralentissement sous charge | rattrapage limité à 100 ms, pause en arrière-plan |
| Redimensionnement déplace seulement le sol | obstacles flottants, saut déplacé | translation verticale cohérente joueur/objets/particules |
| Dimensions virtuelles minimales 280×420 | dessin tronqué sur petite hauteur | dimensions réelles du canvas |
| Onglet masqué ou focus perdu | partie continue sans joueur | pause explicite, reprise manuelle |
| Record local accepte Infinity/négatif/fraction | affichage invalide | entier sûr non négatif uniquement |
| Menus trop grands en paysage | boutons inaccessibles | overlays défilants sur petite hauteur |
| Zoom interdit dans viewport | accessibilité réduite | suppression de user-scalable=no |

Le rattrapage est borné pour éviter une spirale de calcul : de longues interruptions n'avancent pas intégralement le monde. Cela reste un jeu local, pas une horloge ni une preuve de score serveur.

## Écarts restant à traiter

- Jacques : matrice rudimentaire et jambes en rectangles, sans atlas professionnel ni animations d'états. La stabilisation ne prétend pas satisfaire la refonte artistique.
- Décor : formes vectorielles, rectangles et quelques éléments pixelisés ; montagnes et ciel ne constituent pas un ensemble de sprites homogène.
- Obstacles : génération aléatoire avec espacement temporel, sans preuve de franchissabilité des combinaisons. Les branches peuvent traverser la trajectoire d'un saut.
- Hitbox : marge uniforme de 5 pixels, différente du dessin visible ; calibration graphique nécessaire après intégration des sprites.
- Vitesse initiale : 240 conservée pour isoler la stabilisation. L'augmentation demandée doit être testée avec le nouveau générateur.
- Records et scores entièrement modifiables côté client. Ils ne doivent autoriser aucune récompense.
- Récompenses, codes QR, portails, authentification, SQL et statistiques absents. Aucune attribution commerciale active.
- Rendu à valider sur appareils physiques iOS/Android ; viewport mobile Chromium ne suffit pas à cette affirmation.
- Aucun budget de performance mesuré, aucun test multi-navigateur, aucune longue session d'équilibrage à ce stade.

## Validation effectuée

Chromium système, véritable navigateur headless avec écran tactile émulé 390×844. Chargement, guide, menu, progression et pause testés par actions DOM. États internes examinés via instrumentation de la réponse HTTP de test uniquement ; aucun accès de debug ajouté au jeu livré. Premier saut, double saut, troisième saut refusé, atterrissage, collecte, combo, expiration, collision, redémarrage, six seuils, comparaison 30/60/120 Hz, redimensionnement 844×390, perte de focus et record Infinity vérifiés. 24 contrôles réussis après correction. La référence V2 échoue sur la comparaison de trajectoire entre fréquences ; cette régression est donc discriminante.

Captures `artifacts/menu-mobile.png` et `artifacts/jeu-mobile.png` produites par la session réelle. Aucun système de récompenses n'a été testé : il n'existe pas encore. Les données de test sont locales et ne représentent pas des statistiques du restaurant.
