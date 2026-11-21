# Développement

Lancer l'application en local, la vérifier et la tester.

## Prérequis

- Node `^20.19.0 || >=22.12.0` (contrainte de Vite)
- Rust stable
- Linux : `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev`

## Lancer

```bash
npm install
npm run tauri:dev
```

`npm run tauri:dev` démarre Vite **et** le binaire. Lancer le binaire de debug
seul n'affiche rien : en mode debug, Tauri charge `build.devUrl`
(`http://localhost:1420`), donc le serveur Vite doit tourner.

## Vérifications

```bash
npm run typecheck   # tsc --noEmit
npm run build       # tsc + vite build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## Intégration continue

`.github/workflows/ci.yml` rejoue ces vérifications sur `windows-latest`, la
seule plateforme cible, puis produit les installeurs via `tauri build`.

Les binaires (`.msi` et `.exe` NSIS) sont publiés en artefact `nexus-app-windows`
sur chaque exécution, ce qui permet de tester une PR sans build local.

Le build du frontend précède obligatoirement toute commande qui **compile** la
crate (`cargo clippy`, `tauri build`) : `build.rs` appelle `tauri_build::build()`,
qui résout `frontendDist` (`../dist`) et échoue si le dossier n'existe pas.
`cargo fmt` ne compile rien et n'est pas concerné.

## Traductions

L'interface existe en français, anglais et espagnol (`use-intl`). Les messages
sont dans `src/i18n/messages/<langue>/<Namespace>.json` ; le français fait
référence. Toute nouvelle chaîne s'ajoute dans les trois langues, puis :

```bash
npm run i18n:types   # régénère src/i18n/messages-types.ts depuis le français
npm run i18n:check   # échoue si une langue manque une clé ou si un message n'est pas de l'ICU valide
```

## Vérifier le code Windows sans Windows

`xcap` et la crate `windows` ne compilent que pour Windows. Depuis Linux,
[cargo-xwin](https://github.com/rust-cross/cargo-xwin) fournit le SDK Windows
et permet de contrôler toute la crate :

```bash
cd src-tauri && cargo xwin check --target x86_64-pc-windows-msvc
```

Plus léger pour la seule capture : `src-tauri/src/capture.rs` ne dépend que de
`serde`, `xcap` et `windows` ; recopié dans une crate jetable ciblant
`x86_64-pc-windows-msvc`, il se type-checke en local, appels WinRT compris.
C'est nettement plus rapide que d'attendre la CI.

## Version

Chaque changement publié monte la version (patch pour un correctif), dans les
trois fichiers alignés : `package.json`, `src-tauri/tauri.conf.json` et
`src-tauri/Cargo.toml` (plus `Cargo.lock`). La publication est décrite dans
[publication.md](publication.md).

## Linux sans GPU

En conteneur ou VM sans accélération, WebKitGTK peut afficher une fenêtre vide :

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri:dev
```
