// Intl для Node без ICU (nodejs-mobile на Android). Ядру нужен только DateTimeFormat#formatToParts для «Сейчас: …» в системном промпте.
// Часовой пояс — местный пояс телефона (его знает система); опция timeZone не пересчитывается.
const pad = (n) => String(n).padStart(2, "0");
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

class DateTimeFormat {
  constructor(locale, opts = {}) { this.opts = { ...opts }; }
  formatToParts(d = new Date()) {
    const t = d instanceof Date ? d : new Date(d);
    return [["weekday", WD[t.getDay()]], ["literal", ", "], ["year", String(t.getFullYear())], ["literal", "-"], ["month", pad(t.getMonth() + 1)], ["literal", "-"],
      ["day", pad(t.getDate())], ["literal", ", "], ["hour", pad(t.getHours())], ["literal", ":"], ["minute", pad(t.getMinutes())]].map(([type, value]) => ({ type, value }));
  }
  format(d) { return this.formatToParts(d).map((p) => p.value).join(""); }
  resolvedOptions() { return { locale: "en-US", calendar: "gregory", numberingSystem: "latn", timeZone: process.env.SVETLANA_TZ || "UTC", ...this.opts }; }
}

export const Intl = { DateTimeFormat };
