# Livraison de développement — 15 novembre 2026

Branche : `develop/noel-budget-configurable`. Production `livraison-v3` inchangée ; aucune migration distante ni activation de gains.

La version prépare les bons de rabais **exclusivement alimentaires**, le budget configurable avec choix de portée, les émissions manuelles réservées au gestionnaire et leurs exceptions justifiées, la confirmation exclusive de l’application sur facture, le suivi des montants partiels et les SMS du bon distincts de Verify. Aucune API Lightspeed ni référence obligatoire.

- [Analyse et paramètres manuels](AUDIT-BUDGET-CONFIGURABLE.md)
- [Migrations SQL et ordre d’exécution](AUDIT-BUDGET-CONFIGURABLE.md#sql--fichiers-séparés-ordre-dexécution)
- [Contrat API](API-RECOMPENSES.md)
- [Procédure des employés](PROCEDURE-EMPLOYES.md)
- [Tests et limites](TESTS-RECOMPENSES.md)
- [Renseignements encore nécessaires avant l’ouverture](RENSEIGNEMENTS-LEGAUX.md)

La Preview doit disposer d’une D1 distincte : la liaison Preview annoncée par l’exploitant pointe actuellement sur la même base que Production. Le nouveau schéma ne doit pas être appliqué à cette base de production pour préparer les essais.

`REWARDS_ENABLED=false`, `MANUAL_REWARDS_ENABLED=false`, `NOTIFICATION_SMS_ENABLED=false`, `SMS_APPROVED=false` et `TERMS_APPROVED=false`. Les restrictions alimentaires sont une mesure de prudence ; aucune garantie de conformité juridique. Validation RACJ et recette distante requises avant ouverture.

La priorité est désormais la recette interne en Preview avec vrais SMS et codes, autorisée par le propriétaire. L’envoi réel et le contrôle de la D1 distante ne sont pas encore vérifiés faute d’accès aux comptes Cloudflare/Twilio. Voir le [parcours de recette](AUDIT-BUDGET-CONFIGURABLE.md#priorité-actuelle--recette-preview-avec-vrais-sms-et-codes), la correction du téléphone et la consommation sans fausse attestation de rabais.
