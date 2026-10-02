# FF DM — scénario conversationnel pour Netlify

Cette version est conçue d'abord pour les téléphones. Elle comprend :
- écran d'entrée léger (le nom et le mot de passe fictifs restent dans le navigateur et sont effacés à l'entrée) ;
- transition Matrix courte et désactivable via la préférence système de réduction des animations ;
- phrase d'accueil configurable ;
- scénario séquentiel de 1 à 30 couples question/réponse, sans afficher de numéros au visiteur ;
- réponses révélées progressivement à environ 60 tokens/seconde ;
- modifications d'administration prises en compte au prochain envoi du visiteur ;
- archives qui conservent le texte réellement envoyé à chaque date ;
- administration protégée par une session HTTP-only ;
- stockage persistant dans Netlify Blobs.

## Déploiement conseillé (fonctions Netlify incluses)

**Important :** un simple glisser-déposer du dossier `public` ne déploie pas les fonctions serveur. Pour que le chat, l'administration et les archives fonctionnent, déploie le projet comme un site Netlify avec build depuis un dépôt Git.

1. Décompresse le ZIP.
2. Envoie le dossier `ff-dm` dans un dépôt GitHub (tu peux créer un dépôt privé).
3. Dans Netlify, choisis **Add new project → Import an existing project** puis connecte ce dépôt.
4. Laisse Netlify détecter `netlify.toml` et lancer le déploiement. Le dossier publié est `public` et les fonctions sont dans `netlify/functions`.
5. Ouvre l'URL `.netlify.app` générée et teste l'accueil, un échange, puis « Éteindre ».

Le projet ne demande aucune variable d'environnement. Le code administrateur n'est jamais présent dans les fichiers publics ; seul son condensat est utilisé côté fonction serveur.

## Logique du scénario

L'accueil est toujours affiché en premier. Ensuite, chaque envoi du visiteur déclenche la réponse de l'échange courant, puis le texte de la prochaine question. Après le dernier échange, le scénario reprend au premier échange (sans répéter l'accueil). Les numéros d'étape ne sont jamais montrés dans le chat.

La fonction relit la configuration à chaque envoi. Si l'administrateur modifie l'échange suivant pendant que le visiteur rédige son message, la nouvelle version est utilisée au moment où il appuie sur Envoyer. Les messages archivés ne sont jamais réécrits.

## Limites connues

- Les réponses sont fixes et séquentielles : le système ne comprend pas le contenu du message et ne choisit pas une réponse sémantique.
- La vitesse de révélation est une approximation visuelle de 60 tokens/seconde, calculée à partir de la longueur des caractères ; les tokens varient selon la langue et le texte.
- Le premier déploiement doit activer le stockage Netlify Blobs dans l'environnement Netlify. Les fonctions ont besoin de ce service pour enregistrer les messages et la configuration.
