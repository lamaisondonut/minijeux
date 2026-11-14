# Livraison de développement — 14 novembre 2026

Code sauvegardé sur [`develop/noel-recompenses-v1`](https://github.com/lamaisondonut/minijeux/tree/develop/noel-recompenses-v1), depuis `edition-noel` / `080fe40`. [Pull request brouillon nº 1](https://github.com/lamaisondonut/minijeux/pull/1), sans fusion. La branche de production `livraison-v3` reste à `080fe40`.

## Livré et vérifié

Menu et logos officiels, moteur partagé et relecture serveur, migrations D1, réservations atomiques du budget et d’un premier SMS, codes uniques, règle glissante de téléphone, administration privée, audit, CSV et procédure de remise Lightspeed manuelle. Les tests des récompenses et de Noël passent localement et dans GitHub Actions ; [détails](TESTS-RECOMPENSES.md).

Le dossier à publier reste **`v3`**. Les sources Functions sont compilées dans `v3/_worker.js`, vérifié dans le véritable moteur Cloudflare local. L’ancien HTML autonome ne comprend pas ce backend.

## Prévisualisation distante : échec à diagnostiquer

La tentative automatique Cloudflare Pages du commit `0114369` a échoué. GitHub retourne seulement « Deploy failed », sans le motif ni les journaux détaillés. Aucun lien public fonctionnel de cette version n’est confirmé.

[Ouvrir le journal privé du déploiement](https://dash.cloudflare.com/?to=/2d2a4ebb6477b2a2a128e12d87e36cd4/pages/view/minijeux/289a24cc-f036-48c9-a0e0-f74f1ab5c38b).

Un opérateur ayant accès au compte Cloudflare doit transmettre le message d’erreur de ce journal pour corriger précisément le déploiement. Ne pas attribuer cet échec à D1 ou au fournisseur SMS sans consulter le journal. L’environnement de travail ne possède pas d’identité ou de secrets du compte Cloudflare permettant de lire ce journal, créer D1, lier Access ou configurer les secrets distants.

Pour essayer localement le menu et l’entraînement :

```sh
npm ci --ignore-scripts
npm run build:pages
npx wrangler pages dev v3 --port 8788
```

Ouvrir `http://localhost:8788/`. Sans services configurés, la réponse de statut est `pending`, le jeu n’offre aucun gain et `/admin/` reste fermé.

## Avant les gains réels

Configurer une **D1 de prévisualisation**, les comptes employés nominatifs Access, Turnstile et les secrets serveur selon [le guide exact](RECOMPENSES-CLOUDFLARE.md). Faire approuver le fournisseur SMS et ses coûts, finaliser les règles, l’admissibilité, la confidentialité et la politique anti-abus. L’unicité technique d’un téléphone ne garantit pas l’unicité d’une personne.

Les trois drapeaux d’approbation restent désactivés. La recette sur les vrais services de prévisualisation et l’approbation explicite du propriétaire restent nécessaires avant toute publication en production.
