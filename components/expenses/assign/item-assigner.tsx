"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { GripVertical, MoreHorizontal, Pencil, Plus, Scale, Trash2, Users } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { FormPerson } from "@/components/expenses/expense-form";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMinor, parseMajor, type DraftLine, type ItemizedPreview } from "@/lib/splits";
import { cn } from "@/lib/utils";
import { ItemEditDialog, LINE_KINDS } from "./item-edit-dialog";
import { SharesDialog } from "./shares-dialog";
import { useLongPress } from "./use-long-press";

type Props = {
  lines: DraftLine[];
  setLines: React.Dispatch<React.SetStateAction<DraftLine[]>>;
  people: FormPerson[];
  meId: string;
  currency: string;
  preview: ItemizedPreview;
};

type Editing = { index: number; line: DraftLine; isNew: boolean } | null;

const firstName = (p: FormPerson, meId: string) => (p.id === meId ? "You" : p.name.split(" ")[0]);

/**
 * Receipt review / item assignment.
 * Select mode: tap a person (sticky bar), then tap their items; tapping an item someone else
 * has makes it shared. Drag & drop: drag an avatar onto an item, or an item (grip) onto an avatar.
 * Long-press (or right-click / menu) an item for uneven shares. Digits 1–9 pick a person.
 */
export function ItemAssigner({ lines, setLines, people, meId, currency, preview }: Props) {
  const [activeId, setActiveId] = useState<string | null>(meId);
  const [editing, setEditing] = useState<Editing>(null);
  const [sharesFor, setSharesFor] = useState<number | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const owedBy = useMemo(() => new Map(preview.breakdown.map((b) => [b.participantId, b.owed])), [preview.breakdown]);
  const unassigned = new Set(preview.unassigned);
  const money = useCallback(
    (amount: string) => {
      try {
        return formatMinor(parseMajor(amount || "0", currency), currency);
      } catch {
        return amount || "—";
      }
    },
    [currency],
  );

  const updateLine = useCallback(
    (index: number, update: (line: DraftLine) => DraftLine) => setLines((ls) => ls.map((l, i) => (i === index ? update(l) : l))),
    [setLines],
  );

  const addPerson = useCallback(
    (index: number, personId: string) =>
      updateLine(index, (l) =>
        l.assignments.some((a) => a.participantId === personId)
          ? l
          : { ...l, assignments: [...l.assignments, { participantId: personId, weight: 1 }] },
      ),
    [updateLine],
  );

  const toggle = useCallback(
    (index: number) => {
      if (!activeId) {
        toast("Tap a person at the top first, then tap their items.");
        return;
      }
      updateLine(index, (l) =>
        l.assignments.some((a) => a.participantId === activeId)
          ? { ...l, assignments: l.assignments.filter((a) => a.participantId !== activeId) }
          : { ...l, assignments: [...l.assignments, { participantId: activeId, weight: 1 }] },
      );
    },
    [activeId, updateLine],
  );

  const everyone = useCallback(
    (index: number) => updateLine(index, (l) => ({ ...l, assignments: people.map((p) => ({ participantId: p.id, weight: 1 })) })),
    [people, updateLine],
  );

  const assignRemaining = () => {
    if (!activeId) return;
    setLines((ls) =>
      ls.map((l) => (l.kind === "item" && l.assignments.length === 0 ? { ...l, assignments: [{ participantId: activeId, weight: 1 }] } : l)),
    );
  };

  // dnd-kit: mouse drags after 6px; touch after a short hold (so scrolling still works); keyboard via space/arrows.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const onDragStart = (e: DragStartEvent) => setDragging(String(e.active.id));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over) return;
    const [kind, value] = String(active.id).split(":");
    const [overKind, overValue] = String(over.id).split(":");
    if (kind === "person" && overKind === "drop-item") addPerson(Number(overValue), value);
    if (kind === "item" && overKind === "drop-person") addPerson(Number(value), overValue);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const p = people[Number(e.key) - 1];
      if (p) {
        e.preventDefault();
        setActiveId(p.id);
      }
    }
  };

  const items = lines.map((l, i) => ({ line: l, index: i })).filter((x) => x.line.kind === "item");
  const charges = lines.map((l, i) => ({ line: l, index: i })).filter((x) => x.line.kind !== "item");
  const active = activeId ? byId.get(activeId) : undefined;
  const draggedPerson = dragging?.startsWith("person:") ? byId.get(dragging.slice(7)) : undefined;
  const draggedItem = dragging?.startsWith("item:") ? lines[Number(dragging.slice(5))] : undefined;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="space-y-4" onKeyDown={onKeyDown}>
        {/* Sticky people bar */}
        <div className="sticky -top-4 z-20 -mx-4 border-b bg-background/95 px-4 pt-3 pb-2 backdrop-blur sm:-mx-6 sm:px-6">
          <div role="toolbar" aria-label="Choose who you're assigning items to" className="flex gap-3 overflow-x-auto pb-1">
            {people.map((p, i) => (
              <PersonButton
                key={p.id}
                person={p}
                label={firstName(p, meId)}
                shortcut={i < 9 ? i + 1 : undefined}
                active={p.id === activeId}
                owed={owedBy.has(p.id) ? formatMinor(owedBy.get(p.id)!, currency) : null}
                onSelect={() => setActiveId(p.id === activeId ? null : p.id)}
              />
            ))}
          </div>
          <div className="mt-1 flex min-h-8 items-center justify-between gap-2 text-xs text-muted-foreground">
            <span aria-live="polite">
              {active ? (
                <>
                  Tap items for <span className="font-medium text-foreground">{firstName(active, meId)}</span>
                </>
              ) : (
                "Tap a person, then tap their items"
              )}
            </span>
            {active && preview.unassigned.length > 0 && (
              <Button type="button" size="sm" variant="secondary" className="h-7" onClick={assignRemaining}>
                Assign remaining ({preview.unassigned.length}) to {firstName(active, meId)}
              </Button>
            )}
          </div>
        </div>

        {items.length === 0 && <p className="text-sm text-muted-foreground">No items yet. Add them below or scan a receipt.</p>}

        <ul className="space-y-2" aria-label="Items">
          {items.map(({ line, index }) => (
            <ItemCard
              key={index}
              index={index}
              line={line}
              people={people}
              byId={byId}
              meId={meId}
              activeName={active ? firstName(active, meId) : null}
              activeOn={Boolean(activeId && line.assignments.some((a) => a.participantId === activeId))}
              unassigned={unassigned.has(index)}
              amount={money(line.amount)}
              unitPrice={line.unitPrice ? money(line.unitPrice) : null}
              onToggle={toggle}
              onShares={setSharesFor}
              onEveryone={everyone}
              onEdit={() => setEditing({ index, line, isNew: false })}
              onDelete={() => setLines((ls) => ls.filter((_, i) => i !== index))}
            />
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing({ index: lines.length, line: { kind: "item", name: "", amount: "", assignments: [] }, isNew: true })}
          >
            <Plus aria-hidden /> Item
          </Button>
          {(["tax", "tip", "service", "discount"] as const).map((kind) => (
            <Button
              key={kind}
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setEditing({
                  index: lines.length,
                  line: { kind, name: LINE_KINDS.find((k) => k.value === kind)!.label, amount: "", assignments: [] },
                  isNew: true,
                })
              }
            >
              <Plus aria-hidden /> {LINE_KINDS.find((k) => k.value === kind)!.label}
            </Button>
          ))}
        </div>

        {charges.length > 0 && (
          <section aria-label="Tax, tip and other charges" className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Tax, tip &amp; discounts</h3>
            <ul className="divide-y rounded-lg border">
              {charges.map(({ line, index }) => {
                const equal = line.distribution === "equal" || line.assignments.length === people.length;
                return (
                  <li key={index} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{line.name || LINE_KINDS.find((k) => k.value === line.kind)?.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {line.assignments.length > 0 && !equal
                          ? `Only ${line.assignments.map((a) => firstName(byId.get(a.participantId) ?? { id: "", name: "?", avatarUrl: null }, meId)).join(", ")}`
                          : equal
                            ? "Split equally"
                            : "Split by what each person had"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() =>
                        updateLine(index, (l) =>
                          equal ? { ...l, assignments: [], distribution: "proportional" } : { ...l, assignments: [], distribution: "equal" },
                        )
                      }
                      aria-label={equal ? "Split proportionally instead" : "Split equally instead"}
                    >
                      {equal ? "Proportional" : "Equal"}
                    </Button>
                    <span className="w-20 text-right tabular-nums">{money(line.amount)}</span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${line.name}`} onClick={() => setEditing({ index, line, isNew: false })}>
                      <Pencil />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <DragOverlay dropAnimation={null}>
        {draggedPerson && <PersonAvatar name={draggedPerson.name} avatarUrl={draggedPerson.avatarUrl} className="size-12 shadow-lg ring-2 ring-primary" />}
        {draggedItem && (
          <div className="rounded-md border bg-background px-3 py-2 text-sm shadow-lg">
            {draggedItem.name} · {money(draggedItem.amount)}
          </div>
        )}
      </DragOverlay>

      {editing && (
        <ItemEditDialog
          line={editing.line}
          currency={currency}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onDelete={() => {
            setLines((ls) => ls.filter((_, i) => i !== editing.index));
            setEditing(null);
          }}
          onSave={(line) => {
            setLines((ls) => (editing.isNew ? [...ls, line] : ls.map((l, i) => (i === editing.index ? line : l))));
            setEditing(null);
          }}
        />
      )}
      {sharesFor !== null && lines[sharesFor] && (
        <SharesDialog
          line={lines[sharesFor]}
          people={people}
          meId={meId}
          onClose={() => setSharesFor(null)}
          onSave={(assignments) => {
            updateLine(sharesFor, (l) => ({ ...l, assignments }));
            setSharesFor(null);
          }}
        />
      )}
    </DndContext>
  );
}

function PersonButton({
  person,
  label,
  shortcut,
  active,
  owed,
  onSelect,
}: {
  person: FormPerson;
  label: string;
  shortcut?: number;
  active: boolean;
  owed: string | null;
  onSelect: () => void;
}) {
  const drag = useDraggable({ id: `person:${person.id}` });
  const drop = useDroppable({ id: `drop-person:${person.id}` });
  return (
    <button
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      type="button"
      {...drag.listeners}
      {...drag.attributes}
      // dnd-kit sets role="button"; keep the toggle semantics for screen readers.
      aria-pressed={active}
      aria-label={`${person.name}${owed ? `, ${owed} so far` : ""}`}
      aria-roledescription="person, draggable"
      aria-keyshortcuts={shortcut ? String(shortcut) : undefined}
      onClick={onSelect}
      className={cn(
        "flex w-16 shrink-0 touch-manipulation flex-col items-center gap-0.5 rounded-lg py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
        drop.isOver && "bg-primary/10",
        drag.isDragging && "opacity-40",
      )}
    >
      <span className={cn("rounded-full p-0.5 transition-shadow", active ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "")}>
        <PersonAvatar name={person.name} avatarUrl={person.avatarUrl} className="size-11" />
      </span>
      <span className={cn("max-w-full truncate", active && "font-semibold")}>{label}</span>
      <span className="h-4 text-[11px] text-muted-foreground tabular-nums">{owed ?? ""}</span>
    </button>
  );
}

type ItemCardProps = {
  index: number;
  line: DraftLine;
  people: FormPerson[];
  byId: Map<string, FormPerson>;
  meId: string;
  activeName: string | null;
  activeOn: boolean;
  unassigned: boolean;
  amount: string;
  unitPrice: string | null;
  onToggle: (index: number) => void;
  onShares: (index: number) => void;
  onEveryone: (index: number) => void;
  onEdit: () => void;
  onDelete: () => void;
};

const ItemCard = memo(function ItemCard({
  index,
  line,
  people,
  byId,
  meId,
  activeName,
  activeOn,
  unassigned,
  amount,
  unitPrice,
  onToggle,
  onShares,
  onEveryone,
  onEdit,
  onDelete,
}: ItemCardProps) {
  const drop = useDroppable({ id: `drop-item:${index}` });
  const drag = useDraggable({ id: `item:${index}` });
  const press = useLongPress(
    () => onShares(index),
    () => onToggle(index),
  );
  const names = line.assignments.map((a) => {
    const p = byId.get(a.participantId);
    return p ? `${p.id === meId ? "you" : p.name}${a.weight && a.weight > 1 ? ` ×${a.weight}` : ""}` : "someone";
  });
  const status = unassigned ? "unassigned" : `on ${names.join(", ")}`;

  return (
    <li
      ref={drop.setNodeRef}
      data-unassigned={unassigned || undefined}
      className={cn(
        "flex items-stretch gap-1 rounded-lg border bg-card transition-colors",
        unassigned && "border-amber-500/70 bg-amber-500/5",
        activeOn && "border-primary bg-primary/5",
        drop.isOver && "ring-2 ring-primary",
        drag.isDragging && "opacity-40",
      )}
    >
      <button
        ref={drag.setNodeRef}
        type="button"
        {...drag.listeners}
        {...drag.attributes}
        aria-label={`Drag ${line.name} onto a person`}
        className="flex w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-l-lg text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>

      <button
        type="button"
        {...press}
        aria-pressed={activeOn}
        aria-label={`${line.name}, ${amount}, ${status}.${activeName ? ` Press to ${activeOn ? "remove" : "add"} ${activeName}.` : ""} Long-press for uneven shares.`}
        className="min-w-0 flex-1 touch-manipulation py-2.5 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-ring [-webkit-touch-callout:none]"
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{line.name || "Unnamed item"}</span>
          <span className="shrink-0 tabular-nums">{amount}</span>
        </span>
        {(line.originalName || (line.quantity && line.quantity !== "1")) && (
          <span className="flex gap-2 text-xs text-muted-foreground">
            {line.originalName && <span className="min-w-0 truncate">{line.originalName}</span>}
            {line.quantity && line.quantity !== "1" && (
              <span className="ml-auto shrink-0 tabular-nums">
                {line.quantity}
                {unitPrice ? ` × ${unitPrice}` : ""}
              </span>
            )}
          </span>
        )}
        <span className="mt-1.5 flex min-h-6 flex-wrap items-center gap-1">
          {unassigned ? (
            <Badge variant="outline" className="border-amber-500/70 text-amber-700 dark:text-amber-400">
              Unassigned
            </Badge>
          ) : (
            line.assignments.map((a) => {
              const p = byId.get(a.participantId);
              if (!p) return null;
              return (
                <span key={a.participantId} className="flex items-center gap-1 rounded-full bg-muted py-0.5 pr-2 pl-0.5 text-[11px]">
                  <PersonAvatar name={p.name} avatarUrl={p.avatarUrl} className="size-5" />
                  {p.id === meId ? "You" : p.name.split(" ")[0]}
                  {a.weight && a.weight > 1 ? <span className="font-semibold">×{a.weight}</span> : null}
                </span>
              );
            })
          )}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" className="m-1.5 self-start" aria-label={`More options for ${line.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEveryone(index)}>
            <Users aria-hidden /> Split with everyone ({people.length})
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onShares(index)}>
            <Scale aria-hidden /> Uneven shares…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil aria-hidden /> Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
});
