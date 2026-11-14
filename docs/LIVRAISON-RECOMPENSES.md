# Livraison de développement — 14 novembre 2026

Code sauvegardé sur [`develop/noel-recompenses-v1`](https://github.com/lamaisondonut/minijeux/tree/develop/noel-recompenses-v1), depuis `edition-noel` / `080fe40`. [Pull request brouillon nº 1](https://github.com/lamaisondonut/minijeux/pull/1), sans fusion. La branche de production `livraison-v3` reste à `080fe40`.

## Livré et vérifié

Menu et logos officiels, moteur partagé et relecture serveur, migrations D1, réservations atomiques du budget et d’un premier SMS, codes uniques, règle glissante de téléphone, administration privée, audit, CSV et procédure de remise Lightspeed manuelle. Les tests des récompenses et de Noël passent localement et dans GitHub Actions ; [détails](TESTS-RECOMPENSES.md).

Le dossier à publier reste **`v3`**. Les sources Functions sont compilées dans `v3/_worker.js`, vérifié dans le véritable moteur Cloudflare local. L’ancien HTML autonome ne comprend pas ce backend.

## Prévisualisation distante déployée

Le correctif `6a9454e` supprime les couches Node injectées inutilement par la compilation. Cloudflare confirme désormais la publication réussie des fichiers et de la Function.

- [Prévisualisation de la branche](https://develop-noel-recompenses-v1.minijeux-4gy.pages.dev/)
- [Déploiement précis du correctif](https://796cd2d0.minijeux-4gy.pages.dev/)
- [État Cloudflare du déploiement](https://dash.cloudflare.com/?to=/2d2a4ebb6477b2a2a128e12d87e36cd4/pages/view/minijeux/796cd2d0-d6e7-48c2-8de5-74174d4778f6)

Le Worker exact charge sans recompilation sur sept configurations workerd, avec et sans Node. Le jeu et les routes privées ont été vérifiés dans le navigateur contre Pages/D1 local. L'accès HTTP direct à `*.pages.dev` depuis l'environnement de travail est bloqué par son proxy réseau ; la réussite distante est confirmée par le contrôle Cloudflare dans GitHub. Aucune navigation publique réussie n'est revendiquée depuis cet environnement.

Les échecs initiaux sont conservés comme historique dans le [diagnostic du Worker](CORRECTIF-WORKER.md). Aucun changement manuel de `nodejs_compat` n'est nécessaire au fichier corrigé. La production reste inchangée.

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
