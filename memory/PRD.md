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

## Backend structure
- `core.py` (config, DB, auth helpers, pricing, notify/SMS), `models.py`, `serializers.py`, `routes/{auth,rides,driver,team,payments,notifications}.py`, `server.py`

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
