# Plan d'implémentation

Ce plan décrit des fichiers futurs ; leur présence dans cette liste ne signifie pas qu'ils sont implémentés. Chaque phase doit conserver le moteur existant et une sauvegarde jouable.

## 1. Audit et stabilisation — réalisé

`current/index.html` : corrections ciblées et configuration centralisée. `tests/browser.cjs` : tests discriminants Chromium. `versions/` : références inchangées. `docs/AUDIT.md`, `CHANGELOG.md` : preuves et limites. Aucun framework requis pour le jeu.

## 2. Extraction ciblée et graphismes

Extraire les fonctions existantes vers `current/js/config.js`, `engine.js`, `physics.js`, `player.js`, `animation.js`, `obstacles.js`, `collectibles.js`, `scene.js`, `ui.js`, `scores.js`, en gardant `current/index.html` comme entrée. Une migration à la fois, tests de non-régression et screenshot avant/après. Risque : ordre d'initialisation et comportement lors d'un hébergement statique ; servir en HTTP pour les modules.

Ajouter `current/assets/jacques.png` et `jacques-atlas.json`, un atlas original environ 64×96 par frame : idle 2, course 8, premier saut 3, double saut 4, descente 2, atterrissage 3, collision 3. Origine et pieds stables, ombrages cohérents, transparence, aucun lissage. Graphisme basé sur photos à fournir, pas sur copie RONA. Voir `ART_DIRECTION.md`. Intégrer les animations aux états physiques sans changer leur logique.

Ajouter les neuf couches boréales et sprites d'obstacles/collectibles à `current/assets/`. Valider lisibilité des dangers, contrastes, budget mémoire, alignement hitbox, téléphone réel et ressemblance avec les maquettes attendues. Ressources manquantes : photos de Jacques, maquettes, éventuelle charte définitive et fichiers Web de police avec licence.

## 3. Game design

`config.js`, `obstacles.js`, `physics.js`, tests de simulation : augmenter la vitesse initiale, plafonner l'accélération, définir des motifs compatibles avec le double saut et leur intervalle minimum. Introduire un générateur avec graine et des entrées quantifiées si la simulation déterministe est retenue. Vérifier les motifs à chaque vitesse et hauteur logique ; normaliser les coordonnées de jeu pour ne pas faire dépendre l'admissibilité d'une rotation d'écran. Aucune preuve universelle de franchissabilité n'est acquise actuellement.

Mesurer distributions de scores et durée des parties avant d'ajuster bonus et paliers. Le bonus de combo ne peut provenir que d'une collecte, jamais d'un saut répété. Tests aux bornes, sessions courtes/longues, clavier et tactile.

## 4. Récompenses et backend Supabase

Fichiers proposés : `supabase/migrations/*`, `supabase/functions/start-run/`, `finish-run/`, `claim-reward/`, `lookup-reward/`, `redeem-reward/`, `admin-campaign/` ; `shared/simulation/`, `current/js/api.js`, `rewards.js`. La simulation serveur doit exécuter le même moteur déterministe et versionné avant toute émission automatique. Le serveur calcule le score : un score déclaré par le navigateur n'est jamais une autorisation.

Réutilisation d'une partie bloquée par contrainte unique ; palier le plus élevé sélectionné côté serveur, une seule récompense par partie ; validation atomique et journalisation. Tester limites, concurrence et RLS dans PostgreSQL réel, pas seulement avec mocks. Une graine et un journal d'entrées ne prouvent pas qu'un humain joue : sessions serveur horodatées, événements reçus pendant la partie, analyse de plausibilité et limitations nécessaires. Récompenses automatiques désactivées jusqu'à validation de cette architecture.

## 5. Portails

`staff/index.html`, `admin/index.html`, `staff/js/*`, `admin/js/*` : Supabase Auth, rôles contrôlés côté serveur, employé limité à consultation et remise, administrateur pour campagne/paliers/coûts/limites/annulation. QR lu comme code, jamais comme URL à exécuter. Caméra sous HTTPS avec saisie manuelle disponible. Dépendances possibles : encodeur QR maintenu et scanner compatible, versions verrouillées après choix. Statistiques exclusivement issues des données réelles ; état vide explicite.

Tests : absence de session, utilisateur non membre, rôle employé face aux opérations admin, révocation, double clic et validation concurrente de deux employés, expiration, annulation, panne réseau sans faux succès.

## 6. Déploiement et activation

Frontend statique sur Netlify ou équivalent, backend Supabase séparé, environnements test/production distincts. Documenter clés publiques vs privées, headers, HTTPS, politique de conservation et restauration de DB. Jamais de service-role côté navigateur ni dans l'archive. Déployer uniquement après tests backend, appareil réel et revue des conditions.

Décisions manquantes pour production : produits/coûts/stock et conditions, durée d'expiration, méthode d'identification joueur, fréquence de réclamation, calendrier campagne, politique de conservation et avis juridique adapté au Québec. Alcool désactivé. Ne pas imposer une fréquence quotidienne/hebdomadaire/mensuelle par défaut.

Lightspeed reste indépendant de la V1 des récompenses : version Restaurant exacte, accès API, capacités documentées, frais, produits/rabais et méthode de rapprochement nécessaires avant intégration. Aucun accès demandé tant que cette intégration n'est pas engagée.
