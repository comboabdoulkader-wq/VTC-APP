# Cahier des charges — Application VTC « RideGo »
### Plateforme de réservation de chauffeurs privés (type Uber / Bolt / Blacklane)
**Version 1.0 — Document destiné à une équipe de développement**
**Périmètre : Application Client · Application Chauffeur · Back-office Administrateur · Espace Partenaire · Espace Entreprise**

---

## 1. Présentation & vision produit

RideGo est une plateforme de transport avec chauffeur (VTC) premium, pensée pour une clientèle internationale. Elle couvre la réservation immédiate ou planifiée, les transferts aéroport avec suivi de vol, la facturation professionnelle, un réseau de partenaires (hôtels, conciergeries, agences) et un programme de parrainage rémunéré.

**Objectifs :**
- Offrir une expérience de réservation fluide, glanceable et « thumb-friendly » sur mobile.
- Garantir la transparence tarifaire (prix affiché avant confirmation, prix fixes aéroport).
- Fournir des outils métier : budgets entreprise, flotte de chauffeurs, commissions partenaires.
- Fonctionner à l'international : 6 langues, devise selon le pays, RTL pour l'arabe.

**Stack cible :** Frontend Expo / React Native (SDK 57) · Backend FastAPI (Python) · Base MongoDB · Object Storage · Notifications Push (relais managé) · Stripe · Twilio · AviationStack · Google/Apple Maps & Waze.

---

## 2. Personas & profils

| Profil | Rôle | Objectif principal |
|--------|------|--------------------|
| **Client (Passager)** | Utilisateur final | Réserver et suivre une course |
| **Chauffeur** | Prestataire | Recevoir, exécuter et facturer des courses |
| **Administrateur** | Exploitant plateforme | Piloter clients, chauffeurs, véhicules, paiements, commissions, promotions |
| **Partenaire** | Hôtel / Conciergerie / Agence | Réserver pour ses clients et percevoir une commission |
| **Entreprise** | Compte B2B | Gérer les déplacements et budgets de ses employés |

---

## 3. Fonctionnalités par profil (plan réorganisé : Client → Chauffeur → Admin → Partenaire → Entreprise)

### 3.1 CLIENT (Passager)

#### a) Géolocalisation en temps réel
- **Objectif :** localiser automatiquement le client à l'ouverture de l'app et suivre le chauffeur en direct.
- **Comportement :**
  - Détection GPS de la position du client dès l'ouverture (permission demandée contextuellement, avec explication du bénéfice avant la pop-up native).
  - Géocodage inverse pour pré-remplir l'adresse de prise en charge.
  - Position du chauffeur mise à jour en direct sur la carte pendant toute la course.
  - Calcul automatique de la distance et du temps d'arrivée estimé (ETA), rafraîchis en continu.

#### b) Carte interactive
- Carte plein écran avec point de départ détecté automatiquement.
- Déplacement manuel du point de prise en charge.
- Recherche d'adresse avec **autocomplétion** (Google Places en production, Photon/OSM en repli).
- Points d'intérêt : aéroports (CDG, Orly, Beauvais), gares, hôtels, Disneyland Paris, monuments.

#### c) Réservation intelligente
- Détection de la position actuelle + **adresses favorites** (Maison, Travail, Hôtel — icône ★).
- Réservation **immédiate** ou **planifiée** (jour + créneaux de 15 min).
- **Multi-destinations** et **aller-retour**.
- **Réservation multi-courses** (panier : commander plusieurs trajets en une fois).
- **Réservation pour une autre personne** (libellé passager + consignes chauffeur).
- Choix du véhicule (8 types de service, 5 catégories de véhicule avec capacité passagers/bagages).
- Options : rallonge kilométrique transparente, code promo, paiement espèces / carte / portefeuille récompenses.

#### d) Transferts aéroport
- Saisie du **numéro de vol** (+ compagnie).
- **Suivi automatique du vol** (AviationStack) : détection des retards, mise à jour de l'heure de prise en charge.
- Message rassurant : « **Votre chauffeur suit votre vol** ».

#### e) Suivi du chauffeur (course en cours)
- Suivi en direct + ETA.
- **Photo du chauffeur**, note, modèle et **plaque du véhicule**.
- Moyens de contact : **Chat in-app**, **Appel**, **WhatsApp**.
- Partage du trajet à un proche (lien public de suivi).

#### f) Historique, notation & reçus
- Historique complet des courses (actives en tête).
- **Notation détaillée** (ponctualité, propreté, conduite, véhicule) + pourboire + commentaire.
- **« Réserver à nouveau »** en un tap.
- **Reçu PDF** envoyé par email + téléchargeable.

---

### 3.2 CHAUFFEUR

- **Disponible / Indisponible** (statut en ligne, GPS actif).
- File des **demandes de courses** (tags : programmée, rallonge, libellé, paiement, affectée par).
- Cycle de course : **Accepter / Refuser → Aller au client (navigation) → Arrivé sur place → Client à bord → Début → Fin**.
- **Navigation GPS en un clic** : ouverture de **Google Maps**, **Waze** ou **Apple Plans** (iOS) selon la préférence stockée ; itinéraire de conduite réel affiché dans l'app (OSRM).
- Bouton **« Je suis sur place »** → déclenche l'alerte d'arrivée au client.
- **Historique des revenus** : net, part plateforme vs courses privées, commission par course, statistiques (heures en ligne, taux d'acceptation, meilleurs créneaux).
- **Courses privées** (hors plateforme) avec commission de 15 % à la clôture.
- **Documents** obligatoires (carte VTC, assurance, etc.) : upload, validité, blocage automatique si expiré, selfie à la demande de l'admin.
- **Gestion d'équipe / flotte** (chauffeur gestionnaire) : ajout de chauffeurs, KPIs, affectation de courses, activation/désactivation.

---

### 3.3 ADMINISTRATEUR (Back-office)

Console d'exploitation complète permettant la gestion :
- **Clients** : liste, activité, blocage.
- **Chauffeurs** : validation des documents, selfie, activation, blocage automatique.
- **Véhicules** : catégories, photos, capacités, grille tarifaire.
- **Paiements** : suivi Stripe, statuts, reçus.
- **Commissions** : taux plateforme, commissions partenaires et parrainage, demandes de versement.
- **Promotions** : codes promo plateforme (pourcentage ou montant fixe, plafond d'usage, expiration).
- **Partenaires** (hôtels, entreprises, conciergeries) : suivi des réservations et commissions.
- **Zones & tarifs** : centres-villes, multiplicateurs de prix, routes à prix fixe (ex. CDG → Paris = 75 €).
- **Statistiques temps réel** : courses actives, chiffre d'affaires, budgets.

---

### 3.4 PARTENAIRE (Hôtels / Conciergeries / Agences)

- **Réservation pour un client** : nom du client (affiché au chauffeur), n° de chambre, téléphone (SMS de suivi), trajet, véhicule, vol.
- **Tarif partenaire** : remise appliquée automatiquement, facturation sur relevé mensuel (`invoiced`).
- **Suivi en direct** des courses de leurs clients + partage du lien de suivi.
- **Commissions Partenaires (5 %)** — *fonctionnalité clé* :
  - Le partenaire perçoit **5 %** de chaque course réservée pour ses clients, crédité automatiquement sur son **portefeuille** à la fin de la course.
  - **Cascade réseau** : si le client crée ensuite son propre compte (même numéro de téléphone), le partenaire devient son parrain et continue de percevoir 5 % sur ses futures courses (+ 3 % niveau 2 pour le parrain du partenaire).
  - **Relevé mensuel** : écran dédié affichant le solde, les commissions du mois (directes vs réseau), le détail ligne par ligne, l'export **PDF**, et une **demande de versement** (à la demande du partenaire, versement min. 10 €).

---

### 3.5 ENTREPRISE (Comptes B2B)

- Inscription entreprise → **code d'invitation** employés.
- Chaque employé rejoint l'entreprise et réserve dans la limite d'un **budget** (jour / semaine / mois).
- Bascule **« Déplacement professionnel »** à la réservation (le serveur contrôle le budget → refus si dépassé).
- **Tableau de bord** : courses en cours, historique, coûts, employés.
- **Codes promo employés** (applicables uniquement aux courses professionnelles).
- **Relevés mensuels** exportables (CSV / PDF) par employé.

---

## 4. Paiement

- Cartes **Visa, Mastercard, Amex** via **Stripe Checkout** (sécurisé, vérification côté serveur).
- **Apple Pay / Google Pay** (via Stripe).
- **Espèces** et **portefeuille récompenses** (crédits de parrainage/commissions).
- **Facture / reçu PDF** et **historique des paiements**.
- Pourboire, frais d'annulation (3 € reversés au chauffeur après acceptation), remboursement du portefeuille en cas d'annulation.

---

## 5. International

- **6 langues** : Français, Anglais, Espagnol, Arabe (RTL), Portugais, Chinois.
- **Détection automatique de la langue** (paramètres du device) + choix manuel dans le profil.
- Notifications et SMS localisés dans la langue de l'utilisateur.
- **Devise selon le pays** (affichage adapté).

---

## 6. Description des écrans

> Charte : fond sombre premium `#0E0E0E` / surfaces `#141414`-`#1B1B1B` · texte `#FFFFFF` / secondaire `#B0B0B0` · accent marque (brand) · succès `#2D8C50` · alerte `#D97736` · erreur `#D32F2F`. Grille 8pt, cibles tactiles ≥ 44 px, coins arrondis, ombres douces.

| Écran | Champs / Éléments | Boutons | Icônes | Comportement |
|-------|-------------------|---------|--------|--------------|
| **Splash** | Logo RideGo | — | — | Chargement des polices/session puis redirection auto (connecté → app ; sinon → Accueil). |
| **Connexion** | Email, Mot de passe (œil afficher/masquer) | « Se connecter », « Mot de passe oublié ? », **Google** | mail, lock, eye, google | Validation, erreurs inline, limitation anti-brute-force. |
| **Inscription** | Nom, Email, Téléphone, Mot de passe, Rôle (Passager/Chauffeur/Entreprise), type partenaire, code parrainage | « Créer un compte », **Google** | account, phone | Après inscription avec téléphone → écran de vérification SMS (OTP). |
| **Accueil / Carte** | Barre de recherche, position actuelle, favoris | « Où allez-vous ? », ★ favoris | map-marker, crosshairs-gps, star | Localisation auto, carte interactive, bottom-sheet de réservation. |
| **Réservation** | Départ, Destination, Date/heure, Passagers, Enfants, Sièges, Bagages, N° de vol, Notes, Code promo | « Continuer », toggles rallonge/pro/portefeuille | circle, map-marker, calendar, airplane | Estimation en direct, prix fixe aéroport signalé. |
| **Choix du véhicule** | Cartes véhicule (photo, capacité, prix, badge « prix fixe ») | Sélection véhicule, « Confirmer • {prix} » | car, car-sports, van, bus | Grise les véhicules trop petits ; scroll horizontal. |
| **Paiement** | Moyen de paiement, récapitulatif prix (base + rallonge − remise) | « Payer par carte » (Stripe), « Espèces » | credit-card, cash, apple/google-pay | Redirection Checkout, retour vérifié serveur. |
| **Suivi du chauffeur** | Carte live, ETA, photo/plaque chauffeur | Chat, Appel, WhatsApp, Partager, Annuler | phone, message, whatsapp, share | Marqueur chauffeur animé, mises en avant « arrive », statuts. |
| **Historique** | Liste des courses (tags statut/paiement) | « Réserver à nouveau », « Reçu PDF » | history, receipt | Actives en tête, rafraîchissement auto. |
| **Profil** | Nom, téléphone (vérif SMS), langue, portefeuille, entreprise | Modifier, Déconnexion, sections admin | account, wallet, translate, office | Cartes portefeuille, langue, aide, légal. |
| **Support** | FAQ, coordonnées | WhatsApp, Email, Téléphone | help-circle, whatsapp, email | Deep links de contact, FAQ multilingue. |
| **Notifications** | Bannière + liste | Marquer comme lu | bell | Types : accepté, arrive, démarré, terminé, annulé, payé, portefeuille. |

**Écrans Chauffeur spécifiques :** Disponibilité (switch), Demandes, Course active (ETA + « Je suis sur place »/Start/Complete + Navigation), Courses privées, Équipe, Gains, Documents.

**Écran Partenaire — Commissions :** sélecteur de mois, solde portefeuille, totaux (mois / direct / réseau), détail des lignes, export PDF, demande de versement.

---

## 7. Architecture technique

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  App Client       │   │  App Chauffeur    │   │  Back-office      │
│  (Expo RN)        │   │  (Expo RN)        │   │  Admin (RN/Web)   │
└─────────┬────────┘   └─────────┬────────┘   └─────────┬────────┘
          │                      │                      │
          └──────────────┬───────┴──────────────┬───────┘
                         │   API REST /api/*     │
                    ┌────▼──────────────────────▼────┐
                    │      Backend FastAPI            │
                    │  Auth JWT · Rides · Driver ·    │
                    │  Company/Partner · Payments ·   │
                    │  Referral/Wallet · Documents ·  │
                    │  Notifications · Geo · Reports  │
                    └────┬───────────────┬───────────┘
                         │               │
                 ┌───────▼──────┐  ┌─────▼───────────────────────┐
                 │  MongoDB      │  │  Services externes           │
                 │  users/rides/ │  │  Stripe · Twilio SMS ·       │
                 │  wallet_tx/…  │  │  AviationStack · Object      │
                 └──────────────┘  │  Storage · Push · Email ·    │
                                   │  Google/Apple Maps · Waze ·  │
                                   │  Google Places · OSRM/Photon │
                                   └──────────────────────────────┘
```

**Composants :**
- **API** : FastAPI modulaire (`routes/{auth,rides,driver,team,payments,notifications,company,geo_routes,documents,extras,passenger_extras,referral}.py`).
- **Base de données** : MongoDB (collections `users`, `rides`, `wallet_tx`, `transactions`, `cities`, `fixed_routes`, `promos`, `notifications`, `partner_leads`).
- **Notifications Push** : relais managé + `expo-notifications` (build natif requis).
- **Géolocalisation GPS** : `expo-location` (permissions contextuelles) + streaming position chauffeur.
- **Cartographie** : Google Maps API (production) / `react-native-maps` + repli web.
- **Google Places API** : autocomplétion d'adresses.
- **Waze Deep Link** & **Apple Maps** : navigation chauffeur.
- **OSRM / Photon** : itinéraires et recherche en repli open-source.

---

## 8. Modèle de données (extrait)

- **users** : `{id, email, role, phone, phone_verified, partner_type, company_name, invite_code, company_id, budget_amount, budget_period, wallet_balance, sponsor_id, referral_code, partner_discount, docs_blocked, rating, …}`
- **rides** : `{id, passenger_id, driver_id, status, service_type, vehicle_type, pickup, dropoff, price, base_price, surcharge_amount, discount_amount, payment_method, payment_status, business, company_id, partner_booking, partner_name, partner_discount_amount, partner_commission_amount, guest_name, room, flight, booking_ref, share_token, rating, review, …}`
- **wallet_tx** : `{id, user_id, amount, type (referral_l1|referral_l2|partner_commission|ride_payment|payout|refund), label, ride_id, created_at}`
- **partner_leads** : `{phone, sponsor_id, partner_name, updated_at}` (liaison cascade partenaire → futur client)
- **fixed_routes**, **cities**, **promos**, **notifications**.

---

## 9. Sécurité & conformité

- Authentification **JWT**, mots de passe **bcrypt** (≥ 8 caractères).
- Limitation de débit (login, inscription, OTP, réinitialisation).
- Vérification téléphone par **OTP SMS** (HMAC, TTL, tentatives limitées).
- En-têtes de sécurité, CORS maîtrisé, limites de taille des entrées.
- Documents chauffeurs stockés en **Object Storage** (accès signé par token).
- Paiements **PCI** délégués à Stripe (aucune donnée carte stockée).

---

## 10. État d'implémentation & roadmap

**Déjà livré et testé :** Auth JWT + Google, réservation premium (8 services), prix fixes aéroport, suivi de vol, carte + navigation Google/Waze/Apple, chat/appel/WhatsApp, notation détaillée, reçus PDF email, portefeuille & parrainage multi-niveaux, budgets entreprise, flotte chauffeurs, documents & blocage, promotions, zones tarifaires, i18n 6 langues + RTL, espace partenaire, **commissions partenaires 5 % + relevé mensuel + versement**.

**À finaliser avec clés fournies par le client :** Twilio (SMS), AviationStack (vols), Google Maps/Places (clé prod), `google-services.json` (push natif), coordonnées support/légales réelles.

**Prérequis build natif :** notifications push, caméra, audio arrière-plan → nécessitent un build de développement/production (non testables sous Expo Go).

---

*Document généré pour l'équipe de développement RideGo — v1.0.*
