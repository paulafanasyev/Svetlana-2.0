// Автопрокрутка чата: только если человек и так внизу переписки. Кто прокрутил вверх и читает старое,
// того новая реплика не дёргает вниз (новую реплику диктор всё равно зачитает: журнал role="log").

/** Прокрутка у нижнего края (с запасом slack пикселей). */
export function nearBottom(scrollHeight: number, scrollTop: number, clientHeight: number, slack = 80): boolean {
  if (![scrollHeight, scrollTop, clientHeight].every(Number.isFinite)) return true;
  return scrollHeight - scrollTop - clientHeight <= slack;
}

/** Крутить ли вниз после новой реплики: человек был внизу или сам только что написал. */
export function shouldAutoScroll(wasNearBottom: boolean, lastRole: 'user' | 'svetlana' | undefined): boolean {
  return wasNearBottom || lastRole === 'user';
}
