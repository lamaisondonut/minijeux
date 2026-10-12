# Architecture proposée — non déployée

## Choix

| Solution | Intérêt | Limites |
|---|---|---|
| Supabase/PostgreSQL + fonctions serveur | transactions, contraintes uniques, Auth, RLS, audit | nécessite backend et validation fiable des parties |
| Sheets + Apps Script | prototype interne rapide et export facile | quotas, rôles et concurrence plus délicats ; aucune feuille publique ni endpoint de validation anonyme |
| Lightspeed direct | rapprochement potentiel avec ventes | version, droits et API inconnus ; ne pas supposer de capacités |

Supabase est la cible recommandée. Aucune connexion externe n'est établie, aucun secret n'est nécessaire pour l'audit local.

## Modèle de données à implémenter

- `campaigns` : dates UTC, fuseau commercial America/Toronto, active, émission automatique désactivée, configuration des limites et rétention, version moteur autorisée.
- `reward_tiers` : campagne, seuil unique, produit, coût estimé, actif, stock éventuel, indicateur alcool désactivé.
- `players` : identité minimale décidée avec le restaurant ; aucune collecte de nom/email par défaut. Un cookie anonyme peut être effacé, donc ne garantit pas une limite par personne réelle.
- `runs` : identifiant serveur, joueur, campagne, graine, version moteur, dates début/fin, état, score recalculé, digest des événements, expiration session.
- `run_events` : séquence monotone, tick, type d'action autorisé, réception serveur. Taille et débit bornés ; événements tardifs/réordonnés refusés selon protocole.
- `rewards` : UUID, hash d'un code cryptographiquement aléatoire (au moins 128 bits), campagne, joueur, partie UNIQUE, palier, produit/coût/conditions figés à émission, score vérifié, émission, expiration, statut disponible/utilisé/expiré/annulé, validation, employé. Ne pas stocker de code en clair dans les logs.
- `memberships` : Auth UUID, restaurant, rôle admin/employé, actif. Jamais de rôle choisi dans une requête client.
- `audit_events` : action, acteur, objet, horodatage, métadonnées minimales ; accès restreint, conservation configurée.

## Attribution et limites

Transaction : verrouiller la campagne et la partie, vérifier état/identité/score serveur/dates, consulter les paliers actifs dont seuil <= score en ordre décroissant, choisir un seul palier, contrôler limites et stock sous verrou, insérer une seule récompense puis marquer la partie consommée. Contrainte UNIQUE sur run_id pour résister aux requêtes concurrentes. En cas de nouvelle tentative, retourner le résultat déjà attribué sans nouvelle émission. Si une limite bloque, ne pas attribuer plusieurs paliers de secours sans règle commerciale explicite.

Limiter les requêtes et le journal d'événements, comparer temps serveur et durée simulée, rejeter résultats improbables et versions non autorisées. Simulation déterministe proposée mais non implémentée : Math.random, dt variable et coordonnées dépendantes de l'écran doivent être remplacés/normalisés avant partage frontend/backend. Un jeu exécuté côté client reste automatisable ; ne pas présenter cette méthode comme une garantie absolue anti-bot.

## Usage unique et accès

Consultation du code sans consommation. Lors de confirmation employé : UPDATE conditionnel statut=disponible AND expires_at>now(), RETURNING, journal d'audit dans la même transaction. Deux validations simultanées donnent exactement un succès. Vérifier le rôle membre actif à chaque opération, y compris dans la fonction SQL. Ne jamais faire un SELECT suivi d'un UPDATE sans verrou/condition atomique.

RLS activée sur toutes les tables exposées : aucun accès anonyme aux récompenses, événements, employés ou audit ; aucune écriture directe du client sur score vérifié ou statut. Endpoints serveur avec session Auth contrôlée, recherche bornée, réponses minimales et limitation de requêtes. Codes non valides/expirés/annulés/utilisés refusés ; conservation de l'historique, pas de suppression à la remise.

## Paramètres et activation

Seuils initiaux 2500, 5000, 7500, 10000 ; propositions respectives bonus découverte, mocktail sélectionné, bouchée/entrée sélectionnée, planche découverte sélectionnée. Sous 2500 : aucune récompense. 5200 => seulement 5000 ; 8100 => seulement 7500 ; 10500 => seulement 10000. Produits et coûts restent à confirmer. Aucun code fictif affiché dans le jeu.

Prévoir `claim_limit_count`, `claim_limit_period`, limite par campagne/joueur, stock, expiration et activation explicite. Une configuration commerciale incomplète bloque l'activation plutôt que d'inventer des règles. Choisir les conditions et limites avant production.

Variables futures : URL Supabase et clé publique publishable/anon dans le client ; secrets serveur via configuration sécurisée des fonctions. Service-role exclusivement serveur. Les valeurs de production ne doivent jamais être demandées dans le chat, mises dans Git ou inclues dans un ZIP.

## Conformité à faire valider

Conditions de participation et confidentialité doivent préciser admissibilité, mécanique, disponibilités, expiration, identité minimale, finalités, conservation et contact. Valider les règles applicables aux promotions, à l'alcool et à la Loi 25 avec un professionnel/autorité compétente. Aucune conclusion juridique n'est tirée ici. L'alcool et les récompenses réelles restent inactifs.
