// The example shop: sign up, sign in and out with the shop's own Better Auth (void/client). The
// affiliate program is its own app on its own address; it sees this sign-in.
import { useState, type FormEvent } from "react";
import { auth } from "void/client";
import type { Props } from "./index.server";

const AFFILIATES_URL = import.meta.env.DEV ? "http://localhost:5174/" : "/";

export default function Shop({ user }: Props) {
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>, mode: "up" | "in") {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    const email = text("email");
    const password = text("password");
    const result =
      mode === "up"
        ? await auth.signUp.email({ email, password, name: text("name") || email })
        : await auth.signIn.email({ email, password });
    if (result.error) setError(result.error.message ?? "Failed");
    else window.location.reload();
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "2rem auto" }}>
      <h1>Example shop</h1>
      {user ? (
        <>
          <p>Signed in as {user.email}.</p>
          <p>
            <a href={AFFILIATES_URL}>Affiliate program</a>
          </p>
          <button onClick={() => auth.signOut().then(() => window.location.reload())}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <form onSubmit={(e) => submit(e, "up")}>
            <h2>Sign up</h2>
            <input name="name" placeholder="Name" />{" "}
            <input name="email" type="email" placeholder="Email" required />{" "}
            <input name="password" type="password" placeholder="Password" minLength={8} required />{" "}
            <button type="submit">Sign up</button>
          </form>
          <form onSubmit={(e) => submit(e, "in")}>
            <h2>Sign in</h2>
            <input name="email" type="email" placeholder="Email" required />{" "}
            <input name="password" type="password" placeholder="Password" required />{" "}
            <button type="submit">Sign in</button>
          </form>
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </main>
  );
}
