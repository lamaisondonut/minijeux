# Prévisualisation Cloudflare Pages — V3.0.1

## État
Base : 106dfa829d40ffd1a747c5a9b188c01351ea71ae.
Branche : migration/cloudflare-preview-v3-0-1.
Aucun changement au moteur, aux images, aux animations ou aux fonctionnalités.
Aucun déploiement Cloudflare effectué : compte et authentification Cloudflare absents.
Netlify, Framer, DNS et récompenses inchangés.

## Format recommandé
Publier uniquement le contenu de v3 : 10 fichiers, 11 106 819 octets.
Le HTML autonome fait 14 661 741 octets : pratique hors ligne et vérifié, mais
chaque changement impose de recharger tout ce document et le base64 augmente sa taille.
Les fichiers séparés permettent le cache individuel des images et évitent une étape
de génération. Leurs chemins relatifs fonctionnent depuis la racine HTTP.
Les deux formats respectent la limite Pages de 25 Mio par fichier.
Ne pas publier tout le dépôt : les archives projet ne sont pas du contenu Web.

## Préparer un paquet sans modifier les sources
Depuis un checkout propre de la branche :
    python3 scripts/prepare-cloudflare-preview.py
Sortie : dist/cloudflare-preview ; index.html à la racine.
Empreintes : dist/cloudflare-preview-sha256.json, hors du dossier publié.
Le script refuse d'écraser une sortie existante. Il ne déploie rien.

## Configuration Git cible
Projet Pages lié à lamaisondonut/minijeux.
Framework : None.
Racine : v3.
Commande de compilation : vide.
Répertoire publié : . (relatif à v3).
Aucune dépendance npm, variable secrète ou Function nécessaire au jeu.
Branche de production réservée : livraison-v3.
Déploiements automatiques de production : désactivés.
Prévisualisations : inclure uniquement migration/cloudflare-preview-v3-0-1.

Attention : la création via « Save and Deploy » peut déclencher un premier
déploiement de production. Ne pas l'utiliser sans avoir vérifié que la configuration
du projet empêche ce déploiement. Créer/configurer le projet via l'API authentifiée
si nécessaire, puis vérifier ses paramètres avant de déclencher le moindre build.
Ne jamais considérer la branche de migration comme branche de production.
Ne rattacher aucun domaine personnalisé.

Une fois le projet correctement configuré, un déploiement manuel peut cibler
explicitement la branche non productive avec Wrangler :
    npx wrangler pages deploy dist/cloudflare-preview --project-name NOM_REEL_DU_PROJET --branch migration/cloudflare-preview-v3-0-1
Cette commande n'a pas été exécutée. Vérifier au préalable le compte, le projet et
sa production_branch, qui doit être différente de la branche passée à --branch.
Le résultat doit indiquer environment=preview avant de communiquer son URL.

## Vérifications exécutées
- Identité exacte des 10 fichiers v3 avec le commit de base.
- Préparation du paquet et contrôle SHA-256 de chaque copie.
- Mécaniques : 740 assertions réussies.
- V3 dans Chromium : 56 contrôles réussis, dont Jacques, sprites, forêt, saut,
  double saut, collisions, collecte, bonus, score, pause/reprise, rotation,
  arrière-plan et erreur de ressource.
- HTML autonome : 24 contrôles réussis, hors ligne et HTTP.
- Les tests ont tourné dans une copie isolée ; aucune instrumentation dans le jeu livré.
Les premiers essais ont été bloqués par les sockets du bac à sable ; ils ont
ensuite réussi avec l'autorisation d'exécution adaptée.

## À vérifier après publication
URL HTTPS de preview, réponses HTTP et MIME, ressources, absence de promotion,
menus et partie sur iOS/Safari et Android physiques, puis Chrome/Firefox/Edge.
Les tests Chromium locaux ne valident pas l'hébergement Cloudflare ni ces appareils.
Aucune URL de prévisualisation n'existe à cette étape.

## Accès nécessaires
Compte Cloudflare et identifiant de compte ; accès Pages en écriture via connexion
sécurisée ou jeton limité au compte concerné ; autorisation GitHub de l'application
Cloudflare Pages sur ce dépôt pour l'intégration Git.
L'environnement CLI doit pouvoir accéder à api.cloudflare.com et aux URL de preview.
Ne pas coller de secret dans le chat ni l'ajouter au dépôt.
L'autorisation de prévisualisation est déjà donnée ; aucun nouvel accord de
production, DNS ou activation monétaire n'est présumé.

## Références
https://developers.cloudflare.com/pages/get-started/git-integration/
https://developers.cloudflare.com/pages/configuration/branch-build-controls/
https://developers.cloudflare.com/pages/configuration/preview-deployments/
https://developers.cloudflare.com/pages/platform/limits/
