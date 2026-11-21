# Publication et mises à jour

Publier une version (releases GitHub, Microsoft Store) et comment l'application se met à jour.

## Publier une release

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

## Microsoft Store

Le Store se soumet un installeur **différent** de celui des releases GitHub, d'où
un mode de build à part :

```bash
npm run tauri:build:store
```

Il compile le binaire sans l'empaqueter (`tauri build --no-bundle`), puis
l'empaquette avec `src-tauri/tauri.microsoftstore.conf.json` par-dessus la
configuration normale (`tauri bundle --config …`). Le fichier à téléverser est
`src-tauri/target/release/bundle/nsis/Nexus App_<version>_x64-setup.exe`.

Ce que change l'overlay, et pourquoi :

| Réglage                             | Raison                                                        |
| ----------------------------------- | ------------------------------------------------------------- |
| `windows.webviewInstallMode.type: "offlineInstaller"` | exigence du Store : l'installeur embarque WebView2 au lieu de le télécharger |
| `targets: ["nsis"]`                 | une soumission ne porte qu'un installeur ; NSIS est celui que l'application sait déjà relancer |

L'installeur passe donc d'environ 5 Mo à ~140 Mo : c'est le runtime WebView2
embarqué, et le workflow refuse un bundle trop léger — un repli silencieux sur le
bootstrapper produirait un installeur parfaitement fonctionnel, que Partner
Center rejetterait ensuite.

Le MSI reste possible (`msiexec /quiet` au lieu de `/S`), mais rien ne l'exige
ici et le choisir demanderait de redéclarer le paramètre silencieux.

### Ce que demande Partner Center

- un **compte développeur** Microsoft, à titre individuel ou au nom d'une société ;
- un produit créé depuis
  [Apps and Games](https://partner.microsoft.com/en-us/dashboard/apps-and-games/overview)
  en **« EXE or MSI app »**, avec un nom réservé ;
- le **paramètre d'installation silencieuse**, à déclarer dans la soumission :
  `/S` — en **majuscule**, c'est celui de NSIS. Sans lui la soumission est
  refusée avec « Win32 products must install silently » ;
- un installeur **signé** (Authenticode). C'est le seul prérequis que le dépôt ne
  couvre pas encore : il demande un certificat, donc
  `bundle.windows.certificateThumbprint` (ou `signCommand`) et un secret de plus.
  À garder dans un overlay privé plutôt que dans `tauri.conf.json`, pour la même
  raison que `updater.conf.json` : la CI des pull requests n'a pas de certificat.

Les logos attendus par le Store (`Square*Logo.png`, `StoreLogo.png`) sont déjà
dans `src-tauri/icons`, écrits par `npm run tauri icon`.

### Éditeur

`bundle.publisher` vaut `"Nexus Corp"`, et pas seulement pour l'affichage : le
Store refuse un éditeur **identique au nom du produit**. Sans ce réglage, Tauri
déduit l'éditeur du deuxième segment de l'identifiant (`services.nexus.app`,
donc « nexus »), ce qui passerait la règle mais n'est le nom de personne.

### Mises à jour

Elles restent celles de l'application (voir « Mises à jour ») : pour un produit
EXE/MSI, le Store distribue l'installeur, il ne met rien à jour de lui-même. Une
copie installée depuis le Store se mettra donc à jour avec l'installeur **en
ligne** attaché à la release GitHub — sans conséquence, WebView2 étant déjà là.

### Ce que fait la CI

`.github/workflows/microsoft-store.yml` rejoue ce build sur les tags `v*` et à la
demande, et **attache l'installeur à la release du tag**, à côté de celui du
build normal — mais pas sous le même nom :

| Asset de la release                             | Contenu                                            |
| ----------------------------------------------- | -------------------------------------------------- |
| `Nexus.App_<version>_x64-setup.exe`             | l'installeur public, qui télécharge WebView2        |
| `Nexus.App_<version>_x64-microsoft-store.exe`   | celui à soumettre à Partner Center, WebView2 embarqué |

Le renommage n'est pas cosmétique. Le bundler donne le **même** nom aux deux, et
`release.yml` annonce aux copies déjà installées le premier asset qui se termine
par `-setup.exe` : sous son nom d'origine, celui du Store remplacerait l'autre
purement et simplement, et à défaut enverrait 140 Mo de WebView2 embarqué à des
gens qui l'ont déjà.

Comme `release.yml`, le workflow exige que la release existe et le vérifie
**avant** de compiler. L'installeur reste par ailleurs publié en artefact
`nexus-app-microsoft-store` (90 jours) : c'est le seul moyen de le récupérer
depuis une exécution qui n'a pas de release — pull request ou lancement manuel.

Il tourne enfin sur les pull requests qui touchent le workflow ou l'overlay :
rien d'autre ne construit cette variante, une erreur dedans ne se découvrirait
donc qu'au moment du tag. Les autres pull requests gardent le seul build de
`ci.yml`.

## Mises à jour

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

### Signature

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

### Ce que publie la CI

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
