import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth, RequireRole } from "./components/RequireAuth";
import { useAuth } from "./hooks/useAuth";
import { homeFor } from "./lib/roles";
import { AttendanceLog } from "./pages/AttendanceLog";
import { AttendanceReports } from "./pages/AttendanceReports";
import { BuildingMapping } from "./pages/BuildingMapping";
import { EnrolledList } from "./pages/EnrolledList";
import { EnrollFace } from "./pages/EnrollFace";
import { LoginLog } from "./pages/LoginLog";
import { Login } from "./pages/Login";
import { MarkAttendance } from "./pages/MarkAttendance";
import { MyAttendance } from "./pages/MyAttendance";
import { Profile } from "./pages/Profile";

/**
 * Where a bare "/" and every unknown URL land.
 *
 * It has to be a component rather than a constant: the destination depends on
 * the signed-in role (an admin has no check-in screen to send them to), and a
 * signed-out visitor must reach /login instead of bouncing off a guard.
 */
function Home() {
  const { session } = useAuth();
  return <Navigate to={session ? homeFor(session.role) : "/login"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Home />} />

          {/* Every screen below sits behind RequireRole, which reads the same
              NAV table the header nav filters on (`lib/roles.ts`). Adding a
              route here without an entry there makes it permanently
              unreachable — that is deliberate: it fails closed. */}
          <Route element={<RequireRole />}>
            {/* Self-service: members only. Enrollment is still behind no
                permission key — enroll only ever registers the token holder's
                own face (§8.5) — but an admin account has no face to enroll. */}
            <Route path="/face-setup" element={<EnrollFace />} />
            <Route path="/attendance/mark" element={<MarkAttendance />} />
            <Route path="/attendance/my-reports" element={<MyAttendance />} />
            <Route path="/profile" element={<Profile />} />

            {/* Oversight: admin only. */}
            <Route path="/attendance/enrolled" element={<EnrolledList />} />
            <Route path="/attendance/reports" element={<AttendanceReports />} />
            <Route path="/attendance/buildings" element={<BuildingMapping />} />
            <Route path="/logs/login" element={<LoginLog />} />
            <Route path="/logs/attendance" element={<AttendanceLog />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Home />} />
    </Routes>
  );
}
