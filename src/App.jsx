import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, get } from "firebase/database";
import { auth, db } from "./firebase";
import DonutDashboard from "./DonutDashboard";
import DataEditor from "./DataEditor";
import Stocks from "./Stocks";
import Login from "./Login";
import AdminPanel from "./AdminPanel";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        // Block disabled accounts immediately
        try {
          const disabledSnap = await get(ref(db, `admin/disabledUsers/${u.uid}`));
          if (disabledSnap.exists()) {
            await signOut(auth);
            setUser(null);
            setIsAdmin(false);
            return;
          }
        } catch {
          // Network error — fail open so users aren't locked out
        }

        // Check admin status
        try {
          const adminSnap = await get(ref(db, `admin/admins/${u.uid}`));
          setIsAdmin(adminSnap.exists() && adminSnap.val() === true);
        } catch {
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
      setUser(u ?? null);
    });
    return () => unsub();
  }, []);

  if (user === undefined) {
    return <div style={{ background: "#080c14", minHeight: "100vh" }} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to="/" replace /> : <Login />}
        />
        <Route
          path="/"
          element={user ? <DonutDashboard isAdmin={isAdmin} /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/editor"
          element={user ? <DataEditor /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/stocks"
          element={user ? <Stocks /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/admin"
          element={
            user
              ? isAdmin
                ? <AdminPanel />
                : <Navigate to="/" replace />
              : <Navigate to="/login" replace />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
