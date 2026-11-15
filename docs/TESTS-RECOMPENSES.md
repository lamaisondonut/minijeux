# Vérifications de la version récompenses

Réalisées localement le 14 novembre 2026, Node.js 24, Python 3, Chromium et Wrangler 4.162.0. Aucun SMS réel ni écriture de production.

| Commande | Résultat et portée |
| --- | --- |
| `npm run test:rewards:unit` | Moteur partagé : 143 contrôles. API : 16 scénarios. SMS : 6 scénarios. Authentification : 3 scénarios. Concurrence : 11 scénarios, vrais fichiers SQLite WAL et connexions indépendantes. Identité visuelle : quatre PNG identiques aux fichiers fournis. |
| `npm run test:rewards:browser` | Client : 106 contrôles dans Chromium. Administration : 10 suites, téléphone/tablette/ordinateur, erreurs et concurrence entre employés. |
| `npm run test:pages` | Chargement du Worker brut dans workerd, sans recompilation, sur sept configurations avec/sans Node et plusieurs dates ; puis migration D1 locale, routes privées refusées, API sûre et partie d’entraînement dans Chromium ; enfin parcours complet du Worker avec véritable liaison D1 locale. |
| `npm run test:noel` | 740 assertions de mécanique, 137 contrôles Noël et 98 contrôles du menu/traîneau. |
| `npm run build:pages` | Compilation Pages réussie ; génération reproductible comparée à l’artefact versionné. |

Les tests couvrent les trois seuils, le meilleur palier unique et le plafond annoncé, le mois de Toronto et ses changements d’heure, l’absence de report ou remboursement, les réservations simultanées, l’expiration et la limite glissante de téléphone de 30 jours. Les relectures gagnantes réelles dépassent 10 000 points dans les deux modes ; le serveur ignore un score déclaré arbitrairement par le navigateur.

Les courses utilisent notamment 32 départs simultanés, 24 attributions répétées, deux parties pour un téléphone, deux téléphones pour une partie, 24 employés concurrents sur un code, des vérifications OTP concurrentes et 32 demandes sur un quota de huit SMS. Les nouveaux tests de réservation SMS vérifient la saturation pendant une partie, minuit à Toronto et la libération unique d’un emplacement inutilisé.

Le navigateur vérifie aussi les erreurs réseau et la reprise du même journal de partie, les pauses et changements de dimensions, la confirmation explicite d’un changement de mode ou plafond, l’absence de collecte d’identité avant le gain admissible, l’affichage du code seulement après attribution serveur et l’absence de données personnelles dans le stockage local. L’absence des logos dans le menu, les tatouages/animations de Jacques, les cinq obstacles, le traîneau à six rennes et le nez rouge restent vérifiés.

L’administration est testée contre les accès 401/403, les échecs de service, les textes malveillants, les doubles réclamations, la reprise après coupure et les exports. Seul l’employé ayant verrouillé le code peut enregistrer la remise manuelle de la carte Lightspeed. Le score validé est présent dans le registre et le CSV ; un code confirmé reste récupérable par son navigateur même si les nouvelles récompenses sont désactivées.

## Limites de ces essais

Les fournisseurs Turnstile, Twilio et les clés Access sont simulés **dans les tests uniquement**. Les signatures RSA, les opérations métier et le SQL sont réels. Aucun endpoint public de simulation ni compte administrateur de démonstration n’est livré. Les tests ne prouvent ni l’identité physique d’un détenteur de téléphone ni l’absence de robots capables de produire un journal cohérent.

Les vérifications sont exécutées par les workflows GitHub Actions de cette branche. Les liens et captures des dernières exécutions figurent sur la pull request. Les contrôles Noël ont réussi sur la [pull request de prévisualisation](https://github.com/lamaisondonut/minijeux/pull/1). Les captures du menu et de l’administration sont disponibles dans les artefacts de ces exécutions.

La prévisualisation publique sans liaisons/secrets reste jouable en entraînement. Le parcours monétaire et la connexion réelle du personnel nécessitent une D1 de prévisualisation, Access et un fournisseur SMS approuvé. Ces opérations distantes n’ont pas été exécutées faute d’accès au compte Cloudflare. Avant activation, effectuer une recette sur ces services configurés et finaliser les règles, les coûts et la confidentialité ; voir [configuration](RECOMPENSES-CLOUDFLARE.md).

## Vérification du mandat final

Le test `tests/pages-rewards-integration.cjs` charge le fichier Worker exact avec une véritable liaison D1 dans workerd. Il applique la migration à une base locale jetable, authentifie les comptes de test par de vraies signatures RSA, lit le diagnostic du schéma et démarre 16 parties simultanément : cinq plafonds de 20 CAD, onze parties extrêmes. Il fait réellement rejouer le score 10 526, refuser un mauvais SMS, attribuer un seul code, débiter 20 CAD, puis départager deux employés et verrouiller la remise au bon employé. Tous les fournisseurs sont remplacés dans le test uniquement; aucune base distante n’est remplie de données d’essai.

Cette vérification a révélé une incompatibilité réelle : `redirect: 'error'`, accepté par Node, est refusé par Workers. Les appels de clés d’authentification, Turnstile et SMS utilisent désormais `redirect: 'manual'` et rejettent les réponses 3xx. Le parcours et le refus des redirections sont testés dans workerd.

Le registre n’affiche pas de faux gagnants ni de montants inventés. Les reçus des joueurs excluent les noms et identités des employés, les références et notes internes. Une base dont les protections ou colonnes attendues sont absentes ferme les offres et les nouveaux départs récompensés.
