# Le Défi Boréal — essai des expéditions

Branche de prévisualisation : preview/expeditions-v3, basée sur V3.0.1 /106dfa8.
Production livraison-v3 inchangée. Publication statique du dossier v3.

## Essayer
Ouvrir la prévisualisation à /essais.html pour choisir un scénario fictif.
Le jeu ordinaire à / choisit aléatoirement un parcours à chaque chargement.
Aucun compte, aucune indication de budget ou de disponibilité sur l'écran du jeu.
Les raccourcis accélérés sont réservés à la vérification des écrans ; le pied de
page indique clairement le mode accéléré. La difficulté réelle se teste à vitesse normale.

Toutes les récompenses sont fictives. Aucun budget, réservation serveur, code
utilisable ou attribution monétaire n'existe dans cette démonstration. La page
essais.html décrit les scénarios pour le testeur seulement ; elle ne doit pas être
publiée dans la future version destinée aux clients.

## Parcours
- r0 :45s,12planches ; score maximum théorique3990, inférieur à5000.
- r1 :90s,20planches ; maximum6980, inférieur à7500.
- r2 :120s,28planches ; maximum9640, inférieur à10000.
- r3 :150s,40planches ; maximum13300.
Le temps rapporte22points/s ; chaque planche rapporte125points plus un bonus de
combo de25à125points. Le nombre fini de planches et le temps bornent le score :
il n'est jamais écrêté. Les parcours permettent effectivement les paliers visés.

Les obstacles restent franchissables. L'arrivée est un refuge dessiné dans la
forêt originale. Un saut en cours se termine pendant l'animation d'arrivée.
Pause, reprise, commandes tactiles/clavier et records séparés par parcours.
Le petit fruit reste préservé dans les sources graphiques V3 ; les parcours de
cet essai utilisent des planches pour démontrer la borne de score précisément.
Les animaux, panoramas et toutes les cellules de Jacques restent d'origine.

## Vérification et livraison
    node tests/expeditions.test.cjs
    node tests/expeditions-browser.cjs
    python3 scripts/build-expedition-demo.py
Le test navigateur nécessite Python3, Playwright et Chromium (CHROMIUM_PATH).
Le script génère work/expedition-demo/index.html, autonome et jouable hors ligne,
essais.html et LISEZ-MOI.txt. Extraire entièrement le ZIP avant ouverture.
Le workflow GitHub Expedition demo crée une archive téléchargeable de ce dossier.

7tests moteur, dont100simulations sur5formats d'écran et4parcours ;32contrôles
Chromium couvrant les arrivées, résultats fictifs, pause/reprise, rejouer,
ordinateur, rotation et lancement hors ligne. Aucun téléphone physique testé.

## Pour la future version avec argent réel
Le choix du parcours sera fait par le serveur après une réservation atomique,
puis le résultat sera rejoué côté serveur. Le navigateur ne peut jamais décider
seul de son parcours admissible ni de sa récompense. Une démonstration locale
ne valide pas la sécurité monétaire. Il reste à intégrer réservations, libération
des montants non utilisés, expiration, contrôle mensuel individuel et règlement
validé. Le brouillon récompenses/admin est conservé séparément, sans activation.
