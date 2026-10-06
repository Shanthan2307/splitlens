"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { saveAccount, type AccountFormState } from "@/app/(app)/account/actions";
import { initials } from "@/components/shell/initials";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCY_CODES, currencyName, type CurrencyCode } from "@/lib/currencies";
import { LANGUAGE_TAGS, languageName, type LanguageTag } from "@/lib/languages";
import { AVATAR_MIME_TYPES } from "@/lib/validation/profile";

type Props = {
  profile: {
    displayName: string;
    email: string | null;
    avatarUrl: string | null;
    defaultCurrency: CurrencyCode;
    preferredLanguage: LanguageTag;
    venmoUsername: string;
    paypalUsername: string;
  };
};

const initialState: AccountFormState = { status: "idle" };

export function AccountForm({ profile }: Props) {
  const [state, formAction, pending] = useActionState(saveAccount, initialState);
  const [preview, setPreview] = useState<string | null>(null);
  const currencies = useMemo(() => CURRENCY_CODES.map((code) => ({ code, name: currencyName(code) })), []);
  const languages = useMemo(() => LANGUAGE_TAGS.map((tag) => ({ tag, name: languageName(tag) })), []);

  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    if (state.status === "error" && !state.fieldErrors) toast.error(state.message);
  }, [state]);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar className="size-16">
          {(preview ?? profile.avatarUrl) && <AvatarImage src={preview ?? profile.avatarUrl ?? undefined} alt="" />}
          <AvatarFallback className="text-lg">{initials(profile.displayName || profile.email || "?")}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-2">
          <Label htmlFor="avatar">Profile photo</Label>
          <Input
            id="avatar"
            name="avatar"
            type="file"
            accept={AVATAR_MIME_TYPES.join(",")}
            aria-invalid={Boolean(errors.avatar)}
            onChange={(e) => {
              const file = e.target.files?.[0];
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
          />
          <FieldError message={errors.avatar} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">Name</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={profile.displayName}
          maxLength={80}
          required
          autoComplete="name"
          aria-invalid={Boolean(errors.displayName)}
        />
        <FieldError message={errors.displayName} />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Email</Label>
        <p className="text-sm text-muted-foreground">{profile.email ?? "—"}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="defaultCurrency">Default currency</Label>
        <Select name="defaultCurrency" defaultValue={profile.defaultCurrency}>
          <SelectTrigger id="defaultCurrency" className="w-full" aria-invalid={Boolean(errors.defaultCurrency)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currencies.map(({ code, name }) => (
              <SelectItem key={code} value={code}>
                {code} — {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError message={errors.defaultCurrency} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="preferredLanguage">Preferred language</Label>
        <Select name="preferredLanguage" defaultValue={profile.preferredLanguage}>
          <SelectTrigger id="preferredLanguage" className="w-full" aria-invalid={Boolean(errors.preferredLanguage)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {languages.map(({ tag, name }) => (
              <SelectItem key={tag} value={tag}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Receipts in other languages are translated into this one.</p>
        <FieldError message={errors.preferredLanguage} />
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-medium">Get paid back</legend>
        <p className="-mt-2 text-xs text-muted-foreground">
          Friends who owe you see a button that opens Venmo or PayPal with the amount filled in. SplitLens never handles money.
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="venmoUsername">Venmo username</Label>
          <Input
            id="venmoUsername"
            name="venmoUsername"
            placeholder="@your-name"
            defaultValue={profile.venmoUsername}
            aria-invalid={Boolean(errors.venmoUsername)}
          />
          <FieldError message={errors.venmoUsername} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="paypalUsername">PayPal.me name</Label>
          <Input
            id="paypalUsername"
            name="paypalUsername"
            placeholder="paypal.me/yourname"
            defaultValue={profile.paypalUsername}
            aria-invalid={Boolean(errors.paypalUsername)}
          />
          <FieldError message={errors.paypalUsername} />
        </div>
      </fieldset>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}
