import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import DesktopShell from "./DesktopShell";
import CRMLauncher from "./components/CRMLauncher";
import { installAndroidDownloads } from "./services/AndroidFiles";
import { installBackButton } from "./services/BackStack";

// Только в приложении для Android (на сайте и в Windows ничего не меняет): файлы через «Сохранить как»
// и системная кнопка «Назад». Ставим до первого рендера.
installAndroidDownloads();
installBackButton();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <>
    <DesktopShell />
    <CRMLauncher />
  </>
);
