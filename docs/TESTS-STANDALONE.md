# Vérification du HTML V3 autonome

Le fichier `downloads/defi-boreal-v3-autonome.html` contient les scripts, les métadonnées d’animation et les PNG du jeu. Cette livraison permet d’ouvrir un seul fichier HTML, sans ouvrir un HTML à l’intérieur d’une archive ZIP et sans conserver une arborescence de fichiers annexes.

Exécuter depuis la racine du projet, après avoir généré le fichier autonome :

```sh
node tests/standalone-v3.cjs
```

Le test utilise Playwright et Chromium installé dans l’environnement. La variable facultative `CHROMIUM_PATH` permet de sélectionner un autre binaire Chromium. Le contrôle HTTP démarre temporairement un serveur Python sur `127.0.0.1:8891` et l’arrête à la fin du test.

## Chargement sans serveur ni réseau

Le test lit le fichier distribué sur disque, puis charge son HTML dans une page `about:blank` dont l’origine est opaque (`location.origin === 'null'`). Le contexte Playwright est hors ligne avant le chargement. Ce scénario expose les restrictions d’origine et l’absence de serveur, sans contourner une restriction d’accès `file://` du navigateur géré.

La version autonome ne fait aucune requête HTTP pour ses images, son atlas, les métadonnées JSON ou ses scripts. Le test attend que les ressources soient réellement prêtes, puis démarre la partie. Il constate la progression du score et le dessin de plusieurs frames de Jacques à partir de son PNG intégré. Les 24 silhouettes sont décodées ; les neuf plans de décor sont disponibles.

Les menus, les instructions, la pause et la reprise sont testés pendant une partie normale. Une seconde page utilise le même fichier avec un accès de test temporaire à la fermeture du moteur et le temps de simulation contrôlé pour vérifier les commandes tactiles et clavier : premier saut, double saut, refus du troisième saut et recharge à l’atterrissage. Le fichier distribué ne contient pas ces accès de test.

## Fichier servi en HTTP

Le même HTML distribué est ouvert sans instrumentation sur le serveur local. La partie démarre et toutes les ressources sont prêtes. Une seule requête de page est enregistrée : le fichier HTML lui-même. Aucun script, JSON ou PNG annexe n’est demandé.

## Résultat et capture réelle

**24 contrôles réussis** avec Chromium `154.0.8037.57`, viewport mobile `390 × 844` pixels CSS. Le résultat de la dernière exécution réussie est enregistré dans `artifacts/v3/standalone-results.json`.

La capture JPEG `artifacts/v3/autonome-mobile.jpg` provient d’une partie normale du fichier autonome hors ligne. Le score, le HUD, Jacques, le sentier et la forêt sont visibles. Aucun panneau n’est masqué et aucune image n’est ajoutée après la capture.

Un contrôle de pixels prélève 1 196 points sur une large portion du véritable Canvas, sous le HUD et au-dessus de la légende du bas. Cette exécution relève 1 162 couleurs distinctes, une luminance moyenne de 66,7 sur une échelle de 0 à 255 et 96,7 % de points dépassant le seuil de noir défini dans le test. La capture a aussi été inspectée visuellement et contient bien le décor coloré.

## Limites

Cette validation est réalisée dans Chromium headless sous Linux. L’origine opaque hors ligne couvre l’absence d’accès HTTP et les restrictions d’origine ; elle ne prouve pas le comportement des applications d’aperçu ZIP, des apps Fichiers iOS/Android ou de Safari sur un téléphone physique. L’ouverture directe `file://` n’est pas validée dans le navigateur géré et aucune restriction n’a été contournée pour la tester.

Le fichier doit être téléchargé comme HTML indépendant et ouvert dans un navigateur qui exécute JavaScript. L’ouverture d’un HTML directement dans l’aperçu d’une archive ZIP ne constitue pas ce mode de lancement. Certains navigateurs refusent `localStorage` pour une origine opaque ; le moteur gère ce refus sans interrompre le jeu, mais le record peut alors ne pas être conservé après fermeture.
