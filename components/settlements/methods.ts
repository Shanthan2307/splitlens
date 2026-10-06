/** UI payment methods ↔ DB (method, external_provider). Shared by server and client code. */
export type PaymentMethod = "cash" | "venmo" | "paypal" | "external" | "bank";

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "venmo", label: "Venmo" },
  { value: "paypal", label: "PayPal" },
  { value: "external", label: "Other app" },
  { value: "bank", label: "Bank" },
];

export function toServerMethod(m: PaymentMethod) {
  switch (m) {
    case "cash":
      return { method: "cash" as const };
    case "bank":
      return { method: "bank_transfer" as const };
    case "venmo":
      return { method: "external_app" as const, provider: "venmo" as const };
    case "paypal":
      return { method: "external_app" as const, provider: "paypal" as const };
    case "external":
      return { method: "external_app" as const, provider: "other" as const };
  }
}

export function fromServerMethod(method: string, provider: string | null): PaymentMethod {
  if (method === "bank_transfer") return "bank";
  if (method === "external_app") return provider === "venmo" ? "venmo" : provider === "paypal" ? "paypal" : "external";
  return "cash";
}
