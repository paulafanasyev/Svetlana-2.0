"""Список элементов экрана для Светланы: текст + рамка в координатах последнего скриншота.

Windows: UI Automation (кнопки, поля, пункты меню любой программы, в т.ч. 1С, браузер, Excel).
Если UIA ничего не дал (игры, Remote Desktop, «нарисованные» интерфейсы) или это macOS/Linux — распознавание
текста на скриншоте (Tesseract, языки rus+eng). Так Светлана видит любое приложение, даже без API.
"""
import sys

ROLES = {"ButtonControl": "button", "EditControl": "input", "MenuItemControl": "menu", "TabItemControl": "tab", "ListItemControl": "item",
         "TreeItemControl": "item", "HyperlinkControl": "link", "CheckBoxControl": "checkbox", "ComboBoxControl": "select", "TextControl": "text",
         "DataItemControl": "cell", "HeaderItemControl": "header", "RadioButtonControl": "radio", "DocumentControl": "document"}
CLICKABLE = {"button", "menu", "tab", "item", "link", "checkbox", "select", "radio", "cell", "header", "input"}


def _uia(geom, limit):
    import uiautomation as auto  # pip install uiautomation (только Windows)
    left, top, pw, ph, _lw, _lh, iw, ih = geom
    kx, ky = iw / pw, ih / ph
    win = auto.GetForegroundControl()
    out = []
    for ctl, _depth in auto.WalkControl(win, includeTop=True, maxDepth=14):
        if len(out) >= limit:
            break
        try:
            role = ROLES.get(ctl.ControlTypeName)
            name = (ctl.Name or "").strip() or (ctl.GetValuePattern().Value if role == "input" else "")
            if not role or not name and role not in ("input", "cell"):
                continue
            r = ctl.BoundingRectangle
            if r.width() < 4 or r.height() < 4 or ctl.IsOffscreen:
                continue
            box = [round((r.left - left) * kx), round((r.top - top) * ky), round((r.right - left) * kx), round((r.bottom - top) * ky)]
            if box[2] < 0 or box[3] < 0 or box[0] > iw or box[1] > ih:
                continue
            out.append({"role": role, "text": str(name)[:120], "box": box, "click": role in CLICKABLE, "enabled": bool(ctl.IsEnabled)})
        except Exception:
            continue
    return out


def _ocr(image, limit):
    import pytesseract  # pip install pytesseract + программа Tesseract с языком rus
    d = pytesseract.image_to_data(image, lang="rus+eng", output_type=pytesseract.Output.DICT, config="--psm 11")
    lines = {}
    for i, w in enumerate(d["text"]):
        w = (w or "").strip()
        if not w or float(d["conf"][i]) < 55:
            continue
        key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
        x, y, ww, hh = d["left"][i], d["top"][i], d["width"][i], d["height"][i]
        ln = lines.setdefault(key, {"words": [], "box": [x, y, x + ww, y + hh]})
        ln["words"].append(w)
        b = ln["box"]
        ln["box"] = [min(b[0], x), min(b[1], y), max(b[2], x + ww), max(b[3], y + hh)]
    out = [{"role": "text", "text": " ".join(v["words"])[:120], "box": v["box"], "click": True} for v in lines.values()]
    return sorted(out, key=lambda e: (e["box"][1] // 12, e["box"][0]))[:limit]


def ui_tree(eyes, limit=250):
    """eyes — объект Eyes из agent.py (нужны geom и последний кадр)."""
    if not eyes.geom or eyes.last_image is None:
        eyes.capture()
    errors = []
    if sys.platform == "win32":
        try:
            els = _uia(eyes.geom, limit)
            if len(els) >= 3:
                return {"source": "uia", "elements": els}
        except Exception as e:
            errors.append(f"uia: {e}")
    try:
        return {"source": "ocr", "elements": _ocr(eyes.last_image, limit)}
    except Exception as e:
        errors.append(f"ocr: {e}")
    return {"source": "none", "elements": [], "error": "; ".join(errors) or "нет данных"}
