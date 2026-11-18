# Mise en service — jeu et administration

Branche : `develop/noel-budget-configurable`. Répertoire publié : `v3`.
La branche `livraison-v3` et la base de production restent inchangées.

- Jeu : <https://develop-noel-budget-configur.minijeux-4gy.pages.dev/>
- Administration : <https://develop-noel-budget-configur.minijeux-4gy.pages.dev/admin/>

## Ce qui nécessite le compte de l’hébergeur

Le binding `DB` existe déjà dans Preview, selon la vérification du propriétaire.
Les variables Preview sont vides. L’environnement de développement n’a ni accès
au compte Cloudflare, ni secrets, ni identité permettant d’y intervenir. Le
déploiement du code n’ajoute pas les réglages de compte décrits ci-dessous.

### 1. Base de données : inspection et séparation

Dans **Storage & databases → D1 → defi-boreal-recompenses → Console**, exécuter
uniquement [inspect_schema_readonly.sql](../proposals/sql/inspect_schema_readonly.sql).
Ce fichier lit les tables, les marqueurs de migration, les colonnes et les liens
entre données. Il ne modifie rien. Ne pas réappliquer une migration déjà présente.

Si `defi-boreal-recompenses` est également liée à Production, créer une base
`defi-boreal-recompenses-preview` puis changer **uniquement** la liaison Preview
dans **Workers & Pages → minijeux → Settings → Bindings → Preview → DB**.
Garder la base de Production et toutes ses données. Une branche distincte n’isole
pas une liaison D1 partagée. Les bases ne doivent pas être fusionnées pour la bascule.

Sur une base existante, appliquer seulement les migrations manquantes après
inspection, dans l’ordre `0001` à `0009`. Les migrations `0002` et suivantes
doivent chacune être exécutées en un batch D1 atomique complet, jamais en
séparant leurs opérations de reconstruction. Elles préservent les enregistrements.
Sur une base neuve dont l’inspection a confirmé **zéro table applicative**, le
[schéma final existant](../proposals/sql/preview_schema_development.sql) est disponible.
Ne jamais employer ce schéma neuf sur une base existante.

Aucune migration supplémentaire n’est nécessaire pour les statistiques et la
gestion des employés : elles utilisent les tables existantes.

### 2. Variables Preview

Ouvrir **Workers & Pages → minijeux → Settings → Variables and secrets**,
sélectionner **Preview**, puis ajouter les valeurs suivantes. Ne pas changer
Production. `APP_ORIGIN` doit être sans barre oblique finale.

| Variable | Valeur |
| --- | --- |
| `APP_ORIGIN` | `https://develop-noel-budget-configur.minijeux-4gy.pages.dev` |
| `PHONE_VERIFICATION_MODE` | `unverified` |
| `REWARDS_ENABLED` | `true` |
| `MANUAL_REWARDS_ENABLED` | `true` |
| `TERMS_APPROVED` | `false` tant que les conditions définitives ne sont pas explicitement approuvées ; `true` uniquement après cette validation |
| `SMS_APPROVED` | `false` |
| `NOTIFICATION_SMS_ENABLED` | `false` |
| `SMS_DAILY_LIMIT` | `0` |
| `DEPLOYMENT_ENVIRONMENT` | `preview` |
| `PREVIEW_TEST_REDEMPTION` | `false` |
| `REWARDS_HMAC_SECRET` | **Secret** aléatoire stable d’au moins 32 octets, enregistré uniquement dans Cloudflare |
| `TURNSTILE_SITE_KEY` | Clé publique réelle du widget Turnstile configuré pour l’alias Preview |
| `TURNSTILE_SECRET` | **Secret** réel du même widget |
| `ACCESS_TEAM_DOMAIN` | Domaine réel de l’équipe Access, sans `https://`, terminé par `.cloudflareaccess.com` |
| `ACCESS_AUD` | Audience réelle de l’application Access du restaurant |

Les identifiants Access et les clés Turnstile ne sont pas inventables. Aucun
identifiant Twilio, secret SMS ou forfait SMS n’est nécessaire au lancement.
`nodejs_compat` n’est pas nécessaire pour ce Worker utilisant les API Web.
Si une clé HMAC protège déjà des récompenses, la conserver : la remplacer
empêcherait de relire les téléphones chiffrés et leurs identifiants de contrôle.
Ne pas communiquer les secrets dans la conversation ou les ajouter dans Git.

Dans **Turnstile → Add widget**, autoriser le nom d’hôte
`develop-noel-budget-configur.minijeux-4gy.pages.dev`, choisir **Managed**, puis
recopier la clé publique et le secret dans les deux variables correspondantes.
Le code utilise l’action `boreal-session` et valide l’hôte côté serveur.

### 3. Connexion du gestionnaire et du personnel

Dans **Zero Trust → Integrations → Identity providers**, activer **One-time PIN**.
Selon la version du tableau de bord, cette section apparaît sous
**Settings → Authentication → Login methods**.

Dans **Zero Trust → Access controls → Applications → Add an application →
Self-hosted**, créer une seule application avec les chemins privés de l’alias :

- `develop-noel-budget-configur.minijeux-4gy.pages.dev/admin*`
- `develop-noel-budget-configur.minijeux-4gy.pages.dev/v3/admin*`
- `develop-noel-budget-configur.minijeux-4gy.pages.dev/api/admin/*`

Choisir **One-time PIN** comme méthode de connexion. Une politique **Allow →
Include → Login Methods → One-time PIN** permet d’authentifier les courriels par
code. Elle ne remplace pas la liste d’autorisation du jeu : le Worker vérifie
ensuite, sur chaque page et chaque requête privée, que ce courriel appartient à
un employé D1 actif. Seuls les comptes préautorisés obtiennent accès au registre.
Ne pas créer de règle **Bypass** ni protéger le jeu public par une connexion.
Cette combinaison permet ensuite d’ajouter et de désactiver les employés dans
l’administration, sans modifier la politique Cloudflare pour chaque courriel.

Recopier le **Team domain** dans `ACCESS_TEAM_DOMAIN` et le **Application Audience
(AUD) Tag** de cette application dans `ACCESS_AUD`.

Pour éviter une reconnexion quotidienne : **Application session duration :
7 days**, politique **Same as application**, et **Access controls → Access
settings → Global session duration : 1 month**. Access renouvelle le jeton
d’application si la session globale demeure valable et la politique l’autorise.
La désactivation D1 refuse immédiatement les nouvelles requêtes, même avant
l’expiration du jeton. Le lien **Se déconnecter** ferme la session de l’appareil.
La révocation complète reste disponible dans la fiche utilisateur Access en cas
de compromission. Aucun jeton permanent n’est créé.

Préautoriser le gestionnaire avec le fichier SQL individuel préparé séparément,
après vérification de la table `employees`. Il n’est pas publié dans le dépôt
pour ne pas exposer son courriel personnel. Le script préserve l’identité Access
déjà liée si le compte existe. Le premier code reçu par courriel lie une nouvelle
invitation à l’identité Access vérifiée, sans compte Cloudflare pour le restaurant.

### 4. Redéployer et constater le résultat

Après enregistrement des variables et liaisons, ouvrir **Deployments**, choisir le
dernier déploiement de `develop/noel-budget-configurable`, puis **Retry deployment**.
Les variables de compte ne deviennent pas effectives dans un ancien déploiement.

Après connexion du gestionnaire, le diagnostic privé `/api/admin/setup` doit
indiquer `database.schemaReady: true`. Le tableau de bord doit afficher les
données D1 et le formulaire de gestion du budget. Le budget initial du schéma
est **100 $ CA**. Le gestionnaire peut confirmer **100 $ → ce mois-ci et les mois
suivants** ; aucun gain ni engagement existant n’est réinitialisé.

Tant que `TERMS_APPROVED=false`, le mode sans récompense demeure intentionnel.
Après approbation explicite des conditions et réglage de ce drapeau à `true`,
`rewardsConfigured` doit être vrai et le jeu propose les paliers disponibles.
Si le budget est épuisé, l’absence de nouvelle récompense est normale.

## Politique de confidentialité et ouverture

Le jeu conserve son règlement complet. Le lien vers le site du restaurant est
présent. L’URL exacte de sa politique n’a pas pu être confirmée dans les pages
publiques consultables ; ne pas remplacer ce lien par une adresse supposée.
Avant approbation des conditions, vérifier que la politique indique les finalités
liées au jeu, le prénom/nom/téléphone déclaré, les codes et historiques, les
identifiants de contrôle, le contact responsable, les durées de conservation,
les droits et les destinataires Cloudflare ainsi que les traitements hors Québec.
Ce sont les points précis à compléter si la politique ne les couvre pas.

## Sources de configuration

- [Sessions Access](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [Politiques Access](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [Connexion One-time PIN](https://developers.cloudflare.com/cloudflare-one/identity/one-time-pin/)

## Vérifications exécutées sur cette livraison

- Mécaniques V3 : 740 assertions.
- Accueil : 1 112 contrôles responsive sur 11 formats et trois modes, plus
  174 contrôles accueil/animations et 139 contrôles du parcours client.
- Administration : 23 scénarios Chromium, dont téléphones/tablettes/ordinateur,
  statistiques indisponibles sans chiffres fictifs, ajout et révocation du
  personnel, audit global, expiration pendant une opération et reconnexion.
- Serveur : 29 scénarios API, 4 d’authentification, 15 de budget, 15 de concurrence,
  3 de statistiques et 9 de gestion des employés.
- Worker compilé : sept combinaisons de date/drapeaux, Pages avec vraie D1 locale,
  score rejoué côté serveur, attribution unique sans aucun secret Twilio,
  recherche privée, prise en charge exclusive, usage unique, statistiques,
  invitation par courriel et révocation immédiate.
- Le SQL de préautorisation a été exécuté sur une base locale existante : deux
  applications ne créent pas de doublon et préservent une identité Access déjà liée.

Les services externes (Access, Turnstile, SMS historique) sont remplacés par des
réponses contrôlées dans les tests. Aucune récompense d’essai n’a été créée dans
une D1 distante. Ces résultats ne constituent pas une vérification des réglages
réels du compte Cloudflare, qui restent à effectuer par l’hébergeur.
