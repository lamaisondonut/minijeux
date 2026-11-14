# Le Défi Boréal — Édition de Noël et récompenses

Développement sur `develop/noel-recompenses-v1`, depuis Noël `080fe40`. La production `livraison-v3` reste séparée.

Le menu officiel fourni par GOAT est intégré. Le jeu conserve Jacques, ses images et animations de Noël, les obstacles et le double saut. Les récompenses nécessitent une partie rejouée et validée par le serveur, puis une vérification SMS ; aucun compte n’est requis avant de jouer.

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

- [Configuration Cloudflare, comptes employés et décisions avant activation](docs/RECOMPENSES-CLOUDFLARE.md)
- [API et paramètres](docs/API-RECOMPENSES.md)
- [Tests et limites](docs/TESTS-RECOMPENSES.md)
- [Procédure simple pour le personnel](docs/PROCEDURE-EMPLOYES.md)
- [Projet de règlement et confidentialité](v3/reglement.html)
- [Provenance exacte des logos fournis](docs/BRANDING-PROVENANCE.json)

Publier le **dossier `v3`**, avec son Worker généré, ses modules et ses images. L’ancien HTML autonome V3 reste une archive du jeu antérieur : il ne contient pas ce serveur et ne convient pas aux récompenses sécurisées.

Les gains restent désactivés tant que les services, les règles et le fournisseur SMS n’ont pas été approuvés et configurés. Ne pas fusionner cette branche ni publier en production sans validation du propriétaire.
