import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import CRMLauncher from "./components/CRMLauncher";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <CRMLauncher />
  </>
);
