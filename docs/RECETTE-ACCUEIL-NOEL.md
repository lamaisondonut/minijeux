# Accueil Noël — recette du 15 novembre 2026

L’accueil privilégie le téléphone : bouton JOUER visible au chargement, actions
secondaires regroupées, règlement détaillé dans une modale. La limite d’une
récompense par personne tous les 30 jours demeure affichée avant de jouer.
Le mode et le rabais maximal proposés restent issus du statut public existant.

## Isolation du changement

- `menu-noel.css` compose l’accueil sur la fenêtre entière, avec des dispositions
  distinctes pour téléphone, tablette et écran large.
- `menu-noel-scene.js` dessine exclusivement le décor de l’accueil, Jacques et le
  traîneau original à six rennes, avec le nez rouge animé. Il respecte la
  préférence de réduction des animations.
- Le canvas de partie conserve sa largeur habituelle, limitée à 620 px. Le moteur,
  les collisions, les sauts, les ressources originales, les règles, le client des
  récompenses, le Worker, les migrations et l’administration ne sont pas modifiés.
- Les boutons existants gardent leurs identifiants et leurs gestionnaires. Le
  panneau de récupération couvre également toute la fenêtre depuis l’accueil.
- La modale du règlement gère le focus, Tab, Maj+Tab, Échap et le retour au bouton.

## Vérifications exécutées localement

Chromium, avec les ressources du dépôt. Pour les parcours de récompense, les
réponses des API sont simulées dans les tests : aucune récompense réelle ni
aucun SMS n’est émis par cette recette.

| Suite | Résultat |
| --- | --- |
| `node tests/mechanics-v3.cjs` | 740 assertions réussies |
| `node tests/noel-browser.cjs` | 138 contrôles réussis |
| `node tests/noel-home.test.cjs` | 174 contrôles réussis |
| `node tests/home-responsive.test.cjs` | 1002 contrôles réussis |
| `node tests/rewards-client-browser.cjs` | 137 contrôles réussis |
| `node tests/branding.test.cjs` | Réussite : logos originaux, couleurs, signature |

La suite responsive couvre 320×480, 320×568, 360×640, 375×667, 390×500,
390×844, 844×390, 820×1180, 1024×768, 1440×900 et 1920×1080. Chaque format
est vérifié en mode libre, récompenses et extrême : bouton principal entièrement
visible avant défilement, absence de débordement horizontal, règlement accessible,
plafond proposé et paliers inchangés, aucun formulaire personnel avant le jeu.
Les 44 captures et les mesures sont enregistrées dans
`$BOREAL_HOME_ARTIFACTS` (par défaut `/tmp/boreal-home-responsive`).

Les autres suites vérifient aussi les états de Jacques, les obstacles, les sauts,
la pause, les ressources manquantes, les six rennes et le nez rouge. Le test de
récupération sur grand écran vérifie que les clics derrière son panneau sont
bloqués et ne peuvent pas démarrer une partie.

## Publication

Branche de prévisualisation : `develop/noel-budget-configurable`.
Adresse existante : <https://develop-noel-budget-configur.minijeux-4gy.pages.dev/>.
La production `livraison-v3` est exclue de cette livraison.

`npm run test:noel` inclut désormais la suite responsive. GitHub Actions conserve
ses captures avec les autres résultats Noël. Ces essais locaux ne remplacent pas
une vérification sur les appareils physiques du restaurant.
