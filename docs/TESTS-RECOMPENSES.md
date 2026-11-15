# Vérifications de la version récompenses

Réalisées localement le 15 novembre 2026, Node.js 24, Python 3, Chromium et Wrangler 4.162.0. Aucun SMS réel ni écriture de production.

| Commande | Résultat et portée |
| --- | --- |
| `npm run test:rewards:unit` | Moteur partagé : 143 contrôles. API : 22 scénarios. SMS : 6 scénarios. Authentification : 3 scénarios. Concurrence : 11 scénarios, vrais fichiers SQLite WAL et connexions indépendantes. Identité visuelle : quatre PNG identiques aux fichiers fournis. |
| `npm run test:rewards:browser` | Client : 110 contrôles dans Chromium. Administration : 17 scénarios responsive, budget, exceptions, confirmation alimentaire et consommation Preview, téléphone/tablette/ordinateur, erreurs et concurrence entre employés. |
| `npm run test:pages` | Chargement du Worker brut dans workerd, sans recompilation, sur sept configurations avec/sans Node et plusieurs dates ; puis migration D1 locale, routes privées refusées, API sûre et partie d’entraînement dans Chromium ; enfin parcours complet du Worker avec véritable liaison D1 locale. |
| `npm run test:noel` | 740 assertions de mécanique, 137 contrôles Noël et 98 contrôles du menu/traîneau. |
| `npm run build:pages` | Compilation Pages réussie ; génération reproductible comparée à l’artefact versionné. |

Les tests couvrent les trois seuils, le meilleur palier unique et le plafond annoncé, le mois de Toronto et ses changements d’heure, l’absence de report ou remboursement, les réservations simultanées, l’expiration et la limite glissante de téléphone de 30 jours. Les relectures gagnantes réelles dépassent 10 000 points dans les deux modes ; le serveur ignore un score déclaré arbitrairement par le navigateur.

Les courses utilisent notamment 32 départs simultanés, 24 attributions répétées, deux parties pour un téléphone, deux téléphones pour une partie, 24 employés concurrents sur un code, des vérifications OTP concurrentes et 32 demandes sur un quota de huit SMS. Les nouveaux tests de réservation SMS vérifient la saturation pendant une partie, minuit à Toronto et la libération unique d’un emplacement inutilisé.

Le navigateur vérifie aussi les erreurs réseau et la reprise du même journal de partie, les pauses et changements de dimensions, la confirmation explicite d’un changement de mode ou plafond, l’absence de collecte d’identité avant le gain admissible, l’affichage du code seulement après attribution serveur et l’absence de données personnelles dans le stockage local. L’absence des logos dans le menu, les tatouages/animations de Jacques, les cinq obstacles, le traîneau à six rennes et le nez rouge restent vérifiés.

L’administration est testée contre les accès 401/403, les échecs de service, les textes malveillants, les doubles réclamations, la reprise après coupure et les exports. Seul l’employé ayant verrouillé le code peut enregistrer l’application manuelle du rabais alimentaire. Le score validé est présent dans le registre et le CSV ; un code confirmé reste récupérable par son navigateur même si les nouvelles récompenses sont désactivées.

## Limites de ces essais

Les fournisseurs Turnstile, Twilio et les clés Access sont simulés **dans les tests uniquement**. Les signatures RSA, les opérations métier et le SQL sont réels. Aucun endpoint public de simulation ni compte administrateur de démonstration n’est livré. Les tests ne prouvent ni l’identité physique d’un détenteur de téléphone ni l’absence de robots capables de produire un journal cohérent.

Les vérifications sont exécutées par les workflows GitHub Actions de cette branche. Les liens et captures des dernières exécutions figurent sur la pull request. Les contrôles Noël ont réussi sur la [pull request de prévisualisation](https://github.com/lamaisondonut/minijeux/pull/1). Les captures du menu et de l’administration sont disponibles dans les artefacts de ces exécutions.

La prévisualisation publique sans liaisons/secrets reste jouable en entraînement. Le parcours monétaire et la connexion réelle du personnel nécessitent une D1 de prévisualisation, Access et un fournisseur SMS approuvé. Ces opérations distantes n’ont pas été exécutées faute d’accès au compte Cloudflare. Avant activation, effectuer une recette sur ces services configurés et finaliser les règles, les coûts et la confidentialité ; voir [configuration](RECOMPENSES-CLOUDFLARE.md).

## Vérification du mandat final

Le test `tests/pages-rewards-integration.cjs` charge le fichier Worker exact avec une véritable liaison D1 dans workerd. Il applique la chaîne 0001–0007 à une base locale jetable, authentifie les comptes de test par de vraies signatures RSA, lit le diagnostic du schéma et démarre 16 parties simultanément : cinq plafonds de 20 CAD, onze parties extrêmes. Il fait réellement rejouer le score 10 526, refuser un mauvais SMS, attribuer un seul code, débiter 20 CAD, puis départager deux employés et verrouiller la remise au bon employé. Tous les fournisseurs sont remplacés dans le test uniquement; aucune base distante n’est remplie de données d’essai.

Cette vérification a révélé une incompatibilité réelle : `redirect: 'error'`, accepté par Node, est refusé par Workers. Les appels de clés d’authentification, Turnstile et SMS utilisent désormais `redirect: 'manual'` et rejettent les réponses 3xx. Le parcours et le refus des redirections sont testés dans workerd.

Le registre n’affiche pas de faux gagnants ni de montants inventés. Les reçus des joueurs excluent les noms et identités des employés, les références et notes internes. Une base dont les protections ou colonnes attendues sont absentes ferme les offres et les nouveaux départs récompensés.

## Tests ajoutés sur `develop/noel-budget-configurable`

`npm run test:budget-proposals` exécute les migrations dans le vrai moteur D1 local, les transitions SQL, l’API budget et ses courses entre connexions indépendantes, les émissions manuelles/exceptionnelles et les notifications SMS simulées. Les tests sont exécutés directement par Node pour conserver les comptes détaillés des scénarios.

Les scénarios manuels vérifient la désactivation par défaut, l’accès refusé au personnel non gestionnaire, les justifications, le code sans faux score, le dépassement sans hausse du plafond, le blocage du jeu même en présence d’autorisations exceptionnelles, le devis périmé, la révocation de rôle et les reprises concurrentes d’un même identifiant. L’utilisation alimentaire partielle conserve les dépenses attribuées et rend le reliquat inutilisable. Les SMS vérifient les deux textes, l’absence de numéro en clair, le quota, le renvoi, le refus des redirections et la non-répétition après une réponse ambiguë.

Le Worker compilé est également testé avec sa vraie liaison D1 locale pour les émissions manuelles simultanées et justifiées, la notification initiale, le renvoi du même code et une utilisation alimentaire partielle. Les services externes restent simulés dans ces essais. Les vérifications GitHub de ce nouveau commit doivent être consultées séparément ; des succès antérieurs ne prouvent pas les modifications présentes.

Les tests de correction couvrent le numéro invalide, le SMS non reçu, le délai, le renvoi, le maintien de la réservation et du score, le refus de l’ancienne vérification, la course avec une validation en cours, les cinq demandes et le blocage après confirmation. Le parcours de consommation sans rabais est refusé sur l’hôte Production et journalisé avec 0 $ réellement appliqué en Preview.
