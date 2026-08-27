// ── BPL Predictions backend config ───────────────────────────────────────────
// Predictions work LOCALLY (saved in your own browser) until you paste a free
// Firebase config below. Once filled in and published, predictions become SHARED
// across everyone with a live leaderboard.
//
// Setup (one time, ~5 min, free):
//   1. Go to https://console.firebase.google.com  → Add project (any name).
//   2. In the project: Build → Firestore Database → Create database
//        → Start in *production mode* → pick a location → Enable.
//   3. Firestore → Rules tab, paste this and Publish:
//        rules_version = '2';
//        service cloud.firestore {
//          match /databases/{db}/documents {
//            match /predictions/{doc} {
//              allow read: if true;
//              allow create, update: if request.resource.data.size() < 20
//                && request.resource.data.name is string
//                && request.resource.data.name.size() <= 40;
//            }
//          }
//        }
//   4. Project settings (gear) → General → "Your apps" → Web (</>) → register app
//        → copy the firebaseConfig values into the object below.
//   5. Save this file, then Publish the site (Admin → Publish).
window.BPL_FIREBASE = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  // (storageBucket / messagingSenderId / appId are optional for predictions)
};
