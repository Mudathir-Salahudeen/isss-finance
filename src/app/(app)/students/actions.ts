"use server";
import { act, str, optNum, reqNum } from "@/server/action";
import * as S from "@/server/services/students";
import * as F from "@/server/services/fees";

const studentFields = (fd: FormData) => ({
  admissionNo: str(fd, "admissionNo"), firstName: str(fd, "firstName"), middleName: str(fd, "middleName"), lastName: str(fd, "lastName"), gender: str(fd, "gender"),
  dateOfBirth: str(fd, "dateOfBirth") || null, guardianName: str(fd, "guardianName"), guardianPhone: str(fd, "guardianPhone"), guardianEmail: str(fd, "guardianEmail"), guardianAddress: str(fd, "guardianAddress"),
});

export const createStudentAction = act(async (a, fd) => {
  const id = await S.createStudent(a, { ...studentFields(fd), sessionId: reqNum(fd, "sessionId"), classId: reqNum(fd, "classId"), armId: optNum(fd, "armId") });
  return { redirect: `/students/${id}` };
});
export const updateStudentAction = act(async (a, fd) => { await S.updateStudent(a, reqNum(fd, "id"), studentFields(fd)); return { message: "Student details updated." }; });
export const statusAction = act(async (a, fd) => { await S.changeStatus(a, reqNum(fd, "id"), str(fd, "status"), str(fd, "effectiveDate") || null, str(fd, "reason")); return { message: "Status updated." }; });
export const placementAction = act(async (a, fd) => { await S.changeCurrentPlacement(a, reqNum(fd, "id"), reqNum(fd, "classId"), optNum(fd, "armId"), str(fd, "reason")); return { message: "Placement corrected." }; });
export const adjustAction = act(async (a, fd) => { await F.adjustCharge(a, reqNum(fd, "chargeId"), str(fd, "kind") as "waiver", str(fd, "amount"), str(fd, "reason")); return { message: "Adjustment recorded." }; });
export const reverseAdjAction = act(async (a, fd) => { await F.reverseAdjustment(a, reqNum(fd, "adjustmentId"), str(fd, "reason")); return { message: "Adjustment reversed." }; });
export const cancelChargeAction = act(async (a, fd) => { await F.cancelCharge(a, reqNum(fd, "chargeId"), str(fd, "reason")); return { message: "Charge cancelled." }; });
