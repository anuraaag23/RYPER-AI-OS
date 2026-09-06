import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SettingsApp } from "./SettingsApp.js";
import "./styles/base.css";
import "./styles/settings.css";

const container = document.getElementById("root");
if (!container) throw new Error('root element "#root" not found');

createRoot(container).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>,
);
