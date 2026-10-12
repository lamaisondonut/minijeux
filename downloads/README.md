# Livraison V3

Ces fichiers sont préparés pour être récupérés depuis une branche GitHub après autorisation de publication. Un lien `/workspace/...` dans le chat désigne un fichier interne, pas un téléchargement partagé.

- `defi-boreal-v3-jouable.zip` : frontend complet, index.html à la racine ; extraire tout le ZIP et servir son contenu sur un hébergement statique, par exemple Netlify.
- `defi-boreal-v3-projet.zip` : projet complet avec anciennes versions, docs, tests et captures.
- `jeu-livraison.jpg` : nouvelle capture JPEG prise dans Chromium pendant une vraie partie, sans retouche ni élément d'interface masqué.

Les captures originales PNG sont RGB opaques et colorées ; le jeu sur HTTP charge 24 frames, sans erreur JavaScript. Le problème signalé concerne l'affichage des captures dans le chat et les liens internes. Aucun défaut nouveau du moteur n'a été confirmé par ce signalement.

Aucun fichier de secrets, node_modules ou métadonnée Git n'est inclus dans les ZIP. Le jeu ne contient ni backend ni récompense active. Le dossier doit être publié sur une branche distincte, sans modifier main ; la préparation locale ne constitue pas une publication.
