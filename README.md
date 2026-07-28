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

**Chaque raccourci est enregistré indépendamment.** Une combinaison déjà prise
par une autre application — `Ctrl+Maj+S` en particulier est courante — ne coûte
que ce raccourci-là : les autres restent actifs, l'application démarre, et
Paramètres liste les combinaisons refusées avec leur motif. Le choix reste
enregistré même refusé, il suffit d'en saisir un autre.

Rien de tout cela ne peut empêcher le démarrage : ni l'initialisation du plugin,
ni l'enregistrement d'une combinaison. Un plugin qui n'a pas démarré coûte les
raccourcis et rien d'autre — Paramètres les liste alors comme indisponibles, là
où demander au plugin de lier une combinaison ferait tomber le processus.

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

Connecté, l'éditeur lit et écrit `/api/notes`, donc les notes sont les mêmes que
sur le site. Déconnecté, il écrit dans le store local. Les deux ne fusionnent
pas : la session décide simplement lequel s'applique, et le cache React Query
est indexé là-dessus pour qu'une connexion échange les notes affichées.

L'enregistrement est automatique, 1,2 s après la dernière frappe. Les écritures
peuvent se chevaucher (minuterie, bouton, fermeture de la fenêtre) et les
réponses revenir dans le désordre : seule la requête la plus récente met l'écran
à jour.

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

`.github/workflows/release.yml` se déclenche sur les tags `v*` :

```bash
# aligner les trois fichiers de version, puis
git tag v0.2.0 && git push origin v0.2.0
```

Le workflow refuse de builder si le tag ne correspond pas aux versions déclarées
dans `src-tauri/tauri.conf.json`, `package.json` et `src-tauri/Cargo.toml` — les
noms des installeurs venant de `tauri.conf.json`, un tag `v0.2.0` publierait
sinon un `Nexus App_0.3.0_x64-setup.exe`.

La release est créée **en brouillon**, avec les notes générées depuis les commits
et les deux installeurs attachés. À relire puis publier depuis l'onglet Releases.

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
