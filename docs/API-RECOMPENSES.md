# API Récompenses

Le backend est fourni dans `functions/`, `server/` et `migrations/0001_rewards.sql`. Aucun service payant ni déploiement de production n’est activé. La migration doit être appliquée à une D1 dédiée avant activation. Le moteur partagé `v3/game-session-engine.mjs` détermine tous les scores depuis la graine, les sauts et les redimensionnements ; aucun score envoyé par le navigateur n’est accepté comme preuve.

## Configuration

Bindings et variables : `DB`, `APP_ORIGIN` (origine HTTPS exacte), `REWARDS_ENABLED`, `SMS_APPROVED`, `TERMS_APPROVED`, `SMS_PROVIDER=twilio`, `SMS_DAILY_LIMIT` (entier explicite de 1 à 100), `TURNSTILE_SITE_KEY`, `ACCESS_TEAM_DOMAIN` (`equipe.cloudflareaccess.com`) et `ACCESS_AUD`.

Secrets : `REWARDS_HMAC_SECRET` (au moins 32 octets), `TURNSTILE_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. `SMS_CHALLENGE_SECRET` est facultatif (au moins 32 octets) ; sinon la clé HMAC sert aussi à signer les défis. Les trois autorisations doivent être exactement `true`. Turnstile doit utiliser l’action `boreal-session` et le nom d’hôte de `APP_ORIGIN`.

Les employés sont provisionnés dans `employees(sub,email,name,role,active)` à partir de leur identité Access vérifiée. `role` vaut `staff` ou `manager`. `/api/admin/identity` donne au seul utilisateur son `sub` et son `email` vérifiés, même avant ajout à cette liste. L’email d’un simple en-tête n’est jamais une identité.

## Contrat public

Toutes les réponses privées sont `Cache-Control: no-store`. Toutes les écritures exigent du JSON (128 Kio maximum), une origine exacte et des métadonnées Fetch compatibles. Le cookie propriétaire est `__Host-rewards-owner`, Secure, HttpOnly, SameSite=Strict, Path=/.

- `GET /api/rewards/status` : `mode` (`rewards`, `extreme`, `pending`), `rewardsEnabled`, `tiers`, `capCents` si disponible, `policyVersion`, `turnstileSiteKey`, `reason` éventuelle. Aucun solde interne n’est public.
- `POST /api/games/start` : `{width,height,expectedMode,turnstileToken?}` → `{sessionId,seed,width,height,mode,engineVersion,capCents,expiresAt,policyVersion,requiresModeConfirmation}`. Le mode et le plafond annoncés doivent être confirmés avant simulation si différents de l’offre affichée.
- `POST /api/games/finish` : `{sessionId,ticks,jumps,resizes}` → `{score,eligible,mode,capCents,claimDeadline?}`. Les ticks sont à 120 Hz, au maximum 108000. Une partie doit être réellement terminée. Une réponse déjà calculée reste identique.
- `POST /api/rewards/sms/request` : `{sessionId,phone,firstName,lastName,consentVersion}` → `{challengeId,expiresAt}`. `consentVersion` vaut `rewards-2026-11-v1`.
- `POST /api/rewards/sms/verify` : `{challengeId,phone,code}` → `{awarded,score,reward?,reason?}`. Le défi signé et son enregistrement lient propriétaire, partie et HMAC du téléphone. Le premier téléphone vérifié lie définitivement la partie. Ni téléphone brut ni OTP ne sont enregistrés.
- `GET /api/rewards/confirmation` : `{reward:null|reward}` ; récupération du dernier bon du seul propriétaire du navigateur.

Les erreurs sont `{error: "code_machine", message: "explication"}` avec un statut HTTP approprié. Aucun endpoint de test ni contournement public du fournisseur n’existe.

## Budget et délais

Les paliers exacts sont 5000 points → 500 cents CAD, 7500 → 1000, 10000 → 2000. Le plafond initial est le plus grand palier abordable ; le gain vaut le minimum entre score et plafond initial. La base garantit atomiquement `used_cents + reserved_cents <= 10000` par mois civil de Toronto. Aucun report ni remboursement après annulation ou expiration d’un bon.

Une réservation dure 30 minutes. Les nouvelles parties avec récompenses sont suspendues pendant les 31 dernières minutes du mois de Toronto. Le temps simulé est limité à 15 minutes ; la vérification SMS doit finir dans les 10 minutes suivant le résultat, toujours avant la fin de réservation. Le bon confirmé doit être réclamé en boutique dans les 30 jours. L’expiration concerne le bon en attente, pas une carte-cadeau déjà émise. Un téléphone vérifié ne reçoit qu’un gain pendant toute période glissante de 30 × 24 heures, même si un bon est ensuite annulé.

Chaque partie avec récompense réserve atomiquement **un premier envoi SMS** en même temps que son montant. Le quota compte les envois consommés et ces emplacements réservés. Le premier envoi convertit son emplacement en consommation avant l’appel payant et reste disponible même si le quota ordinaire est ensuite épuisé. La perte, l’expiration ou la consommation d’une partie libère une réservation SMS inutilisée une seule fois. Les échecs fournisseur restent consommés ; les renvois demandent du quota ordinaire supplémentaire. Les vérifications de défis déjà envoyés restent possibles.

Le quota est attribué au **jour de départ à Toronto** : une partie commencée avant minuit peut utiliser son premier envoi dans sa fenêtre de 30 minutes après minuit, sur l’allocation du jour précédent. Ce mécanisme garantit le premier SMS d’une partie réservée ; ce n’est pas un plafond de facturation par jour effectif d’expédition. Des plafonds fournisseur, Fraud Guard et restrictions géographiques doivent compléter cette allocation avant toute activation approuvée. Un manque d’emplacements SMS retire les nouvelles offres avec récompense ; le mode extrême reste disponible lorsque le budget financier est épuisé.

## Administration

L’accès statique `/admin` et `/v3/admin*`, ainsi que chaque API d’administration, exige un JWT Access RS256 valide (issuer, audience, expiration, JWKS fixes) et un employé actif. Le mode avancé Pages doit inclure ces chemins et `/api/*` dans `_routes.json` pour que le middleware soit exécuté.

- `GET /api/admin/me` → `{employee:{sub,subject,email,name,role}}`.
- `GET /api/admin/rewards?code=&status=&cursor=` → `{rewards,nextCursor?}`.
- `GET /api/admin/budget` → `{month,usedCents,reservedCents,remainingCents,pendingCount}`.
- `GET /api/admin/audit?rewardId=` → `{audit}`.
- `GET /api/admin/export` accepte les mêmes filtres et produit un CSV UTF-8 BOM, avec protection des formules, noms des employés et horodatages. L’export est audité.
- `POST /api/admin/rewards/:id/claim` → `{reward}` ; transition atomique et verrou au premier employé.
- `POST /api/admin/rewards/:id/issue` avec `{lightspeedRef}` → `{reward}` ; seul ce même employé peut confirmer l’émission manuelle Lightspeed.
- `POST /api/admin/rewards/:id/cancel` avec `{reason}` → `{reward}` ; réservé au responsable, sans restitution du budget ni remise à zéro des 30 jours.

## Vérifications locales

Node 24 est requis pour les tests SQLite : `node tests/rewards-api.test.mjs`, `node tests/d1-concurrency.test.mjs`, `node --test tests/sms*.test.mjs`.

Les tests utilisent de vrais replays gagnants (10526 points), une D1 simulée avec SQLite réel, des réponses fournisseur simulées et de vraies signatures RSA. Les tests de concurrence lancent des workers avec connexions SQLite distinctes : réservations, plafonds restants, gains concurrents, téléphone partagé, double réclamation, acteur verrouillé, quotas SMS et tentatives OTP. Aucun SMS réel n’est envoyé.
