import { LogViewer } from "../components/LogViewer";

/**
 * `uploads/log` — one file per enroll, verify or mapping-save call, recording
 * every branch the handler took.
 *
 * DEPLOYMENT.md calls these the first thing to read when a check-in is
 * disputed: they name the token type used, the AI platform's own answer and
 * similarity score, the geo-fence decision and the stored image path.
 */
export function AttendanceLog() {
  return (
    <LogViewer
      source="attendance"
      title="Attendance log"
      description="Step-by-step record of every enroll, verify and geo-fence write."
      idLabel="Person ID"
      idPlaceholder="2020111007"
      emptyTitle="No attendance calls logged yet"
      emptyDetail="A file appears here for every enroll and verify."
    />
  );
}
