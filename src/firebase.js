import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

export const firebaseConfig = {
  apiKey: "AIzaSyCX6aDTH1TNo-JBh6UkyjVd7Mo7OQmLoj0",
  authDomain: "testdata-16710.firebaseapp.com",
  databaseURL: "https://testdata-16710-default-rtdb.firebaseio.com",
  projectId: "testdata-16710",
  storageBucket: "testdata-16710.firebasestorage.app",
  messagingSenderId: "827366099265",
  appId: "1:827366099265:web:881b97de7aaea75311f9c0",
  measurementId: "G-XH1NY87NQ3",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
