import { formatMinor } from "@/lib/splits";
import { cn } from "@/lib/utils";

/** Formats minor units; `tone` colors positive (owed to you) green and negative (you owe) orange. */
export function Money({
  amount,
  currency,
  tone = false,
  absolute = false,
  className,
}: {
  amount: number;
  currency: string;
  tone?: boolean;
  absolute?: boolean;
  className?: string;
}) {
  const value = absolute ? Math.abs(amount) : amount;
  return (
    <span
      className={cn(
        "tabular-nums",
        tone && amount > 0 && "text-emerald-600 dark:text-emerald-400",
        tone && amount < 0 && "text-orange-600 dark:text-orange-400",
        className,
      )}
    >
      {formatMinor(value, currency)}
    </span>
  );
}

/** "you are owed $5 · you owe €3" style list of per-currency balances. */
export function BalanceList({
  balances,
  positive,
  negative,
  zero = "settled up",
  className,
}: {
  balances: Record<string, number>;
  positive: string;
  negative: string;
  zero?: string;
  className?: string;
}) {
  const entries = Object.entries(balances).filter(([, v]) => v !== 0);
  if (entries.length === 0) return <span className={cn("text-muted-foreground", className)}>{zero}</span>;
  return (
    <span className={cn("flex flex-col", className)}>
      {entries.map(([currency, amount]) => (
        <span key={currency}>
          <span className="text-muted-foreground">{amount > 0 ? positive : negative} </span>
          <Money amount={amount} currency={currency} tone absolute className="font-medium" />
        </span>
      ))}
    </span>
  );
}
