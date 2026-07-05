/**
 * =============================================================================
 * ITQAN STORE — FIREBASE CONFIG (firebase-config.js)
 * =============================================================================
 * إعداد مشروع Firebase الخاص بالمتجر (مشروع imam-warsh).
 *
 * ⚠️ عبّئ القيم الثلاث المحجوبة بين الأقواس [ ] بقيمها الحقيقية من:
 *    Firebase Console → ⚙️ Project settings → General → Your apps → </> → Config
 *      - apiKey            (يبدأ بـ AIza…)  ← عام وليس سريًا
 *      - messagingSenderId (أرقام)
 *      - appId             (1:...:web:...)
 * ما دامت الأقواس [ ] موجودة، يعمل الموقع بالبيانات المحلية (بدون Firebase).
 * =============================================================================
 */
globalThis.ITQAN_FIREBASE = {
  apiKey: "[API_KEY]",
  authDomain: "imam-warsh.firebaseapp.com",
  databaseURL: "https://imam-warsh-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "imam-warsh",
  storageBucket: "imam-warsh.appspot.com",
  messagingSenderId: "[SENDER_ID]",
  appId: "[APP_ID]"
};
