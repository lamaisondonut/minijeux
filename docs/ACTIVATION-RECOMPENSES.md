# Recette réelle en Preview — aucune publication de production

Le propriétaire autorise les vrais SMS Twilio et les vrais codes pour cet essai interne, avec consommation des codes **sans rabais dans Lightspeed**. Les codes gardent leur format normal. Production, `livraison-v3` et l’ouverture aux clients restent inchangées. La validation RACJ reste nécessaire avant la promotion réelle.

## Ordre de configuration

1. Créer **`defi-boreal-recompenses-preview`**, distincte de **`defi-boreal-recompenses`**. Dans Pages → `minijeux` → Settings → Bindings → **Preview**, lier `DB` à cette nouvelle base. Ne pas modifier la liaison Production. Les liaisons Preview sont partagées entre branches Preview du projet.
2. Sur cette base **vide uniquement**, suivre le [schéma console](../proposals/sql/preview_schema_development.sql) : PRAGMA, lecture `application_tables=0`, puis chaque instruction complète dans l’ordre. Terminer par l’insertion du réglage initial et la vérification des clés étrangères. Pour une base existante, voir [l’ordre des migrations et leur exécution atomique](AUDIT-BUDGET-CONFIGURABLE.md#sql--fichiers-séparés-ordre-dexécution). Ne rien appliquer à la base Production.
3. Déployer la branche `develop/noel-budget-configurable`, répertoire publié `v3`. `APP_ORIGIN` doit correspondre exactement à l’alias HTTPS renvoyé par Cloudflare, prévu : `https://develop-noel-budget-configur.minijeux-4gy.pages.dev`. Les écritures sur une autre origine sont volontairement refusées.
4. Protéger la Preview réservée aux testeurs par Cloudflare Access, comptes individuels et MFA. Configurer `ACCESS_TEAM_DOMAIN` et `ACCESS_AUD`. Pour chaque employé, se connecter puis relever son `sub` et son email vérifiés via `/api/admin/identity`. Le responsable de D1 ajoute ensuite un employé actif. Exemple à remplacer par les valeurs **réellement vérifiées** :

```sql
INSERT INTO employees(sub,email,name,role,active)
VALUES('IDENTIFIANT_ACCESS_VERIFIE','EMAIL_ACCESS_VERIFIE','NOM_EMPLOYE','manager',1);
```

Utiliser `staff` pour le personnel. Ne pas utiliser de compte partagé. Ce contrôle d’accès à l’environnement d’essai ne crée pas de compte joueur dans le mini-jeu.

5. Configurer les variables et secrets serveur **Preview seulement** :

| Paramètre | Valeur attendue |
|---|---|
| `REWARDS_HMAC_SECRET` | Valeur aléatoire distincte de Production, 32 octets minimum |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | Clés du même widget, domaine de la Preview et action `boreal-session` |
| `SMS_PROVIDER` | `twilio` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Compte réel autorisé pour la recette ; ne pas les transmettre dans le chat |
| `TWILIO_VERIFY_SERVICE_SID` | Service Verify `VA…` pour le code de vérification |
| `TWILIO_MESSAGING_SERVICE_SID` | Service Messaging `MG…` avec expéditeur autorisé, pour le SMS contenant le bon |
| `SMS_DAILY_LIMIT` | Plafond explicite d’essai entre 1 et 100, p. ex. 10 demandes Verify |
| `NOTIFICATION_SMS_DAILY_LIMIT` | Plafond distinct, p. ex. 10 messages de bons ; plusieurs segments possibles par message |
| `DEPLOYMENT_ENVIRONMENT` | `preview` |
| `PREVIEW_TEST_REDEMPTION` | `true`, exclusivement pour consommer les codes sans rabais pendant cette recette |

Configurer aussi les destinations autorisées, les restrictions géographiques et les limites financières du compte Twilio. Si le compte est en essai, le numéro destinataire doit être autorisé selon ses règles. Aucun financement ni changement de forfait n’est effectué par le code.

6. Pour cet essai interne autorisé seulement, configurer en **Preview** `REWARDS_ENABLED=true`, `SMS_APPROVED=true`, `TERMS_APPROVED=true`, `NOTIFICATION_SMS_ENABLED=true`, et `MANUAL_REWARDS_ENABLED=true` si le parcours manuel est testé. Ces valeurs ne constatent aucune validation RACJ et ne doivent pas être copiées en Production. Restreindre l’environnement aux testeurs. Redéployer la Preview après modification de ses liaisons et paramètres.
7. Le gestionnaire connecté ouvre `/api/admin/setup` et vérifie `database.connected=true`, `database.schemaReady=true`, aucune colonne/table/protection manquante. Le diagnostic ne contacte pas les fournisseurs et ne prouve aucun SMS reçu. Puis suivre la recette ci-dessous.

## Recette du parcours client

- Ouvrir le jeu de Noël. Aucun nom ni téléphone demandé avant le départ.
- Jouer une partie admissible avec les vrais contrôles. Le serveur rejoue les actions ; aucun score déclaré ne force un gain.
- Après le palier admissible, saisir nom et téléphone autorisé, recevoir le SMS Verify et confirmer le code.
- Essayer aussi le retour **Modifier mon numéro**, le renvoi après 60 secondes et une erreur de saisie. Score, réservation et échéance initiale doivent rester identiques ; l’ancienne vérification doit être refusée après une nouvelle demande. Maximum cinq demandes par partie.
- Constater le code attribué et le second SMS contenant score, montant, code et conditions alimentaires. Vérifier dans D1 via l’administration le bénéficiaire, le montant, le budget et le statut.
- Prendre le code en charge puis cocher **consommation pour l’essai Preview, sans rabais**. Aucun rabais à appliquer dans Lightspeed. Le code devient définitivement utilisé ; l’audit enregistre l’employé, la date et **0 $ réellement appliqué**. Une seconde utilisation doit échouer.
- Tester séparément le gestionnaire : budget ce mois seulement/reconduit, bon manuel, confirmations et justifications des deux exceptions. Le SMS manuel ne contient aucun faux score.

Un téléphone déjà gagnant depuis 30 jours est normalement bloqué. Pour répéter les tests, utiliser d’autres numéros autorisés ou le parcours manuel avec dérogation justifiée ; ne pas modifier les protections des joueurs ni effacer l’historique pour simuler un succès.

## Avant le lancement officiel

Conserver les données Preview séparées, sans transférer ses codes dans Production. Après validation réglementaire, recette complète et autorisation explicite de publication, préparer la base Production sans données d’essai. Dans son administration, régler **100 $**, portée **ce mois-ci et les suivants**, puis vérifier le montant récurrent. Ne pas effacer les dépenses réelles pour forcer un solde.

`PREVIEW_TEST_REDEMPTION` doit être désactivé et absent en Production ; le serveur refuse ce parcours sur l’adresse Production. Le personnel utilisera alors la [procédure alimentaire réelle](PROCEDURE-EMPLOYES.md). Aucune publication ni activation de production n’est autorisée par ce document.

La limite CPU Cloudflare applicable à la relecture doit aussi être mesurée en Preview avant ouverture. Un test Node ou workerd local ne mesure pas le quota CPU du compte hébergé. Les accès Cloudflare/Twilio manquent à l’environnement de développement actuel ; aucun SMS réel ni liaison distante n’est donc déclaré vérifié.
