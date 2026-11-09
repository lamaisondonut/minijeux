# Le Défi Boréal — Édition de Noël

## Source et préservation

Branche de travail : `edition-noel`, issue de `livraison-v3` au commit
`106dfa829d40ffd1a747c5a9b188c01351ea71ae` (V3.0.1).
Les images originales, l’atlas et les métadonnées de Jacques, `jacques.js`,
`scenery.js` et `mechanics.js` sont conservés sans modification.
Les versions V1/V2/V2.1 et l’historique du dépôt restent disponibles.

## Jacques

`v3/assets/noel/jacques-noel-atlas.png` est une variante créée en éditant l’atlas
original comme référence : tuque rouge bordée de blanc avec pompon, veste rouge
ouverte et sans manches, bras tatoués visibles, même personnage et mêmes poses.
Aucun père Noël générique ni personnage de substitution n’est utilisé.
La ressemblance artistique et les détails du costume restent soumis à la revue.

Le PNG saisonnier contient24 poses. Son JSON conserve exactement les séquences,
cadences et boucles des7 états originaux. Les rectangles de découpe sont recalibrés
sur les silhouettes du nouveau PNG, pour préserver les pieds, la tuque et les
bras sans fragments de poses voisines. `jacques-noel.js` charge cette variante
séparée et l’aligne sur le même corps de collision V3.

## Forêt hivernale

Deux dérivés hivernaux des panoramas originaux sont conservés dans
`v3/assets/noel/forest-panorama-noel.png` et `forest-landscape-noel.png`.
Ils reprennent le cadrage, les montagnes, le lac, les aurores et les chalets en
ajoutant un manteau de neige aux sapins, rives et sous-bois.

`noel-assets.js` utilise le mécanisme de ressources intégrées existant du chargeur
V3 pour sélectionner ces images ; le module original du décor reste inchangé.
`noel-scenery.js` ajoute les sapins enneigés et décorés, guirlandes, lumières,
sentier blanc et neige légère en3 profondeurs. Les9 plans originaux restent actifs.
Les éléments sont dessinés une fois en cache. La neige utilise le temps du moteur
et se fige en pause ; son nombre est borné et réduit si le navigateur demande
moins d’animations.

## Collectibles

`noel-collectibles.js` dessine4 motifs : cadeaux, étoiles, clochettes et sucres
 d’orge. Leurs marges transparentes sont retirées une fois lors de la création
 du cache ; les silhouettes occupent réellement le rectangle visuel à 1,3×.
Le centre des objets, leurs zones de collecte, leur génération et leurs points
restent ceux de la V3 : 18×18 / 29×16, 50/125 points et bonus de combo inchangés.
Les5 variantes d’obstacles, la course, les sauts/double saut, collisions, pause,
reprise et records sont conservés. Il n’y a pas de parcours raccourci de démo.

## Jouer, tester et publier

Le contenu à publier reste le dossier `v3`, sans build ni variable secrète.

```sh
npm ci --ignore-scripts
npm run dev
# ouvrir http://127.0.0.1:8000/v3/index.html
npm run test:noel
```

Playwright et Python 3 sont nécessaires aux tests ; Chromium est sélectionné par
`CHROMIUM_PATH`, ou `/usr/bin/chromium` par défaut. Voir `NOEL-TESTS.md` pour
les résultats et limites. Le workflow `Noël checks` refait les tests sur GitHub
et conserve les captures et résultats comme artefact de revue.

La connexion GitHub–Cloudflare publie automatiquement les branches de test en
prévisualisation. Le même commit validé est ensuite utilisé pour la production
sur autorisation explicite. Aucune configuration DNS, Netlify ou Framer ne change.
Les PNG restent individuellement sous la limite de 25 Mio de Cloudflare Pages.

## Retour à la V3 antérieure

Une branche `sauvegarde/v3-avant-noel` conserve l’état de production avant Noël.
Pour un retour immédiat, utiliser le déploiement V3 précédent dans Cloudflare
Pages (Rollback). Pour rétablir durablement le code, créer un commit de retour
vers cet arbre sur `livraison-v3`, préserver l’historique, puis publier ce commit.
Ne pas supprimer les ressources saisonnières ni réécrire l’historique.

## Évolutions

Aucune récompense, carte-cadeau, base de données ni authentification n’est ajoutée
ou activée. Les points affichés restent locaux et ne constituent pas une preuve
de gain. L’intégration serveur future devra vérifier les parties et les budgets.
Les personnages Zoltan, Tristan, Vanessa et Manon et un menu de sélection sont
notés dans `EVOLUTIONS-PERSONNAGES.md`, hors de cette livraison.

## Menu d’accueil et traîneau

Jacques est affiché à 1,9× dans le menu (au lieu de 1,45×), avec une position
abaissée et adaptée à la place disponible à droite du titre. Sa taille pendant
la partie reste inchangée. Le calcul de composition est mis en cache par taille
de vue ; il n’ajoute pas de mesure DOM à chaque image.

`noel-sleigh.js` charge une nouvelle illustration transparente représentant le
père Noël et exactement six rennes. Elle remplace le petit oiseau volant dans le
décor de Noël ; les deux anciennes frames sont rendues transparentes uniquement
dans le cache saisonnier, sans modifier `scenery.js` ni les fichiers originaux.
Le renne de tête est celui situé tout à droite, dans le sens du vol. Son nez
reste rouge et sa luminosité pulse doucement à 1 Hz avec le temps de l’animation.
Le mouvement et la pulsation se figent en pause ; le mode de réduction des
animations affiche un éclairage et une position stables. Le cache est créé au
chargement et aucune image ni Canvas n’est alloué à chaque frame.
