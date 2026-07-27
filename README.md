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

¹ le filtre « possédés » n'apparaît qu'une fois connecté, il est résolu côté serveur.
² la liste publique est accessible sans session ; l'inventaire partagé non.

Les endpoints `/api/me`, `/api/reps`, `/api/reps/factions`, `/api/orgs` et
`/api/blueprints/:slug` ont été ajoutés à `nexus-tools` pour cette application :
ces données n'étaient jusqu'ici disponibles qu'en rendu serveur.

### Authentification

La connexion utilise le flux **OTP par e-mail** de better-auth : c'est le seul
fournisseur qui fonctionne sans redirection navigateur. Le cookie `Set-Cookie`
renvoyé à la connexion est persisté tel quel, ce qui évite de deviner le nom du
cookie (better-auth le préfixe `__Secure-` en HTTPS).

> Discord OAuth n'est pas encore géré : il faudrait un listener sur une URL de
> redirection loopback. Voir « Suites possibles ».

## Développement

### Prérequis

- Node 20+
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
cargo check --manifest-path src-tauri/Cargo.toml
```

### Instance ciblée

L'URL de l'API se règle dans **Paramètres**. Les hôtes autorisés sont déclarés
dans `src-tauri/capabilities/default.json` — une URL absente de cette liste est
rejetée à l'exécution par les permissions Tauri :

- `https://tools.services.nexus` (défaut)
- `https://tools.nexus.services`
- `http://localhost:3000` / `http://127.0.0.1:3000`

> Le dépôt `nexus-tools` référence les deux orthographes du domaine de
> production. `tools.services.nexus` est retenu par défaut car il correspond au
> `rpID` de better-auth (`services.nexus`) et aux liens du serveur MCP.

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
