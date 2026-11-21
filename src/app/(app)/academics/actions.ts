"use server";
import { act, str, optNum, reqNum, bool } from "@/server/action";
import * as A from "@/server/services/academics";

export const sessionAction = act(async (a, fd) => { await A.saveSession(a, optNum(fd, "id"), { name: str(fd, "name"), startDate: str(fd, "startDate"), endDate: str(fd, "endDate"), isCurrent: bool(fd, "isCurrent") }); return { message: "Session saved." }; });
export const termAction = act(async (a, fd) => { await A.saveTerm(a, optNum(fd, "id"), { sessionId: reqNum(fd, "sessionId"), name: str(fd, "name"), seq: reqNum(fd, "seq"), startDate: str(fd, "startDate"), endDate: str(fd, "endDate"), isCurrent: bool(fd, "isCurrent") }); return { message: "Term saved." }; });
export const classAction = act(async (a, fd) => { await A.saveClass(a, optNum(fd, "id"), { name: str(fd, "name"), levelOrder: reqNum(fd, "levelOrder"), nextClassId: optNum(fd, "nextClassId"), isTerminal: bool(fd, "isTerminal"), active: fd.get("active") !== "0" }); return { message: "Class saved." }; });
export const armAction = act(async (a, fd) => { await A.saveArm(a, optNum(fd, "id"), { classId: reqNum(fd, "classId"), name: str(fd, "name"), active: fd.get("active") !== "0" }); return { message: "Arm saved." }; });
