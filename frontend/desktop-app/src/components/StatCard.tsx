export function StatCard({
  label,
  value,
  hint,
  accent = "tone-default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "tone-default" | "tone-success" | "tone-warning" | "tone-danger";
}) {
  return (
    <section className={`stat-card ${accent}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </section>
  );
}
