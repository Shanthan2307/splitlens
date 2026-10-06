import { Activity, CircleUser, LayoutDashboard, UserRound, Users, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/groups", label: "Groups", icon: Users },
  { href: "/friends", label: "Friends", icon: UserRound },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/account", label: "Account", icon: CircleUser },
];

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
