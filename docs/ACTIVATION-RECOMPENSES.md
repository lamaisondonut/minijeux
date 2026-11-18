**Configuration finale actuelle : [MISE-EN-SERVICE.md](MISE-EN-SERVICE.md).** Les conditions ne sont pas approuvées automatiquement ; la consommation technique d’essai doit rester désactivée.

# Lancement et tests immédiats — sans SMS

La procédure actuelle est [LANCEMENT-SANS-SMS.md](LANCEMENT-SANS-SMS.md). Elle remplace le parcours Twilio pour le lancement.

- [Jouer en Preview](https://develop-noel-budget-configur.minijeux-4gy.pages.dev/)
- [Administration du restaurant](https://develop-noel-budget-configur.minijeux-4gy.pages.dev/admin/)
- [SQL pour une D1 Preview neuve et vide](../proposals/sql/preview_schema_development.sql)

Les mises à niveau existantes suivent l’ordre **0002 à 0009**, chaque fichier dans son propre batch transactionnel. Si 0007 est déjà appliquée, seules 0008 et 0009 sont nécessaires. Ne rien appliquer à la base Production pour ces essais.

Le personnel n’a pas besoin d’un compte Cloudflare. Une connexion par courriel autorisé au début du service suffit pour vérifier plusieurs codes, avec une session Access de 24 heures à configurer par l’hébergeur. La création manuelle et les exceptions sont réservées aux gestionnaires. La production `livraison-v3` reste inchangée.
