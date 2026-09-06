import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { installRendererAudioBridge } from "./audio/index.js";
import "./styles/base.css";

const container = document.getElementById("root");
if (!container) throw new Error('root element "#root" not found');

// Phase 13.6: the real microphone/speaker bridge lives in this renderer
// (only a Chromium renderer has `navigator.mediaDevices`/`AudioContext`),
// mounted once, independent of whatever screen the app happens to show.
installRendererAudioBridge();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
