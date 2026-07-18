import { redirect } from "next/navigation";

// Root routes to the staff sign-in for now. The public booking portal ("/")
// is introduced in M5 and will replace this landing.
export default function Home() {
  redirect("/login");
}
