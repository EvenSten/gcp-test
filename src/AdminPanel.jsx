import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ref, onValue, set, remove, get } from "firebase/database";
import { signOut } from "firebase/auth";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut as tempSignOut } from "firebase/auth";
import { db, auth, firebaseConfig } from "./firebase";
import "./AdminPanel.css";

// Firebase keys can't contain dots — encode emails by replacing them with commas
function encodeEmail(email) {
  return email.toLowerCase().replace(/\./g, ",");
}

async function createAccountViaSecondaryApp(email, password) {
  const tempApp = initializeApp(firebaseConfig, `temp-${Date.now()}`);
  const tempAuth = getAuth(tempApp);
  try {
    const cred = await createUserWithEmailAndPassword(tempAuth, email, password);
    await tempSignOut(tempAuth);
    return { uid: cred.user.uid, email: cred.user.email };
  } finally {
    await deleteApp(tempApp);
  }
}

export default function AdminPanel() {
  const [tab, setTab] = useState("accounts");

  // Accounts state
  const [accounts, setAccounts] = useState({});
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [createMsg, setCreateMsg] = useState(null);
  const [creating, setCreating] = useState(false);

  // Gmail state
  const [gmails, setGmails] = useState({});
  const [newGmail, setNewGmail] = useState("");
  const [gmailMsg, setGmailMsg] = useState(null);

  useEffect(() => {
    const unsub = onValue(ref(db, "admin/accounts"), (snap) => {
      setAccounts(snap.val() || {});
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onValue(ref(db, "admin/allowedGmails"), (snap) => {
      setGmails(snap.val() || {});
    });
    return () => unsub();
  }, []);

  // ── Account actions ──────────────────────────────────────────

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setCreateMsg(null);
    try {
      const { uid, email } = await createAccountViaSecondaryApp(newEmail, newPassword);
      await set(ref(db, `admin/accounts/${uid}`), {
        email,
        provider: "email",
        createdAt: Date.now(),
        status: "active",
      });
      setNewEmail("");
      setNewPassword("");
      setCreateMsg({ type: "success", text: `Account created for ${email}` });
    } catch (err) {
      const text =
        err.code === "auth/email-already-in-use" ? "An account with this email already exists." :
        err.code === "auth/weak-password"        ? "Password must be at least 6 characters." :
        err.code === "auth/invalid-email"        ? "Invalid email address." :
        "Failed to create account. Please try again.";
      setCreateMsg({ type: "error", text });
    } finally {
      setCreating(false);
    }
  };

  const disableAccount = async (uid, account) => {
    await set(ref(db, `admin/accounts/${uid}/status`), "disabled");
    await set(ref(db, `admin/disabledUsers/${uid}`), {
      email: account.email,
      disabledAt: Date.now(),
    });
  };

  const enableAccount = async (uid) => {
    await set(ref(db, `admin/accounts/${uid}/status`), "active");
    await remove(ref(db, `admin/disabledUsers/${uid}`));
  };

  const removeAccount = async (uid) => {
    await remove(ref(db, `admin/accounts/${uid}`));
    await remove(ref(db, `admin/disabledUsers/${uid}`));
  };

  // ── Gmail actions ────────────────────────────────────────────

  const handleAddGmail = async (e) => {
    e.preventDefault();
    setGmailMsg(null);
    const email = newGmail.trim().toLowerCase();
    const key = encodeEmail(email);

    const existing = await get(ref(db, `admin/allowedGmails/${key}`));
    if (existing.exists()) {
      setGmailMsg({ type: "error", text: "This email is already on the allowlist." });
      return;
    }

    await set(ref(db, `admin/allowedGmails/${key}`), {
      email,
      addedAt: Date.now(),
    });
    setNewGmail("");
    setGmailMsg({ type: "success", text: `${email} added to the Gmail allowlist.` });
  };

  const removeGmail = async (key) => {
    await remove(ref(db, `admin/allowedGmails/${key}`));
  };

  // ── Render ───────────────────────────────────────────────────

  const accountList = Object.entries(accounts);
  const gmailList   = Object.entries(gmails);

  return (
    <div className="ap-page">
      <div className="ap-blob ap-blob-cyan" />
      <div className="ap-blob ap-blob-purple" />

      <header className="ap-header">
        <div>
          <div className="ap-logo">◈ NEXUS</div>
          <div className="ap-hsub">Admin Panel</div>
        </div>
        <div className="ap-hright">
          <Link to="/" className="ap-nav-link">← Dashboard</Link>
          <button className="ap-signout-btn" onClick={() => signOut(auth)}>Sign Out</button>
        </div>
      </header>

      <div className="ap-body">
        <div className="ap-tabs">
          <button
            className={`ap-tab${tab === "accounts" ? " ap-tab--active" : ""}`}
            onClick={() => setTab("accounts")}
          >
            ACCOUNTS
          </button>
          <button
            className={`ap-tab${tab === "gmails" ? " ap-tab--active" : ""}`}
            onClick={() => setTab("gmails")}
          >
            GMAIL ALLOWLIST
          </button>
        </div>

        {/* ── Accounts tab ── */}
        {tab === "accounts" && (
          <div className="ap-panels">
            <div className="ap-card">
              <div className="ap-card-title">CREATE EMAIL / PASSWORD ACCOUNT</div>
              <form onSubmit={handleCreate} className="ap-create-form">
                <div className="ap-field">
                  <label className="ap-label">EMAIL</label>
                  <input
                    className="ap-input"
                    type="email"
                    placeholder="user@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="ap-field">
                  <label className="ap-label">TEMPORARY PASSWORD</label>
                  <input
                    className="ap-input"
                    type="password"
                    placeholder="Min. 6 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <button className="ap-btn ap-btn--cyan" type="submit" disabled={creating}>
                  {creating ? "Creating…" : "Create Account"}
                </button>
              </form>
              {createMsg && (
                <div className={`ap-msg ap-msg--${createMsg.type}`}>{createMsg.text}</div>
              )}
            </div>

            <div className="ap-card">
              <div className="ap-card-title">
                MANAGED ACCOUNTS
                <span className="ap-count">{accountList.length}</span>
              </div>
              {accountList.length === 0 ? (
                <div className="ap-empty">No managed accounts yet. Create one above.</div>
              ) : (
                <div className="ap-list">
                  {accountList.map(([uid, acc]) => (
                    <div key={uid} className={`ap-row${acc.status === "disabled" ? " ap-row--disabled" : ""}`}>
                      <div className="ap-row-info">
                        <div className="ap-row-email">{acc.email}</div>
                        <div className="ap-row-meta">
                          <span className="ap-badge">
                            {acc.provider === "google" ? "Google" : "Email / Password"}
                          </span>
                          {acc.status === "disabled" && (
                            <span className="ap-badge ap-badge--red">Disabled</span>
                          )}
                          {acc.createdAt && (
                            <span className="ap-row-date">
                              Added {new Date(acc.createdAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="ap-row-actions">
                        {acc.status === "disabled" ? (
                          <button
                            className="ap-btn ap-btn--sm ap-btn--green"
                            onClick={() => enableAccount(uid)}
                          >
                            Enable
                          </button>
                        ) : (
                          <button
                            className="ap-btn ap-btn--sm ap-btn--orange"
                            onClick={() => disableAccount(uid, acc)}
                          >
                            Disable
                          </button>
                        )}
                        <button
                          className="ap-btn ap-btn--sm ap-btn--red"
                          onClick={() => removeAccount(uid)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Gmail allowlist tab ── */}
        {tab === "gmails" && (
          <div className="ap-panels">
            <div className="ap-card">
              <div className="ap-card-title">ADD GMAIL TO ALLOWLIST</div>
              <p className="ap-desc">
                Users with these addresses can sign in via "Continue with Google" for the first time.
                Addresses not on this list will be blocked.
              </p>
              <form onSubmit={handleAddGmail} className="ap-inline-form">
                <div className="ap-field ap-field--grow">
                  <label className="ap-label">GMAIL ADDRESS</label>
                  <input
                    className="ap-input"
                    type="email"
                    placeholder="someone@gmail.com"
                    value={newGmail}
                    onChange={(e) => setNewGmail(e.target.value)}
                    required
                  />
                </div>
                <button className="ap-btn ap-btn--cyan ap-btn--bottom" type="submit">
                  Add to Allowlist
                </button>
              </form>
              {gmailMsg && (
                <div className={`ap-msg ap-msg--${gmailMsg.type}`}>{gmailMsg.text}</div>
              )}
            </div>

            <div className="ap-card">
              <div className="ap-card-title">
                ALLOWED GMAIL ADDRESSES
                <span className="ap-count">{gmailList.length}</span>
              </div>
              {gmailList.length === 0 ? (
                <div className="ap-empty">No Gmail addresses on the allowlist yet.</div>
              ) : (
                <div className="ap-list">
                  {gmailList.map(([key, gmail]) => (
                    <div key={key} className="ap-row">
                      <div className="ap-row-info">
                        <div className="ap-row-email">{gmail.email}</div>
                        <div className="ap-row-meta">
                          <span className="ap-badge ap-badge--purple">Google OAuth</span>
                          {gmail.addedAt && (
                            <span className="ap-row-date">
                              Added {new Date(gmail.addedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="ap-row-actions">
                        <button
                          className="ap-btn ap-btn--sm ap-btn--red"
                          onClick={() => removeGmail(key)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
