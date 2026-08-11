import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyC3WRCJ9GRlh4BVIenOKPhpE3D3534VSIk",
  authDomain: "lekka-patra.firebaseapp.com",
  projectId: "lekka-patra",
  storageBucket: "lekka-patra.firebasestorage.app",
  messagingSenderId: "1098232502009",
  appId: "1:1098232502009:web:351beb279f85ab34143428",
  measurementId: "G-EBY21PTD0S",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.useDeviceLanguage();

// For dev/test in Firebase Console you can whitelist test numbers +91XXXXXXXXXX with a fixed OTP.
