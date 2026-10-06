"use client";

import { UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { sendFriendRequestAction } from "@/app/(app)/friends/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AddFriendForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await sendFriendRequestAction({ email });
      if (!result.ok) return setError(result.error);
      toast.success(result.message);
      setEmail("");
    });
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <Label htmlFor="friend-email">Add a friend by email</Label>
      <div className="flex gap-2">
        <Input
          id="friend-email"
          type="email"
          placeholder="friend@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <Button type="submit" disabled={pending}>
          <UserPlus aria-hidden />
          Add
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
