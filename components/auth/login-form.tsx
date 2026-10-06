"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { sendMagicLink, signInWithGoogle, type MagicLinkState } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const initialState: MagicLinkState = { status: "idle" };

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(sendMagicLink, initialState);

  if (state.status === "sent") {
    return (
      <div className="flex flex-col items-center gap-3 text-center" role="status">
        <MailCheck className="size-10 text-primary" aria-hidden />
        <p className="font-medium">Check your email</p>
        <p className="text-sm text-muted-foreground">
          We sent a sign-in link to <span className="font-medium text-foreground">{state.email}</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form action={signInWithGoogle}>
        {next && <input type="hidden" name="next" value={next} />}
        <Button type="submit" variant="outline" className="w-full">
          <GoogleIcon />
          Continue with Google
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" />
        or
        <Separator className="flex-1" />
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        {next && <input type="hidden" name="next" value={next} />}
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
        {state.status === "error" && (
          <p className="text-sm text-destructive" role="alert">
            {state.message}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Email me a sign-in link"}
        </Button>
      </form>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
