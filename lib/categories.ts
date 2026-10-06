/** Expense categories (Splitwise-style). `icon` is a lucide-react icon name resolved in components/expenses/category-icon.tsx. */
export const CATEGORIES = [
  { id: "general", label: "General", group: "Uncategorized", icon: "Receipt" },
  { id: "dining", label: "Dining out", group: "Food and drink", icon: "UtensilsCrossed" },
  { id: "groceries", label: "Groceries", group: "Food and drink", icon: "ShoppingCart" },
  { id: "drinks", label: "Drinks", group: "Food and drink", icon: "Wine" },
  { id: "coffee", label: "Coffee", group: "Food and drink", icon: "Coffee" },
  { id: "rent", label: "Rent", group: "Home", icon: "House" },
  { id: "utilities", label: "Utilities", group: "Home", icon: "Lightbulb" },
  { id: "internet", label: "Internet & phone", group: "Home", icon: "Wifi" },
  { id: "household", label: "Household supplies", group: "Home", icon: "SprayCan" },
  { id: "furniture", label: "Furniture", group: "Home", icon: "Sofa" },
  { id: "taxi", label: "Taxi & rideshare", group: "Transportation", icon: "CarTaxiFront" },
  { id: "fuel", label: "Gas & fuel", group: "Transportation", icon: "Fuel" },
  { id: "parking", label: "Parking", group: "Transportation", icon: "SquareParking" },
  { id: "transit", label: "Bus & train", group: "Transportation", icon: "TrainFront" },
  { id: "flights", label: "Flights", group: "Transportation", icon: "Plane" },
  { id: "car", label: "Car", group: "Transportation", icon: "Car" },
  { id: "lodging", label: "Hotel & lodging", group: "Travel", icon: "BedDouble" },
  { id: "entertainment", label: "Entertainment", group: "Entertainment", icon: "Ticket" },
  { id: "movies", label: "Movies", group: "Entertainment", icon: "Clapperboard" },
  { id: "games", label: "Games", group: "Entertainment", icon: "Gamepad2" },
  { id: "sports", label: "Sports", group: "Entertainment", icon: "Dumbbell" },
  { id: "music", label: "Music", group: "Entertainment", icon: "Music" },
  { id: "gifts", label: "Gifts", group: "Life", icon: "Gift" },
  { id: "medical", label: "Medical", group: "Life", icon: "Stethoscope" },
  { id: "clothing", label: "Clothing", group: "Life", icon: "Shirt" },
  { id: "education", label: "Education", group: "Life", icon: "GraduationCap" },
  { id: "pets", label: "Pets", group: "Life", icon: "PawPrint" },
  { id: "subscriptions", label: "Subscriptions", group: "Life", icon: "Repeat" },
  { id: "other", label: "Other", group: "Uncategorized", icon: "CircleEllipsis" },
] as const;

export type Category = (typeof CATEGORIES)[number];
export type CategoryId = Category["id"];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];

const BY_ID = new Map<string, Category>(CATEGORIES.map((c) => [c.id, c]));

/** Unknown ids (e.g. imported from Splitwise) fall back to General. */
export function categoryById(id: string): Category {
  return BY_ID.get(id) ?? CATEGORIES[0];
}
