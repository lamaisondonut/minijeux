# Appliquer un bon de rabais — Les Boréalistes

La promotion reste fermée avant validation réglementaire et configuration. Cette procédure concerne les comptes individuels autorisés dans `/admin/`, sur téléphone, tablette ou ordinateur.

**Rabais applicable uniquement aux aliments. Ne pas réduire le prix des boissons alcooliques, directement ou indirectement.** Une facture mixte est admissible pour sa portion alimentaire seulement. Une facture uniquement alcoolisée est refusée. Le rabais ne dépasse jamais la valeur des aliments admissibles ; le reliquat est perdu, sans échange contre de l’argent.

## Utiliser un code

1. Se connecter avec son compte et vérifier son nom. Rechercher le code du client. Vérifier le nom, la valeur et la date limite.
2. Cliquer **PRENDRE EN CHARGE** et confirmer. **Attendre le statut « Pris en charge » à son nom avant de toucher à la facture.** Le serveur verrouille alors le code ; un autre employé ne peut pas le prendre ni le terminer.
3. Saisir la valeur des aliments admissibles dans la fiche. Elle affiche le rabais à appliquer et la portion inutilisée qui sera perdue. Si aucun aliment n’est admissible, ne pas appliquer le bon.
4. Vérifier la facture puis appliquer **manuellement dans Lightspeed**, une seule fois, ce montant sur les aliments admissibles. Aucun appel à l’API Lightspeed et aucune référence Lightspeed ne sont nécessaires.
5. Cocher la confirmation des aliments seulement et **« Le rabais a été appliqué sur la facture »**, puis confirmer. Attendre **« Rabais appliqué »**. Le code entier est définitivement utilisé, même si le rabais était partiel.

Exemple : bon de 20 $, aliments admissibles de 12 $ et boissons alcooliques de 15 $. Appliquer 12 $ aux aliments seulement. Les boissons restent à leur prix normal et les 8 $ restants sont perdus. Le registre conserve la valeur attribuée de 20 $, la valeur appliquée de 12 $ et la perte de 8 $. Le budget ne reçoit aucun remboursement.

## Statuts et incidents

| Statut | Consigne |
|---|---|
| À utiliser | Vérifier puis prendre en charge avant tout rabais. |
| Pris en charge | Seul l’employé nommé peut terminer. Ne pas appliquer un deuxième rabais. |
| Rabais appliqué / Déjà utilisé | Opération terminée ; aucun nouveau rabais pour ce code. |
| Code expiré / Annulé / Introuvable | Aucun rabais à appliquer. |

Après une coupure, actualiser la fiche et vérifier **la facture existante** avant toute action. Si le rabais est déjà appliqué, reprendre uniquement son enregistrement avec le même compte et le même montant alimentaire. Ne pas l’appliquer à nouveau. En cas de responsable absent, prévenir le gestionnaire ; ne pas emprunter un compte pour contourner le verrou. Une confirmation dans le site ne vérifie pas automatiquement la caisse.

## Gestionnaire : créer un bon manuellement

Dans **Créer un bon manuellement**, saisir le prénom, le nom, le téléphone, la valeur (5 $, 10 $ ou 20 $) et une justification. Le téléphone sert au contrôle des gains et au SMS ; cette action manuelle ne prouve pas une vérification d’identité par SMS.

Cliquer **Vérifier le budget et les exceptions**. Vérifier le plafond, les montants attribués et réservés, le nouveau bon et le dépassement total exact. Un dépassement exige sa propre case d’autorisation et sa justification. Un gain déjà attribué à ce téléphone depuis 30 jours exige une seconde autorisation avec sa justification. Confirmer ensuite pour obtenir un seul code. Si le budget ou les gains ont changé, recalculer et confirmer les nouveaux chiffres.

Un dépassement reste comptabilisé dans les dépenses et ne relève jamais le plafond configuré. L’exception ne devient pas disponible aux joueurs. Le code créé suit ensuite le même parcours de prise en charge et de rabais alimentaire.

Après une erreur réseau, utiliser **Réessayer la même émission** : la demande conservée renvoie le code existant. Ne pas repartir avec une nouvelle émission sans vérifier le registre. Après fermeture de la page, rechercher les derniers bons avant de recommencer.

## Budget et SMS

Le gestionnaire choisit **ce mois-ci seulement** ou **ce mois-ci et les mois suivants jusqu’à modification**. La confirmation rappelle les anciens et nouveaux montants. Les dépenses et réservations existantes sont conservées. Aucun solde inutilisé n’est reporté au mois suivant. Les exceptions restent identifiées dans le mois où elles ont été autorisées.

Le code peut être envoyé par SMS après attribution. Pour le renvoyer, saisir le même téléphone dans la fiche ; les envois sont limités. « Pris en charge par le fournisseur » ne prouve pas la réception. Si un envoi est incertain, vérifier les messages avant un renvoi explicite. Un renvoi conserve le même code et **ne renouvelle pas sa date limite**. Les SMS de vérification et les SMS contenant le bon sont distincts.

L’historique conserve les employés, dates, heures, montants et justifications. Le CSV contient des données clients : le conserver dans un espace autorisé. Se déconnecter sur les appareils partagés.

Ces restrictions alimentaires sont une mesure de prudence, sans garantie de conformité. L’ouverture attend la validation auprès de la RACJ et la finalisation du règlement.
