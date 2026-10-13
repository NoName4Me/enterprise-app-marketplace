import { ResetForm } from "./reset-form";
export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };
export default function ResetPassword() {
  return <main className="reset-layout"><div className="card security-card"><ResetForm/></div></main>;
}
