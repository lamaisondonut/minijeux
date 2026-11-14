# Chargement du Worker Cloudflare Pages

## Diagnostic

Le journal distant signale `Object.defineProperty called on non-object` pendant la publication de la Function, avec des avertissements `node:stream` et `node:events`. L'erreur survient donc avant le traitement d'une partie ou une opération D1.

L'ancien `_worker.js` contenait des modules `unenv` et `@cloudflare/unenv-preset` initialisant `performance`, `console` et `process`, avec deux imports externes Node. Ils provenaient de la compilation Wrangler, pas du serveur métier : `server/`, `functions/` et le moteur partagé utilisent uniquement les API Web/Workers, dont `fetch`, Web Crypto, les cookies et la liaison D1. Aucun SDK Twilio ou package d'exécution Node n'est nécessaire.

La compilation utilisait la date `2026-11-14`. Depuis `2026-08-04`, cette date active implicitement les compatibilités Node dans Wrangler. Le projet Pages distant peut avoir une date plus ancienne et des drapeaux différents ; le fichier précompilé ne transporte pas automatiquement ces réglages. L'ancien test Pages recompilait en outre le Worker dans un environnement local récent, ce qui masquait cet écart.

Le chargement direct de l'ancien fichier, sans recompilation et sans Node, échoue avec `No such module "node:stream"`. Cela confirme la dépendance accidentelle et l'écart de configuration. Le message fourni ne comporte pas de pile : le destinataire exact du `Object.defineProperty` distant ne peut pas être identifié avec certitude à partir de cette seule ligne. Il ne faut pas attribuer sans preuve cette ligne à une transaction D1 ou à une bibliothèque métier.

## Correction

La génération impose désormais **`no_nodejs_compat` et `no_nodejs_compat_v2`** pour empêcher l'injection des couches Node, puis refuse tout artefact qui en dépend encore. Le Worker versionné ne contient plus ces imports ni ces initialisations. Sa taille passe de 61 696 à 48 873 octets. Aucun changement du moteur de jeu, du SQL ou du parcours des gains.

`nodejs_compat` n'est **pas nécessaire au Worker corrigé**. Une ancienne configuration Node v1 ne suffit d’ailleurs pas au précédent artefact : le test indépendant échoue alors sur `getBuiltinModule`. Node v2 le charge, mais maintenir cette dépendance de compilation ne se justifie pas pour cette application.

## Tests

`npm run test:pages` charge maintenant le module exact dans workerd **sans le recompiler**, avec sept configurations : dates `2022-11-30`, `2024-09-23` et `2026-08-03` sans Node ; date `2026-11-14` avec les deux drapeaux négatifs ; date récente par défaut ; dates `2024-01-01` et `2024-09-23` avec `nodejs_compat`. Le statut public, le passage aux fichiers statiques et le refus des accès privés sont vérifiés.

Le test complet Pages avec migration D1 locale et Chromium utilise aussi les drapeaux explicitement. Les sept chargements, le statut sûr, les routes privées et la partie d'entraînement réussissent. La CI vérifie que l'artefact généré correspond à la source versionnée.

## Paramètres Cloudflare manuels

Pour ce correctif de chargement, aucun nouveau secret, aucune liaison et aucune activation de Node ne sont requis : déployer la branche **`develop/noel-recompenses-v1` en prévisualisation**, avec le dossier publié `v3`. Ne pas changer `livraison-v3`, les réglages Production ni la branche de production.

Pour reproduire exactement la configuration de compilation avec une date `2026-08-04` ou plus récente, les réglages **Preview** peuvent utiliser `no_nodejs_compat` et `no_nodejs_compat_v2`, après retrait de tout drapeau positif contradictoire. L'exemple `wrangler.preview.example.jsonc` les contient. Ces réglages ne sont pas nécessaires pour charger le fichier corrigé sur une ancienne date sans Node. Ne pas ajouter un fichier Wrangler réel au déploiement sans vérifier les liaisons et paramètres existants : il peut devenir leur source de vérité.

Le parcours de gains réels exige toujours la D1 de prévisualisation et ses migrations, les comptes Access, Turnstile, les secrets et l'approbation du fournisseur SMS. Ces éléments ne sont pas activés par le correctif ; sans eux, le jeu reste jouable en entraînement et l'administration demeure fermée. Voir [configuration complète](RECOMPENSES-CLOUDFLARE.md).

Références : [compatibilité Node Cloudflare](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) ; [configuration Pages](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).
