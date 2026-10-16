import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { blockBrowserFind, isTauriWindow } from "./lib/platform";
import "./index.css";

// The packaged app's Ctrl+F is the editor's find and replace (#547), never
// the webview's own find bar.
if (isTauriWindow) blockBrowserFind();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
