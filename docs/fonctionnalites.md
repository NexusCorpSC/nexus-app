# Fonctionnement détaillé

Le détail de chaque fonctionnalité : ce qu'elle lit, ce qu'elle écrit, et les choix qui ne se voient pas à l'écran. La présentation pour les joueurs est dans le [README](../README.md).

## Game.log

L'application lit le `Game.log` de Star Citizen pendant que l'on joue
(`src-tauri/src/game_log.rs`). Pour l'instant, une seule ligne l'intéresse :
celle que le jeu écrit quand le HUD annonce **« Received Blueprint »**.

```
<2026-09-28T12:00:00.000Z> [Notice] <SHUDEvent_OnNotification> Added notification "Received Blueprint: FS-9 LMG: " …
```

Le nom est retrouvé sur Nexus par `/api/blueprints/lookup?name=`, une
correspondance **exacte** (casse et espaces mis à part) : une recherche
approchée pourrait ajouter le mauvais blueprint à un compte. Ensuite :

- déjà possédé → rien ;
- inconnu de Nexus → une notification le signale ;
- sinon → une notification propose **Ajouter** ; la fermer vaut « non ».
  Rien n'est ajouté sans ce clic.

Le fichier est **suivi, pas relu** : ce qu'il contient au lancement de
l'application est ignoré, pour ne pas rejouer toute la soirée. Un fichier qui
apparaît ou qui est recréé ensuite — le jeu en commence un nouveau à chaque
lancement et range l'ancien dans `logbackups/` — est lu depuis sa première
ligne. Les anciens journaux ne sont pas parcourus.

Le dossier du jeu se règle dans **Paramètres › Jeu**, et l'analyse peut y être
coupée. Par défaut : `C:\Program Files\Roberts Space Industries\StarCitizen\LIVE`.
Rust lit ces réglages dans le même `settings.json` que le frontend
(`gameLogDir`, `gameLogEnabled`) ; la fenêtre principale lui demande de les
suivre au démarrage et à chaque enregistrement (`game_log_sync`).

La lecture se fait par sondage, une fois par seconde, plutôt que par
notification du système : le jeu garde le fichier ouvert en écriture toute la
session, et Windows ne signale pas de manière fiable ce qui change dans un
fichier tenu ainsi.

## Télémétrie du jeu

Star Citizen (depuis la 5.0) ouvre un service gRPC local quand l'attribut
`GameTelemetryEnabled` vaut `1` dans
`StarCitizen\<LIVE|PTU>\user\client\0\Profiles\default\attributes.xml` :
HTTP/2 sans TLS, sur `127.0.0.1:2942` par défaut. Le port réel est lu dans
`Game.log` (ligne `GameTelemetryService: 127.0.0.1:<port>`), par le suivi du
journal ou, au démarrage, dans les premiers Mo du fichier. Seule l'adresse de
bouclage est acceptée ; l'option du jeu qui l'ouvrirait sur le réseau
(`LocalServicesExternal`) n'est jamais touchée.

L'attribut ne suffit pas : le jeu n'ouvre le service que si la variable
d'environnement utilisateur `GRPC_CLIENT_SERVER_ENABLED` vaut `1`. Sans elle,
aucune ligne `GameTelemetryService` n'apparaît dans `Game.log` et rien
n'écoute sur le port. La carte des réglages la lit dans `HKCU\Environment`
(`reg query`, pour voir une valeur posée après le démarrage de l'app) et la
pose au clic avec `setx` (`telemetry_enable_env`). Le jeu l'hérite du RSI
Launcher, qui ne lit l'environnement qu'à son démarrage : il faut le quitter
complètement puis le relancer. À la main, dans PowerShell :
`[Environment]::SetEnvironmentVariable('GRPC_CLIENT_SERVER_ENABLED','1','User')`.

Le schéma (`sc.game.telemetry.v1`) est dans `src-tauri/proto/`, reconstruit
d'après les descripteurs intégrés à `StarCitizen.exe` (PTU 5.0, build
13248297) ; les numéros de champs sont ceux du jeu. `build.rs` le compile avec
`protox` et `tonic-prost-build` : pas de `protoc` à installer.

`src-tauri/src/telemetry.rs` tient le flux `TelemetryStream` (environ 20 trames
par seconde, seulement avec un personnage en jeu) :

- connexion au démarrage de la fenêtre principale (`telemetry_sync`, réglage
  `telemetryEnabled`, activé par défaut), puis nouvel essai toutes les 2 à 15 s
  tant que rien ne répond ; un flux muet 60 s est rouvert ;
- chaque partie d'une trame (personnage, vaisseau, armes) est gardée avec son
  heure : le frontend considère une partie de plus de 3 s comme absente
  (`fresh` dans `src/lib/telemetry.ts`), le vaisseau disparaît donc quand on
  quitte son siège ;
- les fenêtres reçoivent l'état au plus 4 fois par seconde
  (`telemetry://frame`), chaque événement du jeu (mort, réapparition, à terre,
  siège) dès qu'il arrive (`telemetry://event`), et les changements de
  connexion (`telemetry://status`) ;
- rien n'est envoyé au serveur, sauf ce que Nexus Chat lit à la demande.

Aucune position dans ce flux : le NPS reste sur `/showlocation` et
`r_displayInfo`.

**Actions.** `ListTriggerableActions` donne la liste des actions déclenchables
(une centaine), `TriggerGameAction` en déclenche une, avec une durée de
maintien pour les actions qui le permettent (10 s au plus, le délai de l'appel s'y ajoute). La page
**Télémétrie** les déclenche une par une, au clic. Les actions à fort impact demandent
une confirmation : éjection, sortie d'urgence, autodestruction, coupure de la
puissance, des propulseurs ou des boucliers, moteur quantique, train
d'atterrissage (rentré ou basculé), ouverture ou déverrouillage de toutes les
portes, G-safe et assistance de proximité coupés. La liste vient des 112
actions du PTU 5.0 ; un nom inconnu qui ressemble aux pires (`eject`,
`self_destruct`, `emergency`, `suicide`, `jettison`) est aussi demandé.
`is_dangerous` en Rust, `isDangerousAction` en TypeScript.
Rust refuse de les déclencher sans `confirmed`, que le frontend ne passe
qu'après le « oui » du joueur.

**Escouade.** La fenêtre d'escouade (créée cachée au démarrage, elle a la
session et vit autant que l'app) écoute `telemetry://event`
(`src/hooks/use-telemetry-squad-status.ts`) : `ACTOR_DOWNED` et `ACTOR_DEAD`
passent la ligne du joueur en `alive: false, ready: false`, `ACTOR_SPAWN` et
`ACTOR_RESPAWN` la repassent en `alive: true`. Le site n'a rien de nouveau :
c'est le même `PATCH /api/squads/members/<id>` que le bouton de la ligne. À
chaque évènement, l'app relit la vue (le cache d'une fenêtre cachée peut être
vieux) et n'écrit que si la ligne dit autre chose, dans chaque escouade où le
joueur a une ligne (l'organisateur d'un raid peut en avoir plusieurs) ; aucun
envoi périodique. Le jeu n'envoie rien quand un joueur à terre est relevé :
repasser actif reste un clic. Réglage `squadAutoDown` (activé par défaut),
dans la carte Télémétrie de **Paramètres › Jeu**.

**Activation.** **Paramètres › Jeu** liste les versions du jeu à côté du
dossier du `Game.log` (`LIVE`, `PTU`…) et l'état de l'attribut dans chacune.
**Activer** refuse tant que `StarCitizen.exe` tourne (le jeu réécrit le fichier
en quittant), copie `attributes.xml` en `attributes.xml.nexus-<horodatage>.bak`,
puis ajoute l'attribut (ou le passe à `1`). Un fichier qui n'a pas la forme
attendue n'est pas modifié.

**Nexus Chat.** Dans l'app, le chat a trois outils de plus : `game_status`,
`game_list_actions` et `game_trigger_action`. Le site les déclare sans les
exécuter (`lib/chat/game-tools.ts` dans nexus-tools, seulement quand la
requête porte `gameTools: true`) ; l'app y répond (`src/lib/chat-game-tools.ts`)
et renvoie le message, dont le site ne reprend que les réponses aux appels en
attente. Le chat ne déclenche seul que des actions anodines (carte stellaire,
lampe, mobiGlas, lumières, emotes, ping radar…, `HARMLESS_ACTIONS`) : il lit
des textes écrits par d'autres joueurs, et un texte piégé pourrait lui en
demander une. Toute autre action, et tout nom que le jeu ne liste pas, est
refusée ou passe par une carte de confirmation dans la conversation, active
seulement dans le dernier message. Une action faite compte comme une écriture
confirmée : « Réessayer » ne la rejoue pas.

Le flux n'a pas de délai de silence (le jeu se tait au menu) : un jeu figé est
détecté par les pings HTTP/2 (toutes les 20 s, 10 s pour répondre).

## NPS (Nexus Positioning System)

La superposition NPS (`Ctrl+Shift+K`) dit à quelle distance est un lieu et
dans quelle direction aller. Le jeu ne donne qu'une position, jamais
d'orientation : la commande `/showlocation`, tapée dans le chat, copie
`Coordinates: x:… y:… z:…` (mètres, repère du système) dans le presse-papiers.

- Le bouton **Actualiser ma position** met `/showlocation` dans le
  presse-papiers ; il reste à le coller dans le chat. La réponse du jeu est
  repérée toute seule (`src-tauri/src/nps.rs`), horodatée au dixième de
  seconde. Le presse-papiers n'est lu que fenêtre NPS affichée, et seulement
  quand son contenu change (`GetClipboardSequenceNumber`).
- Les planètes tournent : un lieu posé sur un corps est rangé dans le repère
  de ce corps, rotation annulée, et la géométrie (`src/lib/nps.ts`) le
  replace dans le repère du système à l'instant du relevé. Le modèle de
  rotation vient de l'outil communautaire de Valalol (MIT) ; les paramètres
  des corps (Stanton, Pyro, Nyx) de starmap.space, posés côté site par
  `npm run import:celestial-bodies`.
- Chaque système a son repère, centré sur son étoile : la fenêtre retient le
  dernier système où un corps a été reconnu, ne guide que vers les lieux de
  ce système et refuse d'enregistrer une position pour un lieu d'un autre.
- Sur le même corps, la fenêtre donne la distance au sol, le cap à suivre
  (0° = nord) et, dès deux relevés distants d'au moins 20 m, de combien
  tourner par rapport à la trajectoire. Dans l'espace, l'écart avec la
  trajectoire, sans côté.
- Les lieux n'ont pas de coordonnées au départ : un joueur sur place
  enregistre sa position pour un lieu, envoyée comme contribution
  (`placeEdit`, publiée d'emblée au niveau 3, relue en dessous).

La fiche d'un lieu relevé propose **Y aller (NPS)**, qui en fait la
destination et affiche la superposition.

## Scanner de signature radar

La superposition **Scanner radar** (`Ctrl+Shift+R`) lit le nombre que le scan
du jeu affiche (la signature radar) et le compare aux signatures connues.

- La calibration passe par la fenêtre de capture, comme celle du NPS
  (`CapturePurpose::RadarCalibration`) : le joueur trace une zone autour du
  nombre ; elle est ensuite lue par l'OCR de Windows toutes les secondes
  environ, fenêtre affichée seulement (`src-tauri/src/radar_screen.rs`,
  réglages dans le store `radarScreen`).
- Contre les chiffres mal lus : la zone est lue telle quelle et inversée ; un
  nombre compte quand les deux lectures concordent, ou quand une seule le
  trouve deux fois de suite (accord remis à zéro fenêtre cachée ou zone
  changée). Les séparateurs de milliers et les lettres prises pour des
  chiffres (`O`, `I`, `l`…) sont corrigés, une étiquette collée devant
  (`RS8600`) est écartée, un nombre suivi de `m` ou `km` est une distance et
  ne compte pas. Un nombre d'un seul tenant passe avant un nombre recollé à
  partir de mots séparés par des espaces, puis le plus long l'emporte.
- L'identification (`src/lib/radar.ts`, copie de `lib/radar.ts` du site)
  cherche les signatures dont la valeur est un multiple, de 1 à 20 éléments,
  la grappe la plus petite d'abord ; sans multiple exact, les plus proches à
  1 % près. À écart égal, le contexte choisi (partout, vaisseau, ROC, à
  pied ; store `radarContext`) met ses catégories en tête avant la taille de
  la grappe : en vaisseau, minerais, astéroïdes et récupération ; en ROC, les
  gisements ROC ; à pied, les gisements à la main. La valeur peut aussi être
  saisie à la main.
- Les signatures viennent de `GET /api/radar-signatures` (corrigées par les
  administrateurs du site), gardées dans le store `radarSignatures`, avec la
  liste du patch 4.10.3 intégrée en dernier recours.

## Nexus Chat

L'assistant du site (Claude), dans l'écran **Nexus Chat** et en superposition
(`Ctrl+Maj+H`). Il cherche dans Nexus Tools et agit sur le compte du joueur
avec les outils du serveur MCP du site ; toute écriture s'affiche d'abord en
carte **Confirmer / Refuser**. Tout se passe côté site : l'accès (ouvert par un
administrateur), le budget mensuel, le modèle et l'historique des
conversations. L'application n'envoie que le nouveau message, ou la réponse à
une confirmation, et lit la réponse en flux par le plugin HTTP
(`chatFetch`, `src/lib/api/chat.ts`), avec la session persistée.

- La superposition reprend la dernière conversation, d'ici, de la fenêtre
  principale ou du site, chaque fois qu'elle s'affiche ; elle prend le focus,
  le curseur dans la saisie, et **Échap** la range pour rendre le clavier au
  jeu. Elle ne parle au site qu'affichée.
- Une conversation continuée ailleurs est relue quand la fenêtre revient au
  premier plan, jamais pendant une réponse en cours
  (`src/hooks/use-active-chat.ts`).
- Le bouton **Ouvrir dans la fenêtre principale** y ouvre la même
  conversation (`/chat?c=`).

## Icône de notification

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

## Superposition et capture d'écran

Des raccourcis globaux, enregistrés côté Rust pour rester actifs quand
l'application est minimisée ou n'a pas le focus :

| Raccourci par défaut | Effet                                                      |
| -------------------- | ---------------------------------------------------------- |
| `Ctrl+Maj+B`         | ouvre la palette de recherche en superposition              |
| `Ctrl+Maj+S`         | ouvre la capture de zone, dont le texte alimente la palette |
| `Ctrl+Maj+N`         | affiche ou masque le bloc-notes en superposition            |
| `Ctrl+Maj+G`         | affiche ou masque la feuille de cargo en superposition      |
| `Ctrl+Maj+E`         | affiche ou masque l'escouade en superposition               |
| `Ctrl+Maj+H`         | affiche ou masque Nexus Chat en superposition               |
| `Ctrl+Maj+O`         | efface les trois superpositions, ou leur rend leur panneau  |
| `Ctrl+Maj+L`         | verrouille les superpositions affichées, ou les déverrouille |
| `Alt+V` (maintenu)   | affiche le menu radial rapide tant qu'il est maintenu       |

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

## Factions et possession dans l'organisation

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

## Feuille de cargo

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

### Modifier la feuille sans quitter le jeu

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

### Une capture d'écran qui devient du cargo

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

### Une capture d'écran qui remplit l'inventaire

Le panneau d'un **ordre de travail terminé** de la raffinerie liste un lot par
ligne — matériau, qualité sur 1000, rendement en cSCU — sous l'en-tête
`MATERIALS YIELDED (CSCU) · QUALITY · YIELD`, et finit par le total `YIELD`.

Quand la capture de zone lit ce panneau, elle ne part pas non plus dans la
recherche : la palette se range et la fenêtre principale s'ouvre sur
l'**ajout en masse** de l'inventaire, les lots déjà dans le tableau en cSCU. Il
reste à choisir le lieu et à relire les chiffres face au jeu — un bandeau
rappelle la somme des lignes et le total affiché par le jeu, qui doivent
coïncider. Un rendement que l'OCR n'a pas pu lire laisse sa ligne en erreur
plutôt que de compter 1.

La palette ne voyant que du texte, les lots voyagent dans la route
(`/inventory/quick-add?workOrder=…`, voir `openMainRoute`) ; la page les lit une
fois, puis les retire de l'adresse.

Le parseur (`src/lib/refinery-work-order.ts`) est recopié du site, qui lit le
même panneau depuis une capture collée. Il ne retient une capture comme ordre
de travail qu'avec un matériau connu **et** l'en-tête ou le total : « Iron 325 »
reste une recherche. Il rapproche les noms mal lus des matériaux connus
(`RON` → Iron), relit les chiffres sosies (`lSO` → 150), et, propre à
Windows OCR, rattache à leurs matériaux les nombres lus sur des lignes à part,
qu'ils reviennent ligne par ligne ou colonne par colonne.

## Colis entre joueurs

Le même échange que sur le site. Dans l'inventaire, l'icône de colis au pied
d'une carte met une quantité du lot choisi dans le **colis** (panneau à droite ;
pas plus que ce qui n'est pas déjà promis ailleurs). **Envoyer le colis** le
scelle : l'API rend un code de 8 caractères `A-Z0-9`, affiché `K7QM-2X9A`, à
donner au destinataire.

Rien ne bouge encore : les quantités sont **réservées** (icône d'avion en
papier sur le lot) jusqu'à ce que le destinataire accepte, que l'expéditeur
annule, ou 24 h. **Recevoir un colis** montre, dès que le code est complet,
l'expéditeur et le contenu ; on choisit où ranger et on accepte — l'API retire
les lots d'un inventaire et les ajoute à l'autre en une transaction, un lot
identique au même lieu étant complété. `#/inventory/parcels` suit les envois
et les réceptions.

Les refus arrivent en codes stables (`not_found`, `expired`, `unavailable`…)
que `src/lib/api/parcels.ts` met en phrases.

## Bloc-notes

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

Une note écrite ailleurs — la fenêtre principale, le site, un autre appareil —
arrive par le **flux d'événements** (voir [architecture.md](architecture.md#flux-dévénements)) : Rust la remet à toutes
les fenêtres (`note://changed`), et l'éditeur l'adopte, sauf s'il tient un
brouillon non enregistré ou une sauvegarde en cours — ceux-là ne disparaissent
pas sous les doigts de l'utilisateur. Sa propre sauvegarde lui revient par le
même chemin, identique à ce qu'il vient de poser, et ne change rien. Tant que
le flux n'est pas connecté, la superposition relit la note quand elle reprend
le focus, comme elle l'a toujours fait.

L'enregistrement est automatique, 1,2 s après la dernière frappe. Les écritures
peuvent se chevaucher (minuterie, bouton, fermeture de la fenêtre) et les
réponses revenir dans le désordre : seule la requête la plus récente met l'écran
à jour.

## En jeu

Chacun déclare lui-même qu'il joue, et s'il le souhaite ce qu'il fait — rien
ne le devine. Depuis le pied du menu : le statut sous le pseudo (« En jeu ·
Minage », ou « Hors jeu ») ouvre la déclaration, avec des suggestions
d'activité et un champ libre. La page d'une organisation montre ses membres en
jeu, leur activité et depuis combien de temps, relue toutes les 30 secondes.

C'est la même déclaration que sur le site : faite ici, elle s'y voit, et
inversement. Elle s'éteint d'elle-même au bout de quatre heures, pour que
quelqu'un qui ferme le jeu sans le dire ne reste pas « en jeu » ; la fenêtre
principale la renouvelle toutes les 20 minutes tant qu'elle tourne. Seuls les
membres d'une organisation voient qui y joue, même quand elle est publique.

## Escouade

`Ctrl+Maj+E` affiche ou masque l'escouade en superposition : qui est prêt, qui
est à terre, qui tient quel rôle, et l'annonce du chef — lisible **au travers**
du cockpit, puisque cette fenêtre-là s'ouvre sans panneau. Tout ce qui touche à
l'escouade se fait depuis cette fenêtre : la créer, la rejoindre par code, la
quitter, ses rôles, et le **raid** qui en regroupe plusieurs sous une même
annonce.

Dès qu'il y a une escouade, l'en-tête porte aussi un bouton qui affiche le
**plan de vol** de l'escouade.

Dans un raid, l'en-tête porte un **commutateur** à deux positions, *Escouade* et
*Raid*, à la place de l'icône : la position allumée est la vue affichée, ce
qu'un seul bouton qui basculait ne disait pas. Le bouton **Gérer le raid** ouvre
la feuille qui le compose : lier une escouade par son code, en retirer une, et
**en ouvrir une nouvelle**.

Ouvrir une escouade depuis le raid la crée avec son organisateur pour seul
membre et pour chef — une escouade vide n'existe pas, le dernier à en sortir la
supprime — **sans le faire sortir de la sienne**. C'est la seule façon d'être
dans plusieurs escouades à la fois, et elle sert à préparer un raid : Bravo et
Charlie existent avant qu'on y soit, leurs codes partent, et le commandement
passe à qui de droit une fois arrivé. La superposition regarde alors *une* de
ces escouades — un sélecteur à côté du titre change laquelle — et sur la vue de
raid, toutes celles dont on est membre se manipulent, pas seulement celle qui
est affichée. Côté API, chaque route accepte `?squad=<id>` pour dire laquelle
elle vise ; sans lui, c'est la plus ancienne des appartenances, donc la seule
pour tout le monde sauf l'organisateur.

La vue elle-même n'est plus demandée toutes les deux secondes : elle arrive par
le **flux d'événements** (voir [architecture.md](architecture.md#flux-dévénements)). Un point dans l'en-tête dit où en est
ce flux — vert, la vue est en direct ; ambre, la connexion se rétablit.

**Ready check.** Le chef d'une escouade ou un de ses lieutenants demande à
l'escouade de se déclarer prête ; celui qui commande l'escouade meneuse le
demande à tout le raid. Tout le monde repasse « non prêt » — le demandeur
compris — et reçoit une notification avec un bouton **Prêt**, en grand, en haut
de l'écran au milieu (voir « Notifications »). Le bouton est pressé dans la
fenêtre des bannières, qui n'a ni session ni réseau : il diffuse
`squad://ready`, et la superposition d'escouade, qui a les deux, écrit la ligne
du lecteur. Le marqueur (`readyCheck`, un identifiant frais) arrive par
le flux d'événements comme le reste de la vue ; un identifiant inconnu, c'est
une notification. Son propre ready check n'en produit pas : la réponse de
l'écriture est posée dans le cache avant le push qui la répète.

**Une annonce envoyée part en notification**, en grand, en haut de l'écran
au milieu. Celle de l'escouade comme celle du raid : ce sont les deux textes
que le chef écrit pour tout le monde, et les deux que personne ne voit tant que
la superposition est cachée derrière le jeu — ce qui est justement le moment où
la fenêtre des bannières, elle, reste visible. La comparaison se fait avec ce que l'écran montrait : le premier push
reçu pour une escouade — au lancement, ou après être passé sur elle — est un
instantané, pas un changement, et n'annonce rien, même si le cache gardait
cette escouade telle qu'elle était une heure plus tôt ; une annonce effacée
n'annonce rien non plus, et ses propres modifications ne reviennent pas en
toast — la supposition optimiste et la réponse de l'écriture sont posées dans
le cache avant le push qui les répète.

**Une annonce part quand on l'envoie**, pas pendant qu'on l'écrit : Entrée ou
**Envoyer**, Maj+Entrée pour aller à la ligne, Échap ou **Annuler** pour la
laisser telle qu'elle était. Enregistrée à chaque pause de la frappe, elle
partait en autant de notifications — « RDV », « RDV Grim », « RDV Grim Hex ».
Une fois envoyée, la cloche à côté la **renvoie** telle quelle : le serveur
horodate chaque envoi (`announcedAt`), et c'est ce tampon, pas le texte, que
la superposition compare — un même texte envoyé deux fois sonne deux fois.
Face à un serveur qui ne l'horodate pas encore, seul le texte compte, et
renvoyer ne sonne pas.

Sur la vue de raid, l'annonce de chaque escouade s'affiche sous son nom, et
celles qu'on commande s'y écrivent sans passer par la vue d'escouade. Le chef
d'une escouade passe la main depuis le `⋯` d'une ligne, **Passer chef**.

Les menus d'une ligne (rôle, `⋯`) s'ouvrent par-dessus la fenêtre entière, pas
dans la liste qui les porte : sur la vue de raid, chaque escouade est sa
propre liste, et le menu du dernier membre s'ouvrait sous son bord, coupé.

**Glisser une escouade** d'une place à l'autre sur la vue de raid demande
`"dragDropEnabled": false` sur la fenêtre `squad` (`tauri.conf.json`) : sous
Windows, le glisser-déposer de fichiers que Tauri intercepte par défaut
confisque les événements HTML5 de la webview, et rien ne se déposait jamais.

## Menu radial rapide

Maintenir `Alt+V` affiche un menu radial au centre de l'écran où se trouve le
curseur ; le relâcher lance l'action du secteur visé :

| Secteur                     | Position    | Proposé                                  |
| --------------------------- | ----------- | ---------------------------------------- |
| Nexus (fenêtre principale)  | haut        | toujours — ramène la fenêtre principale  |
| Éliminé / Actif             | droite      | dans une escouade                        |
| Verrouiller / Déverrouiller | bas droite  | toujours — comme `Ctrl+Maj+L`            |
| Capture de zone             | bas gauche  | toujours — comme `Ctrl+Maj+S`            |
| READY / NOT READY           | gauche      | dans une escouade, grisé si éliminé      |

Fenêtre principale, verrou et capture gardent leur place hors escouade : le geste est le même dans
les deux cas. Le menu est une fenêtre à part, jamais verrouillée : il reste
utilisable par-dessus des superpositions verrouillées, y compris pour les
déverrouiller.

Relâcher au centre, sur un secteur grisé, ou appuyer sur Échap annule.

**Viser sans curseur.** En jeu le curseur est verrouillé et caché : le menu se
vise au *mouvement* de la souris, pas à sa position. Pendant qu'il est affiché,
l'écouteur Raw Input (`src-tauri/src/hotkeys.rs`) lit aussi la souris, focus ou
pas, et chaque déplacement pousse un pointeur depuis le centre ; il bute sur le
bord du cercle, si bien que changer d'avis coûte toujours le même petit coup de
poignet. La souris n'est écoutée que menu ouvert — son flux, jusqu'à plusieurs
milliers de rapports par seconde, réveillerait sinon le thread pour rien. Hors
Windows, le trajet du curseur depuis l'appui en tient lieu.

**Ni focus, ni clic.** La fenêtre (`radial`) ne peut pas prendre le focus et
laisse passer la souris : le jeu garde le clavier et la souris pendant tout le
geste. En contrepartie, comme pour les raccourcis, le jeu reçoit aussi les
frappes — Échap compris.

**Relâcher, de façon certaine.** Le relâchement arrive par Raw Input et par le
plugin, mais une touche relâchée pendant un changement d'application peut
échapper aux deux ; le menu interroge donc aussi l'état du clavier à chaque
image et se ferme dès que la combinaison n'est plus tenue. Un menu resté ouvert
sans personne pour le tenir resterait sinon au-dessus du jeu.

**Qui fait quoi** (`src-tauri/src/radial.rs`, `src/pages/radial-overlay-page.tsx`) :
Rust ouvre, déplace le pointeur et ferme ; la page dessine et décide du
secteur. Elle n'a ni session ni réseau : ce qu'elle sait de l'escouade, c'est la
fenêtre Escouade qui le lui dit (`useRadialBridge`), et c'est à elle qu'elle
rend les deux actions d'escouade — écrites par la même mutation que les boutons
de la ligne de membre, donc affichées aussitôt et confirmées par une
notification. La capture passe par la commande du raccourci de capture, la
fenêtre principale par `radial_open_main`, qui la réaffiche et la remet au
premier plan même réduite derrière le jeu.

## Notifications

Les notifications s'affichent dans **des fenêtres à elles**, deux :

- **Le coin.** Accrochée à un coin de l'écran — en bas à droite par défaut,
  comme celles de Windows. Le coin se choisit dans **Paramètres**, où un exemple
  part à chaque changement pour montrer où il tombe. C'est là que va tout ce
  qui vaut d'être remarqué sans gêner : un échec de capture, une mise à jour.
- **Le haut de l'écran, au milieu, en grand.** Pour ce qui est demandé à toute
  l'escouade — une annonce, un ready check — et que personne ne lirait dans un
  coin pendant que le jeu tient les yeux. Plus large (560 px), plus gros
  caractères, un bouton plus gros ; trois au plus, la plus récente en haut.
  Centré est centré : le réglage du coin ne la concerne pas.

Des fenêtres séparées plutôt qu'un coin de la fenêtre principale : celle-ci est
presque toujours rangée ou minimisée derrière le jeu, et une notification que
personne ne voit n'en est pas une.

Le partage des rôles :

- **Rust** possède la géométrie (`src-tauri/src/notifications.rs`). Il choisit le
  moniteur, lit sa *zone de travail* — pas l'écran entier, pour que les toasts se
  posent au-dessus de la barre des tâches et non dessous — et place chaque
  fenêtre à sa place. Le moniteur est celui **sous le curseur**, la règle que
  suit déjà la capture de zone ; il est figé le temps d'une pile, pour qu'elle ne
  saute pas d'un écran à l'autre en cours de route.
- **La superposition** (`src/pages/notifications-overlay-page.tsx`, la même
  page dans les deux fenêtres) dessine la pile et renvoie sa hauteur : la
  fenêtre est redimensionnée à chaque changement pour ne jamais couvrir plus
  que les toasts eux-mêmes. Rust reconnaît la fenêtre qui l'appelle, la page
  n'a qu'à savoir à quoi ressembler. Chaque fenêtre n'écoute **que ce qui lui
  est adressé** : l'écoute par défaut de Tauri vise « n'importe quelle cible »
  et reçoit donc tout, y compris ce que Rust envoie à l'autre fenêtre — une
  annonce s'afficherait alors en haut *et* dans le coin.

Émettre une notification depuis n'importe quelle fenêtre :

```ts
import { notify } from "@/lib/notifications";

await notify({ kind: "error", title: "Capture impossible", body: raison });
await notify({ title: "Annonce — Alpha", body: texte, placement: "top" });
```

`placement` vaut `corner` par défaut.

L'appel passe par Rust plutôt que par un état React : la fenêtre qui émet n'est
pratiquement jamais celle qui affiche. Rust en émet aussi directement — un échec
de capture ou d'OCR n'avait jusqu'ici nulle part où s'afficher, puisque la
fenêtre de sélection est refermée avant l'erreur.

Une notification levée pendant que la superposition charge encore n'est pas
perdue : elle est mise de côté (huit au plus) et remise quand elle signale
qu'elle écoute.

Une notification peut porter **un bouton** (`action` : un libellé et un
événement, avec sa charge utile). Le presser diffuse l'événement à toutes les
fenêtres et ferme le toast : c'est la fenêtre qui a levé la notification qui
agit, celle des toasts n'ayant ni session ni réseau. Le ready check d'escouade
est le premier à s'en servir.

Quatre niveaux — `info`, `success`, `warning`, `error` — qui décident de l'icône,
de la couleur et de la durée (5 à 10 s). Quatre toasts au maximum dans le coin,
le plus récent contre le coin. Survoler un toast le retient ; le quitter relance son
compte à rebours depuis le début. Un curseur oublié dans ce coin — ce qu'un jeu
qui tient la souris rend très possible — ne l'épingle pas pour autant : passé
30 s, il s'en va quoi qu'il arrive.

> Limites connues : les fenêtres ne prennent jamais le focus (`focusable:
> false`), mais elles restent des fenêtres — un clic dans la zone qu'elles
> occupent leur revient et n'atteint pas ce qu'il y a dessous. D'où le
> redimensionnement au plus juste. Et comme toute fenêtre en surimpression,
> elles sont invisibles d'un jeu en plein écran exclusif ; en plein écran
> fenêtré, elles s'affichent.

## Navigation vers l'Aaron Halo

La superposition **Aaron Halo** (`Ctrl+Shift+A`, fenêtre `halo`) dit à quelle
distance restante couper un saut quantique pour tomber dans une bande de la
ceinture.

- Le calcul (`src/lib/aaron-halo.ts`, copie de `lib/aaron-halo.ts` du site) :
  les bandes sont des couronnes centrées sur l'origine du repère de Stanton,
  dans le plan des orbites ; le trajet est une ligne droite entre deux cibles
  de saut (stations des points de Lagrange, planètes) ; la portion dans la
  bande est la fenêtre, et l'on vise son milieu. Un trajet peut traverser une
  bande deux fois : la traversée la plus large est donnée.
- Sans arrivée choisie, celle dont la fenêtre dans la bande est la plus large.
  Départ, arrivée et bande sont gardés dans le store `haloRoute`.
- Les bandes et les cibles viennent de `GET /api/aaron-halo`, gardées dans le
  store `haloData`, avec les valeurs intégrées en dernier recours.
- La fenêtre écoute `nps://position` : un relevé de moins de 10 min, dans
  Stanton ou sans système connu, dit dans quelle bande on est, ou à quelle
  distance de la plus proche.
- « Guider avec le NPS » pose le milieu de la traversée comme destination
  du NPS (un point, dans le repère du système).
