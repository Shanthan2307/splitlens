import {
  BedDouble,
  Car,
  CarTaxiFront,
  CircleEllipsis,
  Clapperboard,
  Coffee,
  Dumbbell,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  House,
  Lightbulb,
  Music,
  PawPrint,
  Plane,
  Receipt,
  Repeat,
  Shirt,
  ShoppingCart,
  Sofa,
  SprayCan,
  SquareParking,
  Stethoscope,
  Ticket,
  TrainFront,
  UtensilsCrossed,
  Wifi,
  Wine,
  type LucideIcon,
} from "lucide-react";
import { categoryById, type Category } from "@/lib/categories";
import { cn } from "@/lib/utils";

const ICONS: Record<Category["icon"], LucideIcon> = {
  Receipt,
  UtensilsCrossed,
  ShoppingCart,
  Wine,
  Coffee,
  House,
  Lightbulb,
  Wifi,
  SprayCan,
  Sofa,
  CarTaxiFront,
  Fuel,
  SquareParking,
  TrainFront,
  Plane,
  Car,
  BedDouble,
  Ticket,
  Clapperboard,
  Gamepad2,
  Dumbbell,
  Music,
  Gift,
  Stethoscope,
  Shirt,
  GraduationCap,
  PawPrint,
  Repeat,
  CircleEllipsis,
};

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = ICONS[categoryById(category).icon];
  return (
    <span
      className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground", className)}
      aria-hidden
    >
      <Icon className="size-5" />
    </span>
  );
}
