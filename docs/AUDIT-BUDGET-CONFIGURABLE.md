**Version actuelle : lancement sans SMS, jeu illimité, contrôles téléphone/navigateur et accès du personnel par courriel. Voir [la procédure actuelle](LANCEMENT-SANS-SMS.md). Les descriptions SMS ci-dessous concernent désormais le mode optionnel futur.**

# Budget configurable, rabais alimentaires et administration — branche de développement

Branche : `develop/noel-budget-configurable`, issue de `develop/noel-recompenses-v1` au commit `6aa8273`. La branche de production `livraison-v3` n’est pas modifiée. Aucune migration distante, activation de gains, modification de liaison ou publication de production n’est effectuée par ce travail.

## État analysé

La migration originale `0001_rewards.sql` reste inchangée. Les 8 tables, 6 index et 11 déclencheurs que l’exploitant déclare avoir installés correspondent à cette version. La confirmation vient de l’exploitant : aucune lecture directe de la D1 distante n’a été effectuée ici.

Le schéma 0001 impose `used_cents + reserved_cents <= 10000`, et le code initial utilise 100 $ dans le statut public, la réservation et le tableau de bord. Modifier seulement l’interface ou ajouter une colonne ne retire pas cette contrainte. Les anciens déclencheurs imposent une référence Lightspeed et présentent des lacunes d’intégrité sur les NULL, l’état initial et l’immutabilité des métadonnées.

Les changements de cette branche remplacent la carte-cadeau par un **bon de rabais alimentaire**. Aucun système d’émission ni API Lightspeed n’est intégré. Les images, les sprites, Jacques, la physique, les obstacles et le moteur partagé de Noël restent ceux de la branche source. Les textes du jeu sont adaptés aux nouvelles conditions.

## Changements dans le code

- **Budget configurable** : plafond par mois et valeur par défaut des nouveaux mois. Le gestionnaire choisit « ce mois-ci seulement » ou « ce mois-ci et les mois suivants ». Les mois futurs déjà créés sont également mis à jour dans le second cas ; les mois historiques restent inchangés. Aucune somme inutilisée n’est reportée.
- **Concurrence** : modifications du budget atomiques avec versions du mois et du montant récurrent, clé de demande durable et audit. Les engagements non couverts par des autorisations exceptionnelles ne peuvent pas être supprimés par une baisse du budget.
- **Bons du jeu** : score recalculé côté serveur, réservation préalable, montant 5/10/20 $, téléphone contrôlé et code aléatoire 128 bits. Le plafond normal limite toujours les nouvelles réservations, même si des dépenses exceptionnelles existent.
- **Bons manuels** : création réservée à un gestionnaire actif authentifié par Access. Aucun faux score ni fausse partie : origine `manual`, score et partie absents. Téléphone conservé seulement sous HMAC dans D1. La dérogation aux 30 jours et le dépassement exigent des confirmations et des justifications distinctes. Une proposition devenue périmée est refusée ; les répétitions d’une même demande ne créent pas de nouveau code.
- **Dépassement** : autorisation exceptionnelle cumulée séparément, dépense attribuée dans le mois, plafond normal inchangé. La portion exceptionnelle du nouveau bon est `max(0, utilisé+réservé+bon-plafond) - max(0, utilisé+réservé-plafond)`. Le crédit exceptionnel n’est jamais offert au moteur du jeu.
- **Utilisation** : prise en charge exclusive par un employé avant rabais dans la caisse, confirmation explicite du rabais alimentaire appliqué, même employé jusqu’à la fin. Le serveur calcule `min(valeur du bon, aliments admissibles saisis)`. Montant alimentaire positif obligatoire ; aucun reliquat ni argent rendu. Le bon entier est consommé. Les anciennes opérations restent historiques et terminales, sans inventer une attestation alimentaire rétroactive.
- **SMS du gain** : intégration Twilio Programmable Messaging distincte de Verify, envoi initial et renvoi du même code, plafonds et journal durable. Aucun téléphone en clair ni contenu de message dans D1. Une réponse fournisseur ambiguë n’est jamais automatiquement rejouée. Un accusé d’acceptation n’est pas une preuve de livraison.
- **Conditions** : aliments seulement, aucun rabais direct ou indirect sur l’alcool, factures mixtes limitées aux aliments, facture uniquement alcoolisée refusée, montant plafonné aux aliments, portion inutilisée perdue sans argent. Affichage dans le menu avant participation, le règlement, la confirmation, l’administration et les SMS.

Les contrôles de rôle, d’origine, de schéma, d’idempotence et les écritures atomiques sont côté serveur. Le public ne reçoit ni solde interne, ni justification d’exception, ni identité des employés. Un numéro vérifié ne prouve pas l’unicité d’une personne. La règle existante est une période glissante de 30 jours par téléphone ; l’exception manuelle n’en efface pas l’historique.

## SQL : fichiers séparés, ordre d’exécution

Sur une base qui possède déjà 0001 :

1. [`0002_configurable_budget.sql`](../migrations/0002_configurable_budget.sql) — reconstruit les budgets en préservant les soldes et ajoute la configuration récurrente.
2. [`0003_manual_discounts.sql`](../migrations/0003_manual_discounts.sql) — retire l’obligation de référence Lightspeed, protège les transitions et les attestations.
3. [`0004_manual_rewards_food_only.sql`](../migrations/0004_manual_rewards_food_only.sql) — conserve les données, ajoute les dépenses exceptionnelles, les émissions manuelles et la confirmation alimentaire avec montant appliqué.
4. [`0005_reward_notification_sms.sql`](../migrations/0005_reward_notification_sms.sql) — registre des SMS de gain et quota distinct ; aucun SMS envoyé par la migration.
5. [`0006_phone_correction.sql`](../migrations/0006_phone_correction.sql) — correction du téléphone et renvoi avec invalidation de la vérification précédente, sans prolonger la réservation.
6. [`0007_preview_test_consumption.sql`](../migrations/0007_preview_test_consumption.sql) — consommation en Preview sans fausse attestation de rabais dans la caisse.

**Chaque fichier de mise à niveau doit être exécuté en entier dans un seul batch transactionnel D1. Ne pas exécuter ses DROP/ALTER/CREATE une à une dans la console sur une base existante.** D1 gère la transaction ; ne pas ajouter de `BEGIN/COMMIT` dans une requête D1. Les reconstructions vérifient les clés étrangères avant de réinitialiser le report des contraintes. Une erreur doit annuler le fichier entier.

Pour les vérifications de la base 0001, [`00_readonly_preflight.sql`](../proposals/sql/00_readonly_preflight.sql) contient uniquement des lectures, exécutables séparément.

### Console seulement : nouvelle base Preview vide

Créer une base **distincte** `defi-boreal-recompenses-preview`. Le fichier [`preview_schema_development.sql`](../proposals/sql/preview_schema_development.sql) fournit directement le schéma final, sans reconstruction ni destruction de table. Exécuter d’abord PRAGMA puis SELECT : `application_tables` doit être **0**. Copier ensuite chaque instruction complète dans son ordre ; un `CREATE TRIGGER … BEGIN … END;` est une seule instruction. Terminer avec l’insertion du réglage initial et `PRAGMA foreign_key_check`, qui ne doit retourner aucune violation. Schéma final : **11 tables applicatives, 10 index explicites, 14 déclencheurs**.

Ce fichier est réservé à une base vide. Ne pas mélanger cette installation complète avec une application ultérieure des anciennes migrations sans aligner auparavant le journal des migrations. Aucun script n’applique automatiquement des migrations à distance.

Pour une base existante avec données, employer le mécanisme transactionnel de migrations D1 avec un intervenant technique. Le parcours console instruction par instruction n’est pas sûr pour sa reconstruction. Aucune commande de production ne doit être lancée avant validation et sauvegarde.

## Configuration manuelle de Preview

1. Dans Pages `minijeux`, remplacer **uniquement Preview → DB** par `defi-boreal-recompenses-preview`. Laisser Production → `defi-boreal-recompenses`. La liaison Preview est commune aux branches Preview du projet : une branche Git seule n’isole pas les données.
2. Garder `v3` comme répertoire publié. Le Worker généré ne dépend pas de Node ; conserver les paramètres documentés dans `wrangler.preview.example.jsonc`, sans activer `nodejs_compat` pour résoudre cette application.
3. Renseigner `APP_ORIGIN` avec l’alias HTTPS exact du déploiement de cette branche. Protéger cet alias et ses chemins `/admin*`, `/v3/admin*` et `/api/admin/*` par Cloudflare Access. Comptes individuels et MFA, puis liste `employees` avec rôles `staff`/`manager` et identités Access vérifiées. Ne pas créer d’identifiants dans le code public.
4. Configurer Turnstile : domaine de cet alias, action `boreal-session`, clé publique `TURNSTILE_SITE_KEY`, secret `TURNSTILE_SECRET`. Ajouter `REWARDS_HMAC_SECRET` (32 octets minimum).
5. Configurer Twilio Verify : `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `SMS_PROVIDER=twilio`, plafond explicite `SMS_DAILY_LIMIT`. Les vrais essais de SMS et leur coût attendent l’autorisation d’essai du compte ; les tests automatisés simulent uniquement le fournisseur.
6. Pour le SMS contenant le bon, préparer aussi un service **Twilio Messaging** et son expéditeur autorisé : `TWILIO_MESSAGING_SERVICE_SID`, `NOTIFICATION_SMS_DAILY_LIMIT`. Verify seul ne permet pas ces messages libres. Le quota compte des demandes, pas les segments facturés : les textes français et les conditions peuvent occuper plusieurs segments. Configurer les limites financières et géographiques du fournisseur.
7. Conserver **`REWARDS_ENABLED=false`, `MANUAL_REWARDS_ENABLED=false`, `NOTIFICATION_SMS_ENABLED=false`, `SMS_APPROVED=false`, `TERMS_APPROVED=false`**. Le code, les migrations ou la connexion à D1 ne constituent aucune autorisation d’activation. Redéployer uniquement la Preview après changement de ses liaisons.

## Validation avant ouverture

D’abord tester la base isolée, l’accès de chaque rôle, le diagnostic privé `/api/admin/setup`, les devis périmés, le budget récurrent et les exceptions. Puis effectuer des essais fournisseur approuvés sur des numéros de test et vérifier la réception effective, le coût et les limites. Tester une facture alimentaire, une facture mixte et le refus d’une facture uniquement alcoolisée avec le personnel. La caisse manuelle ne peut pas être vérifiée automatiquement par le serveur.

Faire confirmer auprès de la RACJ les modalités finales et ajuster le règlement avant d’activer les gains. Les restrictions actuelles sont une mesure de prudence, **pas une garantie de conformité légale**. Finaliser également les informations manquantes de [`RENSEIGNEMENTS-LEGAUX.md`](RENSEIGNEMENTS-LEGAUX.md).

Les tests locaux et leurs limites sont consignés dans [`TESTS-RECOMPENSES.md`](TESTS-RECOMPENSES.md). Aucun résultat local ne prouve la configuration de la base distante, la livraison d’un SMS réel ou la validation réglementaire.

## Priorité actuelle : recette Preview avec vrais SMS et codes

Le propriétaire autorise les vrais SMS et les vrais codes pour une **recette interne isolée**, sans rabais dans Lightspeed. Cette autorisation ne vaut pas ouverture de la promotion ni publication de production. L’environnement de développement présent ne possède ni accès connecté Cloudflare/Twilio, ni secrets de ces comptes ; les services réels ne sont donc pas déclarés testés.

Après création de la base Preview distincte, schéma complet et accès du personnel, configurer les fournisseurs et le numéro de destination autorisé. Réserver cette Preview aux testeurs pendant l’essai. Pour la seule Preview, le responsable de la configuration pourra activer les paramètres nécessaires à l’essai approuvé (`REWARDS_ENABLED`, `SMS_APPROVED`, `TERMS_APPROVED`, et si testés `MANUAL_REWARDS_ENABLED`/`NOTIFICATION_SMS_ENABLED`). Ici `TERMS_APPROVED` traduit l’autorisation de l’essai interne ; **les variables Production restent à false** et l’ouverture aux clients attend toujours la validation RACJ. Le règlement public reste marqué fermé tant que les renseignements définitifs ne sont pas publiés.

Pour consommer un code d’essai sans rabais, configurer exclusivement Preview : `DEPLOYMENT_ENVIRONMENT=preview` et `PREVIEW_TEST_REDEMPTION=true`. Le serveur exige un sous-domaine de prévisualisation de `minijeux-4gy.pages.dev` et refuse ce parcours sur `https://minijeux-4gy.pages.dev`, même si le drapeau y est ajouté accidentellement. Le code ne porte aucun marqueur visuel de test. Dans l’administration, la confirmation de consommation pour l’essai est explicite, le code est définitivement bloqué, et l’audit conserve `preview_test_used`, l’employé et un montant réellement appliqué de 0 $. Il n’enregistre jamais un rabais fictif comme appliqué.

Le joueur ne saisit aucun numéro avant de jouer. Après le score admissible : saisie du numéro, SMS Verify, possibilité de **Modifier mon numéro**, puis nouvelle vérification. La nouvelle demande invalide la précédente et conserve score, palier réservé et échéance initiale. **Renvoyer le code** attend 60 secondes ; cinq demandes maximum par partie et cinq essais de code par vérification, complétés par les limites globales. Une correction pendant une vérification en cours ne permet pas à l’ancien numéro d’obtenir le gain. Après attribution définitive, correction refusée ; un renvoi de notification conserve le même code et sa date d’origine.

Avant le lancement officiel : utiliser la base Production sans données d’essai, vérifier le budget **100 $** avec portée **ce mois-ci et les suivants**, conserver le journal de Preview séparément, désactiver `PREVIEW_TEST_REDEMPTION` et contrôler son absence en Production. Aucun compteur financier ne doit être remis artificiellement à zéro pour cacher des engagements réels. Ne pas copier les bons de Preview dans Production.
