import { useNavigate } from "react-router-dom";
import "./Rick.css";

export default function Rick() {
  const navigate = useNavigate();

  return (
    <div className="rk-page">
      <div className="rk-blob rk-blob-cyan" />
      <div className="rk-blob rk-blob-purple" />

      <div className="rk-center">
        <button className="rk-back" onClick={() => navigate(-1)}>← Back</button>

        <button
          className="rk-big-btn"
          onClick={() => window.open("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "_blank")}
        >
          Do Not Press
        </button>
      </div>
    </div>
  );
}
