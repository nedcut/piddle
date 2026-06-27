import React from "react";
import { createRoot } from "react-dom/client";
import PiddleAdvisor from "../web/PiddleAdvisor.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PiddleAdvisor />
  </React.StrictMode>,
);
