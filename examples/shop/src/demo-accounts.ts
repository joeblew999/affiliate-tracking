// The shop page's one-tap demo sign-ins, from the demo people (affiliates/demo): its admin, and its
// first active partner (Maya), each with the partner program's page they go to.
import { demoPeople } from "affiliates/demo";

const admin = demoPeople.find((p) => p.role === "admin");
const partner = demoPeople.find((p) => p.partner?.status === "active");

export const demoAccounts = [
  ...(admin ? [{ label: "Sign in as the admin", email: admin.email, path: "/admin" }] : []),
  ...(partner
    ? [
        {
          label: `Sign in as ${partner.name.split(" ")[0]}, a partner`,
          email: partner.email,
          path: "/",
        },
      ]
    : []),
];
