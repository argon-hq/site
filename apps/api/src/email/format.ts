// "Quarta-feira, 11 set 2026", as in the prototype. React escapes every value it renders, so the
// module no longer carries an escaping helper.
export function formatDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const month = get("month").replace(".", "");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${get("day")} ${month} ${get("year")}`;
}
