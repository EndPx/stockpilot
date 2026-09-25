import { notFound, redirect } from "next/navigation";
import { isPrivyMode } from "@/lib/privy/config";

export default function CredentialsPage() {
  if (!isPrivyMode()) notFound();
  redirect("/wallet");
}
