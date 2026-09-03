# RideGo VTC App - PRD

## Overview
Full-stack VTC (ride-hailing) mobile app: Expo + FastAPI + MongoDB. Two roles: Passenger and Driver. Beyond Uber-like booking, it is a business tool: multi-orders, distance surcharge, private rides with commission, team (fleet) management, live GPS, Stripe payments, scheduled rides, in-app arrival alerts (SMS gateway ready).

## Business rules
- City center: Paris – Châtelet (48.8583, 2.3477)
- Surcharge ("rallonge"): optional, 1.20 €/km between pickup and city center, shown transparently before confirming
- Private rides commission: 15 % applied only when the driver marks the private ride completed
- Arrival alert: when driver ETA to pickup <= 2 min → in-app notification (banner + vibration) + SMS via Twilio if TWILIO_* env vars are set (otherwise logged)
- Card payments: Stripe hosted Checkout (EUR), verified server-side via session retrieve (webhook optional with STRIPE_WEBHOOK_SECRET)

## Features
### Passenger
- Auth (JWT), map home, choose pickup (list) + destination, 3 vehicle types with server-side pricing
- Ride options: surcharge toggle, schedule (now / day + 15-min slots), for me / for someone else (label), notes for driver, cash or card
- Multi-orders: add rides to a cart, order all at once (`POST /rides/batch`), each tracked separately
- Ride detail: live driver marker + ETA, "arriving" highlight, price breakdown (base + surcharge), pay by card (Stripe), rating post-ride, cancel
- Rides list: active rides first, tags (scheduled, label, surcharge, payment), auto refresh
- Notifications banner (accepted, arriving, started, completed, cancelled, paid)

### Driver
- Online/offline, live GPS via expo-location (permission contract: explain → request → open settings), streams to `/driver/location`
- Requests list with tags (scheduled, surcharge bonus, label, payment, assigned-by); sorted by surcharge
- Active ride: ETA pill, "Je suis sur place" button (fires 2-min alert), start/complete
- Private rides tab: add (client, phone, addresses, date/time, price, payment, notes), start, close (commission 15 %), delete; stats
- Team tab (manager): add driver accounts, KPIs (gross/commission/net), activate/deactivate, assign open ride to a member, recent activity, remove; members see "team of X"
- Earnings: net hero, platform vs private split, commission per ride

## Iteration 3 additions
- Passenger GPS pickup (expo-location, permission contract) + reverse geocoding; worldwide address autocomplete via Photon/OSM proxied by backend (`/geo/search`, `/geo/reverse`)
- Worldwide city centers: `cities` collection seeded with 30 cities; nearest city (<=60 km) used for the surcharge; unknown areas auto-discovered via reverse geocoding; moderators (MODERATOR_EMAILS env, default test accounts) edit/add via `/admin/cities` + UI in Profil → "Modération des centres-villes"
- Scheduled ride reminder: backend loop every 60 s notifies passenger + driver 45 min before `scheduled_at` (REMINDER_MIN)
- Accounting exports: `/team/invoices|export.csv|export.pdf?month=YYYY-MM` (per driver) and `/company/report|export.csv|export.pdf` (per employee); reportlab PDF; auth via `?token=` query supported for downloads; UI component AccountingExport
- Business accounts (role `company`): register with company_name → invite_code; passenger joins via Profil → Compte professionnel; company sets budget (day/week/month) + blocks access; passenger toggles "Déplacement professionnel" at booking (server enforces budget → 402); company dashboard `(company)` group: live rides, history, overview, employees, exports

## Iteration 5 additions – Documents, blocking, selfie, navigation
- Driver documents (8 types: id_card, driving_license, vtc_card*, rc_pro (independent drivers only), registration (no expiry), vehicle_insurance, rc_circulation, technical_inspection*) — * "si applicable" can be marked "Non concerné"
- Upload (JPG/PNG/WEBP/PDF ≤10 Mo) to Emergent Object Storage (`storage.py`, EMERGENT_LLM_KEY), viewed via `/api/files/{path}?token=`
- Validity dates (valid_from optional, valid_until required when expires); auto-valid on upload; admins (moderators) can validate/reject (`PATCH /admin/documents/{id}`)
- Hourly compliance sweep: J-30 alert to driver + admins (once), expiry → status expired + alert; any required doc missing/expired/rejected → `docs_blocked` → cannot go online / see / accept rides (HTTP 423 with the official message); auto-unblock after re-upload
- On-demand selfie: admin `POST /admin/drivers/{id}/request-selfie` → driver banner → camera upload (type selfie, pending) → admin validates/rejects (reject re-requests)
- Admin console UI: Profil → "Administration chauffeurs & documents" (moderators, any role)
- Navigation: driver "Aller au client" / "Aller à destination" opens Waze or Google Maps (deep links, fallbacks), preference stored (AsyncStorage) + Profil → Navigation; in-app travel plan = real driving route via OSRM (`GET /geo/route`) drawn on the map with distance/duration

## Backend structure
- `core.py` (config, DB, auth helpers, pricing, notify/SMS), `models.py`, `serializers.py`, `routes/{auth,rides,driver,team,payments,notifications,company,geo_routes,documents}.py`, `storage.py` (object storage), `geo.py` (Photon), `reports.py` (CSV/PDF), `server.py`

## Endpoints (/api)
- Auth: POST /auth/register, /auth/login, GET /auth/me
- Rides: POST /rides/estimate → {options[], surcharge}, POST /rides, POST /rides/batch, GET /rides/mine, /rides/active, /rides/active-list, /rides/available, /rides/{id}; POST /rides/{id}/accept|start|complete|cancel|rate
- Driver: POST /driver/status, POST /driver/location, GET /driver/earnings, GET/POST /driver/private-rides, PATCH/DELETE /driver/private-rides/{id}
- Team: GET/POST /team/members, PATCH/DELETE /team/members/{id}, GET /team/members/{id}/rides, GET /team/rides, POST /team/assign, GET /team/overview
- Payments: GET /payments/config, POST /payments/checkout/{ride_id}, GET /payments/status/{ride_id}, POST /payments/webhook
- Notifications: GET /notifications?unread_only, POST /notifications/{id}/read, POST /notifications/read-all

## Env (backend/.env)
MONGO_URL, DB_NAME, STRIPE_SECRET_KEY (user's restricted test key), STRIPE_WEBHOOK_SECRET (optional), FRONTEND_URL, TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER (optional)

## Tech Stack
Expo Router, RN 0.81, @gorhom/bottom-sheet, react-native-maps (web fallback), expo-location, expo-web-browser, expo-haptics; FastAPI, Motor, PyJWT, bcrypt, stripe

## Test Credentials
See /app/memory/test_credentials.md

## Iteration 7 additions
- Document history: previous versions are archived (never deleted) — `GET /documents/history`, admin detail `history[]` with file links; UI "Historique des documents" (driver) + admin section
- Reminders J-30 / J-7 / J-1 (`WARN_STEPS`, `warned_days` on document) + expiry/blocked/unblocked alerts sent to the team manager (`alert_supervisors`, notification type `team_document`)
- Driver profile photo: upload type `profile_photo` → `users.photo_path`; `GET /users/{id}/photo?token=` (any authenticated user); shown to passenger in ride detail (`driver_has_photo`), driver profile avatar with camera button

## Iteration 8 additions
- In-ride chat: `GET/POST /rides/{id}/messages`, `GET /rides/{id}/messages/unread` (accepted/in_progress only; parties only; notification type `message`); UI RideChat (SheetModal, quick replies, polling 3 s) + ChatButton with unread badge on passenger ride detail and driver active ride
- Promo codes (`routes/extras.py`): admins create platform-wide codes, companies create employee-only codes (apply only on business rides); percent or fixed amount, max uses, expiry, min price; `POST /promos/validate`; ride creation accepts `promo_code` → `discount_amount`, price reduced; UI PromosManager (company profile + moderator profiles) and promo input in RideOptions + breakdown
- Pricing zones: `cities.price_multiplier` (0.5–3.0) editable by moderators in CitiesModeration; estimate/ride base price × multiplier; ride stores `price_multiplier`, `city_name`
- Tips: rating box offers tip chips (0/1/2/5/10 €); `POST /rides/{id}/rate {rating, tip}`; card rides → Stripe checkout `kind: "tip"` (payments keyed by ride_id+kind), `tip_paid`, driver notified; cash tips recorded; earnings already include tips

## Iteration 9 additions (`routes/passenger_extras.py`)
- Favorites: `GET/POST/DELETE /favorites` (one address per label Maison/Travail; custom labels); shown at top of the passenger address list with star icon; save via ☆ on any result; delete via trash
- Cancellation fee: passenger cancelling after driver acceptance → `cancellation_fee` 3 € (constant CANCEL_FEE) credited to the driver (earnings `cancellation_fees`); cannot cancel in_progress; UI warning Alert before cancelling + hint under the button
- Driver stats: online sessions (`driver_sessions`, `users.online_since`), `POST /rides/{id}/decline` (hides request, counts for acceptance rate), `GET /driver/stats` (online hours 7d/total, acceptance rate, completion, best weekday/2h slots by earnings, earnings by day) displayed in Gains tab
- Ride sharing: every ride has `share_token`; public `GET /public/track/{token}` (no auth, limited fields); public page `/track/{token}` polling 5 s; "Partager mon trajet à un proche" button (native Share / web share or clipboard)

## Iteration 10 additions – Twilio SMS, phone OTP, wallet UI, security hardening
- Twilio SMS gateway (`core.send_sms`, env TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER, DEFAULT_COUNTRY_CODE=+33). Without keys → test mode: SMS logged, OTP code returned as `dev_code` and shown in the app
- Phone verification by SMS OTP: `POST /auth/phone/send-code {phone}` (E.164 normalisation, 3/10 min per user), `POST /auth/phone/verify {code}` (6 digits, HMAC hash, 10 min TTL, 5 attempts), `GET /auth/phone/status`
- SMS alerts (only if phone verified + `sms_enabled`): driver arriving (≤2 min), ride accepted (incl. team assignment), started, completed, scheduled-ride reminder. Toggle in profile (PhoneVerifyCard)
- Post-signup screen `(auth)/verify-phone` when a phone was given (skippable). Register accepts referral code
- `PATCH /auth/me` (name, phone → re-verify, sms_enabled, vehicle for drivers), `POST /auth/password` (current + new ≥ 8)
- Wallet UI: WalletCard in passenger/driver/company profiles; "Utiliser mon crédit" toggle in RideOptions (`use_wallet`), breakdown shows wallet part + "Reste à payer"; ride detail shows wallet row and card button charges `due_amount`
- Security: login rate limit (8 / 15 min per account, 30 / 15 min per IP), register 10/h per IP, OTP + password change limits, password ≥ 8 chars, JWT_SECRET in backend/.env, security headers middleware, CORS without credentials, input length limits
- UX: password visibility toggle (login/register), functional profile menu (AccountSection → AccountSettings sheet), wide-screen frame (≥ 820 px → centred 480 px column)

## Iteration 11 – Expo SDK 57 upgrade
- `yarn expo install expo@^57.0.0 --fix` → expo 57.0.19, RN 0.86.3, React 19.2.3, expo-router 57, reanimated 4.5.1, worklets 0.10.1, gesture-handler 2.32, screens 4.26, safe-area 5.7, maps 1.27.2, webview 13.16.1, TS 6.0, eslint-config-expo 57
- Removed `@expo/vector-icons` (deprecated); `use-icon-fonts.ts` now preloads the scoped MaterialDesignIcons font (CDN) under Expo Go only
- app.json: removed `newArchEnabled` and `android.edgeToEdgeEnabled` (defaults in SDK 57 schema). expo-doctor 21/21 OK, tsc OK
- Replaced deprecated `shadow*`/`elevation` styles by `boxShadow`; `pointerEvents` prop → style
- Frontend regression smoke test PASS (iteration_9 report)

## Iteration 12 – Phase 1 of the premium roadmap
- Forgot password by SMS OTP: `POST /auth/forgot-password {identifier}` (email or phone, needs a verified phone) → `POST /auth/reset-password {identifier, code, new_password}` → auto-login. Screen `(auth)/forgot-password`, link on login
- Push notifications (Emergent managed relay, `backend/push.py`): `POST /api/register-push` (auth), `push_safe()` called from `notify()` (every in-app notification → push with action_url) and on new ride → all online eligible drivers. Frontend: handlers in `_layout.tsx`, `PushRegistrar` (after login + on foreground), `expo-notifications` plugin. Needs `google-services.json` (user has none yet) + native build; `EMERGENT_PUSH_KEY=placeholder` replaced at deploy
- Tracking-link SMS on accept (`core.send_tracking_link`, uses `FRONTEND_URL/track/{share_token}`)

## Roadmap agreed with user (do not remove existing features)
- Phase 2 Booking premium: 8 service types (airport, private, hourly, business, city tour, events, long distance, special occasions), passengers/children/child seats/luggage, flight number + airline (AviationStack – key to be provided), fixed-price routes managed in back-office (CDG → Paris 75 €), vehicle cards (photo, capacity), booking number, cancellation conditions, "Book again", detailed ratings
- Phase 3 i18n FR/EN/ES/AR/ZH/PT (auto-detect + profile) – app, notifications, SMS
- Phase 4 Trust & support: FAQ, support (WhatsApp/email/phone – details later), legal pages, company identity
- Phase 5 Admin back-office (clients, bookings, payments, zones, pricing grid) + hotel/concierge partner space
- Phase 6 International: Google/Apple sign-in, Apple Pay/Google Pay (Stripe), email receipts, SEO website

## Iteration 12–13 – Phase 2 booking premium (DONE) + Expo Go crash fix
- Phase 2 delivered & tested (backend 13/13, frontend OK): 8 services, trip details (pax/children/child seats/luggage/hours/flight), 5 vehicle categories with capacity + photos (van/van_premium use icon fallback – photos to replace later), fixed-price routes (12 seeded, moderator CRUD `/admin/fixed-routes`), booking ref RG-XXXXXX, cancellation policy text, detailed reviews, "Réserver à nouveau" (`/(passenger)?rebook=<ride_id>`), AviationStack module (`flights.py`, env `AVIATIONSTACK_API_KEY` empty → manual flight entry, `/flights/{n}` 503)
- Fix: expo-notifications must never be imported statically (crashes Android Expo Go). Use `src/utils/push.ts getNotifications()` (lazy require, null in Expo Go/web)

## Iteration 14 – Phase 3/4/5 partial: i18n, Help center, Catalog admin, vehicle photos (DONE, tested)
- i18n: `src/i18n` (fr/en/es/ar/zh/pt, auto-detect expo-localization, persisted, `useI18n().t()`), LanguagePicker in all profiles, `PATCH /auth/me {language}`. Translated: welcome, login, passenger tabs, home sheet core, TripDetails, VehicleCard, AccountSection, logout, service labels (backend). TODO: remaining screens (profile cards, rides list, ride detail, driver/company screens), notifications/SMS per user language, RTL layout for Arabic, FAQ in es/ar/zh/pt
- Help center: `GET /support/config?lang=` (env COMPANY_NAME, SUPPORT_WHATSAPP, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_HOURS – to fill), FAQ fr/en, WhatsApp/mail/tel deep links
- Moderator CatalogAdmin (profiles → "Grille tarifaire & photos véhicules"): fixed routes CRUD, vehicle photo upload `POST /admin/vehicles/{type}/photo` (Object Storage, public `GET /vehicle-photos/{path}`)

## Iteration 15 – translations extended, localized notifications, legal pages (DONE, tested)
- i18n keys now cover statuses, tabs (passenger/driver/company), profile titles, legal; remaining FR strings: rides subtitle, RideSummary chips, company dashboard, driver/company inner screens, RideOptions, profile cards
- Notifications localized via `catalog.NOTIF_I18N` (types accepted/started/completed/cancelled/arriving/reminder/flight) in `core.notify()`
- Legal: `GET /legal?lang=` (terms/privacy/cancellation fr/en) → LegalSheet from AccountSection. Support contacts still to be provided by user (env SUPPORT_*)

## Iteration 16–17 – Email receipts, Google sign-in, responsive audit (DONE, tested)
- Receipts: `emailer.py` (Emergent Resend proxy, EMAIL_FROM_NAME env), auto after paid completion, `GET /rides/{id}/receipt.pdf`, `POST /rides/{id}/send-receipt`, signed `GET /receipts/{id}.pdf?sig=`; UI buttons on ride detail
- Google sign-in: `POST /auth/session` (Emergent session-data → our JWT), `useGoogleAuth`/`GoogleButton` on login & register, callback in `app/index.tsx`
- Responsive: `useResponsive` (compact/tablet/desktop, FRAME_WIDTH 560), framed root & SheetModal on ≥600 px, dynamic snap points, wrap rows on compact phones, capped font scaling. Audit tested on 320/390/768/844x390/1280 – all pass

## Iteration 18 – Partner space hotels/concierges/agencies (DONE, tested 11/11 + UI)
- `partner_type` at company sign-up (hotel/concierge/agency → `partner_discount` env PARTNER_DISCOUNT=0.10). `POST/GET /company/bookings`, `GET /company/partner`; rides flagged `partner_booking`, `payment_status=invoiced`, guest SMS (booking + tracking link on accept). Company tab "Clients" (bookings.tsx + PartnerBookingForm). Geo search now biased to user position / Paris.
- Test account hotel.ritz@test.com / password123

## Iteration 19 – Partner commissions 5 % + monthly statement + payout (DONE, tested 13/13 backend + UI)
- Partners (hotel/concierge/agency) earn 5 % (PARTNER_RATE) on rides booked for their clients, credited to their wallet on ride completion (distribute_partner_commission, idempotent); cascades L2 3 % to the partner's sponsor. Existing guest discount kept (additive). Guest phone captured in db.partner_leads → on later signup the partner becomes sponsor (organic cascade). Endpoints: GET /company/commissions?month=, GET /company/commissions/export.pdf (reports.build_commission_pdf), POST /company/wallet/payout (min 10 €). /company/partner returns commission_rate+wallet_balance.
- UI: PartnerCommissions sheet (company profile → "Commissions & versements"): month nav, wallet hero, totals (direct/réseau), lines, PDF, on-demand payout (web-aware alerts). Delivered /app/CAHIER_DES_CHARGES.md (enterprise-grade spec).

## Iteration 20 – Admin payouts, auto monthly email, partner ranking (DONE, tested 12/12 + UI)
- Versements Admin: payouts now db.payouts {status pending|paid|rejected}. POST /company/wallet/payout debits (hold) + pending request. Moderator GET /company/admin/payouts?status=, PATCH /company/admin/payouts/{id} {status,note} (rejected → refund wallet payout_refund; re-decide → 409). UI PayoutsAdmin sheet in driver/passenger/company profiles (open-payouts-admin).
- Relevé automatique: server.py statements_loop (daily) → company.monthly_statement_sweep() emails each partner the previous month's statement at month start (idempotent via users.last_statement_month), signed public PDF GET /company/commission-statements/{id}.pdf?month=&sig= (emailer.send_partner_statement).
- Classement Partenaires: GET /company/ranking (rank, total_partners, commissioned_partners, my_total, leaderboard[], best_months[]) → ranking card (comm-ranking) in the commissions sheet.

## Iteration 21 – Export compta, badges fidélité, alerte filleul, notes clients (DONE, tested 13/13 backend + UI)
- Export Comptable: moderator GET /company/admin/payouts/export.csv|pdf (?token=, optional status=&month=), reports.build_payouts_csv/pdf; UI export buttons in PayoutsAdmin (payouts-export-csv/pdf).
- Badges Fidélité: referral.PARTNER_TIERS (bronze 5% / argent≥20 6% / or≥50 7% / platine≥100 8% by completed partner bookings); distribute_partner_commission uses the tier rate; /company/partner & /company/commissions return `tier`; UI badge card (comm-tier) with progress bar in PartnerCommissions.
- Alerte Nouveau Filleul: auth.register links sponsor_id from partner_leads AND notifies the partner ("Nouveau filleul").
- Notes Clients: db.partner_guests upserted on each partner booking + GET/POST/DELETE /company/guests; PartnerBookingForm quick-pick "Clients enregistrés" (guest-chip-{id} prefills, guest-del-{id} removes).
- Added tabBarButtonTestID to (company)/(driver)/(passenger) tab layouts (tab-company, tab-clients, tab-profile, …) for testability.

## Iteration 22 – PHASE 1 ride/booking/pricing overhaul (DONE, backend 8/8 + frontend verified)
- Stops/waypoints: EstimateIn/RideCreateIn accept stops[] (≤8); core.route_metrics sums legs; estimate/build_ride/modify use it. Booking home 'Ajouter un arrêt' (stop-picker) + ride edit + RideEditSheet.
- Modify ride: PATCH /rides/{id} (passenger only, until completed) edits pickup/dropoff/stops/vehicle/scheduled_at/pax/bags, recomputes price, notifies driver. UI 'Modifier la course' → RideEditSheet with live price.
- Waiting fees: core.wait_fee — departure 3 min free then 1€/min; each stop 2 min free then 1€/min. Driver /arrived, /stops/{i}/arrive|depart; /start freezes departure fee; /complete folds waiting+toll into final price/due. Live counters + breakdown in ride detail; driver stop buttons + wait note.
- Payment: card is default (cash kept secondary). Language: first-launch gate on welcome (AsyncStorage lang_onboarded) + auto-detect + settings; all screens use i18n (6 langs).
- PHASE 2 (pending, needs native build): saved cards, Apple/Google Pay, off-session auto-charge, prepay — via Stripe RN SDK + integration_expert.
