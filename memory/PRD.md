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
