# nexus-app

Desktop app for Nexus Tools for Star Citizen.

Client desktop (Tauri + React) pour [Nexus Tools](https://github.com/NexusCorpSC/nexus-tools),
la boîte à outils communautaire Star Citizen. L'application expose les
fonctionnalités de Nexus Tools directement depuis le bureau : blueprints,
missions, réputations, inventaire et organisations.

## Architecture

L'interface est une vraie application React — pas une webview du site. Elle
consomme l'API REST de Nexus Tools.

Les appels réseau passent par `@tauri-apps/plugin-http`, qui exécute les
requêtes côté Rust. Deux conséquences :

- **pas de CORS** : l'API n'a besoin d'aucune configuration particulière pour
  accepter l'application desktop ;
- **cookie de session maîtrisé** : la session better-auth est rejouée depuis le
  store persistant, sans dépendre du cookie jar de la webview.

```
src/
  lib/
    api-client.ts     couche HTTP (plugin-http, cookie de session, erreurs)
    api/              un module par domaine (blueprints, missions, reps, …)
    settings.ts       store persistant : URL de l'API + cookie de session
  auth/               contexte de session (OTP e-mail better-auth)
  components/         layout + primitives d'UI
  pages/              un écran par fonctionnalité
  types/nexus.ts      types miroir des réponses de l'API
src-tauri/            binaire Tauri, plugins et permissions
```

### Fonctionnalités

| Écran         | Endpoints                                                   | Session requise |
| ------------- | ----------------------------------------------------------- | --------------- |
| Recherche     | `/api/search`                                                | non⁴            |
| Blueprints    | `/api/blueprints`, `/api/blueprints/:slug`, `…/categories`  | non¹            |
| ↳ ajouter aux miens | `/api/blueprints/:id/ownership`                        | oui             |
| ↳ dans mon org | `/api/blueprints/:id/org-owners`                            | oui             |
| Missions      | `/api/missions`, `/api/missions/:id`, `…/factions`          | non             |
| Factions      | `/api/factions`                                              | non             |
| Réputations   | `/api/reps`, `/api/reps/factions`                            | oui             |
| Inventaire    | `/api/inventory/items`, `/api/inventory/locations`           | oui             |
| Organisations | `/api/orgs`, `/api/orgs/:id/inventory`                       | partiellement²  |
| Feuille de cargo | `/api/cargo-ships` (une fois, mise en cache)               | non⁵            |
| Bloc-notes    | `/api/notes`                                                 | non³            |

¹ le filtre « possédés » n'apparaît qu'une fois connecté, il est résolu côté serveur.
² la liste publique est accessible sans session ; l'inventaire partagé non.
³ connecté, ce sont les notes en ligne du compte ; sinon, des notes locales.
⁴ l'inventaire personnel n'entre dans les résultats qu'une fois connecté.
⁵ la feuille elle-même ne quitte jamais la machine ; voir « Feuille de cargo ».

Le site va plus loin que cette application : boutiques, marché, commandes,
industrie (fret, raffinage) et fiche d'organisation n'ont **aucune route API**
et ne sont rendus que côté serveur. Les écrans correspondants demanderaient donc
d'abord du travail dans `nexus-tools` ; d'ici là, la palette de recherche ouvre
ces résultats-là dans le navigateur.

Les endpoints `/api/me`, `/api/reps`, `/api/reps/factions`, `/api/orgs`,
`/api/blueprints/:slug` et `/api/blueprints/:id/ownership` ont été ajoutés à
`nexus-tools` pour cette application : ces données n'étaient jusqu'ici
disponibles qu'en rendu serveur, ou par une *server action* que seul le site
sait appeler.

#### Ajouter un blueprint à « mes blueprints »

Trois endroits en donnent la possibilité, parce que c'est trois moments
différents : la **grille**, où l'on parcourt ; la **fiche**, où l'on décide ; et
la **liste de la palette de recherche**, où l'on ne faisait que passer.

Les deux premiers savent si le blueprint est déjà possédé et n'affichent donc
rien à ajouter quand il l'est. La palette, elle, ne le sait pas : un résultat de
recherche ne dit rien de la possession. D'où une route **idempotente** qui
répond ce qu'elle a fait — `added: false` veut dire « il y était déjà » — ce qui
suffit à la palette pour répondre juste sans poser une deuxième question.

L'ajout est fait dans la fenêtre où l'on a cliqué, et la palette est une fenêtre
à part. Comme le client de requêtes ne rafraîchit pas au retour du focus, un
ajout depuis la palette laisserait la fenêtre principale afficher « non
possédé » indéfiniment : l'ajout est donc annoncé aux autres fenêtres, comme
l'est une modification de la feuille de cargo.

### Icône de notification

Tant que l'application tourne, elle tient une icône dans la zone de
notification. **Clic gauche** : la fenêtre principale revient, qu'elle ait été
minimisée ou rangée. **Clic droit** : recherche rapide, capture de zone,
bloc-notes, et *Quitter*.

Fermer la fenêtre principale la **range** au lieu de la détruire — sans quoi
l'icône n'aurait plus rien à rouvrir, et l'application continue de toute façon
de tourner pour ses raccourcis. *Quitter*, dans le menu de l'icône, est donc le
seul chemin qui termine réellement le processus.

Les trois commandes du menu passent par le même point d'entrée que les
raccourcis : elles sont journalisées de la même manière (`(tray)` au lieu de
`(raw input)`), et le bloc-notes bascule au lieu de seulement s'ouvrir.

Une icône que le système refuserait n'empêche pas le démarrage : c'est
journalisé, et l'application se lance.

L'icône est le logo Nexus Corp, celui du site
(`nexus-tools/public/nexus_logo_square.png`), décliné par `tauri icon` dans
`src-tauri/icons/`. Le lanceur, la fenêtre et les installeurs le prennent de là.
La zone de notification, elle, reçoit le PNG **128 px** plutôt que l'icône de
fenêtre en 32 px : elle réclame entre 16 et 32 pixels selon l'écran, et une
source large se réduit mieux qu'une petite ne s'agrandit. C'est ce qui vaut au
crate la fonctionnalité `image-png`.

### Superposition et capture d'écran

Deux raccourcis globaux, enregistrés côté Rust pour rester actifs quand
l'application est minimisée ou n'a pas le focus :

| Raccourci par défaut | Effet                                                      |
| -------------------- | ---------------------------------------------------------- |
| `Ctrl+Maj+B`         | ouvre la palette de recherche en superposition              |
| `Ctrl+Maj+S`         | ouvre la capture de zone, dont le texte alimente la palette |
| `Ctrl+Maj+N`         | affiche ou masque le bloc-notes en superposition            |
| `Ctrl+Maj+G`         | affiche ou masque la feuille de cargo en superposition      |

Ils se redéfinissent dans **Paramètres**, en appuyant sur la combinaison
voulue. Au moins un modificateur est exigé : un raccourci global sans
modificateur confisquerait la touche à toutes les applications.

Les combinaisons sont stockées au format du plugin (`Ctrl+Shift+KeyB`), dont les
noms de touches correspondent à `KeyboardEvent.code` — ce que le navigateur
enregistre se transmet donc tel quel.

**Deux chemins guettent les combinaisons, et il en suffit d'un.**

`RegisterHotKey`, via le plugin `global-shortcut`, est le seul qui puisse
*confisquer* la combinaison à l'application en dessous. Mais il n'est pas
délivré tant qu'un jeu tient le clavier : Star Citizen le prend pour lui et la
combinaison n'arrive jamais jusqu'ici — c'est-à-dire précisément quand ces
raccourcis servent.

Un écouteur **Raw Input** (`src-tauri/src/hotkeys.rs`) comble ce trou. La couche
périphérique rapporte chaque frappe à qui l'a demandée, focus ou pas, et sans
aucun enregistrement préalable : une combinaison déjà prise par une autre
application nous parvient donc quand même. C'est l'approche des overlays de la
communauté autour du jeu — l'écouteur lit, il n'accroche aucun hook et n'injecte
rien dans un autre processus, il n'y a donc rien qui puisse inquiéter un
anti-triche. En contrepartie il ne peut pas avaler la frappe : le jeu reçoit
aussi la combinaison. Cela ne coûte rien en pratique, puisque ce chemin ne sert
que là où `RegisterHotKey` n'a pas fonctionné, donc là où le jeu recevait déjà
les touches.

Seule une combinaison illisible, ou demandée deux fois, est donc rapportée comme
refusée dans Paramètres. Le choix reste enregistré même refusé, il suffit d'en
saisir un autre.

Rien de tout cela ne peut empêcher le démarrage : ni l'initialisation du plugin,
ni l'enregistrement d'une combinaison. Un plugin qui n'a pas démarré coûte
l'exclusivité de la combinaison, pas le raccourci lui-même — Raw Input continue
de le rapporter.

Chaque déclenchement est écrit dans le journal avec sa provenance
(`shortcut notes fired (raw input)`), ce qui répond du premier coup d'œil à la
seule question qui compte quand un raccourci ne réagit pas : est-il arrivé
jusqu'à l'application ?

Les diagnostics partent dans `<données de l'app>/logs/nexus-app.log`, car les
builds de release sont liés avec `windows_subsystem = "windows"` et n'ont donc
aucune console où écrire. **Les panics y sont écrits également**, avec le
thread, le `fichier:ligne:colonne` et une backtrace : un panic levé sur la
boucle de messages ne peut pas dérouler et abrège le processus sur-le-champ,
sans rien laisser d'autre qu'un minidump. Avant que l'application ne soit
construite, le fichier est celui de `%LOCALAPPDATA%\services.nexus.app\logs`,
ce qui couvre aussi les échecs de démarrage.

La palette est une fenêtre transparente et sans décoration, toujours au-dessus.
Elle interroge **`/api/search`**, la recherche générale du site : blueprints,
missions, factions, articles en vente, boutiques, organisations, vaisseaux de
fret, et l'inventaire de l'utilisateur quand il est connecté. Une seule liste,
classée par pertinence, chaque résultat portant son type et l'adresse de la page
qui le montre. En dessous de deux caractères l'API répond 400 : la palette
attend donc, plutôt que d'afficher une erreur sur un mot à moitié tapé.

Cette adresse est celle du **site**, et cette application n'en couvre qu'une
partie. `src/lib/search.ts` tient la table des écrans qu'elle a — un blueprint,
une mission, une faction, l'inventaire — et ouvre tout le reste dans le
navigateur, à l'adresse de l'instance configurée. Sans cette table, un résultat
sans écran ici atterrirait sur une route inexistante, que le routeur transforme
en silence en liste de blueprints. Une petite flèche sur la ligne annonce
lesquels sortent de l'application.

> Le piège de la table : `/missions/factions/<id>` est une faction, pas une
> mission. Son motif passe donc **avant** celui des missions, qui n'accepte
> qu'un seul segment.

La capture suit cet enchaînement :

1. le raccourci **fige** l'écran sous le curseur (`xcap`) **avant** d'afficher
   quoi que ce soit — la surface de sélection ne peut donc pas se retrouver
   dans sa propre capture, et le tracé se fait sur une image stable ;
2. la fenêtre de sélection couvre exactement ce moniteur ;
3. au relâchement, la zone est découpée, agrandie puis lue par
   **`Windows.Media.Ocr`**, le moteur fourni avec le système — rien à
   embarquer, contrairement à Tesseract qui demanderait un binaire et ses
   données d'entraînement ;
4. le texte reconnu remplit la barre de recherche.

Deux détails pèsent lourd sur ce que le moteur rend. La zone est **agrandie**
avant d'être lue — jusqu'à 3×, tant que le résultat reste raisonnable — parce
qu'il est entraîné sur du texte de document et qu'à sa taille native un ATH de
jeu lui fait confondre les glyphes, voire avaler les mots courts. Et le résultat
est repris **ligne par ligne** plutôt que par `OcrResult::Text()`, qui recolle
tout avec une simple espace : un journal de mission lu ainsi revient en une
seule phrase interminable, où plus rien ne sépare les objectifs.

Le frontend envoie la sélection en **fractions de la fenêtre** (0..1) plutôt
qu'en pixels : la mise à l'échelle DPI disparaît du protocole et les valeurs se
projettent directement sur l'image capturée, quelle que soit sa définition.

> Limites connues : la capture porte sur le moniteur sous le curseur, et la
> qualité de l'OCR dépend du module linguistique installé dans Windows.

#### Vérifier le code Windows sans machine Windows

`xcap` ne compile pas sur Linux et la chaîne Tauri ne se contrôle pas en
compilation croisée (il lui manque `lib.exe`). En revanche `src-tauri/src/capture.rs`
ne dépend que de `serde`, `xcap` et `windows` : recopié dans une crate jetable
ciblant `x86_64-pc-windows-msvc`, il se type-checke en local, appels WinRT
compris. C'est nettement plus rapide que d'attendre la CI.

### Factions et possession dans l'organisation

Deux écrans qui répondent à des questions que les listes ne savaient pas
poser :

- **Factions** (`/api/factions`) : quelle faction récompense quel blueprint. La
  route rend tout d'un coup, sans filtre — la recherche de l'écran filtre donc
  ce qui est déjà là, sur les noms de faction *et* de blueprint, puisque
  « où est-ce que j'obtiens ça » est la question posée. La palette de recherche
  y renvoie avec un identifiant, et la faction visée est alors mise en évidence
  et amenée à l'écran.
- **Dans mon organisation**, sur la fiche d'un blueprint
  (`/api/blueprints/:id/org-owners`) : qui, parmi les membres, le possède déjà —
  autrement dit à qui le demander plutôt que de le refarmer. La route refuse
  (403) toute organisation dont l'appelant n'est pas membre, et la liste
  proposée est justement celle de ses organisations.

> Ce qui n'a pas pu suivre : un filtre par statistique sur les blueprints.
> `/api/blueprints/stat-names` n'est qu'une autocomplétion pour le formulaire
> de création côté site — `/api/blueprints` n'accepte aucun paramètre de
> statistique, il n'y a donc rien à filtrer tant que la route n'en prend pas.

### Feuille de cargo

Le portage de `/industry/cargo` : on y répartit un volume en conteneurs SCU
(32, 24, 16, 8, 4, 2, 1) et on suit le remplissage du vaisseau. `Ctrl+Maj+G`
l'affiche en superposition, comme le bloc-notes.

**Hors ligne, et pas seulement « ça marche hors ligne »** : la feuille vit dans
le store local, personne d'autre ne la lit, rien ne la synchronise. Le seul
appel réseau de la fonctionnalité est la liste des vaisseaux
(`GET /api/cargo-ships`, ajoutée à `nexus-tools` pour l'occasion), lue une fois
et gardée en cache — l'écran dit d'où elle vient quand ce n'est pas du réseau.

Le vaisseau choisi est **recopié dans la feuille**, nom et capacité compris.
Deux conséquences voulues : la superposition n'a besoin de rien d'autre que la
feuille pour tracer sa jauge — ni liste, ni réseau — et une capacité modifiée
sur le site en cours de route ne déplace pas la cible sous les pieds du pilote.

#### Modifier la feuille sans quitter le jeu

La superposition **s'ouvre en lecture**, parce que c'est ce qu'on lui demande en
vol : la liste et la capacité restante, et rien à cliquer par erreur au-dessus
d'un jeu. Les contrôles sont derrière un « Modifier » explicite, et ce sont les
mêmes que ceux de l'écran principal — ajouter une ligne, la réécrire, la
déplacer d'une mission à l'autre, renommer ou supprimer un bloc mission entier,
ouvrir la mission suivante, changer de plus gros conteneur, clôturer.

Renommer un bloc a deux conséquences assumées. Renommer **vers un nom déjà
pris** fusionne les deux blocs : la feuille regroupe par nom, pas par identité,
c'est donc déjà ce qu'elle affichait. Et renommer **le bloc en cours de
remplissage** fait avancer le compteur — le numéro qu'il portait est libre, et
une ligne ajoutée ensuite doit ouvrir un nouveau bloc plutôt que ressusciter le
nom dont on vient de le sortir.

Une exception : **le vaisseau ne se change pas depuis la superposition.** C'est
la seule chose qui demanderait la liste, donc le réseau, alors que la feuille
est justement faite pour s'en passer.

Deux détails du même souci :

- la clôture demande **deux fois** plutôt qu'une, sans boîte de dialogue native
  — celle-ci passerait devant un jeu en plein écran, ce qui coûte plus cher que
  ce qu'elle protège ;
- `Échap` **quitte d'abord les contrôles**, et ne ferme la fenêtre qu'ensuite :
  la même touche ne doit pas jeter ce qu'on était en train de taper.

Les deux écrans dessinent le même composant (`src/components/cargo/sheet-view.tsx`),
chaque contrôle n'étant tracé que si son gestionnaire est fourni. La version
`compact` est la superposition : mêmes champs, étiquettes descendues dans les
libellés indicatifs, faute de largeur.

#### Une capture d'écran qui devient du cargo

Le journal de mission du jeu a une forme fixe, répétée par livraison :

```
Deliver 0/32 SCU of Titanium to Port Olisar above Crusader.
   Collect Titanium from Area18.
```

Quand le texte reconnu par la capture de zone correspond à ce modèle, il ne
part pas dans la recherche : la palette devient un import de cargo.

- **Une feuille existe** : les lignes y sont ajoutées, sans rien demander. La
  ligne rejoint la mission en cours, ce qui fait qu'une deuxième capture du
  même contrat atterrit dans le même bloc.
- **Aucune feuille** : la seule chose que l'application ne peut pas deviner est
  le vaisseau. Elle le demande, crée la feuille et y met la capture.

Le parseur (`src/lib/mission-objectives.ts`) est recopié du site et reste
tolérant, parce que l'OCR l'est peu :

- le `0/` revient en `O/`, et les chiffres passent pour les lettres qui leur
  ressemblent — `O/l6 SCU` se lit bien 16 ;
- la puce en losange devient `©`, `*` ou une simple lettre `O`, qu'aucun
  nettoyage de ponctuation n'attrape ;
- le `l` minuscule remonte en `I` majuscule (`Audio-VisuaI Equipment`) ;
- la station est « above » sa planète, ou « on » quand la livraison se pose au
  sol — Area18 on ArcCorp ;
- le verbe `Deliver` disparaît parfois : la forme `0/3 SCU of … to …` porte
  alors l'objectif à elle seule ;
- une ligne longue est coupée en deux par le jeu, elle est donc recollée avant
  d'être lue ; à l'inverse, une capture qui revient d'un bloc est redécoupée sur
  les mots qui ouvrent un objectif.

La ligne `Collect` nomme la ressource une seconde fois : elle s'en sert pour
retrouver sa livraison, même quand celle du dessus a été manquée ou que le
journal a été lu dans le désordre.

Le même texte se colle à la main dans l'écran, qui accepte aussi le format
tabulé `Destination;Contenu;Volume;Emplacement`.

### Bloc-notes

Le même bloc-notes que le site, dans une fenêtre indépendante toujours au-dessus
pour rester lisible en jeu. `Ctrl+Maj+N` l'affiche et le masque ; contrairement à
la palette de recherche, il ne se referme pas quand il perd le focus.

La fenêtre n'ayant pas de décorations, **son en-tête tient lieu de barre de
titre** : il porte `data-tauri-drag-region`, ce qui déplace la fenêtre. La
permission qui l'autorise, `core:window:allow-start-dragging`, ne fait pas
partie de `core:default` — d'où la capacité dédiée
`src-tauri/capabilities/notes-overlay.json`, limitée à cette fenêtre. Sans elle
le glissement est refusé sans un mot.

Connecté, l'éditeur lit et écrit `/api/notes`, donc les notes sont les mêmes que
sur le site. Déconnecté, il écrit dans le store local. Les deux ne fusionnent
pas : la session décide simplement lequel s'applique, et le cache React Query
est indexé là-dessus pour qu'une connexion échange les notes affichées.

**Chaque fenêtre a sa propre copie du contexte d'authentification**, et les
superpositions sont créées au démarrage : celle du bloc-notes garderait donc
indéfiniment la session vue à ce moment-là — aucune — et continuerait d'afficher
le bloc-notes local à quelqu'un qui vient de se connecter. Une connexion ou une
déconnexion est donc diffusée à toutes les fenêtres (`auth://session-changed`),
qui relisent la session du store ; la fenêtre à l'origine du changement ignore sa
propre diffusion, sinon elle repasserait par son écran de chargement pour rien.
La superposition revérifie aussi la session quand elle reprend le focus.

L'enregistrement est automatique, 1,2 s après la dernière frappe. Les écritures
peuvent se chevaucher (minuterie, bouton, fermeture de la fenêtre) et les
réponses revenir dans le désordre : seule la requête la plus récente met l'écran
à jour.

### Notifications

Les notifications s'affichent dans **une fenêtre à elles**, accrochée à un coin
de l'écran — en bas à droite par défaut, comme celles de Windows. Le coin se
choisit dans **Paramètres**, où un exemple part à chaque changement pour montrer
où il tombe.

Une fenêtre séparée plutôt qu'un coin de la fenêtre principale : celle-ci est
presque toujours rangée ou minimisée derrière le jeu, et une notification que
personne ne voit n'en est pas une.

Le partage des rôles :

- **Rust** possède la géométrie (`src-tauri/src/notifications.rs`). Il choisit le
  moniteur, lit sa *zone de travail* — pas l'écran entier, pour que les toasts se
  posent au-dessus de la barre des tâches et non dessous — et place la fenêtre
  dans le coin retenu. Le moniteur est celui **sous le curseur**, la règle que
  suit déjà la capture de zone ; il est figé le temps d'une pile, pour qu'elle ne
  saute pas d'un écran à l'autre en cours de route.
- **La superposition** (`src/pages/notifications-overlay-page.tsx`) dessine la
  pile et renvoie sa hauteur : la fenêtre est redimensionnée à chaque changement
  pour ne jamais couvrir plus que les toasts eux-mêmes.

Émettre une notification depuis n'importe quelle fenêtre :

```ts
import { notify } from "@/lib/notifications";

await notify({ kind: "error", title: "Capture impossible", body: raison });
```

L'appel passe par Rust plutôt que par un état React : la fenêtre qui émet n'est
pratiquement jamais celle qui affiche. Rust en émet aussi directement — un échec
de capture ou d'OCR n'avait jusqu'ici nulle part où s'afficher, puisque la
fenêtre de sélection est refermée avant l'erreur.

Une notification levée pendant que la superposition charge encore n'est pas
perdue : elle est mise de côté (huit au plus) et remise quand elle signale
qu'elle écoute.

Quatre niveaux — `info`, `success`, `warning`, `error` — qui décident de l'icône,
de la couleur et de la durée (5 à 10 s). Quatre toasts au maximum à l'écran, le
plus récent contre le coin. Survoler un toast le retient ; le quitter relance son
compte à rebours depuis le début. Un curseur oublié dans ce coin — ce qu'un jeu
qui tient la souris rend très possible — ne l'épingle pas pour autant : passé
30 s, il s'en va quoi qu'il arrive.

> Limites connues : la fenêtre ne prend jamais le focus (`focusable: false`), mais
> elle reste une fenêtre — un clic dans la zone qu'elle occupe lui revient et
> n'atteint pas ce qu'il y a dessous. D'où le redimensionnement au plus juste.
> Et comme toute fenêtre en surimpression, elle est invisible d'un jeu en plein
> écran exclusif ; en plein écran fenêtré, elle s'affiche.

### Mises à jour

L'application interroge la dernière release GitHub au démarrage puis toutes les
six heures. Si elle annonce une version **supérieure** à celle du binaire en
cours, une notification le dit ; un clic dessus ouvre **Paramètres → Mises à
jour**, où l'on voit la version, les notes de release, et un bouton qui
télécharge et installe. Rien ne s'installe sans ce clic.

Ce qui rend la notification nécessaire : la fenêtre principale est presque
toujours rangée. Elle porte donc une route (`/settings`), et le clic ramène la
fenêtre dessus — c'est le seul cas où un toast fait autre chose que disparaître.

Sous Windows, l'installateur NSIS est lancé en mode `passive` (`/P /R`) : le
greffon termine le processus lui-même juste après l'avoir lancé, et
l'installateur relance l'application. Rien de ce qui suit l'appel ne s'exécute,
ce qui est pourquoi l'écran reste sur « Téléchargement… ».

#### Signature

Le greffon refuse toute mise à jour qu'il ne peut pas vérifier, d'où une paire
de clés minisign. La **publique** est versionnée dans
`plugins.updater.pubkey` (`src-tauri/tauri.conf.json`), identifiant
`C301B23CC68E65F2` — c'est son rôle d'être connue de tous.

La **privée** n'existe que chez qui publie, et dans les secrets du dépôt :

| Secret                               | Contenu                            |
| ------------------------------------ | ---------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | le contenu du fichier `.key`       |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | le mot de passe choisi à sa création |

Sans eux, l'étape de build de `release.yml` échoue franchement plutôt que de
publier des installateurs que personne ne pourra installer.

Pour en refaire une — la privée perdue, la paire est à remplacer, et les
versions déjà installées ne pourront plus se mettre à jour d'elles-mêmes :

```bash
npm run tauri signer generate -- -w "$HOME/.tauri/nexus-app.key"
```

La sortie donne la clé publique à recopier dans la configuration, et le fichier
`.key` à déposer dans les secrets.

#### Ce que publie la CI

`release.yml` construit avec `--config src-tauri/updater.conf.json`, qui ajoute
`createUpdaterArtifacts` : le bundler signe alors chaque installateur et écrit
un `.sig` à côté. Ce réglage est tenu **hors** de `tauri.conf.json` pour que la
CI des pull requests, qui n'a pas de clé, continue de compiler.

Le workflow attache ensuite un `latest.json` à la release :

```json
{
  "version": "0.6.0",
  "notes": "le corps de la release, tel qu'écrit à la main",
  "pub_date": "2026-08-01T12:00:00.0000000Z",
  "platforms": {
    "windows-x86_64": { "signature": "…", "url": "https://github.com/…" }
  }
}
```

L'URL y est relue **depuis les assets de la release** plutôt que construite : en
publiant, GitHub remplace les espaces des noms de fichiers par des points
(`Nexus App_0.6.0_x64-setup.exe` devient `Nexus.App_0.6.0_x64-setup.exe`).

L'application lit ce fichier via
`https://github.com/NexusCorpSC/nexus-app/releases/latest/download/latest.json`,
qui ne résout que vers la dernière release **publiée** : tant qu'elle reste en
brouillon, personne ne se voit proposer la mise à jour.

### Authentification

La connexion utilise le flux **OTP par e-mail** de better-auth : c'est le seul
fournisseur qui fonctionne sans redirection navigateur. Le cookie `Set-Cookie`
renvoyé à la connexion est persisté tel quel, ce qui évite de deviner le nom du
cookie (better-auth le préfixe `__Secure-` en HTTPS).

> Discord OAuth n'est pas encore géré : il faudrait un listener sur une URL de
> redirection loopback. Voir « Suites possibles ».

## Développement

### Prérequis

- Node `^20.19.0 || >=22.12.0` (contrainte de Vite 7)
- Rust stable
- Linux : `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev`

### Lancer

```bash
npm install
npm run tauri:dev
```

`npm run tauri:dev` démarre Vite **et** le binaire. Lancer le binaire de debug
seul n'affiche rien : en mode debug, Tauri charge `build.devUrl`
(`http://localhost:1420`), donc le serveur Vite doit tourner.

### Vérifications

```bash
npm run typecheck   # tsc --noEmit
npm run build       # tsc + vite build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

### Intégration continue

`.github/workflows/ci.yml` rejoue ces vérifications sur `windows-latest`, la
seule plateforme cible, puis produit les installeurs via `tauri build`.

Les binaires (`.msi` et `.exe` NSIS) sont publiés en artefact `nexus-app-windows`
sur chaque exécution, ce qui permet de tester une PR sans build local.

Le build du frontend précède obligatoirement toute commande qui **compile** la
crate (`cargo clippy`, `tauri build`) : `build.rs` appelle `tauri_build::build()`,
qui résout `frontendDist` (`../dist`) et échoue si le dossier n'existe pas.
`cargo fmt` ne compile rien et n'est pas concerné.

### Publier une release

`.github/workflows/release.yml` se déclenche sur les tags `v*`. **Il n'écrit pas
la release** : il y attache les deux installeurs. Les notes restent donc écrites
à la main, et la release doit exister — le workflow le vérifie avant de compiler
quoi que ce soit et s'arrête aussitôt s'il n'en trouve pas.

```bash
# aligner les trois fichiers de version, puis
git tag v0.2.0 && git push origin v0.2.0
# créer la release du tag (un brouillon suffit), puis relancer le run
```

Créer le brouillon **avant** de pousser le tag marche tout aussi bien et évite la
relance : un brouillon ne crée pas le tag côté GitHub, le `git push` déclenche
donc bien le workflow. À ne pas faire avec une release **publiée**, qui crée le
tag elle-même : le `git push origin v0.2.0` n'aurait alors plus rien à pousser et
le workflow ne partirait jamais.

Le workflow refuse aussi de builder si le tag ne correspond pas aux versions
déclarées dans `src-tauri/tauri.conf.json`, `package.json` et
`src-tauri/Cargo.toml` — les noms des installeurs venant de `tauri.conf.json`, un
tag `v0.2.0` publierait sinon un `Nexus App_0.3.0_x64-setup.exe`.

Relancer le workflow après un build raté remplace les fichiers déjà envoyés au
lieu d'échouer dessus.

Il refuse enfin de builder si `plugins.updater.pubkey` est vide, et exige les
secrets de signature : sans eux les installateurs partiraient sans `.sig`, donc
sans mise à jour possible depuis l'application (voir « Mises à jour »). Une fois
les installeurs attachés, le workflow publie le `latest.json` que liront les
versions déjà installées — **tant que la release reste un brouillon, personne ne
la voit passer**.

### Instance ciblée

L'URL de l'API se règle dans **Paramètres**. Les hôtes autorisés sont déclarés
dans `src-tauri/capabilities/default.json` — une URL absente de cette liste est
rejetée à l'exécution par les permissions Tauri :

- `https://tools.services.nexus` (défaut, seul domaine de production)
- `http://localhost:3000` / `http://127.0.0.1:3000`

### Linux sans GPU

En conteneur ou VM sans accélération, WebKitGTK peut afficher une fenêtre vide :

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri:dev
```

## Suites possibles

- Connexion Discord OAuth via une redirection loopback.
- Écrans marketplace (`/shopping`) et industrie (cargo, raffinage).
- Cache hors-ligne persistant : le cache React Query est aujourd'hui en mémoire.
- Mises à jour automatiques (`tauri-plugin-updater`).
