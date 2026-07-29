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

| Écran         | Endpoints                                                  | Session requise |
| ------------- | ---------------------------------------------------------- | --------------- |
| Blueprints    | `/api/blueprints`, `/api/blueprints/:slug`, `…/categories` | non¹            |
| Missions      | `/api/missions`, `/api/missions/:id`, `…/factions`         | non             |
| Réputations   | `/api/reps`, `/api/reps/factions`                          | oui             |
| Inventaire    | `/api/inventory/items`, `/api/inventory/locations`         | oui             |
| Organisations | `/api/orgs`, `/api/orgs/:id/inventory`                     | partiellement²  |
| Bloc-notes    | `/api/notes`                                               | non³            |

¹ le filtre « possédés » n'apparaît qu'une fois connecté, il est résolu côté serveur.
² la liste publique est accessible sans session ; l'inventaire partagé non.
³ connecté, ce sont les notes en ligne du compte ; sinon, des notes locales.

Les endpoints `/api/me`, `/api/reps`, `/api/reps/factions`, `/api/orgs` et
`/api/blueprints/:slug` ont été ajoutés à `nexus-tools` pour cette application :
ces données n'étaient jusqu'ici disponibles qu'en rendu serveur.

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

### Superposition et capture d'écran

Deux raccourcis globaux, enregistrés côté Rust pour rester actifs quand
l'application est minimisée ou n'a pas le focus :

| Raccourci par défaut | Effet                                                       |
| -------------------- | ----------------------------------------------------------- |
| `Ctrl+Maj+B`         | ouvre la palette de recherche de blueprints en superposition |
| `Ctrl+Maj+S`         | ouvre la capture de zone, dont le texte alimente la palette  |
| `Ctrl+Maj+N`         | affiche ou masque le bloc-notes en superposition             |

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
Elle interroge `/api/blueprints?fuzzy=true`, tolérant aux imperfections de
l'OCR. Choisir un résultat ramène la fenêtre principale sur la fiche.

La capture suit cet enchaînement :

1. le raccourci **fige** l'écran sous le curseur (`xcap`) **avant** d'afficher
   quoi que ce soit — la surface de sélection ne peut donc pas se retrouver
   dans sa propre capture, et le tracé se fait sur une image stable ;
2. la fenêtre de sélection couvre exactement ce moniteur ;
3. au relâchement, la zone est découpée puis lue par **`Windows.Media.Ocr`**,
   le moteur fourni avec le système — rien à embarquer, contrairement à
   Tesseract qui demanderait un binaire et ses données d'entraînement ;
4. le texte reconnu remplit la barre de recherche.

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
