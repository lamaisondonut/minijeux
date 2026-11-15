# Remettre une récompense de Noël

Cette procédure concerne les employés autorisés des Boréalistes. Enregistrer la page `/admin/` dans les favoris du téléphone, de la tablette ou de l’ordinateur utilisé au service. Elle affiche les vrais gagnants, le budget interne et l’historique des remises. Les cartes-cadeaux sont créées manuellement dans Lightspeed.

## Se connecter

1. Ouvrir `/admin/` et se connecter avec son compte individuel.
2. Vérifier son nom dans le haut de la page. Le compte doit avoir été autorisé par le responsable.
3. Si « Accès employé requis » apparaît, transmettre au responsable le compte et l’identifiant affichés. Ne pas emprunter le compte d’un collègue.

## 1. Vérifier le code et le marquer comme utilisé

1. Demander au client son code de récompense et le rechercher. Sa fiche s’ouvre automatiquement, même si un autre statut était sélectionné.
2. Vérifier avec le client son nom, la valeur de la récompense, la date d’attribution et la date limite d’utilisation du code.
3. Pour un code « À utiliser », cliquer sur **MARQUER COMME UTILISÉ**. La fenêtre de confirmation rappelle le client, le code, le montant et l’employé responsable.
4. Confirmer, puis **attendre la confirmation**. Créer une carte seulement lorsque la fiche affiche **En cours de remise** et identifie son compte comme employé responsable.

Une seule utilisation du code est possible. Si deux employés essaient en même temps, un seul peut réussir. L’autre reçoit une erreur et doit relire la fiche actualisée. Un clic ou une animation de chargement ne constitue jamais une confirmation.

- **CODE INTROUVABLE :** vérifier le code présenté par le client. Aucune carte à créer.
- **CODE DÉJÀ UTILISÉ :** ne pas créer une autre carte. Si la fiche indique « En cours de remise », l’employé responsable doit reprendre la remise avec son compte.
- **CODE EXPIRÉ :** la date limite est dépassée. Aucune carte à créer.

## 2. Créer et remettre une seule carte dans Lightspeed

1. Vérifier si une carte a déjà été créée pour ce code, notamment en cas d’interruption ou de reprise du dossier.
2. Créer **manuellement dans Lightspeed** une seule carte-cadeau du montant exact indiqué sur la fiche.
3. Noter la référence Lightspeed puis remettre la carte au client.

L’application ne communique pas avec Lightspeed. Le passage à « En cours de remise » verrouille le code ; il ne crée aucune carte. Ne pas créer une carte avant ce verrouillage.

## 3. Enregistrer la remise réelle

1. Dans la fiche « En cours de remise », saisir la référence de la carte Lightspeed.
2. Cocher la confirmation d’une seule carte réellement remise au client.
3. Cliquer sur **Confirmer la carte remise**, puis attendre le statut **Carte remise**.

**Seul le compte de l’employé ayant utilisé le code peut enregistrer la remise.** Cela vaut aussi pour un responsable. Un collègue ne doit pas reprendre la création d’une carte sous prétexte que la fiche est encore « En cours de remise ».

## Comprendre les statuts

| Statut | Action à suivre |
| --- | --- |
| À utiliser | Vérifier le client et le montant, puis utiliser le code avant de créer la carte. |
| En cours de remise | Code déjà verrouillé. L’employé responsable vérifie Lightspeed et termine la remise. Ne pas créer une deuxième carte. |
| Carte remise | Opération terminée. Aucune nouvelle carte pour ce code. |
| Code expiré | La date limite d’utilisation du code est dépassée. Aucune carte à créer. |
| Annulé | Aucune carte à créer. Consulter le responsable si nécessaire. |

La limite de **30 jours** concerne l’utilisation du **code de récompense** à partir de sa confirmation. Elle ne représente pas la date d’expiration de la carte-cadeau. Le registre ne propose pas de retour de budget ni d’annulation par l’employé.

## En cas d’erreur ou d’interruption

- **Code déjà utilisé ou fiche modifiée :** relire la fiche actualisée et l’historique. Ne pas créer de carte supplémentaire.
- **Connexion interrompue pendant l’utilisation du code :** ne pas supposer que l’action a échoué. Actualiser et vérifier le statut avant d’ouvrir Lightspeed.
- **Connexion interrompue après la création de la carte :** la carte physique peut déjà exister. Vérifier Lightspeed et reprendre la même référence pour enregistrer la remise avec le même compte. Ne pas créer une nouvelle carte.
- **Employé responsable indisponible :** prévenir le responsable et vérifier les opérations Lightspeed. Ne pas utiliser un autre compte pour contourner le verrouillage.
- **Session expirée :** se reconnecter avec son propre compte, puis rechercher à nouveau le code. Aucune donnée client n’est conservée dans le stockage local du navigateur.

## Budget, export et fin de service

L’accueil présente le budget du mois de **100 $ CAD**, le montant attribué, le budget restant et les derniers gagnants. Le budget suit le mois civil au Québec, sans report. Les montants retenus pour des parties en cours sont indiqués sous les chiffres. Les gains expirés ou utilisés ne rétablissent pas le budget.

Les **codes à réclamer** comprennent tous les codes encore valides, y compris ceux attribués le mois précédent. Les **codes utilisés — total** comprennent tous les codes déjà utilisés, que la remise de la carte soit en cours ou terminée. Ces deux nombres couvrent tous les mois ; les montants du budget concernent uniquement le mois affiché. Les chiffres et les gagnants viennent du registre réel. Si les chiffres ne se chargent pas, utiliser **Actualiser**.

L’export CSV contient des données clients : le conserver uniquement dans un espace de travail autorisé et appliquer les règles internes de conservation. Ne pas le transmettre par un canal personnel.

Sur un appareil partagé, terminer avec **Se déconnecter**. Ce lien ferme la session Cloudflare Access.
