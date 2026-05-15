import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";
import DonutDashboard from "./DonutDashboard";
import DataEditor from "./DataEditor";
import Stocks from "./Stocks";
import Login from "./Login";

function PrivateRoute({ children }) {
  return children;
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u ?? null));
    return () => unsub();
  }, []);

  // Blank dark screen while Firebase resolves auth state (avoids flash)
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
          element={user ? <DonutDashboard /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/editor"
          element={user ? <DataEditor /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/stocks"
          element={user ? <Stocks /> : <Navigate to="/login" replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}
