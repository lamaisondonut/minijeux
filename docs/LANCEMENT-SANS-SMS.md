# Version finale de lancement — sans SMS

Cette consigne remplace le parcours SMS antérieur. Branche `develop/noel-budget-configurable`, publication `v3`. Ne pas modifier `livraison-v3` ni la base de production pour les essais.

Jeu : https://develop-noel-budget-configur.minijeux-4gy.pages.dev/

Administration : https://develop-noel-budget-configur.minijeux-4gy.pages.dev/admin/

## Parcours livré

Aucun renseignement personnel avant de jouer. Après une partie admissible, le serveur recalcule le score, conserve le palier réservé et affiche un formulaire prénom, nom et téléphone. Les renseignements sont corrigibles avant confirmation. Le serveur vérifie les gains antérieurs du téléphone et du navigateur, puis attribue atomiquement un seul code. Le joueur le copie ou en fait une capture d’écran. Aucun appel ni secret Twilio n’est requis.

Un gain par téléphone et par navigateur pendant 30 jours à compter de l’attribution, même si le code est utilisé, annulé ou expiré. Le navigateur est lié au témoin propriétaire opaque, HttpOnly/Secure/SameSite, stocké sous HMAC côté serveur, renouvelé après le gain. Ce n’est ni une empreinte matérielle ni une preuve d’identité ; changer de navigateur ou effacer les témoins peut contourner le contrôle de navigateur. Le téléphone déclaré n’est pas vérifié. Les contrôles limitent les abus sans garantir l’unicité d’une personne.

Les parties restent illimitées. Un navigateur déjà gagnant joue librement sans nouvelle réservation financière ; un nouveau score admissible affiche le message convivial et la date de prochaine admissibilité connue. Un contrôle de téléphone reste effectué après sa saisie. Les tentatives répétées sont signalées dans le registre sans créer de deuxième bon.

Les noms et le téléphone sont enregistrés dans D1 ; le téléphone est chiffré en AES-GCM, lié à l’identifiant du bon. La recherche exacte de téléphone utilise un HMAC et la recherche de nom ignore la casse et les accents. Le numéro complet est déchiffré seulement dans l’API privée des employés. Aucun numéro ni secret n’apparaît dans le reçu public. Ne pas changer `REWARDS_HMAC_SECRET` sans plan de migration : cette clé protège aussi les recherches et les anciens numéros chiffrés.

## Administration simple, sans compte Cloudflare pour le personnel

Le personnel ouvre `/admin/` et se connecte avec son courriel autorisé, par code de connexion reçu par courriel. Configurer une session Access de **24 heures** : une connexion au début du service, puis recherche et validation de plusieurs codes sans nouvelle connexion. Chaque requête vérifie discrètement la session et le compte actif. Un employé révoqué perd immédiatement l’accès ; les émissions manuelles et les exceptions exigent un rôle gestionnaire.

Rechercher un nom, un téléphone ou un code, ouvrir la fiche, vérifier les gains antérieurs et la prochaine admissibilité. Les signaux de doublon restent des indices, pas des accusations. Pour un appareil partagé ou une exception téléphonique, le gestionnaire choisit la portée, saisit une justification et autorise **un seul nouveau gain dans les 24 heures**, sous réserve d’une nouvelle partie admissible et du budget disponible. Le déblocage n’efface aucun historique et ne change pas le budget. Le joueur actualise sa page après déblocage d’appareil. Une autre récompense rend nécessaire une nouvelle autorisation pour gagner à nouveau pendant la période de restriction.

L’utilisation d’un bon conserve la prise en charge exclusive par un employé puis la confirmation du rabais alimentaire appliqué. Les essais Preview peuvent consommer le code sans rabais, avec un audit indiquant 0 $ réellement appliqué. Les codes restent à usage unique. Aucun compte ni API Lightspeed n’est intégré. Le budget mensuel configurable, ses deux portées, les émissions manuelles et les dépassements justifiés restent disponibles aux gestionnaires.

## Interventions nécessaires dans Cloudflare — Preview uniquement

1. Créer une D1 **distincte**, `defi-boreal-recompenses-preview`, et y lier `DB` dans **Pages → minijeux → Settings → Bindings → Preview**. Garder Production → `defi-boreal-recompenses`. Une branche Git seule n’isole pas D1 ; les paramètres Preview sont partagés entre branches Preview du projet.
2. Base Preview vide : appliquer les instructions complètes du [schéma console final](../proposals/sql/preview_schema_development.sql) dans leur ordre. `application_tables` doit être 0 avant tout CREATE ; chaque CREATE TRIGGER…END est une seule instruction. Ne pas utiliser ce fichier sur une base existante.
3. Si la Preview possède déjà le schéma 0007, appliquer **0008 puis 0009**, chaque fichier dans un seul batch D1 transactionnel. Si elle possède seulement 0001, appliquer 0002 à 0009 dans leur ordre, chaque fichier atomiquement. Ne pas exécuter les DROP/CREATE des mises à niveau séparément sur des données existantes. Aucune migration n’a été appliquée à distance par ce travail.
4. Configurer les variables Preview ci-dessous, puis redéployer la branche. Ces valeurs sont réservées à la recette autorisée ; aucune configuration Production ne change.

| Variable | Valeur Preview |
|---|---|
| `APP_ORIGIN` | `https://develop-noel-budget-configur.minijeux-4gy.pages.dev` |
| `PHONE_VERIFICATION_MODE` | `unverified` |
| `REWARDS_ENABLED` | `true` |
| `TERMS_APPROVED` | `true` pour cette recette autorisée |
| `MANUAL_REWARDS_ENABLED` | `true` |
| `SMS_APPROVED` | `false` |
| `NOTIFICATION_SMS_ENABLED` | `false` |
| `SMS_DAILY_LIMIT` | `0` |
| `DEPLOYMENT_ENVIRONMENT` | `preview` |
| `PREVIEW_TEST_REDEMPTION` | `true` pour consommer les codes d’essai sans rabais |
| `REWARDS_HMAC_SECRET` | Secret serveur aléatoire stable de 32 octets minimum |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | Widget du domaine Preview, action `boreal-session` |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Identifiants de l’application Access du personnel |

Aucun SID, token ni service Twilio n’est nécessaire. Le code Verify/Messaging reste présent derrière le mode explicite `sms` pour une version ultérieure. `nodejs_compat` n’est pas requis par ce Worker.

## Connexion des gestionnaires : configuration unique par l’hébergeur

Dans Cloudflare Zero Trust → Settings → Authentication, activer **One-time PIN** pour la connexion par courriel. Créer une application Access pour les chemins privés de l’alias Preview (`/admin*`, `/v3/admin*`, `/api/admin/*`), autoriser uniquement les courriels du personnel et choisir **Session duration: 24 hours**. Ne pas protéger tout le jeu public par un compte joueur. La même protection côté Worker ferme les autres alias dont la politique ne serait pas configurée.

Dans la D1 Preview, préautoriser chaque compte par une instruction avec ses véritables coordonnées, sans mettre les courriels réels dans Git :

```sql
INSERT INTO employees(sub,email,name,role,active)
VALUES('invite:courriel@exemple.ca','courriel@exemple.ca','Nom du gestionnaire','manager',1);
```

Remplacer les quatre renseignements ; courriel en minuscules. Utiliser `staff` pour un employé qui valide seulement les bons. Le premier code de connexion par courriel lie automatiquement ce compte à son identité Access vérifiée : aucun identifiant technique à récupérer par le personnel. Un courriel non autorisé ou un compte inactif reste refusé. Les gestionnaires n’ont pas besoin d’un compte Cloudflare ni d’en ouvrir le tableau de bord.

## Recette avant ouverture aux clients

Vérifier le diagnostic privé `/api/admin/setup` et son schéma complet. Jouer une vraie partie admissible, enregistrer nom et téléphone, conserver le code, retrouver le client dans l’administration et consommer le code une fois. Vérifier ensuite même téléphone/autre nom, même navigateur/autre téléphone, poursuite illimitée du jeu, exception justifiée et blocage d’une deuxième consommation. Ne pas transférer les données Preview vers Production. Avant le lancement officiel autorisé, régler 100 $ pour ce mois et les suivants et vérifier les conditions alimentaires et les modalités définitives de la promotion.

Les accès Cloudflare du projet ne sont pas connectés à cet environnement de développement : le déploiement de code peut être constaté par GitHub/Cloudflare, mais les liaisons et comptes réels ne peuvent pas être déclarés configurés sans vérification sur le compte de l’hébergeur.
