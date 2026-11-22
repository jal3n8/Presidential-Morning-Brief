import { useEffect, useState } from "react";
import type { TerminalState } from "../lib/dataClient";
import { useAuth } from "../lib/auth";
import { loadAudit, rollbackTo, type AuditEntry } from "../lib/adminApi";
import { Badge, PageHeader, Panel, SectionNote } from "../components/ui";
import { fmtInstant, humanizeStatus } from "../lib/format";

export function AdminView({ data }: { data: TerminalState }) {
  const auth = useAuth();
  const tz = data.current?.snapshot.snapshot.displayTimezone ?? "America/New_York";
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const archived = data.archive.filter((e) => e.source !== "local");

  const refreshAudit = () => {
    if (auth.status === "preview") { setErr("The audit log lives on the server; it is not available in local preview."); return; }
    auth.getToken().then(loadAudit).then((e) => { setEntries(e.reverse()); setErr(null); }).catch((e: Error) => setErr(e.message));
  };
  useEffect(refreshAudit, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function doRollback() {
    setMsg(null);
    const r = await rollbackTo(await auth.getToken(), target);
    setMsg(r.message);
    setConfirm("");
    if (r.ok) { data.refresh(); refreshAudit(); }
  }

  return (
    <>
      <PageHeader kicker="Admin" title="Administration">Every action here is checked on the server and written to the audit log</PageHeader>
      <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <Panel kicker="Recovery" title="Roll back the published snapshot">
          <SectionNote>Points “latest” back to an archived snapshot, for example after a bad update. The replaced file is kept, and the action is audited.</SectionNote>
          <div className="mt-3 space-y-2">
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Archived snapshot">
              <option value="">Choose an archived snapshot…</option>
              {[...archived].reverse().map((e) => <option key={e.id} value={e.id}>{e.id} · {humanizeStatus(e.quality)}</option>)}
            </select>
            <input className="input" placeholder={target ? `Type ${target} to confirm` : "Type the id to confirm"} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Confirm id" />
            <button className="btn" disabled={!target || confirm !== target || auth.status === "preview"} onClick={() => void doRollback()}>Roll back to this snapshot</button>
            {auth.status === "preview" && <p className="text-2xs text-ivory-600">Disabled in local preview (no server).</p>}
            {msg && <p className="text-xs text-brass-300">{msg}</p>}
          </div>
        </Panel>

        <Panel kicker="Audit log" title="Recent administrative and data events" right={<button className="btn px-2 py-1" onClick={refreshAudit}>Reload</button>} pad={false}>
          {err && <div className="p-4"><SectionNote>{err}</SectionNote></div>}
          {!err && entries === null && <div className="p-4"><SectionNote>Loading…</SectionNote></div>}
          {entries && entries.length === 0 && <div className="p-4"><SectionNote>No entries yet.</SectionNote></div>}
          {entries && entries.length > 0 && (
            <div className="max-h-[560px] overflow-auto">
              <table className="tbl w-full text-xs">
                <thead><tr><th>When</th><th>Action</th><th>Result</th><th>Snapshot</th><th>By</th></tr></thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap font-mono text-ivory-300">{fmtInstant(e.at, tz)}</td>
                      <td className="text-ivory-100">{e.action}</td>
                      <td><Badge tone={["added", "replaced", "success", "duplicate"].includes(e.result) ? "up" : e.result === "denied" || e.result === "rejected" ? "down" : "caution"}>{e.result}</Badge></td>
                      <td className="font-mono text-ivory-300">{e.id ?? "—"}</td>
                      <td className="max-w-[160px] truncate font-mono text-2xs text-ivory-500" title={e.actor}>{e.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
