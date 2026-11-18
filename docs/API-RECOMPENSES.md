**Version actuelle : lancement sans SMS, jeu illimité, contrôles téléphone/navigateur et accès du personnel par courriel. Voir [la procédure actuelle](LANCEMENT-SANS-SMS.md). Les descriptions SMS ci-dessous concernent désormais le mode optionnel futur.**

# API Récompenses

Le backend est fourni dans `functions/`, `server/` et `migrations/0001_rewards.sql` à `0007_preview_test_consumption.sql`, puis compilé dans le fichier publié `v3/_worker.js`. Aucun service payant ni déploiement de production n’est activé par le dépôt. La migration doit être appliquée à une D1 dédiée avant activation; aucune liaison D1 distante n'a été vérifiée dans cet environnement. Le moteur partagé `v3/game-session-engine.mjs` détermine tous les scores depuis la graine, les sauts et les redimensionnements; aucun score envoyé par le navigateur n’est accepté comme preuve. Voir le [guide d'activation](ACTIVATION-RECOMPENSES.md) pour l'ordre des opérations, les adresses et les accès manquants.

## Configuration

Bindings et variables : `DB`, `APP_ORIGIN` (origine HTTPS exacte), `REWARDS_ENABLED`, `SMS_APPROVED`, `TERMS_APPROVED`, `SMS_PROVIDER=twilio`, `SMS_DAILY_LIMIT` (entier explicite de 1 à 100), `TURNSTILE_SITE_KEY`, `ACCESS_TEAM_DOMAIN` (`equipe.cloudflareaccess.com`) et `ACCESS_AUD`.

Secrets : `REWARDS_HMAC_SECRET` (au moins 32 octets), `TURNSTILE_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. `SMS_CHALLENGE_SECRET` est facultatif (au moins 32 octets) ; sinon la clé HMAC sert aussi à signer les défis. Les trois autorisations doivent être exactement `true`. Turnstile doit utiliser l’action `boreal-session` et le nom d’hôte de `APP_ORIGIN`.

Les employés sont provisionnés dans `employees(sub,email,name,role,active)` à partir de leur identité Access vérifiée. `role` vaut `staff` ou `manager`. Les comptes sont individuels, avec authentification multifacteur imposée par la politique d'accès. `/api/admin/identity` donne au seul utilisateur son `sub` et son `email` vérifiés, même avant ajout à cette liste. L’email d’un simple en-tête n’est jamais une identité.

Le statut, le départ et les demandes/vérifications SMS refusent l'activation si une table, une colonne ou une protection attendue manque dans D1. Les contrôles de schéma réussis peuvent être conservés pendant 60 secondes par liaison dans chaque instance du Worker; les échecs ne sont pas conservés. Les trois approbations restent distinctes d'une preuve de bon fonctionnement des fournisseurs.

## Contrat public

Toutes les réponses privées sont `Cache-Control: no-store`. Toutes les écritures exigent du JSON (128 Kio maximum), une origine exacte et des métadonnées Fetch compatibles. Le cookie propriétaire est `__Host-rewards-owner`, Secure, HttpOnly, SameSite=Strict, Path=/.

- `GET /api/rewards/status` : `mode` (`rewards`, `extreme`, `pending`), `rewardsEnabled`, `tiers`, `capCents` si disponible, `policyVersion`, `turnstileSiteKey`, `reason` éventuelle. Aucun solde interne n’est public.
- `POST /api/games/start` : `{width,height,expectedMode,turnstileToken?}` → `{sessionId,seed,width,height,mode,engineVersion,capCents,expiresAt,policyVersion,requiresModeConfirmation}`. Le mode et le plafond annoncés doivent être confirmés avant simulation si différents de l’offre affichée.
- `POST /api/games/finish` : `{sessionId,ticks,jumps,resizes}` → `{score,eligible,mode,capCents,claimDeadline?}`. Les ticks sont à 120 Hz, au maximum 108000. Une partie doit être réellement terminée. Une réponse déjà calculée reste identique.
- `POST /api/rewards/sms/request` : `{sessionId,phone,firstName,lastName,consentVersion}` → `{challengeId,expiresAt}`. `consentVersion` vaut `discounts-food-2026-11-v2`.
- `POST /api/rewards/sms/verify` : `{challengeId,phone,code}` → `{awarded,score,reward?,reason?}`. Le défi signé et son enregistrement lient propriétaire, partie et HMAC du téléphone. Le premier téléphone vérifié lie définitivement la partie. Ni téléphone brut ni OTP ne sont enregistrés.
- `GET /api/rewards/confirmation` : `{reward:null|reward}` ; récupération du dernier bon du seul propriétaire du navigateur.

Le reçu public contient uniquement les données du gain et de son bénéficiaire, avec ses dates et son statut. Les identités des employés, références Lightspeed et motifs internes restent réservés aux API d'administration.

Les erreurs sont `{error: "code_machine", message: "explication"}` avec un statut HTTP approprié. Aucun endpoint ne fabrique une partie gagnante ni ne contourne le fournisseur SMS. La consommation de codes réservée aux essais Preview est contrôlée séparément côté serveur et reste interdite sur l’hôte Production.

## Budget et délais

Les paliers exacts sont 5000 points → 500 cents CAD, 7500 → 1000, 10000 → 2000. Le plafond initial est le plus grand palier abordable ; le gain vaut le minimum entre score et plafond initial. La base garantit atomiquement `used_cents + reserved_cents <= limit_cents + exceptional_cents` par mois civil de Toronto. Aucun report ni remboursement après annulation ou expiration d’un bon.

Une réservation dure 30 minutes. Les nouvelles parties avec récompenses sont suspendues pendant les 31 dernières minutes du mois de Toronto. Le temps simulé est limité à 15 minutes ; la vérification SMS doit finir dans les 10 minutes suivant le résultat, toujours avant la fin de réservation. Le bon confirmé doit être réclamé en boutique dans les 30 jours. Le code donne droit à un rabais alimentaire, sans carte-cadeau. Un téléphone vérifié ne reçoit qu’un gain pendant toute période glissante de 30 × 24 heures, même si un bon est ensuite annulé.

Chaque partie avec récompense réserve atomiquement **un premier envoi SMS** en même temps que son montant. Le quota compte les envois consommés et ces emplacements réservés. Le premier envoi convertit son emplacement en consommation avant l’appel payant et reste disponible même si le quota ordinaire est ensuite épuisé. La perte, l’expiration ou la consommation d’une partie libère une réservation SMS inutilisée une seule fois. Les échecs fournisseur restent consommés ; les renvois demandent du quota ordinaire supplémentaire. Les vérifications de défis déjà envoyés restent possibles.

Le quota est attribué au **jour de départ à Toronto** : une partie commencée avant minuit peut utiliser son premier envoi dans sa fenêtre de 30 minutes après minuit, sur l’allocation du jour précédent. Ce mécanisme garantit le premier SMS d’une partie réservée ; ce n’est pas un plafond de facturation par jour effectif d’expédition. Des plafonds fournisseur, Fraud Guard et restrictions géographiques doivent compléter cette allocation avant toute activation approuvée. Un manque d’emplacements SMS retire les nouvelles offres avec récompense ; le mode extrême reste disponible lorsque le budget financier est épuisé.

## Administration

L’accès statique `/admin` et `/v3/admin*`, ainsi que les API d’administration, exige un JWT Access RS256 valide (issuer, audience, expiration, JWKS fixes) et un employé actif. Seul `/api/admin/identity` exige le JWT sans inscription préalable dans la liste d'employés. Le mode avancé Pages doit inclure ces chemins et `/api/*` dans `_routes.json` pour que le middleware soit exécuté.

- `GET /api/admin/me` → `{employee:{sub,subject,email,name,role}}`.
- `GET /api/admin/identity` → `{sub,email}` vérifiés pour le compte Access connecté, avant inscription éventuelle dans la liste d'employés.
- `GET /api/admin/setup` → `{checkedAt,configuration,database,rewardsConfigured,providerVerification}`; réservé au rôle `manager`. `database` fournit `connected`, `schemaReady` et les inventaires manquants. Les paramètres sont des booléens, aucun secret n'est retourné. Le diagnostic interroge la D1 réellement liée à ce déploiement, mais n'appelle aucun fournisseur : `providerVerification` vaut `not_performed`. Un schéma connecté ne prouve pas qu'un SMS ou une attribution réelle a réussi. L'accès au diagnostic reste soumis au JWT Access et à la liste active des employés, même lorsque d'autres tables ou secrets de récompense manquent.
- `GET /api/admin/rewards?code=&status=&cursor=` → `{rewards,nextCursor?}`.
- `GET /api/admin/budget` → `{month,budgetCents,usedCents,reservedCents,remainingCents,pendingCount,usedCount,countScope}`; les compteurs de codes portent sur tout le registre (`countScope: "all"`).
- `GET /api/admin/audit?rewardId=` → `{audit}`.
- `GET /api/admin/export` accepte les mêmes filtres et produit un CSV UTF-8 BOM, avec protection des formules, noms des employés et horodatages. L’export est audité.
- `POST /api/admin/rewards/:id/claim` → `{reward}` ; transition atomique et verrou au premier employé.
- `POST /api/admin/rewards/:id/use` avec `{discountApplied:true,foodOnlyConfirmed:true,eligibleFoodCents}` → `{reward}` ; même employé que la prise en charge. Le serveur applique `min(valueCents,eligibleFoodCents)` et consomme entièrement le code. Les deux confirmations doivent être des booléens stricts ; le montant alimentaire doit être un entier positif en cents. Une répétition conserve le même montant alimentaire ; un autre montant ou employé reçoit 409. L’ancien `/issue` renvoie 410 ; aucune référence Lightspeed n’est requise.
- `POST /api/admin/rewards/:id/cancel` avec `{reason}` → `{reward}` ; réservé au responsable, sans restitution du budget ni remise à zéro des 30 jours.

## Vérifications locales

Node 24 est requis pour les tests SQLite : `node tests/rewards-api.test.mjs`, `node tests/d1-concurrency.test.mjs`, `node --test tests/sms*.test.mjs`.

Les tests utilisent de vrais replays gagnants (10526 points), une D1 simulée avec SQLite réel, des réponses fournisseur simulées et de vraies signatures RSA. Les tests de concurrence lancent des workers avec connexions SQLite distinctes : réservations, plafonds restants, gains concurrents, téléphone partagé, double réclamation, acteur verrouillé, quotas SMS et tentatives OTP. Aucun SMS réel n’est envoyé.

La capacité CPU du Worker déployé doit être vérifiée avant l'ouverture des gains : les relectures locales sous Node ont été mesurées à 14–28 ms, alors que [Workers Free documente 10 ms de CPU par requête](https://developers.cloudflare.com/workers/platform/limits/). Vérifier la limite applicable aux Functions Pages et les mesures réelles; une mesure Node n'est pas une mesure Cloudflare. Aucun changement de forfait n'est autorisé sans accord.

## Extensions budget et bons manuels

`GET /api/admin/budget` inclut `defaultBudgetCents`, `revision`, `defaultRevision`, `minimumBudgetCents`, `minimumFutureBudgetCents`, `authorizedExceptionalCents`, `overrunCents`, `updatedAt`, `updatedByName`. Le solde normal est borné à zéro ; le dépassement est affiché séparément. Les dépenses incluent les bons exceptionnels. La valeur faciale est attribuée au budget ; une utilisation partielle ne le rembourse pas.

`PATCH /api/admin/budget` (manager uniquement) : `{month,budgetCents,scope,expectedRevision,expectedDefaultRevision,requestId}`. `scope` vaut `month_only` ou `current_and_future`. Le mois doit être le mois courant de Toronto. Demande durablement idempotente ; conflit de versions ou baisse non couverte : 409.

`POST /api/admin/manual-rewards/quote` (manager) : `{phone,valueCents}`. Renvoie les montants privés, `projectedOverrunCents`, `additionalExceptionalCents`, `cooldownRequired`, `manualRewardsEnabled` et un objet `quote` contenant `{month,budgetCents,usedCents,reservedCents,revision,lastRewardId}`. Ne crée aucun bon.

`POST /api/admin/manual-rewards` (manager actif ; `MANUAL_REWARDS_ENABLED=true` et `TERMS_APPROVED=true`) : `{requestId,firstName,lastName,phone,valueCents,reason,quote,authorizeBudgetOverrun,budgetReason,authorizeCooldown,cooldownReason}`. `valueCents` est 500/1000/2000. La raison manuelle et chaque raison d’exception ont 8–500 caractères. Les autorisations sont des booléens stricts. Le devis est comparé au budget et au dernier gain dans la transaction ; une évolution entraîne 409 avant création. Réponse `{reward,repeated,notification}`. Aucun score envoyé n’est accepté ; le bon manuel a `source=manual`, `score=null`, `session_id=NULL`. Un même `requestId` et contenu canonique du même gestionnaire renvoie le code existant, même après sa prise en charge ; un contenu ou acteur différent reçoit 409. Le fingerprint stocké est un SHA-256, pas le JSON contenant le téléphone.

La validation SQL sépare le jeu des émissions manuelles : une partie ne peut jamais consommer une autorisation exceptionnelle. Les dérogations au budget et aux 30 jours restent dans l’audit avec leur gestionnaire et leurs justifications. Les conditions alimentaires sont obligatoires pour tous les nouveaux usages ; les anciens usages restent terminaux sans attestation rétroactive.

## SMS du bon, distinct de Verify

`NOTIFICATION_SMS_ENABLED=true`, `SMS_APPROVED=true`, `TERMS_APPROVED=true`, `TWILIO_MESSAGING_SERVICE_SID` (`MG…`) et `NOTIFICATION_SMS_DAILY_LIMIT` (1–100) sont requis pour envoyer les messages via Twilio Messages. Les secrets de compte Twilio restent côté serveur. Tous ces envois restent désactivés dans l’exemple Preview.

L’attribution tente un premier message idempotent. Un échec SMS n’annule pas un bon confirmé : le code demeure affiché et récupérable. Les notifications ont leur propre quota, distinct du quota Verify ; les textes peuvent être facturés en plusieurs segments.

- Joueur propriétaire : `POST /api/rewards/notification` avec `{rewardId,phone,requestId}`. Cookie du navigateur de la partie et correspondance HMAC du téléphone obligatoires.
- Employé actif : `POST /api/admin/rewards/:id/notify` avec `{phone,requestId}`. Même téléphone que le bénéficiaire ; aucun changement de destinataire possible.

Réponse `{notification:{id?,status,createdAt?}}`. `accepted` signifie accepté par le fournisseur, **pas livré**. `disabled`, `unavailable`, `sending`, `failed` ou `uncertain` ne prouvent aucun envoi réussi. Le journal et la clé de demande évitent de rejouer automatiquement un POST accepté mais dont la réponse serait perdue. Un renvoi explicite utilise une nouvelle clé, le même code et la date limite originale, avec au moins 60 secondes entre demandes et au maximum cinq demandes par téléphone en 24 heures. Aucun numéro en clair, corps de message ou OTP n’est stocké dans ce journal.

Les messages distinguent le score du jeu et le geste manuel. Ils précisent la validité de 30 jours à compter de l’attribution, l’usage unique, les aliments seulement, l’exclusion directe/indirecte de l’alcool, le refus des factures uniquement alcoolisées, le plafond alimentaire et la perte du reliquat. Ces restrictions ne constituent pas une garantie de conformité réglementaire ; l’activation attend la validation RACJ.

## Correction de téléphone et renvoi Verify

`POST /api/rewards/sms/request` conserve son contrat d’entrée. Il renvoie aussi `nextSendAt`, `sendsRemaining` et `claimDeadline`. Une nouvelle demande autorisée incrémente la révision de vérification de la partie et invalide les anciennes demandes, sans modifier son score, sa réservation ni ses échéances. Délai minimal de 60 secondes et maximum cinq demandes par partie ; 429 peut renvoyer `retryAfter` et l’en-tête `Retry-After`. Un ancien défi reçoit 409 `verification_replaced`, y compris s’il était déjà en cours de validation fournisseur. Liaison du numéro et attribution sont réalisées dans une seule transaction conditionnée à la dernière révision. Après confirmation du gain, une correction est refusée.

## Consommation d’essai sans Lightspeed

`GET /api/admin/me` expose le booléen privé `previewTestRedemption`. Un employé ayant pris en charge le code peut envoyer à `/use` `{previewTestConsumed:true}` uniquement si `DEPLOYMENT_ENVIRONMENT=preview`, `PREVIEW_TEST_REDEMPTION=true` et si `APP_ORIGIN` est un sous-domaine Preview du projet. Ce parcours est refusé sur l’hôte Production. Le code devient terminal `issued` sans `discount_applied`, sans attestation alimentaire et sans montant réellement appliqué. L’audit `preview_test_used` porte un montant appliqué de 0 et l’employé. Le reçu public ne comporte pas de marquage visuel de test ; les bases restent isolées. Les valeurs par défaut de ces paramètres ne permettent aucune consommation d’essai.
