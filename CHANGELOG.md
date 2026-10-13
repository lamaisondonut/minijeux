# Journal des modifications

## 3.0.1 — Livraison autonome

- Correction du parcours d’essai : un seul HTML contient scripts, quatre PNG et animations JSON.
- ZIP jouable réduit à un index autonome, sans chemins de ressources externes.
- Sources modulaires conservées ; compilation reproductible depuis scripts/build-standalone.py.
- Message plus utile lors d’une ouverture locale de la version modulaire.
- 24 contrôles supplémentaires sur le HTML autonome, hors ligne avec origine opaque et en HTTP.
- Aucun hébergement public activé ; ouverture file:// bloquée par la politique du navigateur géré, non contournée.

## 3.0 — Jacques, forêt et mécaniques

- Nouvelle entrée v3/index.html ; V2.1 et anciennes références préservées.
- Atlas PNG transparent original de Jacques, configuré par JSON et états du moteur.
- Panorama boréal détaillé et plans de parallaxe, faune et végétation rasterisées.
- Vitesse initiale315, plafond530, obstacles espacés et nouvelle souche haute.
- Corps de collision32×72 adapté au personnage, double saut et score conservés.
- Interface rose/crème/forêt, gestion explicite des ressources manquantes.
- Régression paysage corrigée : repeinture complète sans traces ni bandes noires.
- Tests de simulation et Chromium, captures du jeu, archives séparées.
- Aucun backend ni récompense développé.

## 2.1 — Stabilisation après audit

- Sauvegarde datée de la V2 avant correction ; V1 et V2 de référence inchangées.
- Paramètres existants centralisés dans CONFIG ; pas de remplacement du moteur.
- Physique à pas fixe, rattrapage borné, pause sur perte de focus/arrière-plan.
- Redimensionnement cohérent, menus défilants sur petites hauteurs, zoom autorisé.
- Validation du record local pour éviter les valeurs invalides.
- Tests Chromium, captures réelles, documentation d'audit, plan et architecture future.
- Aucun sprite professionnel, backend ou système de récompenses livré à ce stade.
