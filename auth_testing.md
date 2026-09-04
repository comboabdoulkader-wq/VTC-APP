# Sign in with Apple — Testing Notes

## Config
- Frontend: `expo-apple-authentication` installed; `app.json` → `expo.ios.usesAppleSignIn: true` + plugin `expo-apple-authentication`.
- Backend: `POST /api/auth/apple` verifies the Apple identity token (RS256) against Apple JWKS, checking issuer `https://appleid.apple.com` and audience.
- `backend/.env` → `APPLE_AUDIENCES="com.emergent.vtcplatform.q33vdy,host.exp.Exponent"` (bundle id + Expo Go audience).

## What CAN be verified without a device
- `POST /api/auth/apple` with a bogus token → **401** "Jeton Apple invalide ou expiré" (confirms JWKS/audience verification path + config loaded). ✅ verified.
- In-process contract test (`tests/test_iteration27_apple_signin.py`, monkeypatched verification): ✅ passing
  - first sign-in creates a user with `apple_sub`, returns our JWT, JWT authenticates `/auth/me`;
  - second sign-in with same `apple_sub` returns the same user;
  - existing account with the same email gets linked (`apple_linked=true`, `apple_sub` set).

## What needs a REAL iOS build (cannot run in Expo Go / web / Android)
- The native `AppleAuthenticationButton` + `signInAsync` flow. The button only renders on iOS where `isAvailableAsync()` is true.
- End-to-end sign-in requires a real Apple ID on a physical iOS device after deploying and generating an iOS build.
- Apple returns the user's name/email **only on the first authorization** — the app forwards them then; later logins send only the identity token.

## Backend logic notes
- Users are keyed on `apple_sub` (not email — Apple may use a private relay email or none).
- Never overwrite stored name/email with nulls on later logins.
