# Architecture

Comment l'application est construite, ce qu'elle demande à l'API de Nexus Tools, et comment elle s'y connecte.

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
  auth/               contexte de session (connexion via Nexus Tools)
  components/         layout + primitives d'UI
  pages/              un écran par fonctionnalité
  types/nexus.ts      types miroir des réponses de l'API
src-tauri/            binaire Tauri, plugins et permissions
```

## Écrans et endpoints

La fenêtre s'ouvre sur l'**accueil** : les superpositions à lancer avant le jeu
(recherche, escouade, carte, NPS, plan de vol, bloc-notes, cargo, Nexus Chat),
chacune avec son
raccourci, l'état de l'escouade, le début du bloc-notes et l'accès à la base de
données. Le menu range les écrans en deux groupes — *Base de données* et *Mon
espace* — et garde en bas deux boutons qui affichent les superpositions
Escouade et Carte. Ces boutons, comme les tuiles de l'accueil, passent par la
commande `show_overlay` : ils affichent la fenêtre, jamais ne la masquent,
contrairement au raccourci qui bascule.

| Écran         | Endpoints                                                   | Session requise |
| ------------- | ----------------------------------------------------------- | --------------- |
| Recherche     | `/api/search`                                                | non⁴            |
| Blueprints    | `/api/blueprints`, `/api/blueprints/:slug`, `…/categories`  | non¹            |
| ↳ mes blueprints | `/api/blueprints/:id/ownership` (POST, DELETE)            | oui             |
| ↳ reçu en jeu | `/api/blueprints/lookup?name=` (voir [Game.log](fonctionnalites.md#gamelog))          | oui             |
| ↳ dans mon org | `/api/blueprints/:id/org-owners`                            | oui             |
| Objets        | `/api/items`, `/api/items/:slug`, `…/facets`                 | non             |
| Missions      | `/api/missions`, `/api/missions/:id`, `…/factions`          | non             |
| Factions      | `/api/factions`                                              | non             |
| Réputations   | `/api/reps`, `/api/reps/factions`                            | oui             |
| Inventaire    | `/api/inventory/items`, `/api/inventory/items/bulk`, `/api/inventory/locations` | oui |
| ↳ colis      | `/api/inventory/parcels`, `…/parcels/:code`, `…/parcels/:code/accept` | oui |
| Organisations | `/api/orgs`, `/api/orgs/:id/inventory`                       | partiellement²  |
| ↳ en jeu      | `/api/orgs/:id/presence`, `/api/me/presence` (GET, PUT, DELETE) | oui          |
| Feuille de cargo | `/api/cargo-ships` (une fois, mise en cache)               | non⁵            |
| Bloc-notes    | `/api/notes`                                                 | non³            |
| NPS           | `/api/lieux/nps`, `/api/lieux/:slug/position` (POST)          | pour enregistrer |
| Nexus Chat    | `/api/chat` (POST, en flux), `/api/chat/status`, `/api/chat/access` (POST), `/api/chat/conversations`, `…/conversations/:id` (GET, PATCH, DELETE) | oui, et un accès ouvert |

¹ le filtre « possédés » n'apparaît qu'une fois connecté, il est résolu côté serveur.
² la liste publique est accessible sans session ; l'inventaire partagé non.
³ connecté, ce sont les notes en ligne du compte ; sinon, des notes locales.
⁴ l'inventaire personnel n'entre dans les résultats qu'une fois connecté. Les
objets du jeu y figurent avec leur type (arme, véhicule, ressource…) et
s'ouvrent dans l'écran « Objets ».
⁵ la feuille elle-même ne quitte jamais la machine ; voir [Feuille de cargo](fonctionnalites.md#feuille-de-cargo).

Le site va plus loin que cette application : boutiques, marché, commandes,
industrie (fret, raffinage) et fiche d'organisation n'ont **aucune route API**
et ne sont rendus que côté serveur. Les écrans correspondants demanderaient donc
d'abord du travail dans `nexus-tools` ; d'ici là, la palette de recherche ouvre
ces résultats-là dans le navigateur.

Les endpoints `/api/me`, `/api/reps`, `/api/reps/factions`, `/api/orgs`,
`/api/blueprints/:slug`, `/api/blueprints/:id/ownership` et
`/api/blueprints/lookup` ont été ajoutés à
`nexus-tools` pour cette application : ces données n'étaient jusqu'ici
disponibles qu'en rendu serveur, ou par une *server action* que seul le site
sait appeler.

### « Mes blueprints », depuis l'application

Trois endroits donnent la possibilité d'**ajouter**, parce que c'est trois
moments différents : la **grille**, où l'on parcourt ; la **fiche**, où l'on
décide ; et la **liste de la palette de recherche**, où l'on ne faisait que
passer.

**Retirer** n'est offert que là où la possession est connue, c'est-à-dire dans
la grille et sur la fiche. Un résultat de recherche n'en dit rien : proposer un
retrait à l'aveugle reviendrait à parier. La palette garde donc son seul `+`,
que la route idempotente rend sans conséquence — `added: false` veut dire « il y
était déjà », ce qui suffit à répondre juste sans poser une deuxième question.

Dans la grille, un blueprint possédé porte un contrôle plutôt qu'un badge : une
coche qui devient un moins au survol. Une carte a la place d'un seul élément
dans ce coin, et un badge à côté d'un bouton dirait deux fois la même chose.

Un **blueprint par défaut** est possédé par tout le monde. C'est le seul cas où
la carte garde son badge « Possédé » sans bouton : il n'y a rien à ajouter, et
rien à reprendre. Le site le sait par `isDefault`, que la liste et la fiche
renvoient à côté de `owned` — et pour la même raison, seulement à un appelant
connecté.

Le changement est fait dans la fenêtre où l'on a cliqué, et la palette est une
fenêtre à part. Comme le client de requêtes ne rafraîchit pas au retour du
focus, un ajout depuis la palette laisserait la fenêtre principale afficher
« non possédé » indéfiniment : il est donc annoncé aux autres fenêtres, comme
l'est une modification de la feuille de cargo. L'annonce part quoi qu'ait
répondu la route, « c'était déjà le cas » compris — elle se lit « quelqu'un
vient d'affirmer une possession, relisez », et une fenêtre qui affiche le
contraire est précisément celle qu'il faut prévenir.

## Authentification

La connexion se fait **sur Nexus Tools, dans le navigateur** (redirection
loopback, RFC 8252) :

1. « Se connecter » ouvre `/desktop/connect` sur le site, avec un `state` et
   l'empreinte d'un secret que l'application garde (PKCE, RFC 7636) ;
   `src-tauri/src/browser_auth.rs` y ajoute le port de la boucle locale sur
   lequel il écoute.
2. Déjà connecté sur le site, le navigateur revient aussitôt ; sinon le site
   demande la connexion — e-mail, Discord ou passkey — puis revient.
3. Le site renvoie le navigateur vers `http://127.0.0.1:<port>/callback` avec un
   code à usage unique (deux minutes).
4. L'application l'échange, avec le secret, contre une session à elle
   (`POST /api/auth/desktop/exchange`) : se déconnecter de l'une ne déconnecte
   pas l'autre.

Le cookie `Set-Cookie` renvoyé par l'échange est persisté tel quel, ce qui évite
de deviner le nom du cookie (better-auth le préfixe `__Secure-` en HTTPS).

## Flux d'événements

Nexus Tools pousse ce qui change — l'escouade, le bloc-notes, demain les
notifications — sur **une connexion Server-Sent Events par client**
(`GET /api/events`, protocole décrit dans le README de nexus-tools). Elle est
tenue **par Rust** (`src-tauri/src/event_feed.rs`), pas par une webview : une
fenêtre ne sait rien des autres, et sept fenêtres tenant chacune un flux
feraient sept sessions vérifiées pour un seul utilisateur. Une seule connexion,
donc, ouverte **dès qu'une session existe**, quelle que soit la fenêtre visible
— une notification doit arriver pendant que l'app dort dans la zone de
notification —, et chaque événement est remis à la fenêtre qui le dessine :

| Événement du serveur | Événement Tauri  | Destinataire                       |
| -------------------- | ---------------- | ---------------------------------- |
| `squad.view`         | `squad://view`   | la superposition d'escouade        |
| `note`               | `note://changed` | toutes les fenêtres                |
| —                    | `feed://status`  | toutes les fenêtres (état du flux) |

Ce que Rust ne connaît pas, il l'ignore : un sujet peut exister côté serveur
avant qu'une fenêtre ne l'écoute.

**La session vient du store.** Rust lit le même `settings.json` que le
frontend (`apiBaseUrl`, `sessionCookie`), sans jamais l'écrire — et il ne sait
pas quand ce store a été ouvert ou modifié. Chaque fenêtre le lui dit donc
(`feed_sync`) après chaque vérification de session, et `auth://session-changed`
lui parvient aussi ; l'appel est idempotent. L'URL est revalidée contre la même
liste d'hôtes que la capacité `http` impose aux webviews : une requête faite
d'ici ne répond à aucune capacité, la règle est tenue à la main.

**Ce que la superposition d'escouade en fait.** Elle dit à Rust quelle
escouade elle regarde (`feed_set_squad`) — une autre escouade, c'est un autre
flux — et met chaque `squad://view` dans son cache React Query, sous la clé de
l'escouade pour laquelle il a été demandé. Au montage, elle prend d'abord le
dernier instantané reçu (`feed_snapshot`), le flux étant en général ouvert bien
avant elle ; sinon une seule requête. Deux règles tiennent l'ordre entre le
flux et ses propres écritures : un push reçu pendant qu'une mutation est en vol
est **retenu** (le dernier gagne) et appliqué une fois la réponse posée ; et un
push dont `squad.version` est **strictement inférieur** à celui affiché pour la
même escouade est ignoré — il a été lu avant ce que l'écran montre déjà.

**Reconnexion.** Perdu, le flux revient avec un délai de 1 s doublé jusqu'à
30 s (±20 %), remis à 1 s après trente secondes de connexion stable ; le `bye`
que le serveur envoie avant sa propre limite de temps redémarre sans attendre.
Un **401** arrête tout jusqu'au prochain changement de session — la
superposition d'escouade revérifie alors la session, ce qui efface le cookie
mort. Un **404** (serveur d'avant le flux) rabat sur `GET /api/squads` toutes
les 10 s, seulement tant que la superposition d'escouade est visible, et
ressaie le flux toutes les cinq minutes. Le journal (`nexus-app.log`) note
chaque transition, jamais le contenu.

### Les trois superpositions ont le même en-tête

Bloc-notes, feuille de cargo et escouade partagent deux boutons, en plus de la
croix.

**Le fond**, en trois états que le bouton fait défiler : *transparent* — rien
derrière le texte, qu'une ombre sous chaque lettre garde lisible ; *ombré* — la
même ombre, plus un léger voile sombre sur toute la fenêtre, pour un cockpit
trop clair pour du texte nu mais qu'on veut encore voir ; *opaque* — le panneau.
Chaque fenêtre garde son réglage d'un lancement à l'autre. `Ctrl+Maj+O` passe
les trois d'un coup au transparent si l'une d'elles dessine encore quelque
chose, et leur rend leur panneau sinon.

**Le verrou.** Verrouillée, la fenêtre laisse **passer les clics au jeu** :
elle reste lue, mais plus rien dessus ne réagit — sauf le verrou lui-même, seul
chemin de retour. Une fenêtre qui ignore la souris ne la voit plus, et ne peut
donc pas savoir que le curseur est sur son bouton : c'est Rust qui surveille la
position du curseur tant qu'une superposition est verrouillée, et rend la souris
à la fenêtre pendant que le pointeur est sur la zone que le bouton a déclarée —
`set_ignore_cursor_events`, basculé dans un sens puis dans l'autre. Le bouton
redéclare sa zone quand la fenêtre est redimensionnée, puisque l'en-tête se
réorganise sous lui.

## Thèmes d'interface

Toutes les couleurs passent par les jetons Tailwind `--color-nexus-*`
(`src/styles.css`), dérivés de quelques graines par `color-mix` : accent,
seconde couleur, teinte des surfaces, encre, arrondi, équerres, halo, motif.
Chaque thème ne pose que ses graines sur `<html data-theme="…">`
(`src/themes.css`). Les couleurs d'état (vert, rouge, ambre) restent fixes ;
n'écrivez pas de `slate-*`, `sky-*` ni d'hexadécimal pour une couleur de
marque, sinon elle ne suivra pas le thème.

La fenêtre principale choisit le thème (`useShipTheme`, d'après le siège et
le préfixe de `class_name` de la télémétrie, `src/lib/themes.ts`), l'écrit
dans le store (`activeTheme`) et le diffuse (`theme://active`) ; les
superpositions le suivent (`useFollowTheme`).

## Instance ciblée

L'URL de l'API se règle dans **Paramètres**. Les hôtes autorisés sont déclarés
dans `src-tauri/capabilities/default.json` — une URL absente de cette liste est
rejetée à l'exécution par les permissions Tauri :

- `https://tools.services.nexus` (défaut, seul domaine de production)
- `http://localhost:3000` / `http://127.0.0.1:3000`

## Suites possibles

- Écrans marketplace (`/shopping`) et industrie (cargo).
- Cache hors-ligne persistant : le cache React Query est aujourd'hui en mémoire.
