export function DemoLabel({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--alert-medium)] bg-opacity-15 text-[var(--alert-medium)] border border-[var(--alert-medium)] border-opacity-30 ${className ?? ''}`}>
      ⚠ Sample data
    </span>
  );
}
