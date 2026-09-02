import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { AttendanceReports } from "./pages/AttendanceReports";
import { BuildingMapping } from "./pages/BuildingMapping";
import { EnrolledList } from "./pages/EnrolledList";
import { EnrollFace } from "./pages/EnrollFace";
import { Login } from "./pages/Login";
import { MarkAttendance } from "./pages/MarkAttendance";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/attendance/mark" replace />} />

          {/* Enrollment is self-service — every user enrolls their own face —
              so it sits behind authentication but behind no permission key
              (§8.5). */}
          <Route path="/face-setup" element={<EnrollFace />} />

          <Route path="/attendance/mark" element={<MarkAttendance />} />
          <Route path="/attendance/enrolled" element={<EnrolledList />} />
          <Route path="/attendance/reports" element={<AttendanceReports />} />
          <Route path="/attendance/buildings" element={<BuildingMapping />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/attendance/mark" replace />} />
    </Routes>
  );
}
