// Keep automatic link following to navigation-only URLs. The more powerful click tool
// passes through ActionGate confirmation and can be used deliberately for action links.
const ACTION_LINK_RE = /(?:logout|log[ -]?out|sign[ -]?out|delete|remove|unsubscribe|cancel[ -]?(?:subscription|account|order)?|checkout|payment|pay now|purchase|buy now|submit|send|transfer|revoke|reset[ -]?password|verify[ -]?email|confirm[ -]?email|activate[ -]?account|удал(?:ить|ение)|отпис(?:аться|ка)|отмен(?:ить|а)|оплат(?:ить|а)|покуп(?:ка|ать)|перевод|отправ(?:ить|ка)|подтверд(?:ить|ение)|сброс(?:ить| пароля))/i;

export function isPotentiallyConsequentialLink(name, rawUrl) {
  if (typeof name !== 'string' || typeof rawUrl !== 'string') return true;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return true;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return true;
  return ACTION_LINK_RE.test(name + ' ' + url.hostname + url.pathname + url.search);
}
