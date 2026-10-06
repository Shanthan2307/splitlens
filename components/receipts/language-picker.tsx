"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LANGUAGE_TAGS, languageName, languageNameEn, type LanguageTag } from "@/lib/languages";
import { cn } from "@/lib/utils";

export const AUTO = "auto" as const;

/** Searchable language list (by English name, native name, or code). Optionally offers Auto-detect. */
export function LanguagePicker<T extends LanguageTag | typeof AUTO>({
  id,
  value,
  onChange,
  allowAuto = false,
}: {
  id?: string;
  value: T;
  onChange: (value: T) => void;
  allowAuto?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () =>
      LANGUAGE_TAGS.map((tag) => {
        const en = languageNameEn(tag);
        const native = languageName(tag);
        return { tag, label: en === native ? en : `${en} · ${native}`, search: `${en} ${native} ${tag}` };
      }).sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );
  const current = value === AUTO ? "Auto-detect" : options.find((o) => o.tag === value)?.label ?? value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className="truncate">{current}</span>
          <ChevronsUpDown className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search languages…" />
          <CommandList>
            <CommandEmpty>No language found.</CommandEmpty>
            <CommandGroup>
              {allowAuto && (
                <CommandItem
                  value="auto-detect automatic"
                  onSelect={() => {
                    onChange(AUTO as T);
                    setOpen(false);
                  }}
                >
                  <Check className={cn(value === AUTO ? "opacity-100" : "opacity-0")} aria-hidden />
                  Auto-detect
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem
                  key={o.tag}
                  value={o.search}
                  onSelect={() => {
                    onChange(o.tag as T);
                    setOpen(false);
                  }}
                >
                  <Check className={cn(value === o.tag ? "opacity-100" : "opacity-0")} aria-hidden />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
