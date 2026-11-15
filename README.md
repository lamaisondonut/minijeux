**Développement récompenses alimentaires (15 novembre 2026) :** voir [budget configurable, exceptions, administration, SQL et SMS](docs/AUDIT-BUDGET-CONFIGURABLE.md). Branche `develop/noel-budget-configurable`, gains désactivés, production inchangée.

# Le Défi Boréal — Édition de Noël et récompenses

Développement sur `develop/noel-recompenses-v1`, depuis Noël `080fe40`. La production `livraison-v3` reste séparée.

Le menu officiel fourni par GOAT est intégré. Le jeu conserve Jacques, ses images et animations de Noël, les obstacles et le double saut. Les récompenses nécessitent une partie rejouée et validée par le serveur, puis une vérification SMS ; aucun compte n’est requis avant de jouer.

Prévisualisation de la branche : https://develop-noel-recompenses-v1.minijeux-4gy.pages.dev/ · Administration : https://develop-noel-recompenses-v1.minijeux-4gy.pages.dev/admin. Ces adresses ne prouvent pas que les changements locaux sont publiés ni que les services sont actifs. Après publication finale autorisée, l'administration sera disponible sur https://minijeux-4gy.pages.dev/admin.

**La mise en service réelle reste bloquée par les accès et réglages Cloudflare/Twilio, la vérification de la capacité CPU et les renseignements légaux à confirmer. Aucune liaison à une D1 distante n'est démontrée depuis cet environnement.** Le [guide d'activation](docs/ACTIVATION-RECOMPENSES.md) précise les opérations restantes et les preuves à recueillir. La production actuelle n'est pas modifiée.

## Essayer et vérifier

Node.js 24, Python 3 et Chromium sont nécessaires aux tests.

```sh
npm ci --ignore-scripts
npm run build:pages
npm run test:rewards
npm run test:noel
```

Définir `CHROMIUM_PATH` si Chromium n’est pas installé dans `/usr/bin/chromium` (par exemple le chemin de `require('playwright').chromium.executablePath()`). `npm run test:pages` applique la migration à un D1 local temporaire et teste le véritable Worker Pages dans le navigateur.

Sans D1, secrets et approbations, la prévisualisation propose uniquement l’entraînement, sans gain ; `/admin/` refuse les accès. Les tests des récompenses utilisent de vraies transactions SQLite et des fournisseurs externes simulés dans les tests uniquement. Aucun SMS payant n’est envoyé par les tests.

## Configurer

- [Guide opérateur : adresses, réglages manquants et ordre d'activation](docs/ACTIVATION-RECOMPENSES.md)
- [Configuration Cloudflare, comptes employés et décisions avant activation](docs/RECOMPENSES-CLOUDFLARE.md)
- [Renseignements légaux indispensables à confirmer](docs/RENSEIGNEMENTS-LEGAUX.md)
- [API et paramètres](docs/API-RECOMPENSES.md)
- [Tests et limites](docs/TESTS-RECOMPENSES.md)
- [Procédure simple pour le personnel](docs/PROCEDURE-EMPLOYES.md)
- [Projet de règlement et confidentialité](v3/reglement.html)
- [Provenance exacte des logos fournis](docs/BRANDING-PROVENANCE.json)

Publier le **dossier `v3`**, avec son Worker généré, ses modules et ses images. L’ancien HTML autonome V3 reste une archive du jeu antérieur : il ne contient pas ce serveur et ne convient pas aux récompenses sécurisées.

Les sources réellement servies sont `v3/index.html` (jeu), `v3/menu-recompenses.js` (menu), `v3/rewards-client.js` (confirmation), `v3/reglement.html` et `v3/admin/`. `npm run build:pages` compile `server/`, `functions/` et le moteur partagé dans `v3/_worker.js`. La [cartographie complète](docs/ACTIVATION-RECOMPENSES.md#fichiers-réellement-publiés) identifie le schéma et le routage.

Les gains restent désactivés tant que les services, les règles et le fournisseur SMS n’ont pas été approuvés et configurés. Ne pas fusionner cette branche ni publier en production sans validation du propriétaire.
