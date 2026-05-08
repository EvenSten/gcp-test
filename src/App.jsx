import { BrowserRouter, Routes, Route } from "react-router-dom";
import DonutDashboard from "./DonutDashboard";
import DataEditor from "./DataEditor";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DonutDashboard />} />
        <Route path="/editor" element={<DataEditor />} />
      </Routes>
    </BrowserRouter>
  );
}
