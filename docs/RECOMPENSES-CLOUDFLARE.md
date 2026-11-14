# Récompenses — mise en place Cloudflare et exploitation

État au 14 novembre 2026 : implémentation et essais locaux sur la branche `develop/noel-recompenses-v1`. La production n'a pas été modifiée. Aucun compte Cloudflare, service SMS ou paiement n'est activé par ce document. Les identifiants Cloudflare nécessaires à la création et à la liaison de D1 ne sont pas disponibles dans cet environnement.

Ce document remplace les propositions historiques de `REWARDS_ARCHITECTURE.md` pour cette branche : la cible est **Cloudflare Pages + Functions + D1**, avec remise manuelle de la carte dans Lightspeed. Les anciens exemples Supabase et les anciens paliers en produits ne décrivent pas cette implémentation.

## Fichiers et hébergement

- Projet Pages existant : `minijeux`, hôte `minijeux-4gy.pages.dev`.
- Base de prévisualisation prévue : `boreal-rewards-preview`, liaison D1 **`DB`**.
- Exemple de configuration : [`wrangler.preview.example.jsonc`](../wrangler.preview.example.jsonc). L'identifiant D1 y est volontairement un espace réservé.
- Sources serveur : [`server/api.mjs`](../server/api.mjs), [`server/store.mjs`](../server/store.mjs), [`server/auth.mjs`](../server/auth.mjs), [`server/sms.mjs`](../server/sms.mjs).
- Schéma : [`migrations/0001_rewards.sql`](../migrations/0001_rewards.sql).
- Entrées Functions : [`functions/_middleware.js`](../functions/_middleware.js) et [`functions/[[path]].js`](../functions/[[path]].js).
- Publication statique : dossier `v3`. [`scripts/build-pages-worker.mjs`](../scripts/build-pages-worker.mjs) génère `v3/_worker.js` pour servir les API et protéger l'administration sans modifier le paramétrage du projet de production.
- `v3/_routes.json` fait passer toutes les routes par le Worker, sauf `/assets/*`. Les pages et scripts `/admin/` restent protégés. Aucun export public ne doit contenir des secrets, une base SQLite ou des fichiers `.dev.vars`.

L'adresse réelle de la prévisualisation doit être relevée après sa création. L'alias de branche présent dans le fichier d'exemple n'est pas une preuve qu'une prévisualisation a été publiée. `APP_ORIGIN` doit correspondre exactement à l'origine retenue, sans barre oblique finale.

## Configuration exacte

Les valeurs sensibles se renseignent dans les secrets Cloudflare de **prévisualisation**, jamais dans Git, dans le navigateur ou dans une archive. Copier l'exemple dans `wrangler.preview.local.jsonc` à la racine, exclu de Git, conserve ses chemins relatifs. Déplacer la configuration sous `work/` exige d'adapter notamment `pages_build_output_dir`, `migrations_dir` et `$schema`.

| Nom | Valeur ou règle |
|---|---|
| `DB` | Liaison à la base D1 de prévisualisation, schéma appliqué. |
| `APP_ORIGIN` | Origine HTTPS exacte de la prévisualisation autorisée. |
| `REWARDS_ENABLED` | Chaîne `false` tant que l'activation commerciale n'est pas autorisée. Seule la chaîne `true` active ce contrôle. |
| `SMS_APPROVED` | Chaîne `false` tant que les dépenses SMS et le compte fournisseur ne sont pas approuvés. |
| `TERMS_APPROVED` | Chaîne `false` tant que règlement, admissibilité et confidentialité ne sont pas finalisés et validés. |
| `REWARDS_HMAC_SECRET` | Secret aléatoire d'au moins 32 octets, utilisé pour dériver les identifiants de téléphone, navigateur et limitation de débit. Le contrôle de disponibilité exige aussi au moins 32 caractères. |
| `SMS_CHALLENGE_SECRET` | Facultatif, secret distinct d'au moins 32 octets pour signer les challenges SMS. À défaut, `REWARDS_HMAC_SECRET` est utilisé. |
| `TURNSTILE_SITE_KEY` | Clé publique du widget Cloudflare Turnstile, configuré pour l'hôte réel. |
| `TURNSTILE_SECRET` | Secret du même widget, conservé côté serveur. |
| `SMS_PROVIDER` | Chaîne exacte `twilio`. |
| `SMS_DAILY_LIMIT` | Chaîne décimale entière de `1` à `100`, quota global des envois et emplacements réservés, imputés au jour d’allocation à Toronto. L'exemple utilise `0`, volontairement invalide et donc désactivé. Choisir une valeur après approbation des coûts. |
| `TWILIO_ACCOUNT_SID` | Identifiant du compte Twilio, forme `AC` suivie de 32 caractères hexadécimaux. |
| `TWILIO_AUTH_TOKEN` | Secret d'authentification Twilio, au moins 16 caractères. |
| `TWILIO_VERIFY_SERVICE_SID` | Service Twilio Verify, forme `VA` suivie de 32 caractères hexadécimaux. |
| `ACCESS_TEAM_DOMAIN` | Domaine de l'équipe Access, par exemple `equipe.cloudflareaccess.com`, sans `https://` ni chemin. |
| `ACCESS_AUD` | Audience exacte de l'application Cloudflare Access protégeant l'administration. |

Un paramètre de récompense manquant, une base inaccessible ou une approbation absente fait répondre `/api/rewards/status` en mode `pending`, avec les paliers indisponibles. Le jeu propose alors l'entraînement sans promesse de gain. L'administration exige séparément un JWT Access vérifié et un employé actif dans D1.

Changer le secret HMAC change les identifiants dérivés et invalide des challenges existants. Une rotation ne doit pas être improvisée pendant une promotion : elle peut interrompre les confirmations et empêcher la reconnaissance des récompenses antérieures pour la limite de 30 jours.

## Préparer une prévisualisation isolée

Ces commandes décrivent une opération ultérieure sur la prévisualisation. Elles n'ont pas été exécutées sur un compte Cloudflare depuis cet environnement.

1. Créer `boreal-rewards-preview` dans le compte autorisé, puis copier son véritable `database_id` dans la configuration locale. Ne pas réutiliser une base de production.
2. Appliquer `migrations/0001_rewards.sql` sur cette base, par exemple avec `npx wrangler d1 migrations apply boreal-rewards-preview --remote --config wrangler.preview.local.jsonc`.
3. Définir les variables et secrets de prévisualisation, en laissant les trois approbations à `false`.
4. Configurer Turnstile pour l'hôte réel et une application Access couvrant `/admin/*` et `/api/admin/*` sur cet hôte. Ne pas modifier les politiques ou variables de production pour tester cette branche.
5. Construire le Worker avec `node scripts/build-pages-worker.mjs`, puis publier uniquement une prévisualisation de `develop/noel-recompenses-v1` selon le circuit du projet existant.
6. Vérifier l'origine réelle, le statut `pending`, le refus anonyme de `/admin/` et des API administratives, puis la liaison D1 et l'accès d'un employé de test autorisé.

Les dates de début et de fin d'une promotion ne disposent pas d'un calendrier d'activation automatique dans cette version. Leur mise en œuvre doit être organisée avec les drapeaux de configuration avant toute ouverture.

## Comptes employés et remise

Chaque employé utilise son propre compte Access. Le serveur vérifie la signature **RS256** avec les clés de l'équipe configurée, l'émetteur, l'audience, l'expiration et les dates du JWT. Un simple en-tête déclarant une adresse courriel n'autorise rien.

La table `employees` associe le `sub` Access exact à l'adresse courriel, au nom humain, au rôle `staff` ou `manager` et à `active=1`. L'adresse doit correspondre au JWT. L'opérateur renseigne cette liste depuis un accès D1 autorisé ; aucun utilisateur ne choisit son rôle depuis le navigateur. `/api/admin/identity` permet à un compte Access authentifié de lire sa propre identité afin de la transmettre au responsable, sans donner accès au registre.

La remise suit trois étapes :

1. L'employé vérifie le code, la valeur et l'échéance, puis confirme son utilisation. Une mise à jour conditionnelle fait passer `pending` à `claimed` une seule fois. Cette action verrouille la remise à cet employé ; elle doit réussir sur le serveur avant de créer une carte.
2. Cet employé crée **manuellement une seule** carte-cadeau dans Lightspeed, du montant confirmé. Le jeu ne dispose d'aucune intégration d'émission Lightspeed.
3. Le même employé enregistre la référence Lightspeed et confirme la remise réelle. Une autre personne ne peut pas terminer cette remise. Après un problème réseau, consulter l'état existant et Lightspeed avant toute nouvelle émission.

Un responsable `manager` peut annuler une récompense non remise avec un motif. Une annulation ne rembourse jamais l'enveloppe du mois et n'efface pas la limite de 30 jours. Les transitions, noms des acteurs et horodatages restent dans l'audit. L'export CSV réservé aux employés autorisés contient les états, valeurs, noms et dates de traitement ; les cellules pouvant être interprétées comme des formules sont neutralisées.

## Règles appliquées par le serveur

| Sujet | Comportement |
|---|---|
| Paliers | 5 000 points → 5 CAD ; 7 500 → 10 CAD ; 10 000 → 20 CAD. Aucun gain sous 5 000. Un seul gain, jamais le cumul. |
| Plafond d'une partie | Au départ, réservation atomique du plus grand montant encore disponible parmi 20, 10 et 5 CAD. Le plafond et le mode sont annoncés avant de jouer. Le gain vaut `min(palier du score, plafond annoncé)`. Un plafond de 10 CAD reste 10 CAD même avec 10 000 points. |
| Enveloppe interne | 100 CAD par **mois civil dans `America/Toronto`**, toutes les récompenses confirmées et réservations actives confondues. Pas de report entre mois, ni remboursement après utilisation ou annulation. Ce montant interne n'est pas publié dans le règlement public ni dans l'API publique. |
| Réservation | 30 minutes à partir du départ serveur, pauses comprises. Les parties perdues et les réservations échues libèrent seulement les montants encore réservés. Une attribution confirmée consomme définitivement son montant. |
| Durée de jeu | Au plus 15 minutes de simulation effective, 120 pas par seconde. Les pauses ne simulent pas de temps, mais consomment la validité de réservation de 30 minutes. |
| Fin de mois | Aucun nouveau départ récompensé dans les 31 minutes précédant minuit le premier du mois suivant, heure de Toronto. Cela évite de transporter une réservation rémunérée d'un mois à l'autre. |
| Confirmation SMS | Seulement après un résultat serveur admissible. Prénom, nom, téléphone international et acceptation des conditions sont demandés à ce moment. Le délai est au plus 10 minutes après la fin, **sans jamais dépasser la réservation de 30 minutes**. |
| Limite de gain | Un gain confirmé par numéro vérifié pendant les 30 × 24 heures précédentes. Le règlement impose une récompense par personne : le téléphone est un contrôle technique, pas une preuve d'identité. Plusieurs personnes peuvent partager un numéro ; une personne peut en posséder plusieurs. Interdire le contournement ne le rend pas techniquement impossible. |
| Code | Code aléatoire généré côté serveur seulement après approbation SMS et attribution atomique. Usage unique, à présenter dans les 30 × 24 heures après attribution. Ce délai concerne la réclamation du prix, pas la validité de la carte-cadeau Lightspeed. |
| Modes | `rewards` : mécanique normale et plafond réservé ; `extreme` : difficulté accrue annoncée, aucun gain ; `pending` : entraînement sans gain quand la configuration ou le service n'est pas prêt. Le mode d'une session est figé. |

## Protection, données et limites connues

Le navigateur et le serveur exécutent le même fichier `v3/game-session-engine.mjs`. Le serveur rejoue les sauts et redimensionnements avec la graine, les dimensions et le mode de la session ; il ignore le score déclaré par le client. Il refuse notamment les journaux invalides, les parties inachevées et un temps simulé supérieur au temps réellement écoulé, avec une tolérance bornée.

**Une relecture valide ne prouve pas qu'un humain a joué.** La graine est visible et un programme peut calculer un journal gagnant puis attendre le délai minimal. Turnstile, la vérification du téléphone et les limitations réduisent certains abus ; ils ne rendent pas ce jeu inautomatisable. La revue de ce risque et du traitement des gagnants légitimes est nécessaire avant activation monétaire.

Le propriétaire anonyme d'une partie est lié à un cookie `__Host-rewards-owner`, `Secure`, `HttpOnly`, `SameSite=Strict`, valable 30 jours. Il permet la confirmation dans le navigateur d'origine ; l'effacer ou changer de navigateur peut empêcher cette récupération. Aucun compte joueur n'est créé. Les écritures exigent l'origine exacte, un corps JSON borné à 128 Kio et des contrôles de session. Les codes, noms et journaux ne sont pas accessibles anonymement.

Le numéro normalisé est transmis au service Twilio Verify pour envoyer et contrôler le SMS. Les réponses doivent correspondre au téléphone, au service et au challenge fournisseur stockés ; un simple résultat « approved » ne suffit pas. Le registre D1 stocke un identifiant HMAC du téléphone, jamais le téléphone en clair ni le code OTP. Les prénoms et noms sont conservés avec la récompense ; les codes de récompense sont conservés dans le registre privé pour leur consultation et leur récupération. Les journaux d'application ne doivent pas recopier de téléphone, d'OTP, de secret ou de code de récompense.

Chaque départ récompensé réserve atomiquement un premier emplacement SMS avec le montant de la partie. Le premier envoi convertit cet emplacement en consommation, même si d’autres joueurs saturent ensuite le quota ordinaire. Les pertes et les expirations libèrent un emplacement inutilisé une seule fois. Un échec fournisseur consomme l’envoi ; les renvois utilisent le quota ordinaire.

`SMS_DAILY_LIMIT` compte les envois consommés et les emplacements réservés au **jour d’allocation à Toronto**. Un premier envoi après minuit reste imputé au jour de départ pendant la fenêtre de 30 minutes. Ce n’est donc pas un plafond de facturation par jour réel d’expédition. Prévoir aussi les restrictions géographiques, Fraud Guard, alertes et plafonds fournisseur approuvés. Une saturation interdit de nouvelles offres récompensées, mais préserve le premier envoi des parties déjà réservées. Les contrôles OTP disposent d'un verrou temporaire et d'au plus cinq tentatives par challenge. Les limitations par navigateur, IP dérivée, téléphone dérivé et employé complètent ces protections.

La politique de conservation, les suppressions, l'accès aux données et le traitement des historiques chez Cloudflare et Twilio doivent encore être définis avec l'exploitant. Aucune purge automatique des récompenses, noms ou audits n'est fournie ; ne pas annoncer une suppression automatique inexistante. Une durée décidée doit préserver les contrôles de 30 jours et les obligations applicables sans conserver indéfiniment les données par défaut.

## Validation avant activation

Conserver `REWARDS_ENABLED=false`, `SMS_APPROVED=false` et `TERMS_APPROVED=false` tant que les points suivants ne sont pas réglés : identité et coordonnées de l'organisateur, dates, âge et territoire admissibles, conditions de carte-cadeau, procédure de contestation, contact de confidentialité, durées de conservation, coût et limites SMS, contrôle des abus et disponibilité de la confirmation d'un gagnant déjà en partie. Le texte public [`v3/reglement.html`](../v3/reglement.html) est une version à finaliser ; ce document ne constitue pas une validation juridique.

Essais locaux, sous Node 24 :

```sh
node tests/game-session-engine.test.mjs
node tests/sms-auth.test.mjs
node tests/sms.test.mjs
node tests/rewards-api.test.mjs
node --no-warnings tests/d1-concurrency.test.mjs
```

Les tests de concurrence utilisent de vraies connexions SQLite WAL dans des Workers Node séparés, avec le schéma et les opérations du serveur. Ils couvrent notamment 32 départs simultanés, les réservations restantes de 10 et 5 CAD, les propriétaires concurrents, l'idempotence, deux parties pour un téléphone, deux téléphones pour une partie, les réclamations concurrentes, l'employé verrouillé, les tentatives OTP et le quota global SMS. Ces essais valident le comportement local ; ils ne remplacent pas une vérification de la prévisualisation réellement liée à D1 et à Access.

## Commandes et accès du personnel

Depuis la racine du dépôt, sur un poste connecté au compte Cloudflare autorisé :

```sh
npm ci --ignore-scripts
npx wrangler login
npx wrangler d1 create boreal-rewards-preview
cp wrangler.preview.example.jsonc wrangler.preview.local.jsonc
# Renseigner le database_id réel et APP_ORIGIN dans ce fichier local ignoré par Git.
npx wrangler d1 migrations apply DB --remote --config wrangler.preview.local.jsonc
```

Dans **Workers & Pages → minijeux → Settings → Bindings → Preview**, ajouter D1, nom de liaison `DB`, base `boreal-rewards-preview`. Dans les variables/secrets **Preview**, renseigner exactement le tableau ci-dessus. Ne pas sélectionner Production. Un redéploiement de la prévisualisation est nécessaire après changement des liaisons ou variables ; ne pas lancer un déploiement de production. Le Worker déjà généré dans `v3` permet de conserver le paramétrage de publication statique existant. Après toute modification de `server/`, `functions/` ou du moteur partagé, exécuter `npm run build:pages` et versionner `v3/_worker.js`.

Créer une application **Cloudflare Zero Trust → Access → Applications → Self-hosted** couvrant les chemins `/admin*` et `/api/admin/*` de l’alias de prévisualisation retenu, avec la même audience pour les destinations. Autoriser seulement les comptes nominatifs du personnel via le fournisseur d’identité choisi et imposer son authentification multifacteur. Configurer `ACCESS_TEAM_DOMAIN` et l’Application Audience (`ACCESS_AUD`) côté Preview. Protéger également les autres alias publiés ; le contrôle JWT dans le Worker refuse de toute façon les accès anonymes et les en-têtes courriel falsifiés.

L’employé se connecte puis ouvre `/api/admin/identity` sur cet alias. Le responsable vérifie l’adresse et le `sub` retournés, puis prépare un fichier SQL local avec ces valeurs (échapper toute apostrophe SQL en la doublant ; ne pas concaténer une requête depuis une saisie publique) :

```sql
BEGIN TRANSACTION;
INSERT INTO employees(sub,email,name,role,active)
VALUES('SUB_ACCESS_VERIFIE','adresse@restaurant.example','Prénom Nom','staff',1);
INSERT INTO audit(action,actor_sub,actor_name,created_at,details)
VALUES('employee_provisioned','RESPONSABLE_VERIFIE','Nom du responsable',
 CAST(strftime('%s','now') AS INTEGER)*1000,
 json_object('employeeSub','SUB_ACCESS_VERIFIE','role','staff'));
COMMIT;
```

Appliquer le fichier à la base de prévisualisation autorisée :

```sh
npx wrangler d1 execute DB --remote --config wrangler.preview.local.jsonc --file work/ajouter-employe.sql
```

Pour révoquer un employé, désactiver sa règle d’accès et `UPDATE employees SET active=0 WHERE sub='SUB_ACCESS_VERIFIE';`, avec une entrée d’audit associée dans la même transaction. Ne pas supprimer l’historique. Le rôle `manager` permet l’annulation motivée, mais ne permet pas de reprendre la remise verrouillée à un collègue.

Turnstile : autoriser le nom d’hôte exact de la prévisualisation, configurer son couple sitekey/secret, puis vérifier l’action serveur `boreal-session`. Twilio Verify : compte et service dédiés approuvés, restrictions géographiques adaptées, protection contre la fraude et alertes de coût. Ne pas activer les SMS réels pour tester avec les clients avant approbation du fournisseur et de son coût. Les tests livrés n’ont pas besoin de ses identifiants réels.

## Références pour la validation au Québec

Faire valider les modalités promotionnelles et l’admissibilité applicables, la distinction entre délai de réclamation du prix et conditions de carte-cadeau, le consentement et la politique de confidentialité, la conservation et le traitement par les fournisseurs. Sources officielles de départ : [OPC — cartes-cadeaux](https://www.opc.gouv.qc.ca/consommateur/bien-service/carte-prepayee/carte-cadeau/), [Commission d’accès à l’information](https://www.cai.gouv.qc.ca/) et [Régie des alcools, des courses et des jeux](https://www.racj.gouv.qc.ca/). Ces liens ne constituent pas une confirmation que la promotion est juridiquement prête.
