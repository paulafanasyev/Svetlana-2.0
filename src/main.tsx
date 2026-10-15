import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import DesktopShell from "./DesktopShell";
import CRMLauncher from "./components/CRMLauncher";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <>
    <DesktopShell />
    <CRMLauncher />
  </>
);
