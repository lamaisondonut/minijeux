# Activer les véritables récompenses

État au 14 novembre 2026 : développement sur `develop/noel-recompenses-v1`. La liaison à une D1 distante, les comptes employés et les services SMS réels ne sont pas vérifiés depuis cet environnement, qui ne dispose pas des accès Cloudflare et Twilio nécessaires. La production actuelle reste sur `livraison-v3`. Aucune dépense ni publication en production n'est autorisée par ce guide.

## Adresses

| Destination | Adresse |
|---|---|
| Prévisualisation de la branche | https://develop-noel-recompenses-v1.minijeux-4gy.pages.dev/ |
| Administration de prévisualisation | https://develop-noel-recompenses-v1.minijeux-4gy.pages.dev/admin |
| Administration après publication finale autorisée | https://minijeux-4gy.pages.dev/admin |

Ces adresses identifient les destinations prévues; elles ne prouvent pas qu'elles servent les changements locaux ni que les récompenses y sont activées.

## Ce qui reste à fournir ou à autoriser

Les accès au projet Cloudflare Pages **`minijeux`** et au compte Twilio Verify permettent à l'agent d'effectuer la liaison, la migration, le déploiement de prévisualisation et l'ajout des employés. L'exploitant fournit les comptes nominatifs, les décisions légales et les autorisations de dépenses; il n'a pas à écrire du SQL ou à modifier le code.

| Service | Réglage exact dans l'environnement **Preview** |
|---|---|
| Origine | `APP_ORIGIN=https://develop-noel-recompenses-v1.minijeux-4gy.pages.dev`, sans barre oblique finale. Utiliser cet alias pour les parties et leur confirmation. |
| Base D1 | Base dédiée de prévisualisation, liaison **`DB`**; appliquer `migrations/0001_rewards.sql` et vérifier toutes les tables, colonnes et protections attendues. Ne pas charger de gagnants fictifs. |
| Accès employés | Application Cloudflare Access couvrant `/admin*` et `/api/admin/*`, comptes individuels et authentification multifacteur; renseigner `ACCESS_TEAM_DOMAIN` et `ACCESS_AUD`. Ajouter les identités Access vérifiées à la liste D1 des employés actifs, avec nom et rôle `staff` ou `manager`. Protéger aussi les autres alias publiés. |
| Turnstile | Widget autorisant l'hôte de prévisualisation; `TURNSTILE_SITE_KEY` public et `TURNSTILE_SECRET` serveur du même widget. Le serveur exige l'action `boreal-session`. |
| Vérification SMS | `SMS_PROVIDER=twilio`; compte et service Verify réels, restrictions géographiques et protections contre la fraude adaptées. Secrets serveur : `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. |
| Protection du registre | `REWARDS_HMAC_SECRET` aléatoire d'au moins 32 octets et 32 caractères. `SMS_CHALLENGE_SECRET` distinct d'au moins 32 octets facultatif. Conserver ces valeurs dans les secrets Cloudflare. |
| Coût SMS | Choisir explicitement `SMS_DAILY_LIMIT` entre `1` et `100`, après approbation des coûts. Ce quota inclut les emplacements réservés et suit le jour d'allocation à Toronto; il ne plafonne pas à lui seul la facturation du fournisseur. |
| Autorisations | Garder `REWARDS_ENABLED=false`, `SMS_APPROVED=false` et `TERMS_APPROVED=false` pendant la préparation. Aucune valeur réelle n'a été inventée dans le dépôt. |

La relecture d'une partie peut dépasser la capacité CPU d'un environnement gratuit : les mesures locales sous Node sont de **14 à 28 ms**, et Cloudflare documente **10 ms de CPU par requête pour Workers Free** dans ses [limites officielles](https://developers.cloudflare.com/workers/platform/limits/). Il faut confirmer la limite réellement applicable aux Functions Pages et mesurer le Worker déployé, puis valider une capacité adaptée **avant d'ouvrir les gains**. Ces mesures Node ne prédisent pas exactement le temps Cloudflare. Aucun changement de forfait ni paiement ne doit être engagé sans accord.

## Ordre de mise en service

1. **Préparer uniquement Preview.** Avec les accès autorisés, l'agent configure les services du tableau, applique le schéma D1, ajoute les employés et publie la branche existante. Les trois autorisations restent à `false`. Après toute modification des liaisons ou variables Cloudflare, redéployer la prévisualisation. Le jeu doit rester jouable sans gain et l'administration doit refuser un visiteur anonyme.
2. **Constater la liaison réelle.** Un responsable connecté ouvre [le diagnostic privé](https://develop-noel-recompenses-v1.minijeux-4gy.pages.dev/api/admin/setup). Il faut obtenir `database.connected=true`, `database.schemaReady=true` et des listes d'éléments manquants vides. Dans `configuration`, `originConfigured`, `hmacConfigured`, `turnstileConfigured` et `smsProviderConfigured` doivent être vrais. Les approbations, `smsConfigured` et `rewardsConfigured` restent faux pendant cette préparation. Le diagnostic ne révèle aucun secret; `providerVerification: "not_performed"` signifie que Turnstile et Twilio n'ont pas été testés. Il ne prouve ni l'envoi d'un SMS ni l'attribution d'un code.
3. **Finaliser le règlement public.** Confirmer les [renseignements indispensables](RENSEIGNEMENTS-LEGAUX.md), les publier dans le règlement et appliquer les modalités de confidentialité décidées. L'approbation humaine se traduit ensuite par `TERMS_APPROVED=true`. Confirmer aussi la capacité CPU et les coûts SMS avant `SMS_APPROVED=true`. Garder `REWARDS_ENABLED=false` jusqu'à l'accord d'ouverture.
4. **Valider le parcours réel autorisé en Preview.** Après accord explicite pour les SMS et les véritables gains de cet essai, passer `REWARDS_ENABLED=true`, redéployer et contrôler le diagnostic. Effectuer un départ avec Turnstile réel, une partie admissible et une confirmation SMS réelle. Vérifier que le code apparaît dans le registre D1 via l'administration, que le budget est débité une seule fois et que la confirmation se retrouve dans le navigateur du joueur. Cet essai attribue une vraie récompense et consomme du quota; il n'existe pas de mode de faux gain. Ne marquer un code comme utilisé qu'au moment d'une vraie remise suivant la [procédure employés](PROCEDURE-EMPLOYES.md).
5. **Faire valider la prévisualisation.** Conserver la preuve du déploiement, du diagnostic, du parcours réel et des limites de fonctionnement. Une configuration complète ne suffit pas à déclarer les services testés. Suspendre les nouveaux gains si un contrôle essentiel échoue; les bons déjà attribués restent des engagements à traiter.
6. **Publier seulement après l'autorisation du propriétaire.** Préparer les paramètres et la D1 de production, les comptes Access et les clés autorisées pour l'hôte `minijeux-4gy.pages.dev`; `APP_ORIGIN` devient exactement `https://minijeux-4gy.pages.dev`. Garder les trois autorisations à `false` pendant cette préparation et ne pas transférer de données d'essai. Après autorisation de publication et vérification en production, appliquer les approbations puis `REWARDS_ENABLED=true` en dernier. Le personnel utilise alors l'adresse d'administration de production du tableau.

Les dates de début et de fin de la promotion doivent correspondre à l'ouverture et à la fermeture effectivement opérées : aucun calendrier automatique de campagne n'est configuré. Le contrôle de répétition repose sur un numéro vérifié, sans prouver l'identité d'une personne; la procédure de contestation doit en tenir compte.

## Fichiers réellement publiés

Le dossier de publication Cloudflare Pages est **`v3`**. Modifier puis tester ces fichiers, et reconstruire le Worker après un changement serveur ou du moteur partagé.

| Fonction | Source utilisée |
|---|---|
| Jeu et menu de Noël | `v3/index.html`, `v3/menu-recompenses.js`; Jacques, décors et animations dans les modules et `v3/assets/` existants |
| Partie validée et SMS | `v3/rewards-client.js`, moteur partagé `v3/game-session-engine.mjs` |
| Règlement et confidentialité | `v3/reglement.html` |
| Administration | `v3/admin/index.html`, `v3/admin/admin.js`, `v3/admin/admin.css` |
| API, sécurité et données | `server/api.mjs`, `server/store.mjs`, `server/auth.mjs`, `server/sms.mjs`, `server/setup.mjs`, `server/common.mjs`; entrées `functions/[[path]].js` et `functions/_middleware.js` |
| Worker publié | `v3/_worker.js`, produit par `npm run build:pages`; routage `v3/_routes.json` et en-têtes `v3/_headers` |
| Schéma et exemple de configuration | `migrations/0001_rewards.sql`, `wrangler.preview.example.jsonc` — exemple à compléter, pas une configuration déjà appliquée |

Les anciens fichiers autonomes et les documents d'architecture historiques ne constituent pas le système de récompenses déployable. Les détails du contrat serveur figurent dans [API et paramètres](API-RECOMPENSES.md).
