# Le Défi Boréal — V3

**Nouvelle version jouable : `v3/index.html`.** Voir [changements V3](docs/V3.md), [mécaniques](docs/MECHANICS-V3.md), [décor](docs/SCENERY-V3.md) et [tests](docs/TESTS-V3.md). La V2.1 reste disponible à `current/index.html`, sans modification.

`npm run dev` sert le dépôt ; sélectionner `/v3/index.html`. `npm run test:v3` exécute les tests V3. Archive déployable : `dist/defi-boreal-v3-jouable.zip`. Archive complète : `dist/defi-boreal-v3-projet.zip`. Aucun backend ni récompense actif.

## Documentation de la V2.1 conservée

Jeu HTML5 autonome des Boréalistes, modifié à partir de la V2 fournie. Voir [audit](docs/AUDIT.md), [plan](docs/PLAN.md), [architecture des récompenses](docs/REWARDS_ARCHITECTURE.md), [direction artistique](docs/ART_DIRECTION.md) et [journal](CHANGELOG.md).

## Lancer

Depuis `/workspace/minijeux` : `npm run dev` (Python 3 requis). Entrée du jeu : `/current/index.html`, port 8000. En local, ouvrir cette entrée dans le navigateur. En cloud, les requêtes locales servent à la vérification interne ; aucune prévisualisation publique n'est fournie.

Aucune dépendance réseau ni variable d'environnement n'est nécessaire au jeu. Paramètres actuels centralisés dans CONFIG dans `current/index.html`. Il ne faut pas exposer le score local comme preuve admissible à une récompense.

## Tests

Node.js et Python 3, puis `npm ci --ignore-scripts` et `npm test`. Playwright 1.62.1 est verrouillé dans package-lock.json. Dans l'environnement cloud, Chromium est installé à `/usr/bin/chromium` ; ailleurs fournir `CHROMIUM_PATH` vers un Chromium installé. Le test lance son propre serveur sur le port 8765, puis le ferme. Ne pas utiliser ce port pour un autre service pendant le test. Captures sous `artifacts/`. Les hooks d'inspection sont injectés dans la réponse de test uniquement, jamais dans le HTML de production.

24 contrôles Chromium réussis ; ce sont des tests sur navigateur avec viewport mobile, pas une validation sur téléphone physique. Le contrôle de trajectoire échoue sur la référence non corrigée (`REFERENCE=versions/v2-reference.html npm test`).

## Préservation

`versions/v1-reference.html`, `versions/v2-reference.html` et `versions/v2-before-stabilisation-2026-10-12.html` restent inchangés. Le ZIP original est conservé dans les pièces jointes de l'espace de travail. Avant une nouvelle modification, sauvegarder `current/index.html` et enregistrer la modification dans Git. L'environnement est déjà isolé : utiliser le checkout existant sans créer de worktree, sauf demande explicite.

## Déploiement de cette étape

`dist/defi-boreal-v2.1-stabilisation.zip` contient le frontend statique uniquement, avec index.html à sa racine. Décompresser et héberger son contenu sur Netlify ou un hébergement statique équivalent. Aucun build requis. Ce ZIP n'inclut pas de backend ou de récompenses. Aucun déploiement externe n'a été effectué.

Le ZIP projet séparé contient sources, références, documentation, tests et captures, sans node_modules ni secrets. La V2.1 couvre l’audit et la stabilisation. La V3 ajoute les graphismes, la vitesse et le générateur décrits dans docs/V3.md ; backend, codes QR et portails restent hors de cette étape. Voir le plan pour les décisions commerciales avant production.
