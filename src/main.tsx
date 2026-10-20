import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "framer-motion";
import "./index.css";
import "./reducedMotion.css";
import DesktopShell from "./DesktopShell";
import CRMLauncher from "./components/CRMLauncher";
import { installAndroidDownloads } from "./services/AndroidFiles";
import { installBackButton } from "./services/BackStack";

// Только в приложении для Android (на сайте и в Windows ничего не меняет): файлы через «Сохранить как»
// и системная кнопка «Назад». Ставим до первого рендера.
installAndroidDownloads();
installBackButton();

// MotionConfig reducedMotion="user": если в системе включено «Уменьшить движение», аватар и панели не двигаются.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <MotionConfig reducedMotion="user">
    <DesktopShell />
    <CRMLauncher />
  </MotionConfig>
);
