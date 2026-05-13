import { useState } from "react";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";
import { auth } from "./firebase";
import "./Login.css";

const googleProvider = new GoogleAuthProvider();

const AUTH_ERRORS = {
  "auth/user-not-found":      "No account found with this email.",
  "auth/wrong-password":      "Incorrect password.",
  "auth/invalid-credential":  "Incorrect email or password.",
  "auth/invalid-email":       "Invalid email address.",
  "auth/too-many-requests":   "Too many attempts. Try again later.",
  "auth/network-request-failed": "Network error. Check your connection.",
};

function friendlyError(code) {
  return AUTH_ERRORS[code] ?? "Something went wrong. Please try again.";
}

export default function Login() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handleEmail = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // App.jsx's onAuthStateChanged handles the redirect
    } catch (err) {
      setError(friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        setError(friendlyError(err.code));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ln-page">
      <div className="ln-blob ln-blob-cyan" />
      <div className="ln-blob ln-blob-purple" />

      <div className="ln-center">
        <div className="ln-brand">
          <div className="ln-logo">◈ NEXUS</div>
          <div className="ln-tagline">Budget Intelligence Platform</div>
        </div>

        <div className="ln-card">
          <div className="ln-card-title">SIGN IN</div>

          <form onSubmit={handleEmail} className="ln-form">
            <div className="ln-field">
              <label className="ln-label">EMAIL</label>
              <input
                className="ln-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="ln-field">
              <label className="ln-label">PASSWORD</label>
              <input
                className="ln-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && <div className="ln-error">{error}</div>}

            <button className="ln-submit" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <div className="ln-divider">
            <span>or</span>
          </div>

          <button className="ln-google" onClick={handleGoogle} disabled={loading}>
            <svg className="ln-google-icon" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
}
