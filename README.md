# AutoTech Knowledge Hub

Plateforme web de données techniques et de diagnostic pour ateliers multimarques.
Cette version est la **première tranche fonctionnelle** du TRD (AutoTech_TRD v1.0) : identification véhicule,
diagnostic guidé multi-codes, schémas électriques interactifs, temps barémés avec recouvrement et entretien.

> **Données de démonstration.** La base est livrée avec 4 motorisations synthétiques (Golf VII 2.0 TDI / 1.6 TDI,
> Clio IV 1.5 dCi, Yaris III Hybrid). Couples, temps, valeurs de mesure et schéma sont **inventés pour la démo** :
> ne jamais les utiliser pour une réparation réelle. Voir « Données et licences » plus bas.

## Ce qui fonctionne

| Module | Fonctions |
|---|---|
| Identification | Décodage VIN ISO 3779 (WMI/VDS/VIS, année modèle, chiffre de contrôle), désambiguïsation des motorisations, arborescence Marque → Modèle → Génération → Motorisation, recherche libre (« golf 7 tdi »), raccourci Ctrl K |
| Diagnostic guidé | Jusqu'à 10 codes défaut, causes candidates fusionnées, **inférence topologique** (codes de perte de communication sur un même bus, masse/fusible partagés entre calculateurs), classement des tests par probabilité / temps, tests pas-à-pas avec valeurs attendues et verdict automatique, mise à jour des probabilités, confirmation de cause, clôture |
| Sécurité HT | Véhicules hybrides/électriques : tests HT verrouillés tant que la consignation (7 étapes) n'est pas confirmée et journalisée |
| Base de connaissances | Notes techniques / rappels liés aux codes, cas terrain vérifiés (confirmations) qui pondèrent le classement |
| Schémas électriques | SVG interactif généré depuis le graphe électrique : zoom/déplacement, **clic sur un fil = traçage du circuit complet** à travers les épissures, détails fil / broche / brochage du connecteur / masse (composants reliés) / calculateur (bus, alimentations, codes), « Voir sur le schéma » depuis une étape de test |
| Temps & devis | Opérations décomposées en étapes (graphe orienté) : les déposes communes ne sont comptées qu'une fois, table de recouvrement constructeur prioritaire, montants en millimes (DT), devis PDF |
| Entretien | Échéances km / durée (« au premier terme atteint »), statut en retard / à faire / bientôt, chiffrage en un clic, fiche d'entretien PDF |
| Méthodes | Méthodes structurées avec couples (y compris serrage angulaire, vis à remplacer), procédure de consignation HT |

Interface en français, espace de travail à onglets déplaçables (dockview) : diagnostic et schéma côte à côte.

## Démarrage rapide (Windows, macOS, Linux)

Prérequis : **Node.js 20+**, **pnpm** (`npm i -g pnpm` ou `corepack enable`) et une base **PostgreSQL 16**.

```bash
pnpm install
cp .env.example .env          # Windows : copy .env.example .env
```

Base de données, au choix :

- **Docker** : `docker compose up -d` (la valeur par défaut de `DATABASE_URL` fonctionne telle quelle).
- **PostgreSQL installé localement** : créez une base `autotech` et ajustez `DATABASE_URL`.
- **Supabase** : collez la chaîne de connexion « Session pooler » dans `DATABASE_URL`, puis lancez `pnpm db:migrate` et `pnpm db:seed`
  (la commande `db:reset` refuse de vider une base distante, sauf `RESET_CONFIRM=yes`).

```bash
pnpm db:reset                 # crée le schéma + données de démonstration (base locale)
pnpm dev                      # API http://localhost:4000/api + Web http://localhost:3000
```

Ouvrez http://localhost:3000.

### Scénarios de démonstration

1. VIN `WVWZZZAUZFW123456` → choisir la 2.0 CRLB → Diagnostic → codes `U0100 U0101 P0562`.
   Le premier test proposé est la **masse 12**, la seule cause qui explique les trois codes. Saisir 0,45 V → cause confirmée.
   « Voir sur le schéma » ouvre le schéma centré sur la masse.
2. Même véhicule, code `P0335` → tests du capteur de régime G28 (alimentation, signal, continuité, connecteur).
3. Schémas → cliquer un fil orange/noir : tout le réseau CAN-H (4 calculateurs) s'allume.
4. Entretien → 89 500 km → « Chiffrer les opérations à faire », puis cocher Kit de distribution + Pompe à eau :
   6,1 h barémées → 3,7 h facturées. Enregistrer → devis PDF.
5. VIN `VNKKD3D30JA123456` (Yaris Hybrid) → codes `P0A80 P0AA6` → tests HT verrouillés jusqu'à la consignation.

## Commandes

| Commande | Rôle |
|---|---|
| `pnpm dev` | API + Web en mode développement |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:reset` | Migrations, données démo, remise à zéro locale |
| `pnpm test` | Tests moteurs (26) + tests d'intégration API (15, base seedée requise) |
| `pnpm typecheck` | Vérification TypeScript de tous les paquets |
| `pnpm build` | Build API (tsc) + Web (Next.js) |
| `pnpm check` | Tout ce qui précède, à lancer avant chaque commit |

## Architecture

```
apps/web          Next.js 16 (App Router), React 19, Tailwind 4, dockview, d3-zoom — proxy /api → API
apps/api          NestJS 11 (REST, validation zod, PDF pdfkit)
packages/engines  Moteurs purs TypeScript : VIN, diagnostic multi-codes, recouvrement, entretien (testés)
packages/db       Migrations SQL, générateur SVG depuis le graphe, données de démonstration
storage/          Fichiers SVG générés (adressés par empreinte SHA-256)
```

Principes du schéma (détail dans le TRD §2) :

- **Groupes d'applicabilité** : chaque contenu pointe vers un ensemble de motorisations, jamais vers un véhicule unique.
- **Provenance** : chaque ligne de contenu référence sa source et sa licence (`data_source`).
- **Le câblage est un graphe**, le schéma est une vue : `wire` relie des `electrical_node` (broches, épissures, masses, fusibles),
  `diagram_element` relie chaque élément SVG à son entité. Le traçage est une requête récursive PostgreSQL.
- **Les temps sont un graphe d'étapes** (`labor_step` + dépendances) : le recouvrement se calcule, il n'est pas saisi à la main.

### API principale

| Méthode | Route | |
|---|---|---|
| GET | `/api/search?q=` | VIN, véhicule ou code défaut |
| GET | `/api/vehicles/vin/:vin` · `/api/vehicles/tree` · `/api/variants/:id` | Identification |
| POST | `/api/diagnostics/sessions` | `{ variantId, codes[] }` → classement des tests |
| POST | `/api/diagnostics/sessions/:id/results` | `{ causeId, steps: [{ stepId, value \| ok }] }` |
| POST | `/api/diagnostics/sessions/:id/hv-isolation` · `/close` | Consignation HT, clôture |
| GET | `/api/test-procedures/:id` · `/api/variants/:id/knowledge?dtcs=` | Étapes de test, notes et cas terrain |
| GET | `/api/variants/:id/diagrams` · `/api/diagrams/:id/svg` · `/api/diagrams/:id/trace?wire=` | Schémas |
| GET | `/api/wiring/entity/:kind/:id` | Détails fil / broche / masse / composant |
| POST | `/api/quotes/preview` · `/api/quotes` · GET `/api/quotes/:id/pdf` | Devis |
| GET | `/api/variants/:id/maintenance?km=&ageMonths=` · `.../checklist.pdf` | Entretien |
| GET | `/api/variants/:id/procedures` · `/api/procedures/:id` | Méthodes et couples |

## Pas encore dans cette tranche

- Authentification et rôles (Supabase Auth + RLS prévus) : l'API utilise un atelier de démonstration unique.
- Recherche par immatriculation : la route renvoie 501 tant qu'aucun fournisseur sous licence n'est branché.
- Bibliothèque OEM « verbatim » (PDF constructeur), carrosserie/cotes, calibrage ADAS, fonctions SERMI.
- Saisie et modération des cas terrain depuis l'interface, éditeurs internes (méthodes, schémas, temps).
- Boucle d'apprentissage des probabilités à partir des sessions clôturées (la clôture est déjà enregistrée).
- Thème clair et mode hors ligne.

## Données et licences

Le droit à la réparation (Règlement (UE) 2018/858) donne à un **atelier** l'accès aux informations constructeur pour ses
propres réparations ; il ne donne **pas** à une plateforme le droit de les republier. Ne jamais importer de contenu extrait
d'un logiciel sous licence (Autodata, HaynesPro, ALLDATA…) sans autorisation écrite. Sources légales envisagées :
rédaction propre, données ouvertes (vPIC, rappels), cas terrain sous accord de contribution, puis licences de fournisseurs
de données ou de constructeurs (TRD §7).

Polices DejaVu (PDF) : licence libre, voir `apps/api/assets/fonts/README.md`.
